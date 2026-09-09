import type {
  AssetDefinition,
  Busbar,
  ConnectionNetwork,
  ConnectionNode,
  DiagramElement,
  PowerSupplyChannel,
} from '../domain/project'
import { busbarPoint } from '../scene/connections'
import { networkPowerChannels } from '../scene/circuitPalette'
import type { Point } from '../scene/geometry'

export const POWER_SOURCE_ASSET_KEYS = new Set(['grid', 'generator', 'battery'])
export const POWER_TARGET_ASSET_KEYS = new Set(['compute-pod', 'power-pod', 'fm'])
export const POWER_DETAIL_TARGET_ASSET_KEYS = new Set(['cabinet-device'])
const POWER_DISTRIBUTION_ASSET_KEYS = new Set(['cabinet', 'cabinet-b'])

export interface DirectedFlowEdge {
  edgeId: string
  direction: 'forward' | 'reverse'
  startNodeId?: string
  endNodeId?: string
  speedMultiplier?: number
  flowRate?: number
}

type FlowDirection = DirectedFlowEdge['direction']

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
  selectedSupplyChannels: Record<string, PowerSupplyChannel>
}

interface GraphLink {
  to: string
  kind: 'line' | 'internal' | 'busbar'
  edgeId?: string
  lineLinkId?: string
  busbarLinkId?: string
}

interface FlowGraph {
  outgoing: Map<string, GraphLink[]>
  incoming: Map<string, GraphLink[]>
}

interface BusbarGraphLink {
  id: string
  busbarId: string
  leftNodeId: string
  rightNodeId: string
}

interface LineGraphLink {
  id: string
  edgeId: string
  startNodeId: string
  endNodeId: string
}

function connect(adjacency: Map<string, GraphLink[]>, from: string, link: GraphLink) {
  const links = adjacency.get(from)
  if (links) links.push(link)
  else adjacency.set(from, [link])
}

function connectDirected(
  graph: FlowGraph,
  from: string,
  to: string,
  link: Omit<GraphLink, 'to'>,
) {
  connect(graph.outgoing, from, { ...link, to })
  connect(graph.incoming, to, { ...link, to: from })
}

function connectPair(
  graph: FlowGraph,
  left: string,
  right: string,
  link: Omit<GraphLink, 'to'>,
) {
  connectDirected(graph, left, right, link)
  connectDirected(graph, right, left, link)
}

function connectNodeGroup(
  graph: FlowGraph,
  nodeIds: string[],
  kind: GraphLink['kind'],
) {
  for (let index = 1; index < nodeIds.length; index += 1) {
    connectPair(graph, nodeIds[index - 1], nodeIds[index], { kind })
  }
}

function graphDistances(
  adjacency: Map<string, GraphLink[]>,
  sourceNodeIds: string[],
  blockedLineEdgeIds: Set<string> = new Set(),
) {
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
      if (link.edgeId && blockedLineEdgeIds.has(link.edgeId)) continue
      if (distance.has(link.to)) continue
      distance.set(link.to, nextDistance)
      queue.push(link.to)
    }
  }
  return distance
}

function addFlowDirection(
  directionsById: Map<string, Set<FlowDirection>>,
  id: string,
  direction: FlowDirection,
) {
  const directions = directionsById.get(id)
  if (directions) directions.add(direction)
  else directionsById.set(id, new Set([direction]))
}

function uniqueFlowDirection(directions: Set<FlowDirection> | undefined) {
  return directions?.size === 1 ? directions.values().next().value : undefined
}

