import type {
  ConnectionNetwork,
  RouteWaypoint,
} from '../domain/project'
import { routeWaypointsForNetworks } from '../runtime/diagramRuntime'
import { snap, type Point, type Rect } from './geometry'
import { compactOrthogonalPoints, type RoutedConnectionEdge } from '../scene/connections'

export { routeWaypointsForNetworks } from '../runtime/diagramRuntime'

const EPSILON = 0.0001

function pointsEqual(left: Point, right: Point) {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON
}

export function syncRouteWaypointsToNetworks(
  networks: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
) {
  const pointsById = new Map(routeWaypoints.map((point) => [point.id, point]))
  return networks.map((network) => {
    const referencedIds = new Set(network.edges.flatMap((edge) => edge.routeNodeIds ?? []))
    const existingIds = new Set(network.nodes.map((node) => node.id))
    const nodes = network.nodes.map((node) => {
      const point = pointsById.get(node.id)
      return node.kind === 'node' && point
        ? { ...node, x: point.x, y: point.y }
        : node
    })
    referencedIds.forEach((id) => {
      if (existingIds.has(id)) return
      const point = pointsById.get(id)
      if (point) nodes.push({ id, kind: 'node', x: point.x, y: point.y })
    })
    return { ...network, nodes }
  })
}

function canonicalSegmentKey(start: Point, end: Point) {
  const ordered = start.x < end.x || (start.x === end.x && start.y <= end.y)
    ? [start, end]
    : [end, start]
  return `${ordered[0].x},${ordered[0].y}:${ordered[1].x},${ordered[1].y}`
}

function pointOnSegment(point: Point, start: Point, end: Point) {
  if (start.y === end.y) {
    return Math.abs(point.y - start.y) < EPSILON &&
      point.x >= Math.min(start.x, end.x) - EPSILON &&
      point.x <= Math.max(start.x, end.x) + EPSILON
  }
  if (start.x === end.x) {
    return Math.abs(point.x - start.x) < EPSILON &&
      point.y >= Math.min(start.y, end.y) - EPSILON &&
      point.y <= Math.max(start.y, end.y) + EPSILON
  }
  return false
}

function segmentsCollinearAndOverlap(
  leftStart: Point,
  leftEnd: Point,
  rightStart: Point,
  rightEnd: Point,
) {
  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y) {
    return Math.abs(leftStart.y - rightStart.y) < EPSILON &&
      Math.max(Math.min(leftStart.x, leftEnd.x), Math.min(rightStart.x, rightEnd.x)) <=
        Math.min(Math.max(leftStart.x, leftEnd.x), Math.max(rightStart.x, rightEnd.x)) + EPSILON
  }
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x) {
    return Math.abs(leftStart.x - rightStart.x) < EPSILON &&
      Math.max(Math.min(leftStart.y, leftEnd.y), Math.min(rightStart.y, rightEnd.y)) <=
        Math.min(Math.max(leftStart.y, leftEnd.y), Math.max(rightStart.y, rightEnd.y)) + EPSILON
  }
  return false
}

export interface DraggableRouteSegment {
  id: string
  networkId: string
  start: Point
  end: Point
  edgeIds: string[]
  orientation: 'horizontal' | 'vertical'
}

function adjacentRouteCoordinates(
  segment: DraggableRouteSegment,
  routedEdges: RoutedConnectionEdge[],
  networks: ConnectionNetwork[] = [],
) {
  const baseCoordinate = segment.orientation === 'horizontal'
    ? segment.start.y
    : segment.start.x
  const participantEdgeIds = new Set(segment.edgeIds)
  if (networks.length) {
    const routesByEdgeId = new Map(routedEdges.map((route) => [route.edgeId, route]))
    networks.forEach((network) => {
      const edgesById = new Map(network.edges.map((edge) => [edge.id, edge]))
      const adjacentNodeIds = new Set<string>()
      const logicalConnectionIds = new Set<string>()
      segment.edgeIds.forEach((edgeId) => {
        const edge = edgesById.get(edgeId)
        const route = routesByEdgeId.get(edgeId)
        if (!edge || !route || !edge.logicalConnectionId) return
        logicalConnectionIds.add(edge.logicalConnectionId)
        const first = route.points[0]
        const last = route.points.at(-1)
        if (first && (pointsEqual(segment.start, first) || pointsEqual(segment.end, first))) {
          adjacentNodeIds.add(edge.sourceNodeId)
        }
        if (last && (pointsEqual(segment.start, last) || pointsEqual(segment.end, last))) {
          adjacentNodeIds.add(edge.targetNodeId)
        }
      })
      if (!adjacentNodeIds.size || !logicalConnectionIds.size) return
      network.edges.forEach((edge) => {
        if (
          edge.logicalConnectionId &&
          logicalConnectionIds.has(edge.logicalConnectionId) &&
          (adjacentNodeIds.has(edge.sourceNodeId) || adjacentNodeIds.has(edge.targetNodeId))
        ) participantEdgeIds.add(edge.id)
      })
    })
  }
  const coordinates = new Set(routedEdges.flatMap((route) => (
    participantEdgeIds.has(route.edgeId)
      ? route.points.map((point) => (
          segment.orientation === 'horizontal' ? point.y : point.x
        ))
      : []
  )))
  coordinates.delete(baseCoordinate)
  return coordinates
}

