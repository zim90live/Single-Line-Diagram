import type {
  Busbar,
  ConnectionNetwork,
  ConnectionNode,
  DiagramElement,
} from '../domain/project'
import { busbarPoint } from '../editor/connections'
import type { Point } from '../editor/geometry'

export const POWER_SOURCE_ASSET_KEYS = new Set(['grid'])
export const POWER_TARGET_ASSET_KEYS = new Set(['compute-pod', 'power-pod'])

export interface DirectedFlowEdge {
  edgeId: string
  direction: 'forward' | 'reverse'
}

export interface DirectedBusbarFlowSegment {
  id: string
  busbarId: string
  start: Point
  end: Point
}

export interface PowerFlowTopology {
  edges: DirectedFlowEdge[]
  busbarSegments: DirectedBusbarFlowSegment[]
  energizedElementIds: Set<string>
}

interface GraphLink {
  to: string
  kind: 'line' | 'internal' | 'busbar'
  edgeId?: string
  busbarId?: string
}

interface BusbarGraphLink {
  busbarId: string
  leftNodeId: string
  rightNodeId: string
}

function connect(adjacency: Map<string, GraphLink[]>, from: string, link: GraphLink) {
  const links = adjacency.get(from)
  if (links) links.push(link)
  else adjacency.set(from, [link])
}

function connectPair(
  adjacency: Map<string, GraphLink[]>,
  left: string,
  right: string,
  link: Omit<GraphLink, 'to'>,
) {
  connect(adjacency, left, { ...link, to: right })
  connect(adjacency, right, { ...link, to: left })
}

function connectNodeGroup(
  adjacency: Map<string, GraphLink[]>,
  nodeIds: string[],
  kind: GraphLink['kind'],
) {
  for (let index = 1; index < nodeIds.length; index += 1) {
    connectPair(adjacency, nodeIds[index - 1], nodeIds[index], { kind })
  }
}

