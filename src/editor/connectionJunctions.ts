import {
  resolveConnectionType,
  type AnchorType,
  type AssetDefinition,
  type Busbar,
  type ConnectionEdge,
  type ConnectionNetwork,
  type ConnectionNode,
  type DiagramElement,
  type RouteWaypoint,
} from '../domain/project'
import {
  busbarPoint,
  connectTerminals,
  normalizeConnectionNetworks,
  resolveElementAnchor,
  type ConnectionTerminal,
  type RoutedConnectionEdge,
} from '../scene/connections'
import type { Point } from './geometry'
import { garbageCollectRouteWaypoints } from './routeWaypoints'

const EPSILON = 0.0001

type IdFactory = (prefix: string) => string

const defaultIdFactory: IdFactory = (prefix) => `${prefix}-${crypto.randomUUID()}`

function pointsEqual(left: Point, right: Point) {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON
}

function pointOnSegment(point: Point, start: Point, end: Point) {
  if (Math.abs(start.y - end.y) < EPSILON) {
    return Math.abs(point.y - start.y) < EPSILON &&
      point.x >= Math.min(start.x, end.x) - EPSILON &&
      point.x <= Math.max(start.x, end.x) + EPSILON
  }
  if (Math.abs(start.x - end.x) < EPSILON) {
    return Math.abs(point.x - start.x) < EPSILON &&
      point.y >= Math.min(start.y, end.y) - EPSILON &&
      point.y <= Math.max(start.y, end.y) + EPSILON
  }
  return false
}

function routeDistanceAtPoint(route: RoutedConnectionEdge, point: Point) {
  let distance = 0
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1]
    const end = route.points[index]
    if (pointOnSegment(point, start, end)) {
      return distance + Math.abs(point.x - start.x) + Math.abs(point.y - start.y)
    }
    distance += Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
  }
  return null
}

function withRouteWaypoints(edge: ConnectionEdge, routeNodeIds: string[]) {
  const { routeNodeIds: _routeNodeIds, ...rest } = edge
  return routeNodeIds.length ? { ...rest, routeNodeIds } : rest
}

function uniqueNodes(nodes: ConnectionNode[]) {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })
}

function networkIndexById(networks: ConnectionNetwork[], networkId: string) {
  return networks.findIndex((network) => network.id === networkId)
}

function busbarOffsetAtPoint(busbar: Busbar, point: Point) {
  const end = busbarPoint(busbar, busbar.length)
  if (!pointOnSegment(point, busbar, end)) return null
  return busbar.orientation === 'horizontal'
    ? point.x - busbar.x
    : point.y - busbar.y
}

function mergeNetworksSharingBusbar(
  networks: ConnectionNetwork[],
  busbarId: string,
  preferredNetworkId: string,
) {
  const affectedIndexes = networks.flatMap((network, index) => (
    network.nodes.some((node) => (
      node.kind === 'busbar-tap' && node.busbarId === busbarId
    )) ? [index] : []
  ))
  if (affectedIndexes.length < 2) return networks
  const affectedNetworks = affectedIndexes.map((index) => networks[index])
  if (resolveConnectionType(affectedNetworks.map((network) => network.type)) !== 'electrical') {
    return null
  }
  const preferredIndex = affectedIndexes.find((index) => (
    networks[index].id === preferredNetworkId
  )) ?? affectedIndexes[0]
  const merged: ConnectionNetwork = {
    ...networks[preferredIndex],
    type: 'electrical',
    nodes: uniqueNodes(affectedNetworks.flatMap((network) => network.nodes)),
    edges: affectedNetworks.flatMap((network) => network.edges),
  }
  const affectedIndexSet = new Set(affectedIndexes)
  return networks.flatMap((network, index) => {
    if (index === preferredIndex) return [merged]
    return affectedIndexSet.has(index) ? [] : [network]
  })
}

export interface RouteJunctionTarget {
  networkId: string
  point: Point
  edgeIds: string[]
}

export interface JunctionConnectionResult {
  networks: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  junctionId: string
  junctionNetworkId: string
  connectionEdgeId: string | null
}