export function draggedRouteSegmentAlignsWithExistingRoute(
  segment: DraggableRouteSegment,
  routedEdges: RoutedConnectionEdge[],
  delta: number,
  networks: ConnectionNetwork[] = [],
) {
  const baseCoordinate = segment.orientation === 'horizontal'
    ? segment.start.y
    : segment.start.x
  const targetCoordinate = baseCoordinate + delta
  return [...adjacentRouteCoordinates(segment, routedEdges, networks)].some((coordinate) => (
    Math.abs(coordinate - targetCoordinate) < EPSILON
  ))
}

export function snapDraggedRouteSegmentDelta(
  segment: DraggableRouteSegment,
  routedEdges: RoutedConnectionEdge[],
  rawDelta: number,
  gridSize: number,
  networks: ConnectionNetwork[] = [],
) {
  const baseCoordinate = segment.orientation === 'horizontal'
    ? segment.start.y
    : segment.start.x
  const rawCoordinate = baseCoordinate + rawDelta
  const gridCoordinate = baseCoordinate + snap(rawDelta, gridSize)
  const candidateCoordinates = adjacentRouteCoordinates(segment, routedEdges, networks)

  let snappedCoordinate = gridCoordinate
  let snappedDistance = Math.abs(gridCoordinate - rawCoordinate)
  candidateCoordinates.forEach((coordinate) => {
    const distance = Math.abs(coordinate - rawCoordinate)
    if (distance > gridSize / 2 + EPSILON || distance > snappedDistance + EPSILON) return
    snappedCoordinate = coordinate
    snappedDistance = distance
  })
  return snappedCoordinate - baseCoordinate
}

function routeReversesAtPoint(points: Point[], point: Point) {
  return points.some((candidate, index) => {
    if (index === 0 || index === points.length - 1 || !pointsEqual(candidate, point)) {
      return false
    }
    const previous = points[index - 1]
    const next = points[index + 1]
    const incoming = { x: candidate.x - previous.x, y: candidate.y - previous.y }
    const outgoing = { x: next.x - candidate.x, y: next.y - candidate.y }
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y
    return Math.abs(cross) < EPSILON && dot < -EPSILON
  })
}

export function removeFoldbackRouteWaypoints(
  networks: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
  routedEdges: RoutedConnectionEdge[],
) {
  const syncedNetworks = syncRouteWaypointsToNetworks(networks, routeWaypoints)
  const routesByEdgeId = new Map(routedEdges.map((route) => [route.edgeId, route]))
  const endpointNodeIds = new Set(syncedNetworks.flatMap((network) => (
    network.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId])
  )))
  const referencedEdgeIdsByNodeId = new Map<string, Set<string>>()
  syncedNetworks.forEach((network) => network.edges.forEach((edge) => {
    const routeNodeIds = 'routeNodeIds' in edge ? edge.routeNodeIds ?? [] : []
    routeNodeIds.forEach((id) => {
      const edgeIds = referencedEdgeIdsByNodeId.get(id) ?? new Set<string>()
      edgeIds.add(edge.id)
      referencedEdgeIdsByNodeId.set(id, edgeIds)
    })
  }))
  const nodeById = new Map(syncedNetworks.flatMap((network) => (
    network.nodes.map((node) => [node.id, node] as const)
  )))
  const removedWaypointIds = new Set<string>()

  syncedNetworks.forEach((network) => network.edges.forEach((edge) => {
    const route = routesByEdgeId.get(edge.id)
    if (!route) return
    const routeNodeIds = 'routeNodeIds' in edge ? edge.routeNodeIds ?? [] : []
    routeNodeIds.forEach((id) => {
      const node = nodeById.get(id)
      if (
        node?.kind !== 'node' ||
        endpointNodeIds.has(id) ||
        (referencedEdgeIdsByNodeId.get(id)?.size ?? 0) > 1
      ) return
      if (routeReversesAtPoint(route.points, node)) removedWaypointIds.add(id)
    })
  }))

  if (!removedWaypointIds.size) {
    return {
      networks: syncedNetworks,
      routeWaypoints: routeWaypointsForNetworks(syncedNetworks),
      removedWaypointIds: [] as string[],
    }
  }
  const nextNetworks = syncedNetworks.map((network) => {
    const edges = network.edges.map((edge) => {
      const routeNodeIds = (edge.routeNodeIds ?? []).filter((id) => (
        !removedWaypointIds.has(id)
      ))
      if (routeNodeIds.length) return { ...edge, routeNodeIds }
      const { routeNodeIds: _routeNodeIds, ...rest } = edge
      return rest
    })
    const retainedNodeIds = new Set(edges.flatMap((edge) => [
      edge.sourceNodeId,
      edge.targetNodeId,
      ...('routeNodeIds' in edge ? edge.routeNodeIds ?? [] : []),
    ]))
    return {
      ...network,
      nodes: network.nodes.filter((node) => retainedNodeIds.has(node.id)),
      edges,
    }
  })
  return {
    networks: nextNetworks,
    routeWaypoints: routeWaypointsForNetworks(nextNetworks),
    removedWaypointIds: [...removedWaypointIds],
  }
}

