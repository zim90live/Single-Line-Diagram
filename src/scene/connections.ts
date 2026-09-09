import { instanceAnchorPlacement } from './elementAnchors'
import {
  resolveConnectionType,
  type AnchorDirection,
  type AnchorType,
  type AssetDefinition,
  type Busbar,
  type ConnectionEdge,
  type ConnectionFlowDirection,
  type ConnectionNetwork,
  type ConnectionNode,
  type DiagramElement,
  type RouteWaypoint,
  type SymbolAnchor,
} from '../domain/project'
import { elementsBounds, rotatePoint, snap, type Point, type Rect } from './geometry'
import { compareConnectionEdgeCrossingPriority } from './connectionCrossingOrder'

export interface ResolvedElementAnchor {
  elementId: string
  anchorId: string
  point: Point
  direction: AnchorDirection
  type: AnchorType
}

export interface RoutedConnectionEdge {
  networkId: string
  edgeId: string
  type: AnchorType
  sourceNodeId: string
  targetNodeId: string
  points: Point[]
  order: number
}

export interface ConnectionCrossing extends Point {
  bridgeEdgeId: string
  underEdgeId: string
}

export type ConnectionCrossingIndex = ReadonlyMap<string, ConnectionCrossing[]>
export type ConnectionCrossingSource = ConnectionCrossing[] | ConnectionCrossingIndex

export function indexConnectionCrossings(crossings: ConnectionCrossing[]) {
  const indexed = new Map<string, ConnectionCrossing[]>()
  crossings.forEach((crossing) => {
    const edgeCrossings = indexed.get(crossing.bridgeEdgeId) ?? []
    edgeCrossings.push(crossing)
    indexed.set(crossing.bridgeEdgeId, edgeCrossings)
  })
  return indexed
}

export interface RoutedConnections {
  edges: RoutedConnectionEdge[]
  crossings: ConnectionCrossing[]
  invalidEdgeIds: string[]
  resolvedBusbarTapOffsets: Record<string, number>
}

export interface ConnectionRouteInput {
  networks: ConnectionNetwork[]
  elements: DiagramElement[]
  assets: AssetDefinition[]
  gridSize: number
  busbars: Busbar[]
  routeWaypoints?: RouteWaypoint[]
}

export interface IncrementalRouteResult {
  routed: RoutedConnections
  mode: 'full' | 'incremental' | 'reused'
  dirtyNetworkCount: number
  dirtyEdgeCount: number
  reusedEdgeCount: number
}

export interface IncrementalRouteOptions {
  skipDirtyEdgeIds?: ReadonlySet<string>
}

export function manualRouteConstrainedEdgeIds(networks: ConnectionNetwork[]) {
  return new Set(networks.flatMap((network) => {
    const constrainedNodeIds = new Set(network.nodes.flatMap((node) => (
      node.kind === 'node' || node.kind === 'busbar-tap' ? [node.id] : []
    )))
    return network.edges.flatMap((edge) => (
      edge.routeNodeIds?.length ||
      constrainedNodeIds.has(edge.sourceNodeId) ||
      constrainedNodeIds.has(edge.targetNodeId)
        ? [edge.id]
        : []
    ))
  }))
}

export type ConnectionTerminal =
  | {
      kind: 'anchor'
      elementId: string
      anchorId: string
      type: AnchorType
    }
  | {
      kind: 'busbar'
      busbarId: string
      offset: number
      point: Point
      type: 'electrical'
    }
  | {
      kind: 'node'
      networkId: string
      nodeId: string
      point: Point
      type: AnchorType
    }

const DIRECTION_ORDER: AnchorDirection[] = ['top', 'right', 'bottom', 'left']
const SEARCH_DIRECTIONS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]
interface RouteOptions {
  startDirection?: number
  endDirection?: number
  startAllowedDirections?: number[]
  endAllowedDirections?: number[]
  maxSearchStates?: number
  marginSteps?: number[]
  blockedEdges?: Set<string>
  heuristicWeight?: number
}

interface RoutedEndpoint {
  actual: Point
  grid: Point
  lead: Point[]
  departureDirection?: number
  arrivalDirection?: number
  departureDirections?: number[]
  arrivalDirections?: number[]
  unblockedEdges?: Set<string>
  obstacle?: Rect
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function pointsEqual(left: Point, right: Point) {
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001
}

function pointKey(point: Point) {
  return `${point.x},${point.y}`
}

function isGridPoint(point: Point, gridSize: number) {
  return point.x % gridSize === 0 && point.y % gridSize === 0
}

function segmentDirection(start: Point, end: Point) {
  if (pointsEqual(start, end)) return undefined
  if (start.y === end.y) return end.x > start.x ? 0 : 2
  if (start.x === end.x) return end.y > start.y ? 1 : 3
  return undefined
}

function lastSegmentDirection(points: Point[]) {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const direction = segmentDirection(points[index - 1], points[index])
    if (direction !== undefined) return direction
  }
  return undefined
}

function reverseDirection(direction: number) {
  return (direction + 2) % 4
}

function busbarConnectionDirections(busbar: Busbar, point?: Point) {
  const directions = busbar.orientation === 'horizontal' ? [1, 3] : [0, 2]
  if (point && pointsEqual(point, busbarPoint(busbar, 0))) {
    directions.push(busbar.orientation === 'horizontal' ? 2 : 3)
  }
  if (point && pointsEqual(point, busbarEndPoint(busbar))) {
    directions.push(busbar.orientation === 'horizontal' ? 0 : 1)
  }
  return directions
}

function anchorOutwardDirection(direction: AnchorDirection) {
  if (direction === 'right') return 0
  if (direction === 'bottom') return 1
  if (direction === 'left') return 2
  return 3
}

function anchorConnectionDirections(direction: AnchorDirection) {
  const outward = anchorOutwardDirection(direction)
  return direction === 'top' || direction === 'bottom'
    ? [outward, 0, 2]
    : [outward, 1, 3]
}

function pathLength(points: Point[]) {
  return points.slice(1).reduce((length, point, index) => (
    length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y)
  ), 0)
}

function pathTurns(points: Point[]) {
  let previousDirection: number | undefined
  let turns = 0
  for (let index = 1; index < points.length; index += 1) {
    const direction = segmentDirection(points[index - 1], points[index])
    if (direction === undefined) continue
    if (previousDirection !== undefined && previousDirection !== direction) turns += 1
    previousDirection = direction
  }
  return turns
}

export function busbarPoint(busbar: Busbar, offset: number): Point {
  return busbar.orientation === 'horizontal'
    ? { x: busbar.x + offset, y: busbar.y }
    : { x: busbar.x, y: busbar.y + offset }
}

export function busbarEndPoint(busbar: Busbar) {
  return busbarPoint(busbar, busbar.length)
}

export function nearestPointOnBusbar(busbar: Busbar, point: Point, gridSize: number) {
  const rawOffset = busbar.orientation === 'horizontal'
    ? point.x - busbar.x
    : point.y - busbar.y
  const offset = Math.max(0, Math.min(snap(rawOffset, gridSize), busbar.length))
  return { offset, point: busbarPoint(busbar, offset) }
}

export function compactOrthogonalPoints(points: Point[]) {
  return points.reduce<Point[]>((compacted, point) => {
    if (compacted.length && pointsEqual(compacted.at(-1)!, point)) return compacted
    while (compacted.length >= 2) {
      const previous = compacted.at(-2)!
      const middle = compacted.at(-1)!
      const horizontal = previous.y === middle.y && middle.y === point.y &&
        middle.x >= Math.min(previous.x, point.x) &&
        middle.x <= Math.max(previous.x, point.x)
      const vertical = previous.x === middle.x && middle.x === point.x &&
        middle.y >= Math.min(previous.y, point.y) &&
        middle.y <= Math.max(previous.y, point.y)
      if (!horizontal && !vertical) break
      compacted.pop()
    }
    compacted.push(point)
    return compacted
  }, [])
}

function rotateDirection(direction: AnchorDirection, rotation: number) {
  const index = DIRECTION_ORDER.indexOf(direction)
  const turns = Math.round(rotation / 90)
  return DIRECTION_ORDER[((index + turns) % 4 + 4) % 4]
}

export function resolveElementAnchor(
  element: DiagramElement,
  asset: AssetDefinition,
  anchor: SymbolAnchor,
): ResolvedElementAnchor {
  anchor = instanceAnchorPlacement(anchor, asset, element)
  const localPoint = {
    x: element.x + (anchor.x / asset.intrinsicWidth) * element.width,
    y: element.y + (anchor.y / asset.intrinsicHeight) * element.height,
  }
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  }
  return {
    elementId: element.id,
    anchorId: anchor.id,
    point: rotatePoint(localPoint, center, element.rotation),
    direction: rotateDirection(anchor.direction, element.rotation),
    type: anchor.type,
  }
}

export function resolveAnchorByReference(
  elementId: string,
  anchorId: string,
  elementsById: Map<string, DiagramElement>,
  assetsByKey: Map<string, AssetDefinition>,
) {
  const element = elementsById.get(elementId)
  const asset = element ? assetsByKey.get(element.assetKey) : undefined
  const anchor = asset?.anchors.find((candidate) => candidate.id === anchorId)
  return element && asset && anchor ? resolveElementAnchor(element, asset, anchor) : null
}

function endpointForAnchor(
  resolved: ResolvedElementAnchor,
  element: DiagramElement,
  gridSize: number,
) {
  const bounds = elementsBounds([element])!
  const boundary = resolved.direction === 'top'
    ? bounds.y
    : resolved.direction === 'right'
      ? bounds.x + bounds.width
      : resolved.direction === 'bottom'
        ? bounds.y + bounds.height
        : bounds.x
  const snappedBoundary = snap(boundary, gridSize)
  const boundaryIsOnGrid = Math.abs(boundary - snappedBoundary) < 0.0001
  const routeBoundary = boundaryIsOnGrid
    ? snappedBoundary
    : resolved.direction === 'top' || resolved.direction === 'left'
      ? Math.floor(boundary / gridSize) * gridSize
      : Math.ceil(boundary / gridSize) * gridSize
  const gridPoint = resolved.direction === 'top' || resolved.direction === 'bottom'
    ? { x: snap(resolved.point.x, gridSize), y: routeBoundary }
    : { x: routeBoundary, y: snap(resolved.point.y, gridSize) }
  const tangentPoint = resolved.direction === 'top' || resolved.direction === 'bottom'
    ? { x: gridPoint.x, y: resolved.point.y }
    : { x: resolved.point.x, y: gridPoint.y }
  const lead = compactOrthogonalPoints([resolved.point, tangentPoint, gridPoint])
  const departureDirection = anchorOutwardDirection(resolved.direction)
  const departureDirections = anchorConnectionDirections(resolved.direction)
  const unblockedEdges = new Set<string>()
  if (boundaryIsOnGrid) {
    if (resolved.direction === 'top' || resolved.direction === 'bottom') {
      const firstX = Math.ceil(bounds.x / gridSize) * gridSize
      const lastX = Math.floor((bounds.x + bounds.width) / gridSize) * gridSize
      const outwardY = routeBoundary + (resolved.direction === 'top' ? -gridSize : gridSize)
      unblockedEdges.add(gridEdgeKey(
        { x: firstX - gridSize, y: routeBoundary },
        { x: firstX, y: routeBoundary },
      ))
      unblockedEdges.add(gridEdgeKey(
        { x: lastX, y: routeBoundary },
        { x: lastX + gridSize, y: routeBoundary },
      ))
      for (let x = firstX; x <= lastX; x += gridSize) {
        unblockedEdges.add(gridEdgeKey(
          { x, y: routeBoundary },
          { x, y: outwardY },
        ))
        if (x < lastX) {
          unblockedEdges.add(gridEdgeKey(
            { x, y: routeBoundary },
            { x: x + gridSize, y: routeBoundary },
          ))
        }
      }
    } else {
      const firstY = Math.ceil(bounds.y / gridSize) * gridSize
      const lastY = Math.floor((bounds.y + bounds.height) / gridSize) * gridSize
      const outwardX = routeBoundary + (resolved.direction === 'left' ? -gridSize : gridSize)
      unblockedEdges.add(gridEdgeKey(
        { x: routeBoundary, y: firstY - gridSize },
        { x: routeBoundary, y: firstY },
      ))
      unblockedEdges.add(gridEdgeKey(
        { x: routeBoundary, y: lastY },
        { x: routeBoundary, y: lastY + gridSize },
      ))
      for (let y = firstY; y <= lastY; y += gridSize) {
        unblockedEdges.add(gridEdgeKey(
          { x: routeBoundary, y },
          { x: outwardX, y },
        ))
        if (y < lastY) {
          unblockedEdges.add(gridEdgeKey(
            { x: routeBoundary, y },
            { x: routeBoundary, y: y + gridSize },
          ))
        }
      }
    }
  }
  return {
    actual: resolved.point,
    grid: gridPoint,
    lead,
    departureDirection,
    arrivalDirection: reverseDirection(departureDirection),
    departureDirections,
    arrivalDirections: departureDirections.map(reverseDirection),
    ...(unblockedEdges.size ? { unblockedEdges } : {}),
    obstacle: bounds,
  }
}

function gridEdgeKey(left: Point, right: Point) {
  return pointKey(left) < pointKey(right)
    ? `${pointKey(left)}::${pointKey(right)}`
    : `${pointKey(right)}::${pointKey(left)}`
}

function blockedGridEdges(obstacles: Rect[], gridSize: number) {
  const blocked = new Set<string>()
  obstacles.forEach((obstacle) => {
    const left = obstacle.x
    const right = obstacle.x + obstacle.width
    const top = obstacle.y
    const bottom = obstacle.y + obstacle.height
    const firstHorizontalY = Math.ceil(top / gridSize) * gridSize
    const lastHorizontalY = Math.floor(bottom / gridSize) * gridSize
    const firstHorizontalX = Math.ceil((left - gridSize) / gridSize) * gridSize
    const lastHorizontalX = Math.floor(right / gridSize) * gridSize
    for (let y = firstHorizontalY; y <= lastHorizontalY; y += gridSize) {
      for (let x = firstHorizontalX; x <= lastHorizontalX; x += gridSize) {
        blocked.add(gridEdgeKey({ x, y }, { x: x + gridSize, y }))
      }
    }

    const firstVerticalX = Math.ceil(left / gridSize) * gridSize
    const lastVerticalX = Math.floor(right / gridSize) * gridSize
    const firstVerticalY = Math.ceil((top - gridSize) / gridSize) * gridSize
    const lastVerticalY = Math.floor(bottom / gridSize) * gridSize
    for (let x = firstVerticalX; x <= lastVerticalX; x += gridSize) {
      for (let y = firstVerticalY; y <= lastVerticalY; y += gridSize) {
        blocked.add(gridEdgeKey({ x, y }, { x, y: y + gridSize }))
      }
    }
  })
  return blocked
}

function rectsEqual(left: Rect, right: Rect) {
  return Math.abs(left.x - right.x) < 0.0001 &&
    Math.abs(left.y - right.y) < 0.0001 &&
    Math.abs(left.width - right.width) < 0.0001 &&
    Math.abs(left.height - right.height) < 0.0001
}

function obstacleBlocksGridEdge(edgeKey: string, obstacle: Rect, gridSize: number) {
  const [leftKey, rightKey] = edgeKey.split('::')
  const [leftX, leftY] = leftKey.split(',').map(Number)
  const [rightX, rightY] = rightKey.split(',').map(Number)
  if (leftY === rightY) {
    const edgeX = Math.min(leftX, rightX)
    return leftY >= Math.ceil(obstacle.y / gridSize) * gridSize &&
      leftY <= Math.floor((obstacle.y + obstacle.height) / gridSize) * gridSize &&
      edgeX >= Math.ceil((obstacle.x - gridSize) / gridSize) * gridSize &&
      edgeX <= Math.floor((obstacle.x + obstacle.width) / gridSize) * gridSize
  }
  const edgeY = Math.min(leftY, rightY)
  return leftX >= Math.ceil(obstacle.x / gridSize) * gridSize &&
    leftX <= Math.floor((obstacle.x + obstacle.width) / gridSize) * gridSize &&
    edgeY >= Math.ceil((obstacle.y - gridSize) / gridSize) * gridSize &&
    edgeY <= Math.floor((obstacle.y + obstacle.height) / gridSize) * gridSize
}

function blockedEdgesForEndpoints(
  source: RoutedEndpoint,
  target: RoutedEndpoint | null,
  obstacles: Rect[],
  gridSize: number,
  blockedEdges?: Set<string>,
) {
  const endpointBlockedEdges = blockedEdges ?? blockedGridEdges(obstacles, gridSize)
  const unblockedEdges = [source.unblockedEdges, target?.unblockedEdges]
    .filter((edges): edges is Set<string> => Boolean(edges))
  if (!unblockedEdges.length) return endpointBlockedEdges
  const endpointObstacles = [source.obstacle, target?.obstacle]
    .filter((obstacle): obstacle is Rect => Boolean(obstacle))
  const unmatchedEndpointObstacles = [...endpointObstacles]
  const otherObstacles = obstacles.filter((obstacle) => {
    const endpointIndex = unmatchedEndpointObstacles.findIndex((endpointObstacle) => (
      rectsEqual(obstacle, endpointObstacle)
    ))
    if (endpointIndex < 0) return true
    unmatchedEndpointObstacles.splice(endpointIndex, 1)
    return false
  })
  const routeBlockedEdges = new Set(endpointBlockedEdges)
  unblockedEdges.forEach((edges) => edges.forEach((edge) => {
    if (!otherObstacles.some((obstacle) => obstacleBlocksGridEdge(edge, obstacle, gridSize))) {
      routeBlockedEdges.delete(edge)
    }
  }))
  return routeBlockedEdges
}