export function connectTerminalToRouteJunction({
  networks,
  routeWaypoints,
  routedEdges,
  diagramId,
  source,
  target,
  createId = defaultIdFactory,
}: {
  networks: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  routedEdges: RoutedConnectionEdge[]
  diagramId: string
  source?: ConnectionTerminal
  target: RouteJunctionTarget
  createId?: IdFactory
}): JunctionConnectionResult | null {
  const targetNetwork = networks.find((network) => network.id === target.networkId)
  if (
    !targetNetwork ||
    !resolveConnectionType([
      ...(source ? [source.type] : []),
      targetNetwork.type,
    ])
  ) return null

  const waypointsById = new Map(routeWaypoints.map((waypoint) => [waypoint.id, waypoint]))
  networks.forEach((network) => network.nodes.forEach((node) => {
    if (node.kind === 'node') waypointsById.set(node.id, node)
  }))
  const collidingWaypointIds = new Set(routeWaypoints.flatMap((waypoint) => (
    pointsEqual(waypoint, target.point) ? [waypoint.id] : []
  )))
  const affectedNetworkIds = new Set<string>([target.networkId])
  networks.forEach((network) => {
    if (network.nodes.some((node) => (
      node.kind === 'node' && pointsEqual(node, target.point)
    )) || network.edges.some((edge) => (
      (edge.routeNodeIds ?? []).some((id) => collidingWaypointIds.has(id))
    ))) affectedNetworkIds.add(network.id)
  })
  const affectedNetworks = networks.filter((network) => affectedNetworkIds.has(network.id))
  const resolvedType = resolveConnectionType([
    ...(source ? [source.type] : []),
    ...affectedNetworks.map((network) => network.type),
  ])
  if (!resolvedType) return null

  const existingJunction = affectedNetworks.flatMap((network) => network.nodes).find((node) => (
    node.kind === 'node' && pointsEqual(node, target.point)
  ))
  const junctionId = existingJunction?.id ?? [...collidingWaypointIds][0] ?? createId('connection-node')
  const replacedJunctionIds = new Set(affectedNetworks.flatMap((network) => (
    network.nodes.flatMap((node) => (
      node.kind === 'node' && pointsEqual(node, target.point) ? [node.id] : []
    ))
  )))
  const routesByEdgeId = new Map(routedEdges.map((route) => [route.edgeId, route]))
  const explicitTargetEdgeIds = new Set(target.edgeIds)
  const primaryIndex = networkIndexById(networks, target.networkId)
  if (primaryIndex < 0) return null

  let insertFailed = false
  const transformed = affectedNetworks.map((network) => {
    const participantEdgeIds = new Set(network.edges.flatMap((edge) => (
      explicitTargetEdgeIds.has(edge.id) ||
      (edge.routeNodeIds ?? []).some((id) => collidingWaypointIds.has(id))
        ? [edge.id]
        : []
    )))
    const remapNodeId = (nodeId: string) => (
      replacedJunctionIds.has(nodeId) || collidingWaypointIds.has(nodeId)
        ? junctionId
        : nodeId
    )
    const nodes = uniqueNodes([
      ...network.nodes.flatMap((node) => {
        if (node.kind !== 'node' || !replacedJunctionIds.has(node.id)) return [node]
        return node.id === junctionId ? [{ ...node, ...target.point }] : []
      }),
      {
        id: junctionId,
        kind: 'node' as const,
        ...target.point,
      },
    ])
    const edges = network.edges.flatMap((edge) => {
      const remapped = {
        ...edge,
        sourceNodeId: remapNodeId(edge.sourceNodeId),
        targetNodeId: remapNodeId(edge.targetNodeId),
      }
      if (remapped.sourceNodeId === remapped.targetNodeId) return []
      let routeNodeIds = (edge.routeNodeIds ?? []).map(remapNodeId)
      if (participantEdgeIds.has(edge.id) && !routeNodeIds.includes(junctionId)) {
        const route = routesByEdgeId.get(edge.id)
        const junctionDistance = route ? routeDistanceAtPoint(route, target.point) : null
        const totalDistance = route?.points.slice(1).reduce((total, point, index) => (
          total + Math.abs(point.x - route.points[index].x) +
            Math.abs(point.y - route.points[index].y)
        ), 0) ?? 0
        if (
          !route ||
          junctionDistance === null ||
          junctionDistance <= EPSILON ||
          junctionDistance >= totalDistance - EPSILON
        ) {
          insertFailed = true
          return [remapped]
        }
        routeNodeIds = [...routeNodeIds, junctionId].sort((leftId, rightId) => {
          const left = leftId === junctionId ? target.point : waypointsById.get(leftId)
          const right = rightId === junctionId ? target.point : waypointsById.get(rightId)
          const leftDistance = left ? routeDistanceAtPoint(route, left) : null
          const rightDistance = right ? routeDistanceAtPoint(route, right) : null
          return (leftDistance ?? Number.MAX_SAFE_INTEGER) -
            (rightDistance ?? Number.MAX_SAFE_INTEGER)
        })
      }
      const retainedRouteNodeIds = new Set<string>()
      routeNodeIds = routeNodeIds.filter((id) => {
        if (
          id === remapped.sourceNodeId ||
          id === remapped.targetNodeId ||
          retainedRouteNodeIds.has(id)
        ) return false
        retainedRouteNodeIds.add(id)
        return true
      })
      return [withRouteWaypoints(remapped, routeNodeIds)]
    })
    return { ...network, type: resolvedType, nodes, edges }
  })
  if (insertFailed) return null

  const primary = transformed.find((network) => network.id === target.networkId)!
  const merged: ConnectionNetwork = {
    ...primary,
    type: resolvedType,
    nodes: uniqueNodes(transformed.flatMap((network) => network.nodes)),
    edges: transformed.flatMap((network) => network.edges),
  }
  const withMergedTarget = networks.flatMap((network, index) => {
    if (index === primaryIndex) return [merged]
    return affectedNetworkIds.has(network.id) ? [] : [network]
  })
  const edgeIdsBeforeTerminalConnection = new Set(withMergedTarget.flatMap((network) => (
    network.edges.map((edge) => edge.id)
  )))
  const connected = source
    ? connectTerminals(withMergedTarget, diagramId, source, {
        kind: 'node',
        networkId: merged.id,
        nodeId: junctionId,
        point: target.point,
        type: resolvedType,
      })
    : withMergedTarget
  if (!connected) return null
  const connectionEdge = source
    ? connected.flatMap((network) => network.edges).find((edge) => (
        !edgeIdsBeforeTerminalConnection.has(edge.id)
      ))
    : undefined
  if (source && !connectionEdge) return null
  const junctionNetwork = connected.find((network) => (
    network.nodes.some((node) => node.id === junctionId)
  ))
  if (!junctionNetwork) return null
  const retainedWaypoints = garbageCollectRouteWaypoints(
    connected,
    routeWaypoints.filter((waypoint) => !collidingWaypointIds.has(waypoint.id)),
  )
  return {
    networks: connected,
    routeWaypoints: retainedWaypoints,
    junctionId,
    junctionNetworkId: junctionNetwork.id,
    connectionEdgeId: connectionEdge?.id ?? null,
  }
}