export function derivePowerFlowTopology({
  elements,
  busbars,
  networks,
  switchStates,
  resolvedBusbarTapOffsets = {},
}: {
  elements: DiagramElement[]
  busbars: Busbar[]
  networks: ConnectionNetwork[]
  switchStates: Record<string, boolean>
  resolvedBusbarTapOffsets?: Record<string, number>
}): PowerFlowTopology {
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  const nodes = networks.flatMap((network) => network.nodes)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const adjacency = new Map<string, GraphLink[]>()

  for (const network of networks) {
    for (const edge of network.edges) {
      if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) continue
      connectPair(adjacency, edge.sourceNodeId, edge.targetNodeId, {
        kind: 'line',
        edgeId: edge.id,
      })
    }
  }

  const elementNodeGroups = new Map<string, string[]>()
  const busbarNodeGroups = new Map<string, Extract<ConnectionNode, { kind: 'busbar-tap' }>[]> ()
  for (const node of nodes) {
    if (node.kind === 'element-anchor') {
      const group = elementNodeGroups.get(node.elementId)
      if (group) group.push(node.id)
      else elementNodeGroups.set(node.elementId, [node.id])
    } else {
      const group = busbarNodeGroups.get(node.busbarId)
      if (group) group.push(node)
      else busbarNodeGroups.set(node.busbarId, [node])
    }
  }

  for (const [elementId, nodeIds] of elementNodeGroups) {
    const element = elementsById.get(elementId)
    if (!element || POWER_TARGET_ASSET_KEYS.has(element.assetKey)) continue
    if (element.assetKey === 'switch' && switchStates[element.id] !== true) continue
    connectNodeGroup(adjacency, nodeIds, 'internal')
  }

  const openSwitchNodeIds = new Set(
    [...elementNodeGroups].flatMap(([elementId, nodeIds]) => {
      const element = elementsById.get(elementId)
      return element?.assetKey === 'switch' && switchStates[elementId] !== true
        ? nodeIds
        : []
    }),
  )

  const busbarLinks: BusbarGraphLink[] = []
  for (const [busbarId, tapNodes] of busbarNodeGroups) {
    if (!busbarsById.has(busbarId)) continue
    const ordered = [...tapNodes].sort((left, right) => (
      (resolvedBusbarTapOffsets[left.id] ?? left.offset) -
      (resolvedBusbarTapOffsets[right.id] ?? right.offset)
    ))
    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1]
      const right = ordered[index]
      connectPair(adjacency, left.id, right.id, { kind: 'busbar', busbarId })
      busbarLinks.push({ busbarId, leftNodeId: left.id, rightNodeId: right.id })
    }
  }

  const sourceNodeIds = nodes.flatMap((node) => {
    if (node.kind !== 'element-anchor') return []
    const element = elementsById.get(node.elementId)
    return element && POWER_SOURCE_ASSET_KEYS.has(element.assetKey) ? [node.id] : []
  })
  const distance = new Map<string, number>()
  const queue: string[] = []
  for (const nodeId of sourceNodeIds) {
    if (distance.has(nodeId)) continue
    distance.set(nodeId, 0)
    queue.push(nodeId)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor]
    const nextDistance = (distance.get(nodeId) ?? 0) + 1
    for (const link of adjacency.get(nodeId) ?? []) {
      if (distance.has(link.to)) continue
      distance.set(link.to, nextDistance)
      queue.push(link.to)
    }
  }

  const directedEdges: DirectedFlowEdge[] = []
  for (const network of networks) {
    for (const edge of network.edges) {
      // An open switch visually interrupts every conductor that terminates on it.
      // The graph still reaches the source-side anchor so upstream topology can be
      // evaluated, but neither immediately adjacent line is allowed to animate.
      if (
        openSwitchNodeIds.has(edge.sourceNodeId) ||
        openSwitchNodeIds.has(edge.targetNodeId)
      ) continue
      const sourceDistance = distance.get(edge.sourceNodeId)
      const targetDistance = distance.get(edge.targetNodeId)
      if (
        sourceDistance === undefined ||
        targetDistance === undefined ||
        sourceDistance === targetDistance
      ) continue
      directedEdges.push({
        edgeId: edge.id,
        direction: sourceDistance < targetDistance ? 'forward' : 'reverse',
      })
    }
  }

  const directedBusbarSegments = busbarLinks.flatMap((link) => {
    const busbar = busbarsById.get(link.busbarId)
    const leftNode = nodesById.get(link.leftNodeId)
    const rightNode = nodesById.get(link.rightNodeId)
    const leftDistance = distance.get(link.leftNodeId)
    const rightDistance = distance.get(link.rightNodeId)
    if (
      !busbar ||
      leftNode?.kind !== 'busbar-tap' ||
      rightNode?.kind !== 'busbar-tap' ||
      leftDistance === undefined ||
      rightDistance === undefined ||
      leftDistance === rightDistance
    ) return []
    const leftPoint = busbarPoint(
      busbar,
      resolvedBusbarTapOffsets[leftNode.id] ?? leftNode.offset,
    )
    const rightPoint = busbarPoint(
      busbar,
      resolvedBusbarTapOffsets[rightNode.id] ?? rightNode.offset,
    )
    if (leftPoint.x === rightPoint.x && leftPoint.y === rightPoint.y) return []
    return [{
      id: `busbar-flow:${link.busbarId}:${link.leftNodeId}:${link.rightNodeId}`,
      busbarId: link.busbarId,
      start: leftDistance < rightDistance ? leftPoint : rightPoint,
      end: leftDistance < rightDistance ? rightPoint : leftPoint,
    }]
  })

  const energizedElementIds = new Set<string>()
  for (const nodeId of distance.keys()) {
    const node = nodesById.get(nodeId)
    if (node?.kind === 'element-anchor') energizedElementIds.add(node.elementId)
  }

  return {
    edges: directedEdges,
    busbarSegments: directedBusbarSegments,
    energizedElementIds,
  }
}