interface SearchState extends Point {
  direction: number
  steps: number
  turns: number
  bendBias: number
  displacement: number
  startOffset: number
  targetOffset: number
  estimate: number
  sequence: number
  previous?: SearchState
}

class MinHeap {
  private values: SearchState[] = []

  get size() {
    return this.values.length
  }

  push(value: SearchState) {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (compareSearch(this.values[parent], value) <= 0) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = value
  }

  pop() {
    const first = this.values[0]
    const last = this.values.pop()
    if (!first || !last || this.values.length === 0) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.values.length) break
      const child = right < this.values.length && compareSearch(this.values[right], this.values[left]) < 0
        ? right
        : left
      if (compareSearch(last, this.values[child]) <= 0) break
      this.values[index] = this.values[child]
      index = child
    }
    this.values[index] = last
    return first
  }
}

function compareSearch(left: SearchState, right: SearchState) {
  return left.estimate - right.estimate ||
    left.turns - right.turns ||
    left.bendBias - right.bendBias ||
    left.displacement - right.displacement ||
    left.steps - right.steps ||
    left.startOffset - right.startOffset ||
    left.targetOffset - right.targetOffset ||
    left.sequence - right.sequence
}

function routeWithinBounds(
  start: Point,
  end: Point,
  obstacles: Rect[],
  occupiedEdges: Set<string>,
  gridSize: number,
  bounds: Rect,
  options: RouteOptions,
) {
  if (pointsEqual(start, end)) return [start]
  const heuristicWeight = options.heuristicWeight ?? 1
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const open = new MinHeap()
  const blockedEdges = options.blockedEdges ?? blockedGridEdges(obstacles, gridSize)
  const best = new Map<string, {
    steps: number
    turns: number
    bendBias: number
    displacement: number
  }>()
  let sequence = 0
  open.push({
    ...start,
    direction: options.startDirection ?? 4,
    steps: 0,
    turns: 0,
    bendBias: 0,
    displacement: 0,
    startOffset: 0,
    targetOffset: 0,
    estimate:
      ((Math.abs(start.x - end.x) + Math.abs(start.y - end.y)) / gridSize) *
      heuristicWeight,
    sequence: sequence++,
  })

  while (open.size && best.size < (options.maxSearchStates ?? 160_000)) {
    const current = open.pop()!
    const stateKey = `${current.x},${current.y},${current.direction}`
    const known = best.get(stateKey)
    if (known && (known.steps < current.steps || (
        known.steps === current.steps && (
          known.turns < current.turns ||
          (known.turns === current.turns && (
            known.bendBias < current.bendBias ||
            (known.bendBias === current.bendBias && known.displacement <= current.displacement)
          ))
        )
      ))) continue
    best.set(stateKey, {
      steps: current.steps,
      turns: current.turns,
      bendBias: current.bendBias,
      displacement: current.displacement,
    })

    if (pointsEqual(current, end)) {
      const path: Point[] = []
      let cursor: SearchState | undefined = current
      while (cursor) {
        path.unshift({ x: cursor.x, y: cursor.y })
        cursor = cursor.previous
      }
      return compactOrthogonalPoints(path)
    }

    SEARCH_DIRECTIONS.forEach((direction, directionIndex) => {
      if (
        current.steps === 0 &&
        options.startAllowedDirections &&
        !options.startAllowedDirections.includes(directionIndex)
      ) return
      const next = {
        x: current.x + direction.x * gridSize,
        y: current.y + direction.y * gridSize,
      }
      if (
        next.x < bounds.x || next.x > bounds.x + bounds.width ||
        next.y < bounds.y || next.y > bounds.y + bounds.height
      ) return
      const edgeKey = gridEdgeKey(current, next)
      if (blockedEdges.has(edgeKey)) return
      if (occupiedEdges.has(edgeKey)) return
      if (
        pointsEqual(next, end) &&
        options.endAllowedDirections &&
        !options.endAllowedDirections.includes(directionIndex)
      ) return

      const steps = current.steps + 1
      const changesDirection = current.direction !== 4 && current.direction !== directionIndex
      const changesAtTarget = pointsEqual(next, end) &&
        options.endDirection !== undefined && directionIndex !== options.endDirection
      const turns = current.turns +
        Number(changesDirection) +
        Number(changesAtTarget)
      const bendBias = current.bendBias +
        (changesDirection
          ? (Math.abs(current.x - midpoint.x) + Math.abs(current.y - midpoint.y)) / gridSize
          : 0) +
        (changesAtTarget
          ? (Math.abs(end.x - midpoint.x) + Math.abs(end.y - midpoint.y)) / gridSize
          : 0)
      const nextKey = `${next.x},${next.y},${directionIndex}`
      const nextKnown = best.get(nextKey)
      if (nextKnown && (nextKnown.steps < steps || (
          nextKnown.steps === steps && (
            nextKnown.turns < turns ||
            (nextKnown.turns === turns && (
              nextKnown.bendBias < bendBias ||
              (nextKnown.bendBias === bendBias && nextKnown.displacement <= current.displacement)
            ))
          )
        ))) return
      const heuristic =
        ((Math.abs(next.x - end.x) + Math.abs(next.y - end.y)) / gridSize) *
        heuristicWeight
      open.push({
        ...next,
        direction: directionIndex,
        steps,
        turns,
        bendBias,
        displacement: current.displacement,
        startOffset: current.startOffset,
        targetOffset: current.targetOffset,
        estimate: steps + heuristic,
        sequence: sequence++,
        previous: current,
      })
    })
  }
  return null
}

export function routeOrthogonalGrid(
  start: Point,
  end: Point,
  obstacles: Rect[],
  occupiedEdges: Set<string>,
  gridSize: number,
  options: RouteOptions = {},
) {
  const minX = Math.min(start.x, end.x)
  const minY = Math.min(start.y, end.y)
  const maxX = Math.max(start.x, end.x)
  const maxY = Math.max(start.y, end.y)
  for (const marginSteps of options.marginSteps ?? [12, 24, 48, 96]) {
    const margin = marginSteps * gridSize
    const bounds = {
      x: Math.floor((minX - margin) / gridSize) * gridSize,
      y: Math.floor((minY - margin) / gridSize) * gridSize,
      width: Math.ceil((maxX - minX + margin * 2) / gridSize) * gridSize,
      height: Math.ceil((maxY - minY + margin * 2) / gridSize) * gridSize,
    }
    const route = routeWithinBounds(start, end, obstacles, occupiedEdges, gridSize, bounds, options)
    if (route) return route
  }
  return null
}

interface FlexibleBusbarCandidate {
  offset: number
  point: Point
  displacement: number
  blockedDirections?: number[]
  departureDirections?: number[]
}

interface FlexibleBusbarRoute {
  points: Point[]
  sourceOffset: number
  targetOffset: number
}

function routeFlexibleBusbarsWithinBounds(
  sourceCandidates: FlexibleBusbarCandidate[],
  targetCandidates: FlexibleBusbarCandidate[],
  sourceDirections: number[],
  targetDirections: number[],
  occupiedEdges: Set<string>,
  blockedEdges: Set<string>,
  gridSize: number,
  bounds: Rect,
): FlexibleBusbarRoute | null {
  const sourceByOffset = new Map(sourceCandidates.map((candidate) => [candidate.offset, candidate]))
  const targetByPoint = new Map(targetCandidates.map((candidate) => [pointKey(candidate.point), candidate]))
  const allCandidatePoints = [
    ...sourceCandidates.map((candidate) => candidate.point),
    ...targetCandidates.map((candidate) => candidate.point),
  ]
  const midpoint = {
    x: (Math.min(...allCandidatePoints.map((point) => point.x)) +
      Math.max(...allCandidatePoints.map((point) => point.x))) / 2,
    y: (Math.min(...allCandidatePoints.map((point) => point.y)) +
      Math.max(...allCandidatePoints.map((point) => point.y))) / 2,
  }
  const heuristic = (point: Point) => Math.min(...targetCandidates.map((candidate) => (
    (Math.abs(point.x - candidate.point.x) + Math.abs(point.y - candidate.point.y)) / gridSize
  )))
  const open = new MinHeap()
  const best = new Map<string, {
    steps: number
    turns: number
    bendBias: number
    displacement: number
    startOffset: number
  }>()
  let sequence = 0

  sourceCandidates.forEach((candidate) => {
    open.push({
      ...candidate.point,
      direction: 4,
      steps: 0,
      turns: 0,
      bendBias: 0,
      displacement: candidate.displacement,
      startOffset: candidate.offset,
      targetOffset: 0,
      estimate: heuristic(candidate.point),
      sequence: sequence++,
    })
  })

  while (open.size && best.size < 200_000) {
    const current = open.pop()!
    const stateKey = `${current.x},${current.y},${current.direction}`
    const known = best.get(stateKey)
    if (known && (
      known.steps < current.steps ||
      (known.steps === current.steps && (
        known.turns < current.turns ||
        (known.turns === current.turns && (
          known.bendBias < current.bendBias ||
          (known.bendBias === current.bendBias && (
            known.displacement < current.displacement ||
            (known.displacement === current.displacement && known.startOffset <= current.startOffset)
          ))
        ))
      ))
    )) continue
    best.set(stateKey, {
      steps: current.steps,
      turns: current.turns,
      bendBias: current.bendBias,
      displacement: current.displacement,
      startOffset: current.startOffset,
    })

    const targetCandidate = targetByPoint.get(pointKey(current))
    if (current.steps > 0 && targetCandidate) {
      const path: Point[] = []
      let cursor: SearchState | undefined = current
      while (cursor) {
        path.unshift({ x: cursor.x, y: cursor.y })
        cursor = cursor.previous
      }
      return {
        points: compactOrthogonalPoints(path),
        sourceOffset: current.startOffset,
        targetOffset: targetCandidate.offset,
      }
    }

    SEARCH_DIRECTIONS.forEach((direction, directionIndex) => {
      const sourceCandidate = current.steps === 0
        ? sourceByOffset.get(current.startOffset)
        : undefined
      if (current.steps === 0 && (
        !(sourceCandidate?.departureDirections ?? sourceDirections).includes(directionIndex) ||
        sourceCandidate?.blockedDirections?.includes(directionIndex)
      )) return
      const next = {
        x: current.x + direction.x * gridSize,
        y: current.y + direction.y * gridSize,
      }
      if (
        next.x < bounds.x || next.x > bounds.x + bounds.width ||
        next.y < bounds.y || next.y > bounds.y + bounds.height
      ) return
      const edgeKey = gridEdgeKey(current, next)
      if (blockedEdges.has(edgeKey)) return
      if (occupiedEdges.has(edgeKey)) return
      const nextTarget = targetByPoint.get(pointKey(next))
      if (nextTarget && (
        !(nextTarget.departureDirections?.map(reverseDirection) ?? targetDirections).includes(directionIndex) ||
        nextTarget.blockedDirections?.includes(reverseDirection(directionIndex))
      )) return

      const steps = current.steps + 1
      const changesDirection = current.direction !== 4 && current.direction !== directionIndex
      const turns = current.turns + Number(changesDirection)
      const bendBias = current.bendBias + (changesDirection
        ? (Math.abs(current.x - midpoint.x) + Math.abs(current.y - midpoint.y)) / gridSize
        : 0)
      const displacement = current.displacement + (nextTarget?.displacement ?? 0)
      const nextKey = `${next.x},${next.y},${directionIndex}`
      const nextKnown = best.get(nextKey)
      if (nextKnown && (
        nextKnown.steps < steps ||
        (nextKnown.steps === steps && (
          nextKnown.turns < turns ||
          (nextKnown.turns === turns && (
            nextKnown.bendBias < bendBias ||
            (nextKnown.bendBias === bendBias && (
              nextKnown.displacement < displacement ||
              (nextKnown.displacement === displacement && nextKnown.startOffset <= current.startOffset)
            ))
          ))
        ))
      )) return
      open.push({
        ...next,
        direction: directionIndex,
        steps,
        turns,
        bendBias,
        displacement,
        startOffset: current.startOffset,
        targetOffset: nextTarget?.offset ?? 0,
        estimate: steps + heuristic(next),
        sequence: sequence++,
        previous: current,
      })
    })
  }
  return null
}

function routeFlexibleBusbars(
  sourceCandidates: FlexibleBusbarCandidate[],
  targetCandidates: FlexibleBusbarCandidate[],
  sourceBusbar: Busbar,
  targetBusbar: Busbar,
  occupiedEdges: Set<string>,
  blockedEdges: Set<string>,
  gridSize: number,
) {
  if (!sourceCandidates.length || !targetCandidates.length) return null
  const allPoints = [
    ...sourceCandidates.map((candidate) => candidate.point),
    ...targetCandidates.map((candidate) => candidate.point),
  ]
  const minX = Math.min(...allPoints.map((point) => point.x))
  const minY = Math.min(...allPoints.map((point) => point.y))
  const maxX = Math.max(...allPoints.map((point) => point.x))
  const maxY = Math.max(...allPoints.map((point) => point.y))
  for (const marginSteps of [12, 24, 48, 96]) {
    const margin = marginSteps * gridSize
    const bounds = {
      x: Math.floor((minX - margin) / gridSize) * gridSize,
      y: Math.floor((minY - margin) / gridSize) * gridSize,
      width: Math.ceil((maxX - minX + margin * 2) / gridSize) * gridSize,
      height: Math.ceil((maxY - minY + margin * 2) / gridSize) * gridSize,
    }
    const route = routeFlexibleBusbarsWithinBounds(
      sourceCandidates,
      targetCandidates,
      busbarConnectionDirections(sourceBusbar),
      busbarConnectionDirections(targetBusbar),
      occupiedEdges,
      blockedEdges,
      gridSize,
      bounds,
    )
    if (route) return route
  }
  return null
}

function nodeEndpoint(
  node: ConnectionNode,
  elementsById: Map<string, DiagramElement>,
  assetsByKey: Map<string, AssetDefinition>,
  busbarsById: Map<string, Busbar>,
  gridSize: number,
  resolvedBusbarTapOffsets = new Map<string, number>(),
): RoutedEndpoint | null {
  if (node.kind === 'node') {
    const point = { x: node.x, y: node.y }
    return {
      actual: point,
      grid: point,
      lead: [point],
    }
  }
  if (node.kind === 'busbar-tap') {
    const busbar = busbarsById.get(node.busbarId)
    if (!busbar || node.offset < 0 || node.offset > busbar.length) return null
    const offset = resolvedBusbarTapOffsets.get(node.id) ?? node.offset
    const point = busbarPoint(busbar, offset)
    const directions = busbarConnectionDirections(busbar, point)
    return {
      actual: point,
      grid: point,
      lead: [point],
      departureDirections: directions,
      arrivalDirections: directions.map(reverseDirection),
    }
  }
  const resolved = resolveAnchorByReference(
    node.elementId,
    node.anchorId,
    elementsById,
    assetsByKey,
  )
  const element = elementsById.get(node.elementId)
  return resolved && element ? endpointForAnchor(resolved, element, gridSize) : null
}

function routeEndpoints(
  source: RoutedEndpoint,
  target: RoutedEndpoint,
  obstacles: Rect[],
  occupiedEdges: Set<string>,
  gridSize: number,
  blockedEdges?: Set<string>,
) {
  const routeBlockedEdges = blockedEdgesForEndpoints(
    source,
    target,
    obstacles,
    gridSize,
    blockedEdges,
  )
  const route = routeOrthogonalGrid(
    source.grid,
    target.grid,
    obstacles,
    occupiedEdges,
    gridSize,
    {
      startDirection: source.departureDirection,
      endDirection: target.arrivalDirection,
      startAllowedDirections: source.departureDirections,
      endAllowedDirections: target.arrivalDirections,
      blockedEdges: routeBlockedEdges,
    },
  )
  return route
    ? compactOrthogonalPoints([
        ...source.lead,
        ...route.slice(1),
        ...[...target.lead].reverse().slice(1),
      ])
    : null
}