export interface MergeConnectionPointsResult {
  networks: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  mergedJunctionIds: string[]
  absorbedNodeIds: string[]
}

function absorbNodesIntoElementAnchor({
  networks,
  routeWaypoints,
  targetNetworkId,
  targetAnchorId,
  absorbedNodeIds,
}: {
  networks: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  targetNetworkId: string
  targetAnchorId: string
  absorbedNodeIds: Set<string>
}) {
  const affectedNetworkIds = new Set(networks.flatMap((network) => (
    network.id === targetNetworkId ||
    network.nodes.some((node) => absorbedNodeIds.has(node.id)) ||
    network.edges.some((edge) => (
      (edge.routeNodeIds ?? []).some((id) => absorbedNodeIds.has(id))
    ))
      ? [network.id]
      : []
  )))
  const affectedNetworks = networks.filter((network) => affectedNetworkIds.has(network.id))
  const resolvedType = resolveConnectionType(affectedNetworks.map((network) => network.type))
  if (!resolvedType) return null

  let unsupportedInteriorMerge = false
  const edges = affectedNetworks.flatMap((network) => network.edges.flatMap((edge) => {
    const sourceNodeId = absorbedNodeIds.has(edge.sourceNodeId)
      ? targetAnchorId
      : edge.sourceNodeId
    const targetNodeId = absorbedNodeIds.has(edge.targetNodeId)
      ? targetAnchorId
      : edge.targetNodeId
    const absorbsInteriorNode = (edge.routeNodeIds ?? []).some((id) => absorbedNodeIds.has(id))
    if (
      absorbsInteriorNode &&
      sourceNodeId !== targetAnchorId &&
      targetNodeId !== targetAnchorId
    ) {
      unsupportedInteriorMerge = true
      return [edge]
    }
    if (sourceNodeId === targetNodeId) return []
    const retained = new Set<string>()
    const routeNodeIds = (edge.routeNodeIds ?? []).filter((id) => {
      if (
        absorbedNodeIds.has(id) ||
        id === sourceNodeId ||
        id === targetNodeId ||
        retained.has(id)
      ) return false
      retained.add(id)
      return true
    })
    return [withRouteWaypoints({ ...edge, sourceNodeId, targetNodeId }, routeNodeIds)]
  }))
  if (unsupportedInteriorMerge) return null

  const targetIndex = networkIndexById(networks, targetNetworkId)
  if (targetIndex < 0) return null
  const targetNetwork = networks[targetIndex]
  const targetAnchor = targetNetwork.nodes.find((node) => node.id === targetAnchorId)
  if (targetAnchor?.kind !== 'element-anchor') return null
  const merged: ConnectionNetwork = {
    ...targetNetwork,
    type: resolvedType,
    nodes: uniqueNodes(affectedNetworks.flatMap((network) => network.nodes))
      .filter((node) => !absorbedNodeIds.has(node.id)),
    edges,
  }
  const nextNetworks = networks.flatMap((network, index) => {
    if (index === targetIndex) return [merged]
    return affectedNetworkIds.has(network.id) ? [] : [network]
  })
  return {
    networks: nextNetworks,
    routeWaypoints: garbageCollectRouteWaypoints(
      nextNetworks,
      routeWaypoints.filter((waypoint) => !absorbedNodeIds.has(waypoint.id)),
    ),
  }
}

