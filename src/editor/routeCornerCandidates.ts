import type { AnchorType } from '../domain/project'
import type { RoutedConnectionEdge } from '../scene/connections'
import type { Point } from './geometry'

const EPSILON = 0.0001

export interface DerivedRouteCornerCandidate {
  networkId: string
  point: Point
  edgeIds: string[]
  type: AnchorType
}

interface RouteCorner {
  point: Point
  signature: string
}

function pointsEqual(left: Point, right: Point) {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON
}

function directionFromCorner(corner: Point, adjacent: Point) {
  const dx = Math.sign(adjacent.x - corner.x)
  const dy = Math.sign(adjacent.y - corner.y)
  if ((dx === 0) === (dy === 0)) return null
  if (dx < 0) return 'left'
  if (dx > 0) return 'right'
  if (dy < 0) return 'top'
  return 'bottom'
}

function routeCorners(route: RoutedConnectionEdge): RouteCorner[] {
  return route.points.slice(1, -1).flatMap((point, offset) => {
    const index = offset + 1
    const previousDirection = directionFromCorner(point, route.points[index - 1])
    const nextDirection = directionFromCorner(point, route.points[index + 1])
    if (!previousDirection || !nextDirection || previousDirection === nextDirection) return []
    const sameAxis = (
      (previousDirection === 'left' || previousDirection === 'right') ===
      (nextDirection === 'left' || nextDirection === 'right')
    )
    if (sameAxis) return []
    return [{
      point,
      signature: [previousDirection, nextDirection].sort().join(':'),
    }]
  })
}

export function derivedRouteCornerCandidateAtPointer({
  routes,
  networkId,
  edgeId,
  pointer,
  maxDistance,
  excludedPoints = [],
}: {
  routes: RoutedConnectionEdge[]
  networkId: string
  edgeId: string
  pointer: Point
  maxDistance: number
  excludedPoints?: Point[]
}): DerivedRouteCornerCandidate | null {
  const hoveredRoute = routes.find((route) => (
    route.networkId === networkId && route.edgeId === edgeId
  ))
  if (!hoveredRoute) return null
  const corner = routeCorners(hoveredRoute)
    .map((candidate) => ({
      ...candidate,
      distance: Math.hypot(candidate.point.x - pointer.x, candidate.point.y - pointer.y),
    }))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance)[0]
  if (!corner || excludedPoints.some((point) => pointsEqual(point, corner.point))) return null

  const edgeIds = routes
    .filter((route) => route.networkId === networkId)
    .filter((route) => routeCorners(route).some((candidate) => (
      candidate.signature === corner.signature && pointsEqual(candidate.point, corner.point)
    )))
    .sort((left, right) => left.order - right.order || left.edgeId.localeCompare(right.edgeId))
    .map((route) => route.edgeId)

  return edgeIds.length ? {
    networkId,
    point: corner.point,
    edgeIds,
    type: hoveredRoute.type,
  } : null
}