function routeEndpointsThroughWaypoints(
  source: RoutedEndpoint,
  target: RoutedEndpoint,
  waypoints: Point[],
  obstacles: Rect[],
  occupiedEdges: Set<string>,
  gridSize: number,
  blockedEdges?: Set<string>,
) {
  if (!waypoints.length) {
    return routeEndpoints(source, target, obstacles, occupiedEdges, gridSize, blockedEdges)
  }
  const targets = [...waypoints, target.grid]
  let start = source.grid
  let startDirection = source.departureDirection
  const points = [...source.lead]
  const routeBlockedEdges = blockedEdgesForEndpoints(
    source,
    target,
    obstacles,
    gridSize,
    blockedEdges,
  )
  for (let index = 0; index < targets.length; index += 1) {
    const isLast = index === targets.length - 1
    const route = routeOrthogonalGrid(
      start,
      targets[index],
      obstacles,
      occupiedEdges,
      gridSize,
      {
        startDirection,
        endDirection: isLast ? target.arrivalDirection : undefined,
        startAllowedDirections: index === 0 ? source.departureDirections : undefined,
        endAllowedDirections: isLast ? target.arrivalDirections : undefined,
        blockedEdges: routeBlockedEdges,
      },
    )
    if (!route) return null
    points.push(...route.slice(1))
    startDirection = lastSegmentDirection(route)
    start = targets[index]
  }
  points.push(...[...target.lead].reverse().slice(1))
  return compactOrthogonalPoints(points)
}

function addOccupiedSegments(points: Point[], occupied: Set<string>, gridSize: number) {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    if (!isGridPoint(start, gridSize) || !isGridPoint(end, gridSize)) continue
    const distance = (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) / gridSize
    for (let step = 0; step < distance; step += 1) {
      const left = {
        x: start.x + Math.sign(end.x - start.x) * gridSize * step,
        y: start.y + Math.sign(end.y - start.y) * gridSize * step,
      }
      const right = {
        x: start.x + Math.sign(end.x - start.x) * gridSize * (step + 1),
        y: start.y + Math.sign(end.y - start.y) * gridSize * (step + 1),
      }
      occupied.add(gridEdgeKey(left, right))
    }
  }
}

function segmentCrossing(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const aHorizontal = a1.y === a2.y
  const bHorizontal = b1.y === b2.y
  if (aHorizontal === bHorizontal) return null
  const horizontalStart = aHorizontal ? a1 : b1
  const horizontalEnd = aHorizontal ? a2 : b2
  const verticalStart = aHorizontal ? b1 : a1
  const verticalEnd = aHorizontal ? b2 : a2
  const point = { x: verticalStart.x, y: horizontalStart.y }
  return point.x >= Math.min(horizontalStart.x, horizontalEnd.x) &&
    point.x <= Math.max(horizontalStart.x, horizontalEnd.x) &&
    point.y >= Math.min(verticalStart.y, verticalEnd.y) &&
    point.y <= Math.max(verticalStart.y, verticalEnd.y)
    ? point
    : null
}

const CROSSING_INDEX_CELL_SIZE = 128

interface IndexedRouteSegment {
  edge: RoutedConnectionEdge
  edgeIndex: number
  segmentIndex: number
  start: Point
  end: Point
}

function crossingIndexKeys(start: Point, end: Point) {
  const left = Math.floor(Math.min(start.x, end.x) / CROSSING_INDEX_CELL_SIZE)
  const right = Math.floor(Math.max(start.x, end.x) / CROSSING_INDEX_CELL_SIZE)
  const top = Math.floor(Math.min(start.y, end.y) / CROSSING_INDEX_CELL_SIZE)
  const bottom = Math.floor(Math.max(start.y, end.y) / CROSSING_INDEX_CELL_SIZE)
  const keys: string[] = []
  for (let x = left; x <= right; x += 1) {
    for (let y = top; y <= bottom; y += 1) keys.push(`${x},${y}`)
  }
  return keys
}

function connectionEdgesById(networks: ConnectionNetwork[]) {
  const edges = new Map<string, ConnectionEdge>()
  networks.forEach((network) => {
    network.edges.forEach((edge) => {
      edges.set(edge.id, edge)
    })
  })
  return edges
}

function findCrossings(
  edges: RoutedConnectionEdge[],
  networks: ConnectionNetwork[] = [],
) {
  const crossings: Array<ConnectionCrossing & {
    laterIndex: number
    earlierIndex: number
    laterSegmentIndex: number
    earlierSegmentIndex: number
  }> = []
  const seen = new Set<string>()
  const segmentIndex = new Map<string, IndexedRouteSegment[]>()
  const configuredEdges = connectionEdgesById(networks)
  for (let laterIndex = 0; laterIndex < edges.length; laterIndex += 1) {
    const later = edges[laterIndex]
    for (let leftIndex = 1; leftIndex < later.points.length; leftIndex += 1) {
      const start = later.points[leftIndex - 1]
      const end = later.points[leftIndex]
      const candidates = new Set<IndexedRouteSegment>()
      crossingIndexKeys(start, end).forEach((key) => {
        segmentIndex.get(key)?.forEach((segment) => candidates.add(segment))
      })
      candidates.forEach((earlierSegment) => {
        const earlier = earlierSegment.edge
        if (later.networkId === earlier.networkId) return
        const point = segmentCrossing(start, end, earlierSegment.start, earlierSegment.end)
        if (!point) return
        const sharedNodeIds = new Set([
          later.sourceNodeId,
          later.targetNodeId,
        ].filter((id) => id === earlier.sourceNodeId || id === earlier.targetNodeId))
        const atSharedEndpoint = sharedNodeIds.size > 0 && (
          pointsEqual(point, later.points[0]) ||
          pointsEqual(point, later.points.at(-1)!)
        ) && (
          pointsEqual(point, earlier.points[0]) ||
          pointsEqual(point, earlier.points.at(-1)!)
        )
        if (atSharedEndpoint) return
        const key = `${later.edgeId}::${earlier.edgeId}::${pointKey(point)}`
        if (seen.has(key)) return
        seen.add(key)
        const bridge = compareConnectionEdgeCrossingPriority(
          configuredEdges.get(later.edgeId),
          configuredEdges.get(earlier.edgeId),
        ) < 0 ? earlier : later
        const under = bridge === later ? earlier : later
        crossings.push({
          ...point,
          bridgeEdgeId: bridge.edgeId,
          underEdgeId: under.edgeId,
          laterIndex,
          earlierIndex: earlierSegment.edgeIndex,
          laterSegmentIndex: leftIndex,
          earlierSegmentIndex: earlierSegment.segmentIndex,
        })
      })
    }
    for (let segmentIndexInEdge = 1; segmentIndexInEdge < later.points.length; segmentIndexInEdge += 1) {
      const segment: IndexedRouteSegment = {
        edge: later,
        edgeIndex: laterIndex,
        segmentIndex: segmentIndexInEdge,
        start: later.points[segmentIndexInEdge - 1],
        end: later.points[segmentIndexInEdge],
      }
      crossingIndexKeys(segment.start, segment.end).forEach((key) => {
        const segments = segmentIndex.get(key) ?? []
        segments.push(segment)
        segmentIndex.set(key, segments)
      })
    }
  }
  return crossings
    .sort((left, right) => (
      left.laterIndex - right.laterIndex ||
      left.earlierIndex - right.earlierIndex ||
      left.laterSegmentIndex - right.laterSegmentIndex ||
      left.earlierSegmentIndex - right.earlierSegmentIndex
    ))
    .map(({ laterIndex: _later, earlierIndex: _earlier, laterSegmentIndex: _left, earlierSegmentIndex: _right, ...crossing }) => crossing)
}

function findBusbarCrossings(
  edges: RoutedConnectionEdge[],
  networks: ConnectionNetwork[],
  busbars: Busbar[],
) {
  const crossings: ConnectionCrossing[] = []
  const seen = new Set<string>()
  const nodesByNetwork = new Map(networks.map((network) => [
    network.id,
    new Map(network.nodes.map((node) => [node.id, node])),
  ]))

  for (const edge of edges) {
    const nodes = nodesByNetwork.get(edge.networkId)
    const sourceNode = nodes?.get(edge.sourceNodeId)
    const targetNode = nodes?.get(edge.targetNodeId)
    for (const busbar of busbars) {
      const busbarStart = busbarPoint(busbar, 0)
      const busbarEnd = busbarEndPoint(busbar)
      for (let index = 1; index < edge.points.length; index += 1) {
        const point = segmentCrossing(
          edge.points[index - 1],
          edge.points[index],
          busbarStart,
          busbarEnd,
        )
        if (!point) continue
        const attachedAtSource = sourceNode?.kind === 'busbar-tap' &&
          sourceNode.busbarId === busbar.id && pointsEqual(point, edge.points[0])
        const attachedAtTarget = targetNode?.kind === 'busbar-tap' &&
          targetNode.busbarId === busbar.id && pointsEqual(point, edge.points.at(-1)!)
        if (attachedAtSource || attachedAtTarget) continue
        const key = `${edge.edgeId}::${busbar.id}::${pointKey(point)}`
        if (seen.has(key)) continue
        seen.add(key)
        crossings.push({
          ...point,
          bridgeEdgeId: edge.edgeId,
          underEdgeId: `busbar:${busbar.id}`,
        })
      }
    }
  }

  return crossings
}

interface PreviewEndpointMovement {
  kind: 'element-anchor' | 'busbar-tap'
  from: Point
  to: Point
  direction: AnchorDirection
}

function previewEndpointMovement(
  node: ConnectionNode | undefined,
  committedElementsById: Map<string, DiagramElement>,
  previewElementsById: Map<string, DiagramElement>,
  assetsByKey: Map<string, AssetDefinition>,
): PreviewEndpointMovement | null {
  if (node?.kind !== 'element-anchor') return null
  const committed = resolveAnchorByReference(
    node.elementId,
    node.anchorId,
    committedElementsById,
    assetsByKey,
  )
  const preview = resolveAnchorByReference(
    node.elementId,
    node.anchorId,
    previewElementsById,
    assetsByKey,
  )
  if (!committed || !preview || pointsEqual(committed.point, preview.point)) return null
  return {
    kind: 'element-anchor',
    from: committed.point,
    to: preview.point,
    direction: preview.direction,
  }
}

function previewBusbarEndpointMovement(
  node: ConnectionNode | undefined,
  previewNode: ConnectionNode | undefined,
  originalPoint: Point,
  adjacentPoint: Point | undefined,
  previewBusbarsById: Map<string, Busbar>,
  resolvedBusbarTapOffsets: Record<string, number>,
): PreviewEndpointMovement | null {
  if (node?.kind !== 'busbar-tap' || previewNode?.kind !== 'busbar-tap') return null
  const busbar = previewBusbarsById.get(previewNode.busbarId)
  if (!busbar) return null
  const offset = Math.max(
    0,
    Math.min(resolvedBusbarTapOffsets[previewNode.id] ?? previewNode.offset, busbar.length),
  )
  const point = busbarPoint(busbar, offset)
  if (pointsEqual(originalPoint, point)) return null
  const direction: AnchorDirection = busbar.orientation === 'horizontal'
    ? (adjacentPoint?.y ?? originalPoint.y) < originalPoint.y ? 'top' : 'bottom'
    : (adjacentPoint?.x ?? originalPoint.x) < originalPoint.x ? 'left' : 'right'
  return { kind: 'busbar-tap', from: originalPoint, to: point, direction }
}

function previewJunctionEndpoint(
  node: ConnectionNode | undefined,
  previewNode: ConnectionNode | undefined,
): Point | null {
  if (node?.kind !== 'node' || previewNode?.kind !== 'node') return null
  if (pointsEqual(node, previewNode)) return null
  return { x: previewNode.x, y: previewNode.y }
}

function directionVector(direction: AnchorDirection): Point {
  if (direction === 'top') return { x: 0, y: -1 }
  if (direction === 'right') return { x: 1, y: 0 }
  if (direction === 'bottom') return { x: 0, y: 1 }
  return { x: -1, y: 0 }
}

function attachPreviewEndpoint(
  points: Point[],
  movement: PreviewEndpointMovement,
  gridSize: number,
  atStart: boolean,
) {
  if (movement.kind === 'element-anchor') {
    return attachPreviewJunctionEndpoint(points, movement.to, atStart)
  }
  const route = atStart ? points : [...points].reverse()
  const original = route[0]
  if (!original) return points
  const vector = directionVector(movement.direction)
  const outside = {
    x: movement.to.x + vector.x * gridSize,
    y: movement.to.y + vector.y * gridSize,
  }
  const corner = vector.x === 0
    ? { x: original.x, y: outside.y }
    : { x: outside.x, y: original.y }
  const attached = compactOrthogonalPoints([
    movement.to,
    outside,
    corner,
    original,
    ...route.slice(1),
  ])
  return atStart ? attached : attached.reverse()
}

function attachPreviewJunctionEndpoint(points: Point[], point: Point, atStart: boolean) {
  const route = atStart ? points : [...points].reverse()
  const original = route[0]
  const adjacent = route[1]
  if (!original || !adjacent) return points
  const corner = Math.abs(adjacent.x - original.x) >= Math.abs(adjacent.y - original.y)
    ? { x: adjacent.x, y: point.y }
    : { x: point.x, y: adjacent.y }
  const attached = compactOrthogonalPoints([point, corner, ...route.slice(1)])
  return atStart ? attached : attached.reverse()
}

function sameMovement(left: PreviewEndpointMovement, right: PreviewEndpointMovement) {
  return Math.abs((left.to.x - left.from.x) - (right.to.x - right.from.x)) < 0.0001 &&
    Math.abs((left.to.y - left.from.y) - (right.to.y - right.from.y)) < 0.0001
}