function absorbNodesIntoBusbarTap({
  networks,
  routeWaypoints,
  targetNetworkId,
  targetTapId,
  absorbedNodeIds,
}: {
  networks: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  targetNetworkId: string
  targetTapId: string
  absorbedNodeIds: Set<string>
}) {
  const affectedNetworkIds = new Set(networks.flatMap((network) => (
    network.id === targetNetworkId ||
    network.nodes.some((node) => absorbedNodeIds.has(node.id)) ||
    network.edges.some((edge) => (
      (edge.routeNodeIds ?? []).some((id) => absorbedNodeIds.has(id))
    ))
      ? [network.id]
      : []
  )))
  const affectedNetworks = networks.filter((network) => affectedNetworkIds.has(network.id))
  const resolvedType = resolveConnectionType(affectedNetworks.map((network) => network.type))
  if (resolvedType !== 'electrical') return null

  let unsupportedInteriorMerge = false
  const edges = affectedNetworks.flatMap((network) => network.edges.flatMap((edge) => {
    const sourceNodeId = absorbedNodeIds.has(edge.sourceNodeId) ? targetTapId : edge.sourceNodeId
    const targetNodeId = absorbedNodeIds.has(edge.targetNodeId) ? targetTapId : edge.targetNodeId
    const absorbsInteriorNode = (edge.routeNodeIds ?? []).some((id) => absorbedNodeIds.has(id))
    if (
      absorbsInteriorNode &&
      sourceNodeId !== targetTapId &&
      targetNodeId !== targetTapId
    ) {
      unsupportedInteriorMerge = true
      return [edge]
    }
    if (sourceNodeId === targetNodeId) return []
    const retained = new Set<string>()
    const routeNodeIds = (edge.routeNodeIds ?? []).filter((id) => {
      if (
        absorbedNodeIds.has(id) ||
        id === sourceNodeId ||
        id === targetNodeId ||
        retained.has(id)
      ) return false
      retained.add(id)
      return true
    })
    return [withRouteWaypoints({ ...edge, sourceNodeId, targetNodeId }, routeNodeIds)]
  }))
  if (unsupportedInteriorMerge) return null

  const targetIndex = networkIndexById(networks, targetNetworkId)
  if (targetIndex < 0) return null
  const targetNetwork = networks[targetIndex]
  const targetTap = targetNetwork.nodes.find((node) => node.id === targetTapId)
  if (targetTap?.kind !== 'busbar-tap') return null
  const merged: ConnectionNetwork = {
    ...targetNetwork,
    type: resolvedType,
    nodes: uniqueNodes(affectedNetworks.flatMap((network) => network.nodes))
      .filter((node) => !absorbedNodeIds.has(node.id)),
    edges,
  }
  const nextNetworks = networks.flatMap((network, index) => {
    if (index === targetIndex) return [merged]
    return affectedNetworkIds.has(network.id) ? [] : [network]
  })
  return {
    networks: nextNetworks,
    routeWaypoints: garbageCollectRouteWaypoints(
      nextNetworks,
      routeWaypoints.filter((waypoint) => !absorbedNodeIds.has(waypoint.id)),
    ),
  }
}

