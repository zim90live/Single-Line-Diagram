import type {
  Busbar,
  ConnectionNetwork,
  ConnectionNode,
  DiagramElement,
  LineSystemType,
  RouteWaypoint,
} from '../domain/project'
import { diagramObjectsBounds, snap, type Point, type Rect } from './geometry'

export type DiagramClipboardOperation = 'copy' | 'cut'

export interface DiagramSelectionClipboard {
  operation: DiagramClipboardOperation
  sourceDiagramId: string | null
  sourceLineSystemType: LineSystemType | null
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  selectedNodeIds: string[]
}

export function createEmptySelectionClipboard(): DiagramSelectionClipboard {
  return {
    operation: 'copy',
    sourceDiagramId: null,
    sourceLineSystemType: null,
    elements: [],
    busbars: [],
    connections: [],
    routeWaypoints: [],
    selectedNodeIds: [],
  }
}

export function clipboardCanPasteInto(
  clipboard: DiagramSelectionClipboard,
  lineSystemType: LineSystemType,
) {
  return clipboard.sourceLineSystemType === lineSystemType
}

export function centeredSelectionOffset(
  elements: DiagramElement[],
  busbars: Busbar[],
  targetCenter: Point,
  gridSize: number,
  connections: ConnectionNetwork[] = [],
): Point {
  const bounds = clipboardSelectionBounds(elements, busbars, connections)
  if (!bounds) return { x: 0, y: 0 }
  return {
    x: snap(targetCenter.x - (bounds.x + bounds.width / 2), gridSize),
    y: snap(targetCenter.y - (bounds.y + bounds.height / 2), gridSize),
  }
}

export function clipboardSelectionBounds(
  elements: DiagramElement[],
  busbars: Busbar[],
  connections: ConnectionNetwork[],
): Rect | null {
  const objectBounds = diagramObjectsBounds(elements, busbars)
  const freeNodes = connections.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'node' ? [node] : []
  )))
  if (!objectBounds && !freeNodes.length) return null
  const minX = Math.min(
    objectBounds?.x ?? Number.POSITIVE_INFINITY,
    ...freeNodes.map((node) => node.x),
  )
  const minY = Math.min(
    objectBounds?.y ?? Number.POSITIVE_INFINITY,
    ...freeNodes.map((node) => node.y),
  )
  const maxX = Math.max(
    objectBounds ? objectBounds.x + objectBounds.width : Number.NEGATIVE_INFINITY,
    ...freeNodes.map((node) => node.x),
  )
  const maxY = Math.max(
    objectBounds ? objectBounds.y + objectBounds.height : Number.NEGATIVE_INFINITY,
    ...freeNodes.map((node) => node.y),
  )
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function instantiateCopiedElement(
  element: DiagramElement,
  patch: Pick<DiagramElement, 'id' | 'diagramId' | 'x' | 'y'>,
  createId: ConnectionIdFactory = createConnectionId,
): DiagramElement {
  return {
    ...element,
    ...patch,
    monitorMetrics: element.monitorMetrics?.map((metric) => ({
      ...structuredClone(metric),
      id: createId('monitor-metric'),
    })),
    properties: structuredClone(element.properties),
    extensions: structuredClone(element.extensions),
  }
}

function nodeBelongsToSelection(
  node: ConnectionNode,
  selectedElementIds: Set<string>,
  selectedBusbarIds: Set<string>,
) {
  return node.kind === 'element-anchor'
    ? selectedElementIds.has(node.elementId)
    : node.kind === 'busbar-tap'
      ? selectedBusbarIds.has(node.busbarId)
      : false
}