export function previewConnectionRoutesForDiagram(
  routed: RoutedConnections,
  committedNetworks: ConnectionNetwork[],
  previewNetworks: ConnectionNetwork[],
  committedElements: DiagramElement[],
  previewElements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  committedBusbars: Busbar[] = [],
  previewBusbars: Busbar[] = committedBusbars,
): RoutedConnections {
  const committedNodesByNetworkId = new Map(committedNetworks.map((network) => [
    network.id,
    new Map(network.nodes.map((node) => [node.id, node])),
  ]))
  const previewNodesByNetworkId = new Map(previewNetworks.map((network) => [
    network.id,
    new Map(network.nodes.map((node) => [node.id, node])),
  ]))
  const committedElementsById = new Map(committedElements.map((element) => [element.id, element]))
  const previewElementsById = new Map(previewElements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const previewBusbarsById = new Map(previewBusbars.map((busbar) => [busbar.id, busbar]))
  let resolvedBusbarTapOffsets = routed.resolvedBusbarTapOffsets
  const setResolvedBusbarTapOffset = (nodeId: string, offset: number) => {
    if (resolvedBusbarTapOffsets[nodeId] === offset) return
    if (resolvedBusbarTapOffsets === routed.resolvedBusbarTapOffsets) {
      resolvedBusbarTapOffsets = { ...resolvedBusbarTapOffsets }
    }
    resolvedBusbarTapOffsets[nodeId] = offset
  }
  previewNetworks.forEach((previewNetwork) => {
    const committedNodesById = committedNodesByNetworkId.get(previewNetwork.id)
    previewNetwork.nodes.forEach((node) => {
      if (node.kind !== 'busbar-tap') return
      const committedNode = committedNodesById?.get(node.id)
      const busbar = previewBusbarsById.get(node.busbarId)
      if (!busbar) return
      const previousResolved = resolvedBusbarTapOffsets[node.id] ?? (
        committedNode?.kind === 'busbar-tap' ? committedNode.offset : node.offset
      )
      const offset = committedNode?.kind === 'busbar-tap' && committedNode.offset !== node.offset
        ? node.offset
        : previousResolved
      setResolvedBusbarTapOffset(node.id, Math.max(0, Math.min(offset, busbar.length)))
    })
  })
  const edges = routed.edges.map((edge) => {
    const committedNodesById = committedNodesByNetworkId.get(edge.networkId)
    const previewNodesById = previewNodesByNetworkId.get(edge.networkId)
    const sourceNode = committedNodesById?.get(edge.sourceNodeId)
    const targetNode = committedNodesById?.get(edge.targetNodeId)
    const sourceJunctionPoint = previewJunctionEndpoint(
      sourceNode,
      previewNodesById?.get(edge.sourceNodeId),
    )
    const targetJunctionPoint = previewJunctionEndpoint(
      targetNode,
      previewNodesById?.get(edge.targetNodeId),
    )
    const sourceMovement = previewEndpointMovement(
      sourceNode,
      committedElementsById,
      previewElementsById,
      assetsByKey,
    ) ?? previewBusbarEndpointMovement(
      sourceNode,
      previewNodesById?.get(edge.sourceNodeId),
      edge.points[0],
      edge.points[1],
      previewBusbarsById,
      resolvedBusbarTapOffsets,
    )
    const targetMovement = previewEndpointMovement(
      targetNode,
      committedElementsById,
      previewElementsById,
      assetsByKey,
    ) ?? previewBusbarEndpointMovement(
      targetNode,
      previewNodesById?.get(edge.targetNodeId),
      edge.points.at(-1)!,
      edge.points.at(-2),
      previewBusbarsById,
      resolvedBusbarTapOffsets,
    )
    if (
      !sourceMovement &&
      !targetMovement &&
      !sourceJunctionPoint &&
      !targetJunctionPoint
    ) return edge
    if (sourceMovement && targetMovement && sameMovement(sourceMovement, targetMovement)) {
      const dx = sourceMovement.to.x - sourceMovement.from.x
      const dy = sourceMovement.to.y - sourceMovement.from.y
      return {
        ...edge,
        points: edge.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      }
    }
    let points = edge.points
    if (sourceJunctionPoint) {
      points = attachPreviewJunctionEndpoint(points, sourceJunctionPoint, true)
    }
    if (targetJunctionPoint) {
      points = attachPreviewJunctionEndpoint(points, targetJunctionPoint, false)
    }
    if (sourceMovement) points = attachPreviewEndpoint(points, sourceMovement, gridSize, true)
    if (targetMovement) points = attachPreviewEndpoint(points, targetMovement, gridSize, false)
    return { ...edge, points }
  })
  const crossings = [
    ...findCrossings(edges, previewNetworks),
    ...findBusbarCrossings(edges, previewNetworks, previewBusbars),
  ]
  const stableCrossings = routed.crossings.length === crossings.length &&
    routed.crossings.every((crossing, index) => {
      const candidate = crossings[index]
      return crossing.x === candidate.x &&
        crossing.y === candidate.y &&
        crossing.bridgeEdgeId === candidate.bridgeEdgeId &&
        crossing.underEdgeId === candidate.underEdgeId
    })
    ? routed.crossings
    : crossings
  return {
    ...routed,
    edges,
    crossings: stableCrossings,
    resolvedBusbarTapOffsets,
  }
}

export function previewConnectionRoutesForElements(
  routed: RoutedConnections,
  networks: ConnectionNetwork[],
  committedElements: DiagramElement[],
  previewElements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  busbars: Busbar[] = [],
) {
  return previewConnectionRoutesForDiagram(
    routed,
    networks,
    networks,
    committedElements,
    previewElements,
    assets,
    gridSize,
    busbars,
    busbars,
  )
}

interface BusbarTapCandidate {
  offset: number
  point: Point
  lowerBound: number
  displacement: number
}

interface BusbarTapScore extends BusbarTapCandidate {
  length: number
  turns: number
}

function compareBusbarTapScore(left: BusbarTapScore, right: BusbarTapScore) {
  return left.length - right.length ||
    left.turns - right.turns ||
    left.displacement - right.displacement ||
    left.offset - right.offset
}

interface RoutedBusbarUsage {
  blockedPoints: Set<string>
  occupiedDirections: Map<string, Set<number>>
}

function routedBusbarUsage(
  busbar: Busbar,
  routedEdges: RoutedConnectionEdge[],
  tapBusbarIds: Map<string, string>,
): RoutedBusbarUsage {
  const blockedPoints = new Set<string>()
  const occupiedDirections = new Map<string, Set<number>>()
  const start = busbarPoint(busbar, 0)
  const end = busbarEndPoint(busbar)
  routedEdges.forEach((edge) => {
    for (let index = 1; index < edge.points.length; index += 1) {
      const crossing = segmentCrossing(edge.points[index - 1], edge.points[index], start, end)
      if (!crossing) continue
      const attachedAtSource = index === 1 &&
        tapBusbarIds.get(edge.sourceNodeId) === busbar.id &&
        pointsEqual(crossing, edge.points[0])
      const attachedAtTarget = index === edge.points.length - 1 &&
        tapBusbarIds.get(edge.targetNodeId) === busbar.id &&
        pointsEqual(crossing, edge.points.at(-1)!)
      if (attachedAtSource || attachedAtTarget) {
        const adjacent = attachedAtSource ? edge.points[1] : edge.points.at(-2)!
        const direction = segmentDirection(crossing, adjacent)
        if (direction !== undefined && busbarConnectionDirections(busbar, crossing).includes(direction)) {
          const key = pointKey(crossing)
          const directions = occupiedDirections.get(key) ?? new Set<number>()
          directions.add(direction)
          occupiedDirections.set(key, directions)
          continue
        }
      }
      blockedPoints.add(pointKey(crossing))
    }
  })
  return { blockedPoints, occupiedDirections }
}

function flexibleCandidatesForTap(
  tap: Extract<ConnectionNode, { kind: 'busbar-tap' }>,
  busbar: Busbar,
  resolvedBusbarTapOffsets: Map<string, number>,
  usage: RoutedBusbarUsage,
  gridSize: number,
) {
  const fallback = Math.max(0, Math.min(snap(tap.offset, gridSize), busbar.length))
  const fixedOffset = resolvedBusbarTapOffsets.get(tap.id)
  const offsets = fixedOffset === undefined
    ? Array.from({ length: Math.floor(busbar.length / gridSize) + 1 }, (_, index) => index * gridSize)
    : [fixedOffset]
  return offsets.flatMap((offset) => {
    const point = busbarPoint(busbar, offset)
    const key = pointKey(point)
    return usage.blockedPoints.has(key) ? [] : [{
      offset,
      point,
      displacement: Math.abs(offset - fallback),
      blockedDirections: [...(usage.occupiedDirections.get(key) ?? [])],
      departureDirections: busbarConnectionDirections(busbar, point),
    }]
  })
}

function resolveBusbarTapPairOffsets(
  sourceTap: Extract<ConnectionNode, { kind: 'busbar-tap' }>,
  targetTap: Extract<ConnectionNode, { kind: 'busbar-tap' }>,
  busbarsById: Map<string, Busbar>,
  resolvedBusbarTapOffsets: Map<string, number>,
  occupiedEdges: Set<string>,
  blockedEdges: Set<string>,
  routedEdges: RoutedConnectionEdge[],
  tapBusbarIds: Map<string, string>,
  gridSize: number,
) {
  const sourceBusbar = busbarsById.get(sourceTap.busbarId)
  const targetBusbar = busbarsById.get(targetTap.busbarId)
  if (!sourceBusbar || !targetBusbar || sourceBusbar.id === targetBusbar.id) return false
  const sourceCandidates = flexibleCandidatesForTap(
    sourceTap,
    sourceBusbar,
    resolvedBusbarTapOffsets,
    routedBusbarUsage(sourceBusbar, routedEdges, tapBusbarIds),
    gridSize,
  )
  const targetCandidates = flexibleCandidatesForTap(
    targetTap,
    targetBusbar,
    resolvedBusbarTapOffsets,
    routedBusbarUsage(targetBusbar, routedEdges, tapBusbarIds),
    gridSize,
  )
  const route = routeFlexibleBusbars(
    sourceCandidates,
    targetCandidates,
    sourceBusbar,
    targetBusbar,
    occupiedEdges,
    blockedEdges,
    gridSize,
  )
  if (!route) return false
  resolvedBusbarTapOffsets.set(sourceTap.id, route.sourceOffset)
  resolvedBusbarTapOffsets.set(targetTap.id, route.targetOffset)
  return true
}

function resolveBusbarTapOffset(
  tap: Extract<ConnectionNode, { kind: 'busbar-tap' }>,
  network: ConnectionNetwork,
  nodesById: Map<string, ConnectionNode>,
  elementsById: Map<string, DiagramElement>,
  assetsByKey: Map<string, AssetDefinition>,
  busbarsById: Map<string, Busbar>,
  resolvedBusbarTapOffsets: Map<string, number>,
  obstacles: Rect[],
  occupiedEdges: Set<string>,
  blockedEdges: Set<string>,
  routedEdges: RoutedConnectionEdge[],
  tapBusbarIds: Map<string, string>,
  routeWaypointsById: Map<string, RouteWaypoint>,
  gridSize: number,
) {
  const busbar = busbarsById.get(tap.busbarId)
  if (!busbar) return tap.offset
  const fallback = Math.max(0, Math.min(snap(tap.offset, gridSize), busbar.length))
  const incident = network.edges.flatMap((edge) => {
    const tapIsSource = edge.sourceNodeId === tap.id
    const tapIsTarget = edge.targetNodeId === tap.id
    if (!tapIsSource && !tapIsTarget) return []
    const otherNode = nodesById.get(tapIsSource ? edge.targetNodeId : edge.sourceNodeId)
    if (!otherNode) return []
    const otherEndpoint = nodeEndpoint(
      otherNode,
      elementsById,
      assetsByKey,
      busbarsById,
      gridSize,
      resolvedBusbarTapOffsets,
    )
    return otherEndpoint ? [{ tapIsSource, otherEndpoint, edge }] : []
  })
  if (!incident.length) return fallback

  const usage = routedBusbarUsage(busbar, routedEdges, tapBusbarIds)
  const candidates: BusbarTapCandidate[] = []
  for (let offset = 0; offset <= busbar.length; offset += gridSize) {
    const point = busbarPoint(busbar, offset)
    if (usage.blockedPoints.has(pointKey(point))) continue
    const lowerBound = incident.reduce((total, item) => (
      total +
      pathLength(item.otherEndpoint.lead) +
      Math.abs(item.otherEndpoint.grid.x - point.x) +
      Math.abs(item.otherEndpoint.grid.y - point.y)
    ), 0)
    candidates.push({
      offset,
      point,
      lowerBound,
      displacement: Math.abs(offset - fallback),
    })
  }
  candidates.sort((left, right) => (
    left.lowerBound - right.lowerBound ||
    left.displacement - right.displacement ||
    left.offset - right.offset
  ))

  let best: BusbarTapScore | null = null
  for (const candidate of candidates) {
    if (best && candidate.lowerBound > best.length) break
    const occupiedDirections = usage.occupiedDirections.get(pointKey(candidate.point)) ?? new Set<number>()
    const busbarDirections = busbarConnectionDirections(busbar, candidate.point)
    const tapEndpoint: RoutedEndpoint = {
      actual: candidate.point,
      grid: candidate.point,
      lead: [candidate.point],
      departureDirections: busbarDirections.filter((direction) => !occupiedDirections.has(direction)),
      arrivalDirections: busbarDirections.map(reverseDirection).filter((direction) => (
        !occupiedDirections.has(reverseDirection(direction))
      )),
    }
    const candidateOccupied = new Set(occupiedEdges)
    let length = 0
    let turns = 0
    let valid = true
    for (const item of incident) {
      const waypoints = (item.edge.routeNodeIds ?? []).flatMap((id) => {
        const waypoint = routeWaypointsById.get(id)
        return waypoint ? [{ x: waypoint.x, y: waypoint.y }] : []
      })
      const points = item.tapIsSource
        ? routeEndpointsThroughWaypoints(
            tapEndpoint,
            item.otherEndpoint,
            waypoints,
            obstacles,
            candidateOccupied,
            gridSize,
            blockedEdges,
          )
        : routeEndpointsThroughWaypoints(
            item.otherEndpoint,
            tapEndpoint,
            waypoints,
            obstacles,
            candidateOccupied,
            gridSize,
            blockedEdges,
          )
      if (!points) {
        valid = false
        break
      }
      length += pathLength(points)
      turns += pathTurns(points)
      addOccupiedSegments(points, candidateOccupied, gridSize)
    }
    if (!valid) continue
    const score = { ...candidate, length, turns }
    if (!best || compareBusbarTapScore(score, best) < 0) best = score
  }
  return best?.offset ?? fallback
}

interface RouteSeed {
  dirtyEdgeIds: Set<string>
  previous: RoutedConnections
}

function routeConnectionNetworksWithSeed(
  networks: ConnectionNetwork[],
  elements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  busbars: Busbar[] = [],
  routeWaypoints: RouteWaypoint[] = [],
  seed?: RouteSeed,
): RoutedConnections {
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  const routeWaypointsById = new Map(routeWaypoints.map((waypoint) => [waypoint.id, waypoint]))
  networks.forEach((network) => network.nodes.forEach((node) => {
    if (node.kind === 'node') routeWaypointsById.set(node.id, { id: node.id, x: node.x, y: node.y })
  }))
  const edgeOrder = new Map<string, number>()
  let nextOrder = 0
  networks.forEach((network) => network.edges.forEach((edge) => {
    edgeOrder.set(edge.id, nextOrder++)
  }))
  const currentEdgeIds = new Set(edgeOrder.keys())
  const currentRouteIdentities = new Set(networks.flatMap((network) => (
    network.edges.map((edge) => `${network.id}::${edge.id}`)
  )))
  const dirtyEdgeIds = seed?.dirtyEdgeIds ?? currentEdgeIds
  const dirtyNetworkIds = new Set(networks.flatMap((network) => (
    network.edges.some((edge) => dirtyEdgeIds.has(edge.id)) ? [network.id] : []
  )))
  const dirtyTapNodeIds = new Set(networks.flatMap((network) => (
    !dirtyNetworkIds.has(network.id) ? [] : network.nodes.flatMap((node) => (
      node.kind === 'busbar-tap' && network.edges.some((edge) => (
        dirtyEdgeIds.has(edge.id) &&
        (edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
      )) ? [node.id] : []
    ))
  )))
  const tapBusbarIds = new Map(networks.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'busbar-tap' ? [[node.id, node.busbarId] as const] : []
  ))))
  const obstacles = elements.map((element) => elementsBounds([element])!).filter(Boolean)
  const blockedEdges = blockedGridEdges(obstacles, gridSize)
  const occupied = new Set<string>()
  busbars.forEach((busbar) => {
    addOccupiedSegments([busbarPoint(busbar, 0), busbarEndPoint(busbar)], occupied, gridSize)
  })
  const routedEdges: RoutedConnectionEdge[] = (seed?.previous.edges ?? []).flatMap((edge) => {
    if (
      !currentRouteIdentities.has(`${edge.networkId}::${edge.edgeId}`) ||
      dirtyEdgeIds.has(edge.edgeId)
    ) return []
    const order = edgeOrder.get(edge.edgeId) ?? edge.order
    return [edge.order === order ? edge : { ...edge, order }]
  })
  routedEdges.forEach((edge) => addOccupiedSegments(edge.points, occupied, gridSize))
  const invalidEdgeIds: string[] = (seed?.previous.invalidEdgeIds ?? []).filter((edgeId) => (
    currentEdgeIds.has(edgeId) && !dirtyEdgeIds.has(edgeId)
  ))
  const resolvedBusbarTapOffsets = new Map(Object.entries(
    seed?.previous.resolvedBusbarTapOffsets ?? {},
  ).filter(([nodeId]) => !dirtyTapNodeIds.has(nodeId)))
  networks.forEach((network) => network.nodes.forEach((node) => {
    if (node.kind === 'busbar-tap') resolvedBusbarTapOffsets.set(node.id, node.offset)
  }))

  for (const network of networks) {
    if (!dirtyNetworkIds.has(network.id)) continue
    const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
    const networkSegments = new Set<string>()
    const routingOccupied = seed
      ? (() => {
          const retained = new Set<string>()
          busbars.forEach((busbar) => {
            addOccupiedSegments([busbarPoint(busbar, 0), busbarEndPoint(busbar)], retained, gridSize)
          })
          routedEdges.forEach((routedEdge) => {
            if (routedEdge.networkId !== network.id) {
              addOccupiedSegments(routedEdge.points, retained, gridSize)
            }
          })
          return retained
        })()
      : occupied
    for (const edge of network.edges) {
      if (!dirtyEdgeIds.has(edge.id)) continue
      const source = nodesById.get(edge.sourceNodeId)
      const target = nodesById.get(edge.targetNodeId)
      if (
        source?.kind === 'busbar-tap' &&
        target?.kind === 'busbar-tap' &&
        !(edge.routeNodeIds?.length)
      ) {
        resolveBusbarTapPairOffsets(
          source,
          target,
          busbarsById,
          resolvedBusbarTapOffsets,
          routingOccupied,
          blockedEdges,
          routedEdges,
          tapBusbarIds,
          gridSize,
        )
      }
      for (const node of [source, target]) {
        if (node?.kind !== 'busbar-tap' || resolvedBusbarTapOffsets.has(node.id)) continue
        resolvedBusbarTapOffsets.set(node.id, resolveBusbarTapOffset(
          node,
          network,
          nodesById,
          elementsById,
          assetsByKey,
          busbarsById,
          resolvedBusbarTapOffsets,
          obstacles,
          routingOccupied,
          blockedEdges,
          routedEdges,
          tapBusbarIds,
          routeWaypointsById,
          gridSize,
        ))
      }
      const sourceEndpoint = source
        ? nodeEndpoint(
            source,
            elementsById,
            assetsByKey,
            busbarsById,
            gridSize,
            resolvedBusbarTapOffsets,
          )
        : null
      const targetEndpoint = target
        ? nodeEndpoint(
            target,
            elementsById,
            assetsByKey,
            busbarsById,
            gridSize,
            resolvedBusbarTapOffsets,
          )
        : null
      if (!sourceEndpoint || !targetEndpoint) {
        invalidEdgeIds.push(edge.id)
        continue
      }
      const waypointPoints = (edge.routeNodeIds ?? []).flatMap((id) => {
        const waypoint = routeWaypointsById.get(id)
        return waypoint ? [{ x: waypoint.x, y: waypoint.y }] : []
      })
      if (waypointPoints.length !== (edge.routeNodeIds?.length ?? 0)) {
        invalidEdgeIds.push(edge.id)
        continue
      }
      const points = routeEndpointsThroughWaypoints(
        sourceEndpoint,
        targetEndpoint,
        waypointPoints,
        obstacles,
        routingOccupied,
        gridSize,
        blockedEdges,
      )
      if (!points) {
        invalidEdgeIds.push(edge.id)
        continue
      }
      const routed = {
        networkId: network.id,
        edgeId: edge.id,
        type: network.type,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        points,
        order: edgeOrder.get(edge.id) ?? nextOrder++,
      }
      routedEdges.push(routed)
      addOccupiedSegments(points, networkSegments, gridSize)
    }
    if (!seed) networkSegments.forEach((segment) => occupied.add(segment))
  }
  routedEdges.sort((left, right) => left.order - right.order)
  invalidEdgeIds.sort((left, right) => (
    (edgeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (edgeOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  ))
  return {
    edges: routedEdges,
    crossings: [
      ...findCrossings(routedEdges, networks),
      ...findBusbarCrossings(routedEdges, networks, busbars),
    ],
    invalidEdgeIds,
    resolvedBusbarTapOffsets: Object.fromEntries(resolvedBusbarTapOffsets),
  }
}

export function routeConnectionNetworks(
  networks: ConnectionNetwork[],
  elements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  busbars: Busbar[] = [],
  routeWaypoints: RouteWaypoint[] = [],
): RoutedConnections {
  return routeConnectionNetworksWithSeed(
    networks,
    elements,
    assets,
    gridSize,
    busbars,
    routeWaypoints,
  )
}

export function routeConnectionNetworksForDirtyNetworks(
  input: ConnectionRouteInput,
  previous: RoutedConnections,
  dirtyNetworkIds: Set<string>,
) {
  const dirtyEdgeIds = new Set(input.networks.flatMap((network) => (
    dirtyNetworkIds.has(network.id) ? network.edges.map((edge) => edge.id) : []
  )))
  return routeConnectionNetworksWithSeed(
    input.networks,
    input.elements,
    input.assets,
    input.gridSize,
    input.busbars,
    input.routeWaypoints ?? [],
    { dirtyEdgeIds, previous },
  )
}

export function routeConnectionNetworksForDirtyEdges(
  input: ConnectionRouteInput,
  previous: RoutedConnections,
  dirtyEdgeIds: Set<string>,
) {
  return routeConnectionNetworksWithSeed(
    input.networks,
    input.elements,
    input.assets,
    input.gridSize,
    input.busbars,
    input.routeWaypoints ?? [],
    { dirtyEdgeIds, previous },
  )
}

function routingElementsEqual(left: DiagramElement, right: DiagramElement) {
  return left.id === right.id &&
    left.assetKey === right.assetKey &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.tmuPortsSwapped === right.tmuPortsSwapped &&
    left.fmPortsSwapped === right.fmPortsSwapped
}

function routingBusbarsEqual(left: Busbar, right: Busbar) {
  return left.id === right.id &&
    left.type === right.type &&
    left.x === right.x &&
    left.y === right.y &&
    left.length === right.length &&
    left.orientation === right.orientation
}

function routingNodesEqual(left: ConnectionNode, right: ConnectionNode) {
  if (left.id !== right.id || left.kind !== right.kind) return false
  if (left.kind === 'element-anchor' && right.kind === 'element-anchor') {
    return left.elementId === right.elementId && left.anchorId === right.anchorId
  }
  if (left.kind === 'busbar-tap' && right.kind === 'busbar-tap') {
    return left.busbarId === right.busbarId && left.offset === right.offset
  }
  if (left.kind === 'node' && right.kind === 'node') {
    return left.x === right.x && left.y === right.y
  }
  return false
}

function routingNetworksEqual(left: ConnectionNetwork, right: ConnectionNetwork) {
  return left.id === right.id &&
    left.type === right.type &&
    left.nodes.length === right.nodes.length &&
    left.edges.length === right.edges.length &&
    left.nodes.every((node, index) => routingNodesEqual(node, right.nodes[index])) &&
    left.edges.every((edge, index) => (
      edge.id === right.edges[index].id &&
      edge.sourceNodeId === right.edges[index].sourceNodeId &&
      edge.targetNodeId === right.edges[index].targetNodeId &&
      JSON.stringify(edge.routeNodeIds ?? []) ===
        JSON.stringify(right.edges[index].routeNodeIds ?? [])
    ))
}

function crossingPrioritiesEqual(
  leftNetworks: ConnectionNetwork[],
  rightNetworks: ConnectionNetwork[],
) {
  if (leftNetworks.length !== rightNetworks.length) return false
  const rightById = new Map(rightNetworks.map((network) => [network.id, network]))
  return leftNetworks.every((left) => {
    const right = rightById.get(left.id)
    if (!right || left.type !== right.type || left.edges.length !== right.edges.length) return false
    const rightEdgesById = new Map(right.edges.map((edge) => [edge.id, edge]))
    return left.edges.every((edge) => {
      const candidate = rightEdgesById.get(edge.id)
      return candidate !== undefined &&
        edge.crossingLayer === candidate.crossingLayer &&
        (left.type === 'electrical' || (
          (edge.coolingLineRole ?? 'primary') ===
            (candidate.coolingLineRole ?? 'primary')
        ))
    })
  })
}

function routingAssetsEqual(left: AssetDefinition[], right: AssetDefinition[]) {
  if (left.length !== right.length) return false
  const rightByKey = new Map(right.map((asset) => [asset.key, asset]))
  return left.every((asset) => {
    const candidate = rightByKey.get(asset.key)
    return candidate !== undefined &&
      asset.intrinsicWidth === candidate.intrinsicWidth &&
      asset.intrinsicHeight === candidate.intrinsicHeight &&
      asset.anchors.length === candidate.anchors.length &&
      asset.anchors.every((anchor, index) => {
        const other = candidate.anchors[index]
        return anchor.id === other.id &&
          anchor.x === other.x &&
          anchor.y === other.y &&
          anchor.direction === other.direction &&
          anchor.type === other.type
      })
  })
}

export function connectionRouteInputsEqual(
  left: ConnectionRouteInput,
  right: ConnectionRouteInput,
) {
  if (
    left.gridSize !== right.gridSize ||
    left.networks.length !== right.networks.length ||
    left.elements.length !== right.elements.length ||
    left.busbars.length !== right.busbars.length ||
    !routingAssetsEqual(left.assets, right.assets) ||
    (left.routeWaypoints?.length ?? 0) !== (right.routeWaypoints?.length ?? 0)
  ) return false
  const rightElementsById = new Map(right.elements.map((element) => [element.id, element]))
  const rightBusbarsById = new Map(right.busbars.map((busbar) => [busbar.id, busbar]))
  return left.networks.every((network, index) => (
    routingNetworksEqual(network, right.networks[index])
  )) && crossingPrioritiesEqual(left.networks, right.networks) &&
    left.elements.every((element) => {
      const candidate = rightElementsById.get(element.id)
      return candidate !== undefined && routingElementsEqual(element, candidate)
    }) && left.busbars.every((busbar) => {
    const candidate = rightBusbarsById.get(busbar.id)
    return candidate !== undefined && routingBusbarsEqual(busbar, candidate)
  }) && (left.routeWaypoints ?? []).every((waypoint) => {
    const candidate = (right.routeWaypoints ?? []).find((item) => item.id === waypoint.id)
    return candidate !== undefined && candidate.x === waypoint.x && candidate.y === waypoint.y
  })
}

function expandedRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  }
}