export function atomicRouteSegments(routes: RoutedConnectionEdge[]) {
  const routeSegments = routes.flatMap((route) => route.points.slice(1).flatMap((end, index) => {
    const start = route.points[index]
    return pointsEqual(start, end) || (start.x !== end.x && start.y !== end.y)
      ? []
      : [{ route, start, end }]
  }))
  const result = new Map<string, DraggableRouteSegment>()

  routeSegments.forEach((segment) => {
    const breakpoints = [segment.start, segment.end]
    routeSegments.forEach((candidate) => {
      if (
        candidate.route.networkId !== segment.route.networkId ||
        !segmentsCollinearAndOverlap(segment.start, segment.end, candidate.start, candidate.end)
      ) return
      if (pointOnSegment(candidate.start, segment.start, segment.end)) breakpoints.push(candidate.start)
      if (pointOnSegment(candidate.end, segment.start, segment.end)) breakpoints.push(candidate.end)
    })
    const horizontal = segment.start.y === segment.end.y
    const sorted = [...new Map(breakpoints.map((point) => [
      `${point.x},${point.y}`,
      point,
    ])).values()].sort((left, right) => horizontal ? left.x - right.x : left.y - right.y)

    for (let index = 1; index < sorted.length; index += 1) {
      const start = sorted[index - 1]
      const end = sorted[index]
      if (pointsEqual(start, end)) continue
      const participantEdgeIds = routes.flatMap((route) => {
        if (route.networkId !== segment.route.networkId) return []
        const participates = route.points.slice(1).some((candidateEnd, candidateIndex) => {
          const candidateStart = route.points[candidateIndex]
          return pointOnSegment(start, candidateStart, candidateEnd) &&
            pointOnSegment(end, candidateStart, candidateEnd)
        })
        return participates ? [route.edgeId] : []
      }).sort()
      if (!participantEdgeIds.length) continue
      const geometryKey = canonicalSegmentKey(start, end)
      const id = `${segment.route.networkId}:${geometryKey}`
      result.set(id, {
        id,
        networkId: segment.route.networkId,
        start,
        end,
        edgeIds: participantEdgeIds,
        orientation: horizontal ? 'horizontal' : 'vertical',
      })
    }
  })
  return [...result.values()]
}