/**
 * Promotes coincident route waypoints and junctions to one topological junction.
 * Only coordinates touched by the current edit are considered, so importing an
 * older drawing does not silently reinterpret unrelated coincident geometry.
 */
export function mergeCollidingConnectionPoints({
  networks,
  routeWaypoints,
  routedEdges,
  diagramId,
  elements = [],
  assets = [],
  busbars = [],
  movedWaypointIds = new Set<string>(),
  movedJunctionIds = new Set<string>(),
  movedElementIds = new Set<string>(),
  movedBusbarIds = new Set<string>(),
  createId = defaultIdFactory,
}: {
  networks: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  routedEdges: RoutedConnectionEdge[]
  diagramId: string
  elements?: DiagramElement[]
  assets?: AssetDefinition[]
  busbars?: Busbar[]
  movedWaypointIds?: Set<string>
  movedJunctionIds?: Set<string>
  movedElementIds?: Set<string>
  movedBusbarIds?: Set<string>
  createId?: IdFactory
}): MergeConnectionPointsResult | null {
  const candidatePoints = new Map<string, Point>()
  routeWaypoints.forEach((waypoint) => {
    if (movedWaypointIds.has(waypoint.id)) {
      candidatePoints.set(`${waypoint.x}:${waypoint.y}`, { x: waypoint.x, y: waypoint.y })
    }
  })
  networks.forEach((network) => network.nodes.forEach((node) => {
    if (node.kind === 'node' && movedJunctionIds.has(node.id)) {
      candidatePoints.set(`${node.x}:${node.y}`, { x: node.x, y: node.y })
    }
  }))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  networks.forEach((network) => network.nodes.forEach((node) => {
    if (
      node.kind !== 'busbar-tap' ||
      (!movedJunctionIds.has(node.id) && !movedBusbarIds.has(node.busbarId))
    ) return
    const busbar = busbarsById.get(node.busbarId)
    if (!busbar) return
    const point = busbarPoint(busbar, node.offset)
    candidatePoints.set(`${point.x}:${point.y}`, point)
  }))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  elements.forEach((element) => {
    if (!movedElementIds.has(element.id)) return
    const asset = assetsByKey.get(element.assetKey)
    asset?.anchors.forEach((anchor) => {
      const point = resolveElementAnchor(element, asset, anchor).point
      candidatePoints.set(`${point.x}:${point.y}`, point)
    })
  })

  let nextNetworks = networks
  let nextRouteWaypoints = routeWaypoints
  const mergedJunctionIds: string[] = []
  const absorbedNodeIds: string[] = []
  for (const point of candidatePoints.values()) {
    const existingTapsAtPoint = nextNetworks.flatMap((network) => (
      network.nodes.flatMap((node) => {
        if (node.kind !== 'busbar-tap') return []
        const busbar = busbarsById.get(node.busbarId)
        return busbar && pointsEqual(busbarPoint(busbar, node.offset), point)
          ? [{ network, node }]
          : []
      })
    ))
    const movedFreeNodesAtPoint = nextNetworks.flatMap((network) => (
      network.nodes.flatMap((node) => (
        node.kind === 'node' && movedJunctionIds.has(node.id) && pointsEqual(node, point)
          ? [{ network, node }]
          : []
      ))
    )).sort((left, right) => left.node.id.localeCompare(right.node.id))
    if (!existingTapsAtPoint.length && movedFreeNodesAtPoint.length) {
      const matchingBusbars = busbars.flatMap((busbar) => {
        const offset = busbarOffsetAtPoint(busbar, point)
        return offset === null ? [] : [{ busbar, offset }]
      })
      if (matchingBusbars.length > 1) return null
      const attachment = matchingBusbars[0]
      if (attachment) {
        const target = movedFreeNodesAtPoint[0]
        if (resolveConnectionType([target.network.type, attachment.busbar.type]) !== 'electrical') {
          return null
        }
        nextNetworks = nextNetworks.map((network) => (
          network.id !== target.network.id
            ? network
            : {
                ...network,
                nodes: network.nodes.map((node) => node.id === target.node.id
                  ? {
                      id: node.id,
                      kind: 'busbar-tap' as const,
                      busbarId: attachment.busbar.id,
                      offset: attachment.offset,
                    }
                  : node),
              }
        ))
        const mergedByBusbar = mergeNetworksSharingBusbar(
          nextNetworks,
          attachment.busbar.id,
          target.network.id,
        )
        if (!mergedByBusbar) return null
        nextNetworks = mergedByBusbar
        mergedJunctionIds.push(target.node.id)
      }
    }
    let collidingWaypointIds = new Set(nextRouteWaypoints.flatMap((waypoint) => (
      pointsEqual(waypoint, point) ? [waypoint.id] : []
    )))
    let collidingJunctions = nextNetworks.flatMap((network) => (
      network.nodes.flatMap((node) => (
        node.kind === 'node' && pointsEqual(node, point)
          ? [{ network, node }]
          : []
      ))
    ))
    let collidingNodeIds = new Set([
      ...collidingWaypointIds,
      ...collidingJunctions.map(({ node }) => node.id),
    ])

    const collidingAnchors = nextNetworks.flatMap((network) => network.nodes.flatMap((node) => {
      if (node.kind !== 'element-anchor') return []
      const element = elementsById.get(node.elementId)
      const asset = element ? assetsByKey.get(element.assetKey) : undefined
      const anchor = asset?.anchors.find((candidate) => candidate.id === node.anchorId)
      if (!element || !asset || !anchor) return []
      const anchorPoint = resolveElementAnchor(element, asset, anchor).point
      return pointsEqual(anchorPoint, point) ? [{ network, node }] : []
    }))
    const distinctAnchorReferences = new Set(collidingAnchors.map(({ node }) => (
      `${node.elementId}:${node.anchorId}`
    )))
    const collidingTaps = nextNetworks.flatMap((network) => network.nodes.flatMap((node) => {
      if (node.kind !== 'busbar-tap') return []
      const busbar = busbarsById.get(node.busbarId)
      return busbar && pointsEqual(busbarPoint(busbar, node.offset), point)
        ? [{ network, node }]
        : []
    }))
    const distinctTapHosts = new Set(collidingTaps.map(({ node }) => node.busbarId))
    if (
      (collidingNodeIds.size || collidingTaps.length > 1) && distinctTapHosts.size > 1
    ) return null
    if (collidingAnchors.length && collidingTaps.length) return null
    if (collidingNodeIds.size && distinctAnchorReferences.size > 1) return null
    const targetTap = [...collidingTaps].sort((left, right) => (
      Number(movedJunctionIds.has(left.node.id)) - Number(movedJunctionIds.has(right.node.id)) ||
      left.node.id.localeCompare(right.node.id)
    ))[0]
    if (targetTap) {
      const absorbedIds = new Set([
        ...collidingNodeIds,
        ...collidingTaps.flatMap(({ node }) => node.id === targetTap.node.id ? [] : [node.id]),
      ])
      if (absorbedIds.size) {
        const absorbed = absorbNodesIntoBusbarTap({
          networks: nextNetworks,
          routeWaypoints: nextRouteWaypoints,
          targetNetworkId: targetTap.network.id,
          targetTapId: targetTap.node.id,
          absorbedNodeIds: absorbedIds,
        })
        if (!absorbed) return null
        nextNetworks = absorbed.networks
        nextRouteWaypoints = absorbed.routeWaypoints
        absorbedNodeIds.push(...absorbedIds)
        mergedJunctionIds.push(targetTap.node.id)
      }
      continue
    }
    const targetAnchor = collidingAnchors[0]
    if (targetAnchor && collidingNodeIds.size) {
      const absorbed = absorbNodesIntoElementAnchor({
        networks: nextNetworks,
        routeWaypoints: nextRouteWaypoints,
        targetNetworkId: targetAnchor.network.id,
        targetAnchorId: targetAnchor.node.id,
        absorbedNodeIds: collidingNodeIds,
      })
      if (!absorbed) return null
      nextNetworks = absorbed.networks
      nextRouteWaypoints = absorbed.routeWaypoints
      absorbedNodeIds.push(...collidingNodeIds)
      collidingWaypointIds = new Set(nextRouteWaypoints.flatMap((waypoint) => (
        pointsEqual(waypoint, point) ? [waypoint.id] : []
      )))
      collidingJunctions = nextNetworks.flatMap((network) => (
        network.nodes.flatMap((node) => (
          node.kind === 'node' && pointsEqual(node, point)
            ? [{ network, node }]
            : []
        ))
      ))
      collidingNodeIds = new Set([
        ...collidingWaypointIds,
        ...collidingJunctions.map(({ node }) => node.id),
      ])
    }
    if (collidingNodeIds.size < 2) continue

    const waypointNetworks = nextNetworks.filter((network) => network.edges.some((edge) => (
      (edge.routeNodeIds ?? []).some((id) => collidingWaypointIds.has(id))
    )))
    const targetNetwork = collidingJunctions[0]?.network ?? waypointNetworks[0]
    if (!targetNetwork) continue
    if (!resolveConnectionType([
      ...collidingJunctions.map(({ network }) => network.type),
      ...waypointNetworks.map((network) => network.type),
    ])) return null

    const promoted = connectTerminalToRouteJunction({
      networks: nextNetworks,
      routeWaypoints: nextRouteWaypoints,
      routedEdges,
      diagramId,
      target: {
        networkId: targetNetwork.id,
        point,
        edgeIds: waypointNetworks.flatMap((network) => network.edges.flatMap((edge) => (
          (edge.routeNodeIds ?? []).some((id) => collidingWaypointIds.has(id))
            ? [edge.id]
            : []
        ))),
      },
      createId,
    })
    if (!promoted) return null
    nextNetworks = promoted.networks
    nextRouteWaypoints = promoted.routeWaypoints
    mergedJunctionIds.push(promoted.junctionId)
  }
  return {
    networks: nextNetworks,
    routeWaypoints: nextRouteWaypoints,
    mergedJunctionIds,
    absorbedNodeIds: [...new Set(absorbedNodeIds)],
  }
}