function busbarRect(busbar: Busbar): Rect {
  const end = busbarEndPoint(busbar)
  return {
    x: Math.min(busbar.x, end.x),
    y: Math.min(busbar.y, end.y),
    width: Math.abs(end.x - busbar.x),
    height: Math.abs(end.y - busbar.y),
  }
}

function segmentIntersectsRect(start: Point, end: Point, rect: Rect) {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  if (start.y === end.y) {
    return start.y >= rect.y && start.y <= bottom &&
      Math.max(Math.min(start.x, end.x), rect.x) <= Math.min(Math.max(start.x, end.x), right)
  }
  if (start.x === end.x) {
    return start.x >= rect.x && start.x <= right &&
      Math.max(Math.min(start.y, end.y), rect.y) <= Math.min(Math.max(start.y, end.y), bottom)
  }
  return false
}

function routeIntersectsAnyRect(route: RoutedConnectionEdge, rects: Rect[]) {
  if (!rects.length) return false
  for (let index = 1; index < route.points.length; index += 1) {
    if (rects.some((rect) => segmentIntersectsRect(
      route.points[index - 1],
      route.points[index],
      rect,
    ))) return true
  }
  return false
}

function rectsIntersect(left: Rect, right: Rect) {
  return left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
}

function invalidEdgeInfluenceRect(
  network: ConnectionNetwork,
  edge: ConnectionEdge,
  input: ConnectionRouteInput,
  margin: number,
) {
  const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
  const elementsById = new Map(input.elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(input.assets.map((asset) => [asset.key, asset]))
  const busbarsById = new Map(input.busbars.map((busbar) => [busbar.id, busbar]))
  const pointForNode = (nodeId: string): Point | null => {
    const node = nodesById.get(nodeId)
    if (!node) return null
    if (node.kind === 'node') return { x: node.x, y: node.y }
    if (node.kind === 'busbar-tap') {
      const busbar = busbarsById.get(node.busbarId)
      return busbar ? busbarPoint(busbar, node.offset) : null
    }
    return resolveAnchorByReference(
      node.elementId,
      node.anchorId,
      elementsById,
      assetsByKey,
    )?.point ?? null
  }
  const points = [
    edge.sourceNodeId,
    ...(edge.routeNodeIds ?? []),
    edge.targetNodeId,
  ].flatMap((nodeId) => {
    const point = pointForNode(nodeId)
    return point ? [point] : []
  })
  if (points.length < 2) return null
  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  return expandedRect({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }, margin)
}

function edgeReferencesChangedGeometry(
  network: ConnectionNetwork,
  edge: ConnectionEdge,
  elementIds: Set<string>,
  busbarIds: Set<string>,
) {
  const endpointIds = new Set([edge.sourceNodeId, edge.targetNodeId])
  return network.nodes.some((node) => endpointIds.has(node.id) && (
    (node.kind === 'element-anchor' && elementIds.has(node.elementId)) ||
    (node.kind === 'busbar-tap' && busbarIds.has(node.busbarId))
  ))
}

/**
 * Reuses stable routed edges after a committed edit. Directly connected edges and routes inside
 * the changed geometry's local search corridor are recomputed against retained routes.
 * Display-only edits (labels, colors, visibility) reuse the entire routed snapshot.
 */
export function routeConnectionNetworksIncrementally(
  previousInput: ConnectionRouteInput | null,
  previousRouted: RoutedConnections | null,
  nextInput: ConnectionRouteInput,
  options: IncrementalRouteOptions = {},
): IncrementalRouteResult {
  if (
    !previousInput ||
    !previousRouted ||
    previousInput.gridSize !== nextInput.gridSize ||
    !routingAssetsEqual(previousInput.assets, nextInput.assets)
  ) {
    return {
      routed: routeConnectionNetworks(
        nextInput.networks,
        nextInput.elements,
        nextInput.assets,
        nextInput.gridSize,
        nextInput.busbars,
        nextInput.routeWaypoints ?? [],
      ),
      mode: 'full',
      dirtyNetworkCount: nextInput.networks.length,
      dirtyEdgeCount: nextInput.networks.reduce((count, network) => count + network.edges.length, 0),
      reusedEdgeCount: 0,
    }
  }

  const previousNetworksById = new Map(previousInput.networks.map((network) => [network.id, network]))
  const nextNetworksById = new Map(nextInput.networks.map((network) => [network.id, network]))
  const previousElementsById = new Map(previousInput.elements.map((element) => [element.id, element]))
  const nextElementsById = new Map(nextInput.elements.map((element) => [element.id, element]))
  const previousBusbarsById = new Map(previousInput.busbars.map((busbar) => [busbar.id, busbar]))
  const nextBusbarsById = new Map(nextInput.busbars.map((busbar) => [busbar.id, busbar]))
  const crossingPriorityChanged = !crossingPrioritiesEqual(
    previousInput.networks,
    nextInput.networks,
  )
  const changedElementIds = new Set<string>()
  const changedBusbarIds = new Set<string>()
  const changedRouteWaypointIds = new Set<string>()
  const influenceRects: Rect[] = []
  const changedGeometryRects: Rect[] = []
  const influenceMargin = nextInput.gridSize * 12

  const previousWaypointsById = new Map(
    (previousInput.routeWaypoints ?? []).map((waypoint) => [waypoint.id, waypoint]),
  )
  const nextWaypointsById = new Map(
    (nextInput.routeWaypoints ?? []).map((waypoint) => [waypoint.id, waypoint]),
  )
  new Set([...previousWaypointsById.keys(), ...nextWaypointsById.keys()]).forEach((id) => {
    const previous = previousWaypointsById.get(id)
    const next = nextWaypointsById.get(id)
    if (previous && next && previous.x === next.x && previous.y === next.y) return
    changedRouteWaypointIds.add(id)
    if (previous) {
      const rect = { ...previous, width: 0, height: 0 }
      changedGeometryRects.push(rect)
      influenceRects.push(expandedRect(rect, influenceMargin))
    }
    if (next) {
      const rect = { ...next, width: 0, height: 0 }
      changedGeometryRects.push(rect)
      influenceRects.push(expandedRect(rect, influenceMargin))
    }
  })

  new Set([...previousElementsById.keys(), ...nextElementsById.keys()]).forEach((id) => {
    const previous = previousElementsById.get(id)
    const next = nextElementsById.get(id)
    if (previous && next && routingElementsEqual(previous, next)) return
    changedElementIds.add(id)
    const previousBounds = previous ? elementsBounds([previous]) : null
    const nextBounds = next ? elementsBounds([next]) : null
    if (previousBounds) {
      changedGeometryRects.push(previousBounds)
      influenceRects.push(expandedRect(previousBounds, influenceMargin))
    }
    if (nextBounds) {
      changedGeometryRects.push(nextBounds)
      influenceRects.push(expandedRect(nextBounds, influenceMargin))
    }
  })

  new Set([...previousBusbarsById.keys(), ...nextBusbarsById.keys()]).forEach((id) => {
    const previous = previousBusbarsById.get(id)
    const next = nextBusbarsById.get(id)
    if (previous && next && routingBusbarsEqual(previous, next)) return
    changedBusbarIds.add(id)
    if (previous) {
      const rect = busbarRect(previous)
      changedGeometryRects.push(rect)
      influenceRects.push(expandedRect(rect, influenceMargin))
    }
    if (next) {
      const rect = busbarRect(next)
      changedGeometryRects.push(rect)
      influenceRects.push(expandedRect(rect, influenceMargin))
    }
  })

  const dirtyEdgeIds = new Set<string>()
  let routeStructureChanged = previousInput.networks.length !== nextInput.networks.length
  nextInput.networks.forEach((network, index) => {
    const previous = previousNetworksById.get(network.id)
    if (!previous || previous.type !== network.type) {
      network.edges.forEach((edge) => dirtyEdgeIds.add(edge.id))
      routeStructureChanged = true
    } else {
      const previousEdgesById = new Map(previous.edges.map((edge) => [edge.id, edge]))
      const previousNodesById = new Map(previous.nodes.map((node) => [node.id, node]))
      const nextNodesById = new Map(network.nodes.map((node) => [node.id, node]))
      network.edges.forEach((edge, edgeIndex) => {
        const previousEdge = previousEdgesById.get(edge.id)
        const referencedNodeIds = new Set([
          edge.sourceNodeId,
          edge.targetNodeId,
          ...(edge.routeNodeIds ?? []),
        ])
        const edgeChanged = !previousEdge ||
          previousEdge.sourceNodeId !== edge.sourceNodeId ||
          previousEdge.targetNodeId !== edge.targetNodeId ||
          JSON.stringify(previousEdge.routeNodeIds ?? []) !== JSON.stringify(edge.routeNodeIds ?? []) ||
          [...referencedNodeIds].some((nodeId) => {
            const previousNode = previousNodesById.get(nodeId)
            const nextNode = nextNodesById.get(nodeId)
            return !previousNode || !nextNode || !routingNodesEqual(previousNode, nextNode)
          })
        if (edgeChanged) dirtyEdgeIds.add(edge.id)
        if (previous.edges[edgeIndex]?.id !== edge.id) routeStructureChanged = true
      })
      if (
        previous.nodes.length !== network.nodes.length ||
        previous.edges.length !== network.edges.length
      ) routeStructureChanged = true
    }
    if (previousInput.networks[index]?.id !== network.id) {
      routeStructureChanged = true
      network.edges.forEach((edge) => dirtyEdgeIds.add(edge.id))
    }
    if (network.edges.some((edge) => (
      (edge.routeNodeIds ?? []).some((id) => changedRouteWaypointIds.has(id))
    ))) network.edges.forEach((edge) => {
      if ((edge.routeNodeIds ?? []).some((id) => changedRouteWaypointIds.has(id))) {
        dirtyEdgeIds.add(edge.id)
      }
    })
  })
  previousInput.networks.forEach((network) => {
    if (!nextNetworksById.has(network.id)) routeStructureChanged = true
  })

  // An invalid edge has no routed geometry, so the usual corridor intersection check cannot
  // discover that moving an unrelated obstacle may make it routable again. Retry only invalid
  // edges whose endpoint/waypoint envelope intersects the geometry that actually changed.
  if (influenceRects.length && previousRouted.invalidEdgeIds.length) {
    const invalidEdgeIds = new Set(previousRouted.invalidEdgeIds)
    nextInput.networks.forEach((network) => network.edges.forEach((edge) => {
      if (!invalidEdgeIds.has(edge.id) || dirtyEdgeIds.has(edge.id)) return
      const retryRect = invalidEdgeInfluenceRect(
        network,
        edge,
        nextInput,
        nextInput.gridSize * 4,
      )
      if (retryRect && changedGeometryRects.some((rect) => rectsIntersect(rect, retryRect))) {
        dirtyEdgeIds.add(edge.id)
      }
    }))
  }

  nextInput.networks.forEach((network) => network.edges.forEach((edge) => {
    if (edgeReferencesChangedGeometry(network, edge, changedElementIds, changedBusbarIds)) {
      dirtyEdgeIds.add(edge.id)
    }
  }))

  previousRouted.edges.forEach((route) => {
    if (
      nextNetworksById.has(route.networkId) &&
      !dirtyEdgeIds.has(route.edgeId) &&
      routeIntersectsAnyRect(route, influenceRects)
    ) dirtyEdgeIds.add(route.edgeId)
  })

  options.skipDirtyEdgeIds?.forEach((edgeId) => dirtyEdgeIds.delete(edgeId))

  if (!routeStructureChanged && !influenceRects.length && !dirtyEdgeIds.size) {
    const routed = crossingPriorityChanged
      ? {
          ...previousRouted,
          crossings: [
            ...findCrossings(previousRouted.edges, nextInput.networks),
            ...findBusbarCrossings(
              previousRouted.edges,
              nextInput.networks,
              nextInput.busbars,
            ),
          ],
        }
      : previousRouted
    return {
      routed,
      mode: 'reused',
      dirtyNetworkCount: 0,
      dirtyEdgeCount: 0,
      reusedEdgeCount: previousRouted.edges.length,
    }
  }

  const nextEdgeIds = new Set(nextInput.networks.flatMap((network) => (
    network.edges.map((edge) => edge.id)
  )))
  const existingDirtyEdgeIds = new Set(
    [...dirtyEdgeIds].filter((id) => nextEdgeIds.has(id)),
  )
  const routed = routeConnectionNetworksWithSeed(
    nextInput.networks,
    nextInput.elements,
    nextInput.assets,
    nextInput.gridSize,
    nextInput.busbars,
    nextInput.routeWaypoints ?? [],
    { dirtyEdgeIds: existingDirtyEdgeIds, previous: previousRouted },
  )
  const existingDirtyNetworkIds = new Set(nextInput.networks.flatMap((network) => (
    network.edges.some((edge) => existingDirtyEdgeIds.has(edge.id)) ? [network.id] : []
  )))
  return {
    routed,
    mode: 'incremental',
    dirtyNetworkCount: existingDirtyNetworkIds.size,
    dirtyEdgeCount: existingDirtyEdgeIds.size,
    reusedEdgeCount: routed.edges.filter((edge) => !existingDirtyEdgeIds.has(edge.edgeId)).length,
  }
}

function pointerTargetOutsideObstacles(target: Point, obstacles: Rect[], gridSize: number) {
  const containing = obstacles.find((obstacle) => (
    target.x >= obstacle.x && target.x <= obstacle.x + obstacle.width &&
    target.y >= obstacle.y && target.y <= obstacle.y + obstacle.height
  ))
  if (!containing) return target
  const epsilon = gridSize / 1000
  const candidates = [
    {
      x: Math.floor((containing.x - epsilon) / gridSize) * gridSize,
      y: snap(Math.max(containing.y, Math.min(target.y, containing.y + containing.height)), gridSize),
    },
    {
      x: Math.ceil((containing.x + containing.width + epsilon) / gridSize) * gridSize,
      y: snap(Math.max(containing.y, Math.min(target.y, containing.y + containing.height)), gridSize),
    },
    {
      x: snap(Math.max(containing.x, Math.min(target.x, containing.x + containing.width)), gridSize),
      y: Math.floor((containing.y - epsilon) / gridSize) * gridSize,
    },
    {
      x: snap(Math.max(containing.x, Math.min(target.x, containing.x + containing.width)), gridSize),
      y: Math.ceil((containing.y + containing.height + epsilon) / gridSize) * gridSize,
    },
  ]
  return candidates.sort((left, right) => (
    Math.abs(left.x - target.x) + Math.abs(left.y - target.y) -
    Math.abs(right.x - target.x) - Math.abs(right.y - target.y) ||
    left.y - right.y ||
    left.x - right.x
  ))[0]
}

export interface ConnectionPreviewContext {
  sourceEndpoint: RoutedEndpoint | null
  sourceNetworkId?: string
  networkIdByAnchor: Map<string, string>
  networkIdByBusbar: Map<string, string>
  segmentNetworkIds: Map<string, Set<string>>
  busbarSegments: Set<string>
  elementsById: Map<string, DiagramElement>
  assetsByKey: Map<string, AssetDefinition>
  busbarsById: Map<string, Busbar>
  obstacles: Rect[]
  blockedEdges: Set<string>
  gridSize: number
}

function terminalNetworkId(
  terminal: ConnectionTerminal,
  networkIdByAnchor: Map<string, string>,
  networkIdByBusbar: Map<string, string>,
) {
  if (terminal.kind === 'anchor') {
    return networkIdByAnchor.get(`${terminal.elementId}::${terminal.anchorId}`)
  }
  if (terminal.kind === 'busbar') return networkIdByBusbar.get(terminal.busbarId)
  return terminal.networkId
}

export function prepareConnectionPreview(
  source: ConnectionTerminal,
  networks: ConnectionNetwork[],
  elements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  busbars: Busbar[] = [],
  existingRoutes?: RoutedConnections,
) : ConnectionPreviewContext {
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  let sourceEndpoint: RoutedEndpoint | null = null
  if (source.kind === 'anchor') {
    const resolved = resolveAnchorByReference(
      source.elementId,
      source.anchorId,
      elementsById,
      assetsByKey,
    )
    const element = elementsById.get(source.elementId)
    if (resolved && element) sourceEndpoint = endpointForAnchor(resolved, element, gridSize)
  } else if (source.kind === 'busbar') {
    const busbar = busbars.find((candidate) => candidate.id === source.busbarId)
    if (busbar) {
      const directions = busbarConnectionDirections(busbar, source.point)
      sourceEndpoint = {
        actual: source.point,
        grid: source.point,
        lead: [source.point],
        departureDirections: directions,
        arrivalDirections: directions.map(reverseDirection),
      }
    }
  } else {
    sourceEndpoint = {
      actual: source.point,
      grid: source.point,
      lead: [source.point],
    }
  }

  const routed = existingRoutes ?? routeConnectionNetworks(
    networks,
    elements,
    assets,
    gridSize,
    busbars,
  )
  const networkIdByAnchor = new Map<string, string>()
  const networkIdByBusbar = new Map<string, string>()
  networks.forEach((network) => network.nodes.forEach((node) => {
    if (node.kind === 'element-anchor') {
      networkIdByAnchor.set(`${node.elementId}::${node.anchorId}`, network.id)
    } else if (node.kind === 'busbar-tap' && !networkIdByBusbar.has(node.busbarId)) {
      networkIdByBusbar.set(node.busbarId, network.id)
    }
  }))
  const segmentNetworkIds = new Map<string, Set<string>>()
  routed.edges.forEach((edge) => {
    const segments = new Set<string>()
    addOccupiedSegments(edge.points, segments, gridSize)
    segments.forEach((segment) => {
      const networkIds = segmentNetworkIds.get(segment) ?? new Set<string>()
      networkIds.add(edge.networkId)
      segmentNetworkIds.set(segment, networkIds)
    })
  })
  const busbarSegments = new Set<string>()
  busbars.forEach((busbar) => {
    addOccupiedSegments([busbarPoint(busbar, 0), busbarEndPoint(busbar)], busbarSegments, gridSize)
  })
  const obstacles = elements.map((element) => elementsBounds([element])!).filter(Boolean)
  return {
    sourceEndpoint,
    sourceNetworkId: terminalNetworkId(source, networkIdByAnchor, networkIdByBusbar),
    networkIdByAnchor,
    networkIdByBusbar,
    segmentNetworkIds,
    busbarSegments,
    elementsById,
    assetsByKey,
    busbarsById,
    obstacles,
    blockedEdges: blockedGridEdges(obstacles, gridSize),
    gridSize,
  }
}

export function routeConnectionPreviewWithContext(
  context: ConnectionPreviewContext,
  targetPoint: Point,
  targetTerminal?: ConnectionTerminal | null,
) {
  const {
    sourceEndpoint,
    networkIdByAnchor,
    networkIdByBusbar,
    segmentNetworkIds,
    busbarSegments,
    elementsById,
    assetsByKey,
    busbarsById,
    obstacles,
    blockedEdges,
    gridSize,
  } = context
  let targetEndpoint: RoutedEndpoint | null = null
  if (targetTerminal?.kind === 'anchor') {
    const resolved = resolveAnchorByReference(
      targetTerminal.elementId,
      targetTerminal.anchorId,
      elementsById,
      assetsByKey,
    )
    const element = elementsById.get(targetTerminal.elementId)
    if (resolved && element) targetEndpoint = endpointForAnchor(resolved, element, gridSize)
  } else if (targetTerminal?.kind === 'busbar') {
    const busbar = busbarsById.get(targetTerminal.busbarId)
    if (busbar) {
      const directions = busbarConnectionDirections(busbar, targetTerminal.point)
      targetEndpoint = {
        actual: targetTerminal.point,
        grid: targetTerminal.point,
        lead: [targetTerminal.point],
        departureDirections: directions,
        arrivalDirections: directions.map(reverseDirection),
      }
    }
  } else if (targetTerminal?.kind === 'node') {
    targetEndpoint = {
      actual: targetTerminal.point,
      grid: targetTerminal.point,
      lead: [targetTerminal.point],
    }
  }
  if (!sourceEndpoint) return null
  if (!targetEndpoint &&
    Math.abs(targetPoint.x - sourceEndpoint.actual.x) < gridSize / 2 &&
    Math.abs(targetPoint.y - sourceEndpoint.actual.y) < gridSize / 2
  ) {
    return sourceEndpoint.lead
  }

  const occupied = new Set(busbarSegments)
  const currentNetworkIds = new Set([
    context.sourceNetworkId,
    targetTerminal
      ? terminalNetworkId(targetTerminal, networkIdByAnchor, networkIdByBusbar)
      : undefined,
  ].filter((networkId): networkId is string => networkId !== undefined))
  segmentNetworkIds.forEach((networkIds, segment) => {
    if ([...networkIds].some((networkId) => !currentNetworkIds.has(networkId))) {
      occupied.add(segment)
    }
  })
  const target = targetEndpoint?.grid ?? pointerTargetOutsideObstacles(
    { x: snap(targetPoint.x, gridSize), y: snap(targetPoint.y, gridSize) },
    obstacles,
    gridSize,
  )
  const route = routeOrthogonalGrid(
    sourceEndpoint.grid,
    target,
    obstacles,
    occupied,
    gridSize,
    {
      startDirection: sourceEndpoint.departureDirection,
      endDirection: targetEndpoint?.arrivalDirection,
      startAllowedDirections: sourceEndpoint.departureDirections,
      endAllowedDirections: targetEndpoint?.arrivalDirections,
      maxSearchStates: 24_000,
      marginSteps: [24],
      blockedEdges: blockedEdgesForEndpoints(
        sourceEndpoint,
        targetEndpoint,
        obstacles,
        gridSize,
        blockedEdges,
      ),
      // A small weighted-A* bias avoids exploring the full rectangle of
      // equal-cost states on long pointer previews. Final Worker routing stays exact.
      heuristicWeight: 1.2,
    },
  )
  return route
    ? compactOrthogonalPoints([
        ...sourceEndpoint.lead,
        ...route.slice(1),
        ...[...(targetEndpoint?.lead ?? [target])].reverse().slice(1),
      ])
    : null
}

export function routeConnectionPreview(
  source: ConnectionTerminal,
  targetPoint: Point,
  networks: ConnectionNetwork[],
  elements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  busbars: Busbar[] = [],
  existingRoutes?: RoutedConnections,
  targetTerminal?: ConnectionTerminal | null,
) {
  return routeConnectionPreviewWithContext(
    prepareConnectionPreview(
      source,
      networks,
      elements,
      assets,
      gridSize,
      busbars,
      existingRoutes,
    ),
    targetPoint,
    targetTerminal,
  )
}

export function connectionTypesCompatible(left: AnchorType, right: AnchorType) {
  return resolveConnectionType([left, right]) !== null
}

function anchorNode(terminal: Extract<ConnectionTerminal, { kind: 'anchor' }>): ConnectionNode {
  return {
    id: createId('connection-node'),
    kind: 'element-anchor',
    elementId: terminal.elementId,
    anchorId: terminal.anchorId,
  }
}

function busbarTapNode(
  terminal: Extract<ConnectionTerminal, { kind: 'busbar' }>,
): ConnectionNode {
  return {
    id: createId('connection-busbar-tap'),
    kind: 'busbar-tap',
    busbarId: terminal.busbarId,
    offset: terminal.offset,
  }
}

function terminalNode(terminal: ConnectionTerminal): ConnectionNode {
  if (terminal.kind === 'anchor') return anchorNode(terminal)
  if (terminal.kind === 'busbar') return busbarTapNode(terminal)
  return {
    id: terminal.nodeId,
    kind: 'node',
    x: terminal.point.x,
    y: terminal.point.y,
  }
}

function connectionEdge(sourceNodeId: string, targetNodeId: string): ConnectionEdge {
  return {
    id: createId('connection-edge'),
    sourceNodeId,
    targetNodeId,
  }
}

function connectionEdgeWithoutDisplayData(edge: ConnectionEdge) {
  const {
    label: _label,
    labelVisible: _labelVisible,
    labelEndpoint: _labelEndpoint,
    labelSide: _labelSide,
    monitorDataVisible: _monitorDataVisible,
    monitorMetricLabelsVisible: _monitorMetricLabelsVisible,
    monitorMetrics: _monitorMetrics,
    externalSupplyEndpoint: _externalSupplyEndpoint,
    externalSupplyChannel: _externalSupplyChannel,
    ...rest
  } = edge
  return rest
}

/**
 * Turns every persisted route node into a real edge boundary. Automatic route
 * corners remain derived geometry, while every editable node-to-node span gets
 * its own stable edge id and can therefore be selected, styled or deleted on
 * its own.
 */
export function segmentConnectionEdgesAtNodes(
  networks: ConnectionNetwork[],
  idFactory: (prefix: string) => string = createId,
) {
  return networks.map((network) => {
    const usedIds = new Set(network.edges.map((edge) => edge.id))
    const freeNodeIds = new Set(network.nodes.flatMap((node) => (
      node.kind === 'node' ? [node.id] : []
    )))
    const nextId = () => {
      let id = idFactory('connection-edge')
      while (usedIds.has(id)) id = idFactory('connection-edge')
      usedIds.add(id)
      return id
    }
    return {
      ...network,
      edges: network.edges.flatMap((edge) => {
        const originalRouteNodeIds = edge.routeNodeIds ?? []
        const routeNodeIds = originalRouteNodeIds.filter((id) => freeNodeIds.has(id))
        if (!routeNodeIds.length) {
          if (edge.routeNodeIds === undefined) return [edge]
          const { routeNodeIds: _routeNodeIds, ...edgeWithoutRouteNodes } = edge
          return [edgeWithoutRouteNodes]
        }
        const chain = [edge.sourceNodeId, ...routeNodeIds, edge.targetNodeId]
        if (chain.some((id, index) => index > 0 && id === chain[index - 1])) return []
        const logicalConnectionId = edge.logicalConnectionId ?? edge.id
        const labelSegmentIndex = edge.labelEndpoint === 'source' ? 0 : chain.length - 2
        const hasDisplayData = Boolean(edge.label?.trim()) || Boolean(edge.monitorMetrics?.length)
        const retainedIdSegmentIndex = hasDisplayData ? labelSegmentIndex : 0
        const {
          routeNodeIds: _routeNodeIds,
          externalSupplyEndpoint: _externalSupplyEndpoint,
          externalSupplyChannel: _externalSupplyChannel,
          ...edgeWithoutRouteNodes
        } = edge
        const edgeWithoutDisplayData = connectionEdgeWithoutDisplayData(edgeWithoutRouteNodes)
        return chain.slice(1).map((targetNodeId, segmentIndex) => ({
          ...(segmentIndex === labelSegmentIndex
            ? edgeWithoutRouteNodes
            : edgeWithoutDisplayData),
          id: segmentIndex === retainedIdSegmentIndex ? edge.id : nextId(),
          sourceNodeId: chain[segmentIndex],
          targetNodeId,
          logicalConnectionId,
          ...(edge.externalSupplyEndpoint === 'source' && segmentIndex === 0
            ? {
                externalSupplyEndpoint: 'source' as const,
                ...(edge.externalSupplyChannel
                  ? { externalSupplyChannel: edge.externalSupplyChannel }
                  : {}),
              }
            : edge.externalSupplyEndpoint === 'target' && segmentIndex === chain.length - 2
              ? {
                  externalSupplyEndpoint: 'target' as const,
                  ...(edge.externalSupplyChannel
                    ? { externalSupplyChannel: edge.externalSupplyChannel }
                    : {}),
                }
              : {}),
        }))
      }),
    }
  })
}

function terminalMatches(node: ConnectionNode, terminal: ConnectionTerminal) {
  if (terminal.kind === 'anchor') {
    return node.kind === 'element-anchor' &&
      node.elementId === terminal.elementId && node.anchorId === terminal.anchorId
  }
  if (terminal.kind === 'busbar') {
    return node.kind === 'busbar-tap' &&
      node.busbarId === terminal.busbarId && node.offset === terminal.offset
  }
  return node.kind === 'node' && node.id === terminal.nodeId
}

function terminalNetworkIndex(
  networks: ConnectionNetwork[],
  terminal: ConnectionTerminal,
) {
  return networks.findIndex((network) => network.nodes.some((node) => (
    terminal.kind === 'busbar'
      ? node.kind === 'busbar-tap' && node.busbarId === terminal.busbarId
      : terminal.kind === 'node'
        ? network.id === terminal.networkId && node.id === terminal.nodeId
        : terminalMatches(node, terminal)
  )))
}

function ensureTerminal(network: ConnectionNetwork, terminal: ConnectionTerminal) {
  const existing = network.nodes.find((node) => terminalMatches(node, terminal))
  if (existing) return { network, nodeId: existing.id }
  const node = terminalNode(terminal)
  return {
    nodeId: node.id,
    network: { ...network, nodes: [...network.nodes, node] },
  }
}

function resolvedNetworkType(
  sourceNetwork: ConnectionNetwork | undefined,
  targetNetwork: ConnectionNetwork | undefined,
  source: ConnectionTerminal,
  target: ConnectionTerminal,
) {
  return resolveConnectionType([
    ...(sourceNetwork ? [sourceNetwork.type] : []),
    ...(targetNetwork && targetNetwork !== sourceNetwork ? [targetNetwork.type] : []),
    source.type,
    target.type,
  ])
}

export function connectTerminals(
  networks: ConnectionNetwork[],
  diagramId: string,
  source: ConnectionTerminal,
  target: ConnectionTerminal,
) {
  if (
    source.kind === 'anchor' &&
    target.kind === 'anchor' &&
    source.elementId === target.elementId &&
    source.anchorId === target.anchorId
  ) return null
  if (
    source.kind === 'busbar' && target.kind === 'busbar' &&
    source.busbarId === target.busbarId
  ) return null
  if (
    source.kind === 'node' && target.kind === 'node' &&
    source.networkId === target.networkId && source.nodeId === target.nodeId
  ) return null
  if (!connectionTypesCompatible(source.type, target.type)) return null
  const sourceIndex = terminalNetworkIndex(networks, source)
  const targetIndex = terminalNetworkIndex(networks, target)
  const type = resolvedNetworkType(
    sourceIndex >= 0 ? networks[sourceIndex] : undefined,
    targetIndex >= 0 ? networks[targetIndex] : undefined,
    source,
    target,
  )
  if (!type) return null

  if (sourceIndex < 0 && targetIndex < 0) {
    const sourceNode = terminalNode(source)
    const targetNode = terminalNode(target)
    return [...networks, {
      id: createId('connection-network'),
      diagramId,
      type,
      nodes: [sourceNode, targetNode],
      edges: [connectionEdge(sourceNode.id, targetNode.id)],
    } satisfies ConnectionNetwork]
  }

  if (sourceIndex === targetIndex) {
    const withSource = ensureTerminal(networks[sourceIndex], source)
    const withTarget = ensureTerminal(withSource.network, target)
    if (withSource.nodeId === withTarget.nodeId) return null
    const duplicate = withTarget.network.edges.some((edge) => (
      edge.sourceNodeId === withSource.nodeId && edge.targetNodeId === withTarget.nodeId ||
      edge.sourceNodeId === withTarget.nodeId && edge.targetNodeId === withSource.nodeId
    ))
    if (duplicate) return null
    const updated: ConnectionNetwork = {
      ...withTarget.network,
      type,
      edges: [...withTarget.network.edges, connectionEdge(withSource.nodeId, withTarget.nodeId)],
    }
    return networks.map((network, networkIndex) => networkIndex === sourceIndex ? updated : network)
  }

  if (sourceIndex < 0 || targetIndex < 0) {
    const index = sourceIndex >= 0 ? sourceIndex : targetIndex
    const withSource = ensureTerminal(networks[index], source)
    const withTarget = ensureTerminal(withSource.network, target)
    const updated: ConnectionNetwork = {
      ...withTarget.network,
      type,
      edges: [...withTarget.network.edges, connectionEdge(withSource.nodeId, withTarget.nodeId)],
    }
    return networks.map((network, networkIndex) => networkIndex === index ? updated : network)
  }

  const withSource = ensureTerminal(networks[sourceIndex], source)
  const withTarget = ensureTerminal(networks[targetIndex], target)
  if (withSource.network.powerSupplyChannel && withTarget.network.powerSupplyChannel && withSource.network.powerSupplyChannel !== withTarget.network.powerSupplyChannel) return null
  const merged: ConnectionNetwork = {
    id: withSource.network.id,
    diagramId,
    type,
    powerSupplyChannel: withSource.network.powerSupplyChannel ?? withTarget.network.powerSupplyChannel,
    nodes: [...withSource.network.nodes, ...withTarget.network.nodes],
    edges: [
      ...withSource.network.edges,
      ...withTarget.network.edges,
      connectionEdge(withSource.nodeId, withTarget.nodeId),
    ],
  }
  return networks.flatMap((network, index) => {
    if (index === sourceIndex) return [merged]
    if (index === targetIndex) return []
    return [network]
  })
}

function terminalTypeForNode(
  node: ConnectionNode,
  elementsById: Map<string, DiagramElement>,
  assetsByKey: Map<string, AssetDefinition>,
  busbarsById: Map<string, Busbar>,
  junctionType: AnchorType,
) {
  if (node.kind === 'node') return junctionType
  if (node.kind === 'busbar-tap') {
    const busbar = busbarsById.get(node.busbarId)
    return busbar && node.offset >= 0 && node.offset <= busbar.length
      ? 'electrical' as const
      : null
  }
  if (node.kind !== 'element-anchor') return null
  const element = elementsById.get(node.elementId)
  return element
    ? assetsByKey.get(element.assetKey)?.anchors.find((anchor) => anchor.id === node.anchorId)?.type ?? null
    : null
}

function normalizeNetwork(
  network: ConnectionNetwork,
  elementsById: Map<string, DiagramElement>,
  assetsByKey: Map<string, AssetDefinition>,
  busbarsById: Map<string, Busbar>,
) {
  let nodes = network.nodes.filter((node) => (
    terminalTypeForNode(node, elementsById, assetsByKey, busbarsById, network.type) !== null
  ))
  let nodeIds = new Set(nodes.map((node) => node.id))
  let edges = segmentConnectionEdgesAtNodes([{ ...network, nodes }])[0].edges.flatMap((edge) => {
    if (
      edge.sourceNodeId === edge.targetNodeId ||
      !nodeIds.has(edge.sourceNodeId) ||
      !nodeIds.has(edge.targetNodeId)
    ) return []
    return [edge]
  })

  let changed = true
  while (changed) {
    changed = false
    const degree = new Map(nodes.map((node) => [node.id, 0]))
    edges.forEach((edge) => {
      degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1)
      degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1)
    })
    const removable = nodes.find((node) => (degree.get(node.id) ?? 0) === 0)
    if (removable) {
      nodes = nodes.filter((node) => node.id !== removable.id)
      edges = edges.filter((edge) => (
        edge.sourceNodeId !== removable.id &&
        edge.targetNodeId !== removable.id
      ))
      changed = true
    }
  }

  nodeIds = new Set(nodes.map((node) => node.id))
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId)
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId)
  })
  const tapIdsByBusbar = new Map<string, string[]>()
  nodes.forEach((node) => {
    if (node.kind !== 'busbar-tap') return
    const tapIds = tapIdsByBusbar.get(node.busbarId) ?? []
    tapIds.push(node.id)
    tapIdsByBusbar.set(node.busbarId, tapIds)
  })
  tapIdsByBusbar.forEach((tapIds) => {
    tapIds.forEach((left) => tapIds.forEach((right) => {
      if (left !== right) adjacency.get(left)?.add(right)
    }))
  })
  const pendingIds = new Set(nodeIds)
  const normalized: ConnectionNetwork[] = []
  while (pendingIds.size) {
    const first = pendingIds.values().next().value as string
    const componentIds = new Set<string>([first])
    const queue = [first]
    pendingIds.delete(first)
    while (queue.length) {
      const current = queue.shift()!
      for (const next of adjacency.get(current) ?? []) {
        if (componentIds.has(next)) continue
        componentIds.add(next)
        pendingIds.delete(next)
        queue.push(next)
      }
    }
    const componentNodes = nodes.filter((node) => componentIds.has(node.id))
    const componentEdges = edges.filter((edge) => (
      componentIds.has(edge.sourceNodeId) && componentIds.has(edge.targetNodeId)
    ))
    const anchorTypes = componentNodes.flatMap((node) => {
      const type = terminalTypeForNode(
        node,
        elementsById,
        assetsByKey,
        busbarsById,
        network.type,
      )
      return type ? [type] : []
    })
    const type = resolveConnectionType(anchorTypes.every((type) => type === 'cooling-general') ? [network.type, ...anchorTypes] : anchorTypes)
    if (anchorTypes.length < 2 || !type || componentEdges.length === 0) continue
    normalized.push({
      ...network,
      id: normalized.length === 0 ? network.id : createId('connection-network'),
      type,
      powerSupplyChannel: network.powerSupplyChannel ?? componentNodes.flatMap((node) => node.kind === 'busbar-tap' ? [busbarsById.get(node.busbarId)?.powerSupplyChannel] : []).find(Boolean),
      nodes: componentNodes,
      edges: componentEdges,
    })
  }
  return normalized
}