export function routeDistanceAtPoint(route: RoutedConnectionEdge, point: Point) {
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

function sharedWaypointAt(
  edgeIds: string[],
  networks: ConnectionNetwork[],
  waypointsById: Map<string, RouteWaypoint>,
  point: Point,
) {
  const edges = networks.flatMap((network) => network.edges).filter((edge) => edgeIds.includes(edge.id))
  if (edges.length !== edgeIds.length) return null
  const commonIds = edges.reduce<Set<string> | null>((common, edge) => {
    const current = new Set(edge.routeNodeIds ?? [])
    if (common === null) return current
    return new Set([...common].filter((id) => current.has(id)))
  }, null)
  return [...(commonIds ?? [])].find((id) => {
    const waypoint = waypointsById.get(id)
    return waypoint !== undefined && pointsEqual(waypoint, point)
  }) ?? null
}

function sharedFreeEndpointAt(
  edgeIds: string[],
  networks: ConnectionNetwork[],
  routesByEdgeId: Map<string, RoutedConnectionEdge>,
  point: Point,
) {
  const nodesById = new Map(networks.flatMap((network) => (
    network.nodes.map((node) => [node.id, node] as const)
  )))
  const endpointIds = edgeIds.flatMap((edgeId) => {
    const route = routesByEdgeId.get(edgeId)
    if (!route) return []
    if (pointsEqual(route.points[0], point)) return [route.sourceNodeId]
    if (pointsEqual(route.points.at(-1)!, point)) return [route.targetNodeId]
    return []
  })
  if (endpointIds.length !== edgeIds.length) return null
  const id = endpointIds[0]
  return endpointIds.every((candidate) => candidate === id) && nodesById.get(id)?.kind === 'node'
    ? id
    : null
}

type IdFactory = (prefix: string) => string

const defaultIdFactory: IdFactory = (prefix) => `${prefix}-${crypto.randomUUID()}`

export function applyDraggedRouteSegment(
  networks: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
  routedEdges: RoutedConnectionEdge[],
  segment: DraggableRouteSegment,
  nextStart: Point,
  nextEnd: Point,
  createId: IdFactory = defaultIdFactory,
) {
  const waypointsById = new Map(routeWaypoints.map((waypoint) => [waypoint.id, waypoint]))
  const routesByEdgeId = new Map(routedEdges.map((route) => [route.edgeId, route]))
  const existingStartId = sharedWaypointAt(
    segment.edgeIds,
    networks,
    waypointsById,
    segment.start,
  ) ?? sharedFreeEndpointAt(segment.edgeIds, networks, routesByEdgeId, segment.start)
  const existingEndId = sharedWaypointAt(
    segment.edgeIds,
    networks,
    waypointsById,
    segment.end,
  ) ?? sharedFreeEndpointAt(segment.edgeIds, networks, routesByEdgeId, segment.end)
  const startId = existingStartId ?? createId('route-waypoint')
  const endId = existingEndId && existingEndId !== startId
    ? existingEndId
    : createId('route-waypoint')
  const nextWaypoints = routeWaypoints.map((waypoint) => {
    if (waypoint.id === startId) return { ...waypoint, ...nextStart }
    if (waypoint.id === endId) return { ...waypoint, ...nextEnd }
    return waypoint
  })
  if (!existingStartId) nextWaypoints.push({ id: startId, ...nextStart })
  if (!existingEndId || existingEndId === startId) nextWaypoints.push({ id: endId, ...nextEnd })

  const nextWaypointById = new Map(nextWaypoints.map((waypoint) => [waypoint.id, waypoint]))
  const movedPointsById = new Map<string, Point>([
    [startId, nextStart],
    [endId, nextEnd],
  ])
  const participantIds = new Set(segment.edgeIds)
  const nextNetworks = networks.map((network) => {
    const edges = network.edges.map((edge) => {
      if (!participantIds.has(edge.id)) return edge
      const route = routesByEdgeId.get(edge.id)
      if (!route) return edge
      const startDistance = routeDistanceAtPoint(route, segment.start)
      const endDistance = routeDistanceAtPoint(route, segment.end)
      if (startDistance === null || endDistance === null) return edge
      const insertedIds = startDistance <= endDistance
        ? [startId, endId]
        : [endId, startId]
      const allIds = [...new Set([
        ...(edge.routeNodeIds ?? []),
        ...insertedIds.filter((id) => id !== edge.sourceNodeId && id !== edge.targetNodeId),
      ])]
      const routeNodeIds = allIds.sort((leftId, rightId) => {
        const insertedDistance = (id: string) => {
          if (id === startId) return startDistance
          if (id === endId) return endDistance
          return null
        }
        const left = waypointsById.get(leftId) ?? nextWaypointById.get(leftId)
        const right = waypointsById.get(rightId) ?? nextWaypointById.get(rightId)
        const leftDistance = insertedDistance(leftId) ?? (left ? routeDistanceAtPoint(route, left) : null)
        const rightDistance = insertedDistance(rightId) ?? (right ? routeDistanceAtPoint(route, right) : null)
        return (leftDistance ?? Number.MAX_SAFE_INTEGER) -
          (rightDistance ?? Number.MAX_SAFE_INTEGER)
      })
      if (routeNodeIds.length) return { ...edge, routeNodeIds }
      const { routeNodeIds: _routeNodeIds, ...edgeWithoutRouteNodes } = edge
      return edgeWithoutRouteNodes
    })
    const referencedIds = new Set(edges.flatMap((edge) => (
      'routeNodeIds' in edge ? edge.routeNodeIds ?? [] : []
    )))
    const existingIds = new Set(network.nodes.map((node) => node.id))
    const nodes = network.nodes.map((node) => {
      const point = movedPointsById.get(node.id) ?? nextWaypointById.get(node.id)
      return node.kind === 'node' && point
        ? { ...node, x: point.x, y: point.y }
        : node
    })
    for (const id of [startId, endId]) {
      if (!referencedIds.has(id) || existingIds.has(id)) continue
      const point = nextWaypointById.get(id)!
      nodes.push({ id, kind: 'node', x: point.x, y: point.y })
    }
    return { ...network, nodes, edges }
  })
  return { networks: nextNetworks, routeWaypoints: nextWaypoints, waypointIds: [startId, endId] }
}

export function garbageCollectRouteWaypoints(
  networks: ConnectionNetwork[],
  _routeWaypoints: RouteWaypoint[],
) {
  return routeWaypointsForNetworks(networks)
}

export function deleteRouteWaypoints(
  networks: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
  waypointIds: Set<string>,
) {
  const nextNetworks = networks.map((network) => ({
    ...network,
    edges: network.edges.map((edge) => {
      const routeNodeIds = (edge.routeNodeIds ?? []).filter((id) => !waypointIds.has(id))
      if (routeNodeIds.length) return { ...edge, routeNodeIds }
      const { routeNodeIds: _routeNodeIds, ...rest } = edge
      return rest
    }),
  }))
  const synced = syncRouteWaypointsToNetworks(nextNetworks, routeWaypoints).map((network) => {
    const referencedIds = new Set(network.edges.flatMap((edge) => edge.routeNodeIds ?? []))
    const endpointIds = new Set(network.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]))
    return {
      ...network,
      nodes: network.nodes.filter((node) => (
        node.kind !== 'node' || referencedIds.has(node.id) || endpointIds.has(node.id)
      )),
    }
  })
  return { networks: synced, routeWaypoints: routeWaypointsForNetworks(synced) }
}