export function deleteConnectionJunctions(
  networks: ConnectionNetwork[],
  junctionIds: Set<string>,
  elements: DiagramElement[],
  assets: AssetDefinition[],
  busbars: Busbar[],
  routeWaypoints: RouteWaypoint[],
) {
  const busbarTapIds = new Set(networks.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'busbar-tap' && junctionIds.has(node.id) ? [node.id] : []
  ))))
  const reverseEdgeProperties = (edge: ConnectionEdge): ConnectionEdge => ({
    ...edge,
    ...(edge.flowDirection === 'forward'
      ? { flowDirection: 'reverse' as const }
      : edge.flowDirection === 'reverse'
        ? { flowDirection: 'forward' as const }
        : {}),
    ...(edge.externalSupplyEndpoint === 'source'
      ? { externalSupplyEndpoint: 'target' as const }
      : edge.externalSupplyEndpoint === 'target'
        ? { externalSupplyEndpoint: 'source' as const }
        : {}),
    ...(edge.labelEndpoint === 'source'
      ? { labelEndpoint: 'target' as const }
      : edge.labelEndpoint === 'target'
        ? { labelEndpoint: 'source' as const }
        : {}),
    ...(edge.labelSide === 'negative'
      ? { labelSide: 'positive' as const }
      : edge.labelSide === 'positive'
        ? { labelSide: 'negative' as const }
        : {}),
  })
  const edgeChain = (edge: ConnectionEdge) => [
    edge.sourceNodeId,
    ...(edge.routeNodeIds ?? []),
    edge.targetNodeId,
  ]
  const physicalDegree = (network: ConnectionNetwork, nodeId: string) => (
    network.edges.reduce((degree, edge) => {
      const chain = edgeChain(edge)
      for (let index = 1; index < chain.length; index += 1) {
        if (chain[index - 1] === nodeId) degree += 1
        if (chain[index] === nodeId) degree += 1
      }
      return degree
    }, 0)
  )
  const contractNode = (network: ConnectionNetwork, nodeId: string) => {
    const containingEdges = network.edges.filter((edge) => edgeChain(edge).includes(nodeId))
    const interiorEdges = containingEdges.filter((edge) => (edge.routeNodeIds ?? []).includes(nodeId))
    if (containingEdges.length === 1 && interiorEdges.length === 1) {
      return {
        ...network,
        nodes: network.nodes.filter((node) => node.id !== nodeId),
        edges: network.edges.map((edge) => edge.id === containingEdges[0].id
          ? withRouteWaypoints(edge, (edge.routeNodeIds ?? []).filter((id) => id !== nodeId))
          : edge),
      }
    }
    const endpointEdges = containingEdges.filter((edge) => (
      edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId
    ))
    if (endpointEdges.length !== 2 || interiorEdges.length) return null
    const base = endpointEdges.find((edge) => (
      edge.label || edge.monitorMetrics?.length
    )) ?? endpointEdges[0]
    const other = endpointEdges.find((edge) => edge.id !== base.id)!
    const baseReversed = base.sourceNodeId === nodeId
    const baseChain = baseReversed ? edgeChain(base).reverse() : edgeChain(base)
    const otherChain = other.sourceNodeId === nodeId
      ? edgeChain(other)
      : edgeChain(other).reverse()
    const mergedChain = [...baseChain.slice(0, -1), ...otherChain.slice(1)]
    const orientedBase = baseReversed ? reverseEdgeProperties(base) : base
    const configuredExternalSourceNodeIds = new Set(endpointEdges.flatMap((edge) => (
      edge.externalSupplyEndpoint === 'source'
        ? [edge.sourceNodeId]
        : edge.externalSupplyEndpoint === 'target'
          ? [edge.targetNodeId]
          : []
    )))
    const mergedExternalSupplyEndpoint = configuredExternalSourceNodeIds.has(mergedChain[0])
      ? 'source' as const
      : configuredExternalSourceNodeIds.has(mergedChain.at(-1)!)
        ? 'target' as const
        : undefined
    const allAuxiliary = endpointEdges.every((edge) => edge.coolingLineRole === 'auxiliary')
    const mergedCrossingLayer = endpointEdges.some((edge) => edge.crossingLayer === 'upper')
      ? 'upper' as const
      : endpointEdges.some((edge) => edge.crossingLayer === 'lower')
        ? 'lower' as const
        : undefined
    const {
      routeNodeIds: _routeNodeIds,
      coolingLineRole: _coolingLineRole,
      crossingLayer: _crossingLayer,
      externalSupplyEndpoint: _externalSupplyEndpoint,
      ...edgeWithoutRouteNodes
    } = orientedBase
    const mergedEdge: ConnectionEdge = {
      ...edgeWithoutRouteNodes,
      sourceNodeId: mergedChain[0],
      targetNodeId: mergedChain.at(-1)!,
      ...(allAuxiliary ? { coolingLineRole: 'auxiliary' as const } : {}),
      ...(mergedCrossingLayer ? { crossingLayer: mergedCrossingLayer } : {}),
      ...(mergedExternalSupplyEndpoint
        ? { externalSupplyEndpoint: mergedExternalSupplyEndpoint }
        : {}),
      ...(mergedChain.length > 2 ? { routeNodeIds: mergedChain.slice(1, -1) } : {}),
    }
    const removedEdgeIds = new Set(endpointEdges.map((edge) => edge.id))
    return {
      ...network,
      nodes: network.nodes.filter((node) => node.id !== nodeId),
      edges: network.edges.flatMap((edge) => (
        edge.id === base.id
          ? [mergedEdge]
          : removedEdgeIds.has(edge.id)
            ? []
            : [edge]
      )),
    }
  }

  const detached = networks.map((network) => {
    let next = busbarTapIds.size
      ? {
          ...network,
          nodes: network.nodes.filter((node) => !busbarTapIds.has(node.id)),
          edges: network.edges.filter((edge) => (
            !busbarTapIds.has(edge.sourceNodeId) &&
            !busbarTapIds.has(edge.targetNodeId)
          )),
        }
      : network
    for (const nodeId of junctionIds) {
      if (!next.nodes.some((node) => node.kind === 'node' && node.id === nodeId)) continue
      const degree = physicalDegree(next, nodeId)
      if (degree === 2) {
        const contracted = contractNode(next, nodeId)
        if (contracted) {
          next = contracted
          continue
        }
      }
      next = {
        ...next,
        nodes: next.nodes.filter((node) => node.id !== nodeId),
        edges: next.edges.filter((edge) => !edgeChain(edge).includes(nodeId)),
      }
    }
    return next
  })
  const normalized = normalizeConnectionNetworks(detached, elements, assets, busbars)
  return {
    networks: normalized,
    routeWaypoints: garbageCollectRouteWaypoints(normalized, routeWaypoints),
  }
}

export function junctionsAtPoint(
  networks: ConnectionNetwork[],
  point: Point,
  type?: AnchorType,
) {
  return networks.flatMap((network) => (
    type && !resolveConnectionType([type, network.type])
      ? []
      : network.nodes.flatMap((node) => (
          node.kind === 'node' && pointsEqual(node, point)
            ? [{ network, node }]
            : []
        ))
  ))
}