export function normalizeConnectionNetworks(
  networks: ConnectionNetwork[],
  elements: DiagramElement[],
  assets: AssetDefinition[],
  busbars: Busbar[] = [],
) {
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  return networks.flatMap((network) => normalizeNetwork(
    network,
    elementsById,
    assetsByKey,
    busbarsById,
  ))
}

export function deleteConnectionEdge(
  networks: ConnectionNetwork[],
  edgeId: string,
  elements: DiagramElement[],
  assets: AssetDefinition[],
  busbars: Busbar[] = [],
) {
  return normalizeConnectionNetworks(networks.map((network) => ({
    ...network,
    edges: network.edges.filter((edge) => edge.id !== edgeId),
  })), elements, assets, busbars)
}

export function deleteBusbarConnections(
  networks: ConnectionNetwork[],
  busbarId: string,
  elements: DiagramElement[],
  assets: AssetDefinition[],
  remainingBusbars: Busbar[],
) {
  const detached = networks.map((network) => {
    const removedNodeIds = new Set(network.nodes.flatMap((node) => (
      node.kind === 'busbar-tap' && node.busbarId === busbarId ? [node.id] : []
    )))
    return {
      ...network,
      nodes: network.nodes.filter((node) => !removedNodeIds.has(node.id)),
      edges: network.edges.filter((edge) => (
        !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId)
      )),
    }
  })
  return normalizeConnectionNetworks(detached, elements, assets, remainingBusbars)
}