function objectSelectionEdgeIds(
  network: ConnectionNetwork,
  selectedElementIds: Set<string>,
  selectedBusbarIds: Set<string>,
) {
  const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
  const selectedTerminalNodeIds = new Set(network.nodes.flatMap((node) => (
    nodeBelongsToSelection(node, selectedElementIds, selectedBusbarIds)
      ? [node.id]
      : []
  )))
  let edges = network.edges.filter((edge) => {
    const source = nodesById.get(edge.sourceNodeId)
    const target = nodesById.get(edge.targetNodeId)
    return source && target &&
      (source.kind === 'node' || selectedTerminalNodeIds.has(source.id)) &&
      (target.kind === 'node' || selectedTerminalNodeIds.has(target.id))
  })
  let pruned = true
  while (pruned) {
    const degree = new Map<string, number>()
    edges.forEach((edge) => {
      const chain = [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
      for (let index = 1; index < chain.length; index += 1) {
        degree.set(chain[index - 1], (degree.get(chain[index - 1]) ?? 0) + 1)
        degree.set(chain[index], (degree.get(chain[index]) ?? 0) + 1)
      }
    })
    const danglingJunctionIds = new Set(network.nodes.flatMap((node) => (
      node.kind === 'node' && (degree.get(node.id) ?? 0) < 2 ? [node.id] : []
    )))
    const nextEdges = edges.filter((edge) => (
      !danglingJunctionIds.has(edge.sourceNodeId) &&
      !danglingJunctionIds.has(edge.targetNodeId) &&
      !(edge.routeNodeIds ?? []).some((id) => danglingJunctionIds.has(id))
    ))
    pruned = nextEdges.length !== edges.length
    edges = nextEdges
  }
  if (!edges.length) return new Set<string>()

  const adjacency = new Map<string, Set<string>>()
  edges.forEach((edge) => {
    const chain = [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
    for (let index = 1; index < chain.length; index += 1) {
      const leftId = chain[index - 1]
      const rightId = chain[index]
      const left = adjacency.get(leftId) ?? new Set<string>()
      const right = adjacency.get(rightId) ?? new Set<string>()
      left.add(rightId)
      right.add(leftId)
      adjacency.set(leftId, left)
      adjacency.set(rightId, right)
    }
  })
  const componentByNodeId = new Map<string, number>()
  let component = 0
  adjacency.forEach((_neighbors, startId) => {
    if (componentByNodeId.has(startId)) return
    const pending = [startId]
    while (pending.length) {
      const nodeId = pending.pop()!
      if (componentByNodeId.has(nodeId)) continue
      componentByNodeId.set(nodeId, component)
      adjacency.get(nodeId)?.forEach((neighborId) => pending.push(neighborId))
    }
    component += 1
  })
  const selectedTerminalCountByComponent = new Map<number, number>()
  selectedTerminalNodeIds.forEach((nodeId) => {
    const componentId = componentByNodeId.get(nodeId)
    if (componentId === undefined) return
    selectedTerminalCountByComponent.set(
      componentId,
      (selectedTerminalCountByComponent.get(componentId) ?? 0) + 1,
    )
  })
  return new Set(edges.flatMap((edge) => (
    (selectedTerminalCountByComponent.get(componentByNodeId.get(edge.sourceNodeId)!) ?? 0) >= 2
      ? [edge.id]
      : []
  )))
}

export type ConnectionNodePointResolver = (
  network: ConnectionNetwork,
  node: ConnectionNode,
) => Point | null | undefined

export function copyConnectionsWithinSelection(
  networks: ConnectionNetwork[],
  selectedElementIds: Set<string>,
  selectedBusbarIds: Set<string>,
  selectedConnectionNodeIds: Set<string> = new Set(),
  resolveNodePoint?: ConnectionNodePointResolver,
) {
  return networks.flatMap((network) => {
    const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
    const selectedObjectEdgeIds = objectSelectionEdgeIds(
      network,
      selectedElementIds,
      selectedBusbarIds,
    )
    const directlySelectedEdgeIds = new Set(network.edges.flatMap((edge) => {
      const chain = [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
      return chain.some((nodeId) => selectedConnectionNodeIds.has(nodeId))
        ? [edge.id]
        : []
    }))
    let edges = network.edges.filter((edge) => (
      selectedObjectEdgeIds.has(edge.id) || directlySelectedEdgeIds.has(edge.id)
    ))
    if (!edges.length) return []

    const detachedPointsByNodeId = new Map<string, Point>()
    const materializableNode = (nodeId: string) => {
      const node = nodesById.get(nodeId)
      if (!node) return false
      if (
        node.kind === 'node' ||
        nodeBelongsToSelection(node, selectedElementIds, selectedBusbarIds)
      ) return true
      const point = resolveNodePoint?.(network, node)
      if (!point) return false
      detachedPointsByNodeId.set(node.id, point)
      return true
    }
    edges = edges.filter((edge) => (
      [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
        .every(materializableNode)
    ))
    if (!edges.length) return []
    const connectedNodeIds = new Set(edges.flatMap((edge) => [
      edge.sourceNodeId,
      ...(edge.routeNodeIds ?? []),
      edge.targetNodeId,
    ]))
    return [{
      ...network,
      nodes: network.nodes
        .filter((node) => connectedNodeIds.has(node.id))
        .map((node) => {
          const detachedPoint = detachedPointsByNodeId.get(node.id)
          return detachedPoint
            ? { id: node.id, kind: 'node' as const, ...detachedPoint }
            : { ...node }
        }),
      edges: edges.map((edge) => structuredClone(edge)),
    }]
  })
}

type ConnectionIdFactory = (prefix: string) => string

const createConnectionId: ConnectionIdFactory = (prefix) => (
  `${prefix}-${crypto.randomUUID()}`
)

export function instantiateCopiedConnections(
  networks: ConnectionNetwork[],
  diagramId: string,
  elementIdMap: Map<string, string>,
  busbarIdMap: Map<string, string>,
  createId: ConnectionIdFactory = createConnectionId,
  routeWaypointIdMap: Map<string, string> = new Map(),
  junctionOffset: Point = { x: 0, y: 0 },
  copiedNodeIdMap: Map<string, string> = new Map(),
) {
  return networks.flatMap((network) => {
    const nodeIdMap = new Map<string, string>()
    const nodes = network.nodes.flatMap((node) => {
      if (node.kind === 'node') {
        const id = routeWaypointIdMap.get(node.id) ?? createId('connection-node')
        nodeIdMap.set(node.id, id)
        copiedNodeIdMap.set(node.id, id)
        return [{
          ...node,
          id,
          x: node.x + junctionOffset.x,
          y: node.y + junctionOffset.y,
        }]
      }
      const ownerId = node.kind === 'element-anchor'
        ? elementIdMap.get(node.elementId)
        : busbarIdMap.get(node.busbarId)
      if (!ownerId) return []
      const id = createId(node.kind === 'element-anchor'
        ? 'connection-node'
        : 'connection-busbar-tap')
      nodeIdMap.set(node.id, id)
      copiedNodeIdMap.set(node.id, id)
      return [{
        ...node,
        id,
        ...(node.kind === 'element-anchor'
          ? { elementId: ownerId }
          : { busbarId: ownerId }),
      } as ConnectionNode]
    })
    const logicalConnectionIdMap = new Map<string, string>()
    const edges = network.edges.flatMap((edge) => {
      const sourceNodeId = nodeIdMap.get(edge.sourceNodeId)
      const targetNodeId = nodeIdMap.get(edge.targetNodeId)
      if (!sourceNodeId || !targetNodeId) return []
      const routeNodeIds = (edge.routeNodeIds ?? []).flatMap((id) => {
        const mapped = nodeIdMap.get(id)
        return mapped ? [mapped] : []
      })
      const { routeNodeIds: _routeNodeIds, ...edgeWithoutRouteWaypoints } = edge
      const logicalConnectionId = edge.logicalConnectionId
        ? logicalConnectionIdMap.get(edge.logicalConnectionId) ?? (() => {
            const id = createId('logical-connection')
            logicalConnectionIdMap.set(edge.logicalConnectionId!, id)
            return id
          })()
        : undefined
      return [{
            ...edgeWithoutRouteWaypoints,
            id: createId('connection-edge'),
            sourceNodeId,
            targetNodeId,
            ...(edge.monitorMetrics ? {
              monitorMetrics: edge.monitorMetrics.map((metric) => ({
                ...structuredClone(metric),
                id: createId('monitor-metric'),
              })),
            } : {}),
            ...(logicalConnectionId ? { logicalConnectionId } : {}),
            ...(routeNodeIds.length ? { routeNodeIds } : {}),
          }]
    })
    if (!edges.length) return []
    const connectedNodeIds = new Set(edges.flatMap((edge) => [
      edge.sourceNodeId,
      ...(edge.routeNodeIds ?? []),
      edge.targetNodeId,
    ]))
    return [{
      ...network,
      id: createId('connection-network'),
      diagramId,
      nodes: nodes.filter((node) => connectedNodeIds.has(node.id)),
      edges,
    }]
  })
}