export function clearRouteWaypointsForEdges(
  networks: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
  edgeIds: Set<string>,
) {
  const nextNetworks = networks.map((network) => ({
    ...network,
    edges: network.edges.map((edge) => {
      if (!edgeIds.has(edge.id) || !edge.routeNodeIds?.length) return edge
      const { routeNodeIds: _routeNodeIds, ...rest } = edge
      return rest
    }),
  }))
  const synced = syncRouteWaypointsToNetworks(nextNetworks, routeWaypoints).map((network) => {
    const referencedIds = new Set(network.edges.flatMap((edge) => edge.routeNodeIds ?? []))
    const endpointIds = new Set(network.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]))
    return {
      ...network,
      nodes: network.nodes.filter((node) => (
        node.kind !== 'node' || referencedIds.has(node.id) || endpointIds.has(node.id)
      )),
    }
  })
  return { networks: synced, routeWaypoints: routeWaypointsForNetworks(synced) }
}

export function routeWaypointInsideRect(waypoint: RouteWaypoint, rect: Rect) {
  return waypoint.x >= rect.x && waypoint.x <= rect.x + rect.width &&
    waypoint.y >= rect.y && waypoint.y <= rect.y + rect.height
}

export function routeWaypointBounds(waypoints: RouteWaypoint[]): Rect | null {
  if (!waypoints.length) return null
  const left = Math.min(...waypoints.map((waypoint) => waypoint.x))
  const top = Math.min(...waypoints.map((waypoint) => waypoint.y))
  const right = Math.max(...waypoints.map((waypoint) => waypoint.x))
  const bottom = Math.max(...waypoints.map((waypoint) => waypoint.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function previewDraggedSegment(
  route: RoutedConnectionEdge,
  segment: DraggableRouteSegment,
  nextStart: Point,
  nextEnd: Point,
) {
  if (!segment.edgeIds.includes(route.edgeId)) return route
  const points: Point[] = []
  let replaced = false
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1]
    const end = route.points[index]
    if (index === 1) points.push(start)
    if (
      !replaced &&
      pointOnSegment(segment.start, start, end) &&
      pointOnSegment(segment.end, start, end)
    ) {
      const forward = routeDistanceAtPoint(route, segment.start)! <=
        routeDistanceAtPoint(route, segment.end)!
      const before = forward ? segment.start : segment.end
      const after = forward ? segment.end : segment.start
      const movedBefore = forward ? nextStart : nextEnd
      const movedAfter = forward ? nextEnd : nextStart
      points.push(before, movedBefore, movedAfter, after)
      replaced = true
    }
    points.push(end)
  }
  return replaced ? { ...route, points: compactOrthogonalPoints(points) } : route
}