export function occupiedAnchorKeys(networks: ConnectionNetwork[]) {
  return new Set(networks.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'element-anchor' ? [`${node.elementId}::${node.anchorId}`] : []
  ))))
}

export function crossingPointKeys(crossings: ConnectionCrossing[]) {
  return new Set(crossings.map((point) => pointKey(point)))
}

export function pathData(points: Point[]) {
  if (!points.length) return ''
  return points.slice(1).reduce(
    (path, point) => `${path} L ${point.x} ${point.y}`,
    `M ${points[0].x} ${points[0].y}`,
  )
}

interface PhysicalRouteSegment {
  start: Point
  end: Point
}

function pointOnOrthogonalSegment(point: Point, start: Point, end: Point) {
  if (start.y === end.y) {
    return point.y === start.y &&
      point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x)
  }
  if (start.x === end.x) {
    return point.x === start.x &&
      point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y)
  }
  return false
}

/**
 * Derives physical branches from unique directions, rather than logical edge
 * count. Overlapping routes remain one pipe; only points with at least three
 * visible directions are branches that must keep a square junction.
 */
export function connectionRouteBranchPointKeys(
  routes: RoutedConnectionEdge[],
  previous: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  const routesByNetworkId = new Map<string, RoutedConnectionEdge[]>()
  routes.forEach((route) => {
    const networkRoutes = routesByNetworkId.get(route.networkId) ?? []
    networkRoutes.push(route)
    routesByNetworkId.set(route.networkId, networkRoutes)
  })

  return new Map([...routesByNetworkId].map(([networkId, networkRoutes]) => {
    const candidates = new Map<string, Point>()
    const segments: PhysicalRouteSegment[] = []
    networkRoutes.forEach((route) => {
      route.points.forEach((point) => candidates.set(pointKey(point), point))
      route.points.slice(1).forEach((end, index) => {
        const start = route.points[index]
        if (segmentDirection(start, end) !== undefined) segments.push({ start, end })
      })
    })
    const branches = new Set<string>()
    candidates.forEach((point, key) => {
      const directions = new Set<number>()
      segments.forEach(({ start, end }) => {
        if (!pointOnOrthogonalSegment(point, start, end)) return
        if (!pointsEqual(point, start)) {
          const direction = segmentDirection(point, start)
          if (direction !== undefined) directions.add(direction)
        }
        if (!pointsEqual(point, end)) {
          const direction = segmentDirection(point, end)
          if (direction !== undefined) directions.add(direction)
        }
      })
      if (directions.size >= 3) branches.add(key)
    })
    const previousBranches = previous.get(networkId)
    const stableBranches = previousBranches &&
      previousBranches.size === branches.size &&
      [...branches].every((key) => previousBranches.has(key))
      ? previousBranches
      : branches
    return [networkId, stableBranches] as const
  }))
}

export function connectionTerminalArrowPath(
  points: Point[],
  direction: ConnectionFlowDirection,
  zoom = 1,
  tipInsetScreen = 0,
) {
  if (points.length < 2) return ''
  const tipIndex = direction === 'forward' ? points.length - 1 : 0
  const step = direction === 'forward' ? -1 : 1
  const terminal = points[tipIndex]
  let adjacentIndex = tipIndex + step
  while (
    adjacentIndex >= 0 &&
    adjacentIndex < points.length &&
    points[adjacentIndex].x === terminal.x &&
    points[adjacentIndex].y === terminal.y
  ) adjacentIndex += step
  if (adjacentIndex < 0 || adjacentIndex >= points.length) return ''
  const adjacent = points[adjacentIndex]
  const deltaX = terminal.x - adjacent.x
  const deltaY = terminal.y - adjacent.y
  const length = Math.hypot(deltaX, deltaY)
  if (length === 0) return ''
  const unitX = deltaX / length
  const unitY = deltaY / length
  const safeZoom = Math.max(zoom, 0.1)
  const arrowLength = 8 / safeZoom
  const halfWidth = 4 / safeZoom
  const tipInset = Math.min(
    Math.max(0, tipInsetScreen) / safeZoom,
    Math.max(0, length - arrowLength),
  )
  const tip = {
    x: terminal.x - unitX * tipInset,
    y: terminal.y - unitY * tipInset,
  }
  const baseX = tip.x - unitX * arrowLength
  const baseY = tip.y - unitY * arrowLength
  const perpendicularX = -unitY * halfWidth
  const perpendicularY = unitX * halfWidth
  return [
    `M ${tip.x} ${tip.y}`,
    `L ${baseX + perpendicularX} ${baseY + perpendicularY}`,
    `L ${baseX - perpendicularX} ${baseY - perpendicularY}`,
    'Z',
  ].join(' ')
}

export interface BridgedPathData {
  linePath: string
  bridgeCasingPath: string
}

export interface BridgedPathOptions {
  bridgeRadius?: number
  cornerRadius?: number
  squareCornerPointKeys?: ReadonlySet<string>
  sourceEndpointArc?: RouteEndpointArc
  targetEndpointArc?: RouteEndpointArc
}

interface BridgeArc {
  start: Point
  end: Point
  radius: number
  sweep: 0 | 1
}

interface RoundedCorner {
  entry: Point
  exit: Point
  center: Point
  radius: number
  sweep: 0 | 1
}

export interface RouteEndpointArc {
  entry: Point
  midpoint: Point
  center: Point
  radius: number
  sweep: 0 | 1
}

export interface ConnectedRouteDisplayGeometry {
  route: RoutedConnectionEdge
  sourceEndpointArc?: RouteEndpointArc
  targetEndpointArc?: RouteEndpointArc
}

interface RouteEndpointIncident {
  route: RoutedConnectionEdge
  endpoint: 'source' | 'target'
  nodeId: string
  point: Point
  adjacent: Point
  direction: number
  length: number
}