export function derivePowerFlowTopology({
  elements,
  assets = [],
  busbars,
  networks,
  switchStates,
  externalSupply = false,
  externalSupplyChannel,
  batteryBackup = false,
  resolvedBusbarTapOffsets = {},
}: {
  elements: DiagramElement[]
  assets?: AssetDefinition[]
  busbars: Busbar[]
  networks: ConnectionNetwork[]
  switchStates: Record<string, boolean>
  externalSupply?: boolean
  externalSupplyChannel?: PowerSupplyChannel
  batteryBackup?: boolean
  resolvedBusbarTapOffsets?: Record<string, number>
}): PowerFlowTopology {
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  const nodes = networks.flatMap((network) => network.nodes)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const channelsByNetworkId = new Map(networks.map((network) => {
    const channels = networkPowerChannels(network, elements, assetsByKey)
    return [network.id, channels.size === 1 ? [...channels][0] : channels.size ? undefined : network.powerSupplyChannel] as const
  }))
  const channelsByNodeId = new Map(networks.flatMap((network) => network.nodes.map((node) => [node.id, channelsByNetworkId.get(network.id)] as const)))
  const powerSupplyChannelByNodeId = new Map<string, PowerSupplyChannel>()
  for (const node of nodes) {
    if (node.kind !== 'element-anchor') continue
    const element = elementsById.get(node.elementId)
    const anchor = element
      ? assetsByKey.get(element.assetKey)?.anchors.find((candidate) => candidate.id === node.anchorId)
      : undefined
    // Network classification identifies a receiving device's supply, but must
    // not turn pass-through equipment (Switch, Transformer, etc.) into sinks.
    const isReceivingElement = element && (
      POWER_TARGET_ASSET_KEYS.has(element.assetKey) ||
      POWER_DETAIL_TARGET_ASSET_KEYS.has(element.assetKey)
    )
    const channel = anchor?.powerSupplyChannel ?? (
      isReceivingElement ? channelsByNodeId.get(node.id) : undefined
    )
    if (channel) {
      powerSupplyChannelByNodeId.set(node.id, channel)
    }
  }
  const dualSupplyElementIds = new Set(nodes.flatMap((node) => (
    node.kind === 'element-anchor' && powerSupplyChannelByNodeId.has(node.id)
      ? [node.elementId]
      : []
  )))
  const graph: FlowGraph = {
    outgoing: new Map<string, GraphLink[]>(),
    incoming: new Map<string, GraphLink[]>(),
  }

  const lineLinks: LineGraphLink[] = []
  const lineLinksByEdgeId = new Map<string, LineGraphLink[]>()
  for (const network of networks) {
    for (const edge of network.edges) {
      if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) continue
      const chain = [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
        .filter((nodeId) => nodesById.has(nodeId))
      for (let index = 1; index < chain.length; index += 1) {
        const startNodeId = chain[index - 1]
        const endNodeId = chain[index]
        const id = `line-flow:${edge.id}:${startNodeId}:${endNodeId}`
        const link = { kind: 'line' as const, edgeId: edge.id, lineLinkId: id }
        const lineGraphLink = { id, edgeId: edge.id, startNodeId, endNodeId }
        lineLinks.push(lineGraphLink)
        const edgeLinks = lineLinksByEdgeId.get(edge.id) ?? []
        edgeLinks.push(lineGraphLink)
        lineLinksByEdgeId.set(edge.id, edgeLinks)
        if (edge.flowDirection === 'forward') {
          connectDirected(graph, startNodeId, endNodeId, link)
        } else if (edge.flowDirection === 'reverse') {
          connectDirected(graph, endNodeId, startNodeId, link)
        } else {
          connectPair(graph, startNodeId, endNodeId, link)
        }
      }
    }
  }

  const elementNodeGroups = new Map<string, string[]>()
  const busbarNodeGroups = new Map<string, Extract<ConnectionNode, { kind: 'busbar-tap' }>[]> ()
  for (const node of nodes) {
    if (node.kind === 'element-anchor') {
      const group = elementNodeGroups.get(node.elementId)
      if (group) group.push(node.id)
      else elementNodeGroups.set(node.elementId, [node.id])
    } else if (node.kind === 'busbar-tap') {
      const group = busbarNodeGroups.get(node.busbarId)
      if (group) group.push(node)
      else busbarNodeGroups.set(node.busbarId, [node])
    }
  }

  for (const [elementId, nodeIds] of elementNodeGroups) {
    const element = elementsById.get(elementId)
    if (element && POWER_DISTRIBUTION_ASSET_KEYS.has(element.assetKey) && dualSupplyElementIds.has(element.id)) {
      const anchors = assetsByKey.get(element.assetKey)?.anchors ?? []
      const outputs = anchors.filter((anchor) => anchor.type === 'electrical' && !anchor.powerSupplyChannel)
        .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
      for (const channel of ['a', 'b'] as const) {
        const channelNodes = nodeIds.filter((nodeId) => {
          const node = nodesById.get(nodeId)
          if (node?.kind !== 'element-anchor') return false
          const anchor = anchors.find((item) => item.id === node.anchorId)
          if (!anchor) return false
          if (anchor.powerSupplyChannel) return anchor.powerSupplyChannel === channel
          // Prefer explicit network/downstream channel labels. The standard group
          // has two outputs ordered A/B in template coordinates (rotation independent).
          const outputChannel = channelsByNodeId.get(nodeId) ?? (outputs.length === 2
            ? outputs[0].id === anchor.id ? 'a' : 'b'
            : undefined)
          return outputChannel === channel
        })
        connectNodeGroup(graph, channelNodes, 'internal')
      }
      continue
    }
    if (
      !element ||
      dualSupplyElementIds.has(element.id) ||
      POWER_TARGET_ASSET_KEYS.has(element.assetKey) ||
      POWER_DETAIL_TARGET_ASSET_KEYS.has(element.assetKey)
    ) continue
    if (element.assetKey === 'switch' && switchStates[element.id] !== true) continue
    connectNodeGroup(graph, nodeIds, 'internal')
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
  const orderedBusbarTapNodeIds = new Map<string, string[]>()
  const configuredExternalEntries = networks.flatMap((network) => network.edges.flatMap((edge) => {
    if (!edge.externalSupplyEndpoint) return []
    const nodeId = edge.externalSupplyEndpoint === 'source'
      ? edge.sourceNodeId
      : edge.targetNodeId
    return nodesById.has(nodeId) ? [{ nodeId, channel: channelsByNetworkId.get(network.id) ?? edge.externalSupplyChannel }] : []
  }))
  const hasConfiguredExternalSources = configuredExternalEntries.length > 0
  const hasTypedExternalSources = configuredExternalEntries.some((entry) => entry.channel)
  const configuredExternalSourceNodeIds = externalSupply
    ? configuredExternalEntries.flatMap((entry) => {
        if (!externalSupplyChannel) return [entry.nodeId]
        if (!hasTypedExternalSources) return entry.channel ? [] : [entry.nodeId]
        return entry.channel === externalSupplyChannel ? [entry.nodeId] : []
      })
    : []
  const externalSourceNodeIds: string[] = [...configuredExternalSourceNodeIds]
  for (const [busbarId, tapNodes] of busbarNodeGroups) {
    const busbar = busbarsById.get(busbarId)
    if (!busbar) continue
    const ordered = [...tapNodes].sort((left, right) => (
      (resolvedBusbarTapOffsets[left.id] ?? left.offset) -
      (resolvedBusbarTapOffsets[right.id] ?? right.offset)
    ))
    orderedBusbarTapNodeIds.set(busbarId, ordered.map((node) => node.id))
    const externalEntry = busbar.monitorFlowDirection === 'end-to-start'
      ? ordered.at(-1)
      : ordered[0]
    if (externalSupply && !hasConfiguredExternalSources && externalEntry) {
      externalSourceNodeIds.push(externalEntry.id)
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1]
      const right = ordered[index]
      const id = `busbar-flow:${busbarId}:${left.id}:${right.id}`
      if (busbar.monitorFlowDirection === 'start-to-end') {
        connectDirected(graph, left.id, right.id, { kind: 'busbar', busbarLinkId: id })
      } else if (busbar.monitorFlowDirection === 'end-to-start') {
        connectDirected(graph, right.id, left.id, { kind: 'busbar', busbarLinkId: id })
      } else {
        connectPair(graph, left.id, right.id, { kind: 'busbar', busbarLinkId: id })
      }
      busbarLinks.push({ id, busbarId, leftNodeId: left.id, rightNodeId: right.id })
    }
  }

  if (externalSupply && !hasConfiguredExternalSources) {
    nodes.forEach((node) => {
      if (node.kind !== 'node') return
      const outgoingNeighbors = new Set(
        (graph.outgoing.get(node.id) ?? []).map((link) => link.to),
      )
      const incomingNeighbors = new Set(
        (graph.incoming.get(node.id) ?? []).map((link) => link.to),
      )
      if (outgoingNeighbors.size > 0 && incomingNeighbors.size === 0) {
        externalSourceNodeIds.push(node.id)
      }
    })
  }
  const externalSourceNodeGroup = [...new Set(externalSourceNodeIds)]
  const sourceNodeGroups = [
    ...[...elementNodeGroups].flatMap(([elementId, nodeIds]) => {
      const element = elementsById.get(elementId)
      return element && (
        POWER_SOURCE_ASSET_KEYS.has(element.assetKey) ||
        (batteryBackup && element.assetKey === 'battery-group')
      ) ? [nodeIds] : []
    }),
    ...(externalSourceNodeGroup.length ? [externalSourceNodeGroup] : []),
  ]
  const sourceNodeIds = sourceNodeGroups.flat()
  const blockedLineEdgeIds = new Set(networks.flatMap((network) => (
    network.edges.flatMap((edge) => (
      openSwitchNodeIds.has(edge.sourceNodeId) || openSwitchNodeIds.has(edge.targetNodeId)
        ? [edge.id]
        : []
    ))
  )))
  const availableDistance = graphDistances(graph.outgoing, sourceNodeIds, blockedLineEdgeIds)
  const selectedSupplyChannels: Record<string, PowerSupplyChannel> = {}
  for (const elementId of dualSupplyElementIds) {
    const channelNodeIds = nodes.flatMap((node) => (
      node.kind === 'element-anchor' && node.elementId === elementId
        ? [{ nodeId: node.id, channel: powerSupplyChannelByNodeId.get(node.id) }]
        : []
    ))
    if (channelNodeIds.some(({ nodeId, channel }) => channel === 'a' && availableDistance.has(nodeId))) {
      selectedSupplyChannels[elementId] = 'a'
    } else if (channelNodeIds.some(({ nodeId, channel }) => channel === 'b' && availableDistance.has(nodeId))) {
      selectedSupplyChannels[elementId] = 'b'
    }
  }
  const targetNodeIds = nodes.flatMap((node) => {
    if (node.kind === 'element-anchor') {
      const element = elementsById.get(node.elementId)
      const isTarget = element && (
        POWER_TARGET_ASSET_KEYS.has(element.assetKey) ||
        POWER_DETAIL_TARGET_ASSET_KEYS.has(element.assetKey) ||
        dualSupplyElementIds.has(element.id)
      )
      if (element && POWER_DISTRIBUTION_ASSET_KEYS.has(element.assetKey) && dualSupplyElementIds.has(element.id)) return []
      if (!isTarget) return []
      const selectedChannel = selectedSupplyChannels[node.elementId]
      const nodeChannel = powerSupplyChannelByNodeId.get(node.id)
      if (dualSupplyElementIds.has(node.elementId)) {
        return selectedChannel && nodeChannel === selectedChannel ? [node.id] : []
      }
      return [node.id]
    }
    if ((!externalSupply && !batteryBackup) || node.kind !== 'node') return []
    const outgoingNeighbors = new Set(
      (graph.outgoing.get(node.id) ?? []).map((link) => link.to),
    )
    const incomingNeighbors = new Set(
      (graph.incoming.get(node.id) ?? []).map((link) => link.to),
    )
    return outgoingNeighbors.size === 0 && incomingNeighbors.size > 0 ? [node.id] : []
  })
  const lineLinkDirections = new Map<string, Set<FlowDirection>>()
  const busbarLinkDirections = new Map<string, Set<FlowDirection>>()
  const flowingNodeIds = new Set<string>()

  // Trace independently from every source element so a nearby Battery or
  // Generator cannot suppress a longer but still valid Grid-to-target path.
  // The rendered result is the union of each source's shortest-path DAG.
  for (const sourceNodeGroup of sourceNodeGroups) {
    const distance = graphDistances(graph.outgoing, sourceNodeGroup, blockedLineEdgeIds)
    const flowingLineLinkIds = new Set<string>()
    const flowingBusbarLinkIds = new Set<string>()
    const tracedNodeIds = new Set<string>()
    const traceQueue = targetNodeIds.filter((nodeId) => {
      if (!distance.has(nodeId) || tracedNodeIds.has(nodeId)) return false
      tracedNodeIds.add(nodeId)
      return true
    })
    for (let cursor = 0; cursor < traceQueue.length; cursor += 1) {
      const nodeId = traceQueue[cursor]
      const nodeDistance = distance.get(nodeId)
      if (nodeDistance === undefined || nodeDistance === 0) continue
      for (const link of graph.incoming.get(nodeId) ?? []) {
        if (link.edgeId && blockedLineEdgeIds.has(link.edgeId)) continue
        if (distance.get(link.to) !== nodeDistance - 1) continue
        if (link.lineLinkId) flowingLineLinkIds.add(link.lineLinkId)
        if (link.busbarLinkId) flowingBusbarLinkIds.add(link.busbarLinkId)
        if (tracedNodeIds.has(link.to)) continue
        tracedNodeIds.add(link.to)
        traceQueue.push(link.to)
      }
    }
    tracedNodeIds.forEach((nodeId) => flowingNodeIds.add(nodeId))

    for (const link of lineLinks) {
      if (!flowingLineLinkIds.has(link.id)) continue
      const startDistance = distance.get(link.startNodeId)
      const endDistance = distance.get(link.endNodeId)
      if (
        startDistance === undefined ||
        endDistance === undefined ||
        startDistance === endDistance
      ) continue
      addFlowDirection(
        lineLinkDirections,
        link.id,
        startDistance < endDistance ? 'forward' : 'reverse',
      )
    }

    for (const link of busbarLinks) {
      if (!flowingBusbarLinkIds.has(link.id)) continue
      const leftDistance = distance.get(link.leftNodeId)
      const rightDistance = distance.get(link.rightNodeId)
      if (
        leftDistance === undefined ||
        rightDistance === undefined ||
        leftDistance === rightDistance
      ) continue
      addFlowDirection(
        busbarLinkDirections,
        link.id,
        leftDistance < rightDistance ? 'forward' : 'reverse',
      )
    }
  }

  // A detail device can have multiple explicitly directed incomers from the
  // same energized busbar (for example the paired TR04-UOS / capacity lines
  // feeding one UPS). Shortest-path tracing intentionally chooses only one of
  // those nearly parallel branches. Once the device is already on a valid
  // external-supply path, include its other explicitly inward busbar feeders
  // as real parallel conductors instead of treating them as dead-end detours.
  if (externalSupply && hasConfiguredExternalSources) {
    const flowingElementIds = new Set([...flowingNodeIds].flatMap((nodeId) => {
      const node = nodesById.get(nodeId)
      return node?.kind === 'element-anchor' ? [node.elementId] : []
    }))
    for (const network of networks) {
      for (const edge of network.edges) {
        if (blockedLineEdgeIds.has(edge.id)) continue
        const sourceNode = nodesById.get(edge.sourceNodeId)
        const targetNode = nodesById.get(edge.targetNodeId)
        let busbarToElementDirection: FlowDirection | null = null
        let elementNodeId: string | null = null
        if (
          sourceNode?.kind === 'busbar-tap' &&
          targetNode?.kind === 'element-anchor' &&
          edge.flowDirection === 'forward'
        ) {
          if (!availableDistance.has(sourceNode.id)) continue
          busbarToElementDirection = 'forward'
          elementNodeId = targetNode.elementId
        } else if (
          sourceNode?.kind === 'element-anchor' &&
          targetNode?.kind === 'busbar-tap' &&
          edge.flowDirection === 'reverse'
        ) {
          if (!availableDistance.has(targetNode.id)) continue
          busbarToElementDirection = 'reverse'
          elementNodeId = sourceNode.elementId
        }
        if (!busbarToElementDirection || !elementNodeId) continue
        const element = elementsById.get(elementNodeId)
        if (
          !element ||
          POWER_SOURCE_ASSET_KEYS.has(element.assetKey) ||
          !flowingElementIds.has(element.id)
        ) continue
        const selectedChannel = selectedSupplyChannels[element.id]
        const edgeElementNode = sourceNode?.kind === 'element-anchor'
          ? sourceNode
          : targetNode?.kind === 'element-anchor'
            ? targetNode
            : null
        const edgeChannel = edgeElementNode
          ? powerSupplyChannelByNodeId.get(edgeElementNode.id)
          : undefined
        if (
          selectedChannel &&
          dualSupplyElementIds.has(element.id) &&
          edgeChannel !== selectedChannel
        ) continue
        for (const link of lineLinksByEdgeId.get(edge.id) ?? []) {
          addFlowDirection(lineLinkDirections, link.id, busbarToElementDirection)
          flowingNodeIds.add(link.startNodeId)
          flowingNodeIds.add(link.endNodeId)
        }
      }
    }
  }

  const directedEdges: DirectedFlowEdge[] = []
  for (const network of networks) {
    for (const edge of network.edges) {
      const edgeLinks = lineLinksByEdgeId.get(edge.id) ?? []
      const directedLinks = edgeLinks.flatMap((link) => {
        const direction = uniqueFlowDirection(lineLinkDirections.get(link.id))
        return direction ? [{ ...link, direction }] : []
      })
      const fullDirection = directedLinks.length === edgeLinks.length &&
        directedLinks.length > 0 &&
        directedLinks.every((link) => link.direction === directedLinks[0].direction)
          ? directedLinks[0].direction
          : null
      if (fullDirection) {
        directedEdges.push({ edgeId: edge.id, direction: fullDirection })
      } else {
        directedEdges.push(...directedLinks.map((link) => ({
          edgeId: edge.id,
          direction: link.direction,
          startNodeId: link.startNodeId,
          endNodeId: link.endNodeId,
        })))
      }
    }
  }

  const automaticBusbarSegments = busbarLinks.flatMap((link) => {
    const busbar = busbarsById.get(link.busbarId)
    if (busbar?.monitorFlowDirection) return []
    const configuredDirections = busbarLinkDirections.get(link.id)
    let direction = uniqueFlowDirection(configuredDirections)
    const tapNodeIds = orderedBusbarTapNodeIds.get(link.busbarId) ?? []
    const fillConfiguredDetailBusbar = hasConfiguredExternalSources &&
      tapNodeIds.some((nodeId) => flowingNodeIds.has(nodeId))
    if (!direction && !configuredDirections && fillConfiguredDetailBusbar) {
      const leftDistance = availableDistance.get(link.leftNodeId)
      const rightDistance = availableDistance.get(link.rightNodeId)
      if (
        leftDistance !== undefined &&
        rightDistance !== undefined &&
        leftDistance !== rightDistance
      ) direction = leftDistance < rightDistance ? 'forward' : 'reverse'
    }
    if (!direction) return []
    const leftNode = nodesById.get(link.leftNodeId)
    const rightNode = nodesById.get(link.rightNodeId)
    if (
      !busbar ||
      leftNode?.kind !== 'busbar-tap' ||
      rightNode?.kind !== 'busbar-tap'
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
      id: link.id,
      busbarId: link.busbarId,
      start: direction === 'forward' ? leftPoint : rightPoint,
      end: direction === 'forward' ? rightPoint : leftPoint,
    }]
  })
  const automaticBusbarTailSegments = busbars.flatMap((busbar) => {
    if (busbar.monitorFlowDirection || !hasConfiguredExternalSources) return []
    const tapNodeIds = orderedBusbarTapNodeIds.get(busbar.id) ?? []
    if (!tapNodeIds.some((nodeId) => flowingNodeIds.has(nodeId))) return []
    const firstNode = nodesById.get(tapNodeIds[0])
    const lastNode = nodesById.get(tapNodeIds.at(-1)!)
    if (firstNode?.kind !== 'busbar-tap' || lastNode?.kind !== 'busbar-tap') return []
    const busbarStart = busbarPoint(busbar, 0)
    const busbarEnd = busbarPoint(busbar, busbar.length)
    const firstPoint = busbarPoint(
      busbar,
      resolvedBusbarTapOffsets[firstNode.id] ?? firstNode.offset,
    )
    const lastPoint = busbarPoint(
      busbar,
      resolvedBusbarTapOffsets[lastNode.id] ?? lastNode.offset,
    )
    return [
      ...(firstPoint.x === busbarStart.x && firstPoint.y === busbarStart.y
        ? []
        : [{
            id: `busbar-flow:tail-start:${busbar.id}`,
            busbarId: busbar.id,
            start: firstPoint,
            end: busbarStart,
          }]),
      ...(lastPoint.x === busbarEnd.x && lastPoint.y === busbarEnd.y
        ? []
        : [{
            id: `busbar-flow:tail-end:${busbar.id}`,
            busbarId: busbar.id,
            start: lastPoint,
            end: busbarEnd,
          }]),
    ]
  })
  const manualBusbarSegments = busbars.flatMap((busbar) => {
    const direction = busbar.monitorFlowDirection
    if (!direction) return []
    const tapNodeIds = orderedBusbarTapNodeIds.get(busbar.id) ?? []
    if (!tapNodeIds.some((nodeId) => flowingNodeIds.has(nodeId))) return []
    const start = busbarPoint(busbar, 0)
    const end = busbarPoint(busbar, busbar.length)
    if (start.x === end.x && start.y === end.y) return []
    return [{
      id: `busbar-flow:manual:${busbar.id}`,
      busbarId: busbar.id,
      start: direction === 'start-to-end' ? start : end,
      end: direction === 'start-to-end' ? end : start,
    }]
  })
  const directedBusbarSegments = [
    ...automaticBusbarSegments,
    ...automaticBusbarTailSegments,
    ...manualBusbarSegments,
  ]

  const energizedElementIds = new Set<string>()
  for (const nodeId of availableDistance.keys()) {
    const node = nodesById.get(nodeId)
    if (node?.kind === 'element-anchor') energizedElementIds.add(node.elementId)
  }

  return {
    edges: directedEdges,
    busbarSegments: directedBusbarSegments,
    energizedElementIds,
    selectedSupplyChannels,
  }
}