function routeEndpointIncident(
  route: RoutedConnectionEdge,
  endpoint: 'source' | 'target',
): RouteEndpointIncident | null {
  const pointIndex = endpoint === 'source' ? 0 : route.points.length - 1
  const step = endpoint === 'source' ? 1 : -1
  const point = route.points[pointIndex]
  if (!point) return null
  let adjacentIndex = pointIndex + step
  while (
    adjacentIndex >= 0 &&
    adjacentIndex < route.points.length &&
    pointsEqual(point, route.points[adjacentIndex])
  ) adjacentIndex += step
  const adjacent = route.points[adjacentIndex]
  if (!adjacent) return null
  const direction = segmentDirection(point, adjacent)
  if (direction === undefined) return null
  return {
    route,
    endpoint,
    nodeId: endpoint === 'source' ? route.sourceNodeId : route.targetNodeId,
    point,
    adjacent,
    direction,
    length: Math.abs(adjacent.x - point.x) + Math.abs(adjacent.y - point.y),
  }
}

function routeDirectionVector(direction: number) {
  if (direction === 0) return { x: 1, y: 0 }
  if (direction === 1) return { x: 0, y: 1 }
  if (direction === 2) return { x: -1, y: 0 }
  return { x: 0, y: -1 }
}

function stableGeometryCoordinate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function routeEndpointArc(
  point: Point,
  direction: number,
  otherDirection: number,
  radius: number,
): RouteEndpointArc {
  const vector = routeDirectionVector(direction)
  const otherVector = routeDirectionVector(otherDirection)
  const center = {
    x: point.x + (vector.x + otherVector.x) * radius,
    y: point.y + (vector.y + otherVector.y) * radius,
  }
  const midpointOffset = radius / Math.sqrt(2)
  const entry = {
    x: point.x + vector.x * radius,
    y: point.y + vector.y * radius,
  }
  const midpoint = {
    x: stableGeometryCoordinate(
      center.x - (vector.x + otherVector.x) * midpointOffset,
    ),
    y: stableGeometryCoordinate(
      center.y - (vector.y + otherVector.y) * midpointOffset,
    ),
  }
  const start = { x: entry.x - center.x, y: entry.y - center.y }
  const end = { x: midpoint.x - center.x, y: midpoint.y - center.y }
  return {
    entry,
    midpoint,
    center,
    radius,
    sweep: start.x * end.y - start.y * end.x > 0 ? 1 : 0,
  }
}

function trimRouteEndpoint(
  geometry: ConnectedRouteDisplayGeometry,
  endpoint: 'source' | 'target',
  entry: Point,
) {
  const points = geometry.route.points.map((point) => ({ ...point }))
  points[endpoint === 'source' ? 0 : points.length - 1] = entry
  return {
    ...geometry,
    route: { ...geometry.route, points },
  }
}

/**
 * A persisted degree-two node splits editing semantics into two edges, but it
 * is still one physical elbow. Each incident edge owns one half of the visual
 * quarter-circle so different edge styles can meet deterministically without
 * changing topology or creating a duplicate full arc.
 */
export function connectedRouteEndpointGeometry(
  routes: RoutedConnectionEdge[],
  roundableNodeIdsByNetworkId: ReadonlyMap<string, ReadonlySet<string>>,
  crossings: ConnectionCrossingSource,
  preferredRadius: number,
  squareCornerPointKeysByNetworkId: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  const geometryByEdgeId = new Map<string, ConnectedRouteDisplayGeometry>(
    routes.map((route) => [route.edgeId, { route }]),
  )
  if (preferredRadius <= 0) return geometryByEdgeId

  const incidentsByNode = new Map<string, RouteEndpointIncident[]>()
  routes.forEach((route) => {
    for (const endpoint of ['source', 'target'] as const) {
      const incident = routeEndpointIncident(route, endpoint)
      if (
        !incident ||
        !roundableNodeIdsByNetworkId.get(route.networkId)?.has(incident.nodeId)
      ) continue
      const key = `${route.networkId}::${incident.nodeId}`
      const incidents = incidentsByNode.get(key) ?? []
      incidents.push(incident)
      incidentsByNode.set(key, incidents)
    }
  })

  incidentsByNode.forEach((incidents) => {
    const firstIncident = incidents[0]
    if (squareCornerPointKeysByNetworkId.get(firstIncident.route.networkId)
      ?.has(pointKey(firstIncident.point))) return
    const directions = [...new Set(incidents.map((incident) => incident.direction))]
    if (
      directions.length !== 2 ||
      reverseDirection(directions[0]) === directions[1]
    ) return
    if (incidents.some((incident) => crossingsForEdge(crossings, incident.route.edgeId)
      .some((crossing) => (
        pointOnOrthogonalSegment(crossing, incident.point, incident.adjacent) &&
        Math.abs(crossing.x - incident.point.x) +
          Math.abs(crossing.y - incident.point.y) <= preferredRadius * 2
      )))) return

    const radius = Math.min(
      preferredRadius,
      ...incidents.map((incident) => incident.length / 2),
    )
    if (radius <= 0) return

    incidents.forEach((incident) => {
      const otherDirection = directions.find((direction) => direction !== incident.direction)!
      const endpointArc = routeEndpointArc(
        incident.point,
        incident.direction,
        otherDirection,
        radius,
      )
      const current = geometryByEdgeId.get(incident.route.edgeId)
      if (!current) return
      const trimmed = trimRouteEndpoint(current, incident.endpoint, endpointArc.entry)
      geometryByEdgeId.set(incident.route.edgeId, {
        ...trimmed,
        ...(incident.endpoint === 'source'
          ? { sourceEndpointArc: endpointArc }
          : { targetEndpointArc: endpointArc }),
      })
    })
  })

  return geometryByEdgeId
}

function cornerIsNearCrossing(
  previous: Point,
  corner: Point,
  next: Point,
  crossings: ConnectionCrossing[],
  radius: number,
) {
  const clearance = radius * 2
  return crossings.some((crossing) => (
    (pointOnOrthogonalSegment(crossing, previous, corner) ||
      pointOnOrthogonalSegment(crossing, corner, next)) &&
    Math.abs(crossing.x - corner.x) + Math.abs(crossing.y - corner.y) <= clearance
  ))
}

function roundedCorners(
  points: Point[],
  preferredRadius: number,
  squareCornerPointKeys: ReadonlySet<string>,
  crossings: ConnectionCrossing[],
) {
  const corners = new Map<number, RoundedCorner>()
  if (preferredRadius <= 0) return corners
  points.slice(1, -1).forEach((corner, offset) => {
    const index = offset + 1
    const previous = points[index - 1]
    const next = points[index + 1]
    const incomingDirection = segmentDirection(previous, corner)
    const outgoingDirection = segmentDirection(corner, next)
    if (
      incomingDirection === undefined ||
      outgoingDirection === undefined ||
      incomingDirection === outgoingDirection ||
      reverseDirection(incomingDirection) === outgoingDirection ||
      squareCornerPointKeys.has(pointKey(corner)) ||
      cornerIsNearCrossing(previous, corner, next, crossings, preferredRadius)
    ) return
    const incomingLength = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y)
    const outgoingLength = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y)
    const radius = Math.min(preferredRadius, incomingLength / 2, outgoingLength / 2)
    if (radius <= 0) return
    const incoming = {
      x: Math.sign(corner.x - previous.x),
      y: Math.sign(corner.y - previous.y),
    }
    const outgoing = {
      x: Math.sign(next.x - corner.x),
      y: Math.sign(next.y - corner.y),
    }
    corners.set(index, {
      entry: {
        x: corner.x - incoming.x * radius,
        y: corner.y - incoming.y * radius,
      },
      exit: {
        x: corner.x + outgoing.x * radius,
        y: corner.y + outgoing.y * radius,
      },
      center: {
        x: corner.x - incoming.x * radius + outgoing.x * radius,
        y: corner.y - incoming.y * radius + outgoing.y * radius,
      },
      radius,
      sweep: incoming.x * outgoing.y - incoming.y * outgoing.x > 0 ? 1 : 0,
    })
  })
  return corners
}

function roundedCornerPathCommand(corner: RoundedCorner) {
  return `A ${corner.radius} ${corner.radius} 0 0 ${corner.sweep} ${corner.exit.x} ${corner.exit.y}`
}

function endpointArcPathCommand(arc: RouteEndpointArc, reverse = false) {
  const end = reverse ? arc.entry : arc.midpoint
  const sweep = reverse ? arc.sweep ? 0 : 1 : arc.sweep
  return `A ${arc.radius} ${arc.radius} 0 0 ${sweep} ${end.x} ${end.y}`
}

export function roundedOrthogonalPathData(
  points: Point[],
  cornerRadius: number,
  squareCornerPointKeys: ReadonlySet<string> = new Set(),
) {
  if (!points.length) return ''
  const corners = roundedCorners(points, cornerRadius, squareCornerPointKeys, [])
  let linePath = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length; index += 1) {
    const corner = corners.get(index)
    const end = corner?.entry ?? points[index]
    linePath += ` L ${end.x} ${end.y}`
    if (corner) linePath += ` ${roundedCornerPathCommand(corner)}`
  }
  return linePath
}

function bridgeArcsOnSegment(
  start: Point,
  end: Point,
  crossings: ConnectionCrossing[],
  gridSize: number,
  preferredRadius = gridSize * 0.5,
) {
  const horizontal = start.y === end.y
  const direction = horizontal ? Math.sign(end.x - start.x) : Math.sign(end.y - start.y)
  if (!direction) return []
  const points = crossings
    .filter((crossing) => (
      horizontal
        ? crossing.y === start.y &&
          crossing.x > Math.min(start.x, end.x) && crossing.x < Math.max(start.x, end.x)
        : crossing.x === start.x &&
          crossing.y > Math.min(start.y, end.y) && crossing.y < Math.max(start.y, end.y)
    ))
    .sort((left, right) => horizontal
      ? (left.x - right.x) * direction
      : (left.y - right.y) * direction)
    .filter((point, index, ordered) => (
      index === 0 || !pointsEqual(point, ordered[index - 1])
    ))
  const segmentLength = Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
  return points.map((point, index): BridgeArc => {
    const distanceFromStart = horizontal
      ? Math.abs(point.x - start.x)
      : Math.abs(point.y - start.y)
    const distanceFromEnd = segmentLength - distanceFromStart
    const previousGap = index === 0
      ? Number.POSITIVE_INFINITY
      : horizontal
        ? Math.abs(point.x - points[index - 1].x)
        : Math.abs(point.y - points[index - 1].y)
    const nextGap = index === points.length - 1
      ? Number.POSITIVE_INFINITY
      : horizontal
        ? Math.abs(points[index + 1].x - point.x)
        : Math.abs(points[index + 1].y - point.y)
    const radius = Math.min(
      preferredRadius,
      distanceFromStart,
      distanceFromEnd,
      previousGap / 2,
      nextGap / 2,
    )
    return {
      start: horizontal
        ? { x: point.x - direction * radius, y: point.y }
        : { x: point.x, y: point.y - direction * radius },
      end: horizontal
        ? { x: point.x + direction * radius, y: point.y }
        : { x: point.x, y: point.y + direction * radius },
      radius,
      sweep: direction > 0 ? 1 : 0,
    }
  }).filter((arc) => arc.radius > 0)
}

function crossingsForEdge(
  crossings: ConnectionCrossingSource,
  edgeId: string,
): ConnectionCrossing[] {
  return Array.isArray(crossings)
    ? crossings.filter((crossing) => crossing.bridgeEdgeId === edgeId)
    : crossings.get(edgeId) ?? []
}

export function bridgedPathData(
  route: RoutedConnectionEdge,
  crossings: ConnectionCrossingSource,
  gridSize: number,
  options: BridgedPathOptions = {},
) : BridgedPathData {
  if (!route.points.length) return { linePath: '', bridgeCasingPath: '' }
  const edgeCrossings = crossingsForEdge(crossings, route.edgeId)
  const bridgeRadius = options.bridgeRadius ?? gridSize * 0.5
  const corners = roundedCorners(
    route.points,
    options.cornerRadius ?? 0,
    options.squareCornerPointKeys ?? new Set(),
    edgeCrossings,
  )
  let linePath = options.sourceEndpointArc
    ? `M ${options.sourceEndpointArc.midpoint.x} ${options.sourceEndpointArc.midpoint.y} ${
        endpointArcPathCommand(options.sourceEndpointArc, true)
      }`
    : `M ${route.points[0].x} ${route.points[0].y}`
  const casingParts: string[] = []
  for (let index = 1; index < route.points.length; index += 1) {
    const start = corners.get(index - 1)?.exit ?? route.points[index - 1]
    const corner = corners.get(index)
    const end = corner?.entry ?? route.points[index]
    const arcs = bridgeArcsOnSegment(
      start,
      end,
      edgeCrossings,
      gridSize,
      bridgeRadius,
    )
    for (const arc of arcs) {
      // Crossings remain straight; only the upper line owns a local opaque casing.
      casingParts.push(`M ${arc.start.x} ${arc.start.y} L ${arc.end.x} ${arc.end.y}`)
    }
    linePath += ` L ${end.x} ${end.y}`
    if (corner) linePath += ` ${roundedCornerPathCommand(corner)}`
  }
  if (options.targetEndpointArc) {
    linePath += ` ${endpointArcPathCommand(options.targetEndpointArc)}`
  }
  return {
    linePath,
    bridgeCasingPath: casingParts.join(' '),
  }
}

function appendDistinctPoint(points: Point[], point: Point) {
  if (!points.length || !pointsEqual(points[points.length - 1], point)) points.push(point)
}

function appendSampledEndpointArc(
  points: Point[],
  arc: RouteEndpointArc,
  reverse: boolean,
  steps: number,
) {
  const start = reverse ? arc.midpoint : arc.entry
  const end = reverse ? arc.entry : arc.midpoint
  const sweep = reverse ? arc.sweep ? 0 : 1 : arc.sweep
  const startAngle = Math.atan2(start.y - arc.center.y, start.x - arc.center.x)
  const endAngle = Math.atan2(end.y - arc.center.y, end.x - arc.center.x)
  let delta = endAngle - startAngle
  if (sweep && delta <= 0) delta += Math.PI * 2
  if (!sweep && delta >= 0) delta -= Math.PI * 2
  appendDistinctPoint(points, start)
  for (let step = 1; step <= steps; step += 1) {
    const angle = startAngle + delta * (step / steps)
    appendDistinctPoint(points, {
      x: stableGeometryCoordinate(arc.center.x + Math.cos(angle) * arc.radius),
      y: stableGeometryCoordinate(arc.center.y + Math.sin(angle) * arc.radius),
    })
  }
}

/**
 * Produces the same display geometry as `bridgedPathData`, but as sampled points
 * suitable for the WebGL monitor overlay. The business route remains unchanged.
 */
export function bridgedPolylinePoints(
  route: RoutedConnectionEdge,
  crossings: ConnectionCrossingSource,
  _gridSize: number,
  optionsOrArcSteps: BridgedPathOptions | number = {},
  arcSteps = 8,
) {
  if (!route.points.length) return []
  const options = typeof optionsOrArcSteps === 'number' ? {} : optionsOrArcSteps
  const resolvedArcSteps = typeof optionsOrArcSteps === 'number'
    ? optionsOrArcSteps
    : arcSteps
  const edgeCrossings = crossingsForEdge(crossings, route.edgeId)
  const corners = roundedCorners(
    route.points,
    options.cornerRadius ?? 0,
    options.squareCornerPointKeys ?? new Set(),
    edgeCrossings,
  )
  const endpointArcSteps = Math.max(2, Math.round(resolvedArcSteps / 4))
  const points: Point[] = []
  if (options.sourceEndpointArc) {
    appendSampledEndpointArc(
      points,
      options.sourceEndpointArc,
      true,
      endpointArcSteps,
    )
  } else {
    points.push({ ...route.points[0] })
  }
  for (let index = 1; index < route.points.length; index += 1) {
    const corner = corners.get(index)
    const end = corner?.entry ?? route.points[index]
    appendDistinctPoint(points, end)
    if (corner) {
      const startAngle = Math.atan2(
        corner.entry.y - corner.center.y,
        corner.entry.x - corner.center.x,
      )
      const endAngle = Math.atan2(
        corner.exit.y - corner.center.y,
        corner.exit.x - corner.center.x,
      )
      let delta = endAngle - startAngle
      if (corner.sweep && delta <= 0) delta += Math.PI * 2
      if (!corner.sweep && delta >= 0) delta -= Math.PI * 2
      const steps = Math.max(2, Math.round(resolvedArcSteps / 2))
      for (let step = 1; step <= steps; step += 1) {
        const angle = startAngle + delta * (step / steps)
        appendDistinctPoint(points, {
          x: corner.center.x + Math.cos(angle) * corner.radius,
          y: corner.center.y + Math.sin(angle) * corner.radius,
        })
      }
    }
  }
  if (options.targetEndpointArc) {
    appendSampledEndpointArc(
      points,
      options.targetEndpointArc,
      false,
      endpointArcSteps,
    )
  }
  return points
}

export function pathDataWithBridges(
  route: RoutedConnectionEdge,
  crossings: ConnectionCrossingSource,
  gridSize: number,
) {
  return bridgedPathData(route, crossings, gridSize).linePath
}
