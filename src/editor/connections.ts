import {
  resolveConnectionType,
  type AnchorDirection,
  type AnchorType,
  type AssetDefinition,
  type Busbar,
  type ConnectionEdge,
  type ConnectionNetwork,
  type ConnectionNode,
  type DiagramElement,
  type SymbolAnchor,
} from '../domain/project'
import { elementsBounds, rotatePoint, snap, type Point, type Rect } from './geometry'

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

export interface RoutedConnections {
  edges: RoutedConnectionEdge[]
  crossings: ConnectionCrossing[]
  invalidEdgeIds: string[]
  resolvedBusbarTapOffsets: Record<string, number>
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

const DIRECTION_ORDER: AnchorDirection[] = ['top', 'right', 'bottom', 'left']
const SEARCH_DIRECTIONS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]
const REUSED_SEGMENT_COST = 0.9

interface RouteOptions {
  startDirection?: number
  endDirection?: number
  startAllowedDirections?: number[]
  endAllowedDirections?: number[]
  reusableEdges?: Set<string>
  reusableEdgeCost?: number
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

function busbarConnectionDirections(busbar: Busbar) {
  return busbar.orientation === 'horizontal' ? [1, 3] : [0, 2]
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
  const unique = points.filter((point, index) => index === 0 || !pointsEqual(point, points[index - 1]))
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true
    const previous = unique[index - 1]
    const next = unique[index + 1]
    const horizontal = previous.y === point.y && point.y === next.y
    const vertical = previous.x === point.x && point.x === next.x
    return !horizontal && !vertical
  })
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
  const epsilon = gridSize / 1000
  const gridPoint = { x: snap(resolved.point.x, gridSize), y: snap(resolved.point.y, gridSize) }
  let outside: Point
  if (resolved.direction === 'top') {
    outside = {
      x: resolved.point.x,
      y: Math.floor((bounds.y - epsilon) / gridSize) * gridSize,
    }
    gridPoint.y = outside.y
  } else if (resolved.direction === 'right') {
    outside = {
      x: Math.ceil((bounds.x + bounds.width + epsilon) / gridSize) * gridSize,
      y: resolved.point.y,
    }
    gridPoint.x = outside.x
  } else if (resolved.direction === 'bottom') {
    outside = {
      x: resolved.point.x,
      y: Math.ceil((bounds.y + bounds.height + epsilon) / gridSize) * gridSize,
    }
    gridPoint.y = outside.y
  } else {
    outside = {
      x: Math.floor((bounds.x - epsilon) / gridSize) * gridSize,
      y: resolved.point.y,
    }
    gridPoint.x = outside.x
  }
  const lead = compactOrthogonalPoints([resolved.point, outside, gridPoint])
  const departureDirection = lastSegmentDirection(lead)
  return {
    actual: resolved.point,
    grid: gridPoint,
    lead,
    departureDirection,
    arrivalDirection: departureDirection === undefined
      ? undefined
      : reverseDirection(departureDirection),
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
  const hasReusableEdges = (options.reusableEdges?.size ?? 0) > 0
  const reusableEdgeCost = options.reusableEdgeCost ?? REUSED_SEGMENT_COST
  const minimumStepCost = hasReusableEdges ? reusableEdgeCost : 1
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
      minimumStepCost * heuristicWeight,
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

      const steps = current.steps + (
        options.reusableEdges?.has(edgeKey) ? reusableEdgeCost : 1
      )
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
        minimumStepCost * heuristicWeight
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
  obstacles: Rect[],
  occupiedEdges: Set<string>,
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
  const blockedEdges = blockedGridEdges(obstacles, gridSize)
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
        !sourceDirections.includes(directionIndex) ||
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
        !targetDirections.includes(directionIndex) ||
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
  obstacles: Rect[],
  occupiedEdges: Set<string>,
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
      obstacles,
      occupiedEdges,
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
  if (node.kind === 'busbar-tap') {
    const busbar = busbarsById.get(node.busbarId)
    if (!busbar || node.offset < 0 || node.offset > busbar.length) return null
    const offset = resolvedBusbarTapOffsets.get(node.id) ?? node.offset
    const point = busbarPoint(busbar, offset)
    const directions = busbarConnectionDirections(busbar)
    return {
      actual: point,
      grid: point,
      lead: [point],
      departureDirections: directions,
      arrivalDirections: directions,
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
  reusableEdges?: Set<string>,
) {
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
      reusableEdges,
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

function findCrossings(edges: RoutedConnectionEdge[]) {
  const crossings: ConnectionCrossing[] = []
  const seen = new Set<string>()
  for (let laterIndex = 1; laterIndex < edges.length; laterIndex += 1) {
    const later = edges[laterIndex]
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = edges[earlierIndex]
      if (later.networkId === earlier.networkId) continue
      const sharedNodeIds = new Set([
        later.sourceNodeId,
        later.targetNodeId,
      ].filter((id) => id === earlier.sourceNodeId || id === earlier.targetNodeId))
      for (let leftIndex = 1; leftIndex < later.points.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex < earlier.points.length; rightIndex += 1) {
          const point = segmentCrossing(
            later.points[leftIndex - 1],
            later.points[leftIndex],
            earlier.points[rightIndex - 1],
            earlier.points[rightIndex],
          )
          if (!point) continue
          const atSharedEndpoint = sharedNodeIds.size > 0 && (
            pointsEqual(point, later.points[0]) ||
            pointsEqual(point, later.points.at(-1)!)
          ) && (
            pointsEqual(point, earlier.points[0]) ||
            pointsEqual(point, earlier.points.at(-1)!)
          )
          if (atSharedEndpoint) continue
          const key = `${later.edgeId}::${earlier.edgeId}::${pointKey(point)}`
          if (seen.has(key)) continue
          seen.add(key)
          crossings.push({
            ...point,
            bridgeEdgeId: later.edgeId,
            underEdgeId: earlier.edgeId,
          })
        }
      }
    }
  }
  return crossings
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
  return { from: committed.point, to: preview.point, direction: preview.direction }
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
  return { from: originalPoint, to: point, direction }
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
  const committedNetworksById = new Map(committedNetworks.map((network) => [network.id, network]))
  const previewNetworksById = new Map(previewNetworks.map((network) => [network.id, network]))
  const committedElementsById = new Map(committedElements.map((element) => [element.id, element]))
  const previewElementsById = new Map(previewElements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const previewBusbarsById = new Map(previewBusbars.map((busbar) => [busbar.id, busbar]))
  const resolvedBusbarTapOffsets = { ...routed.resolvedBusbarTapOffsets }
  previewNetworks.forEach((previewNetwork) => {
    const committedNodesById = new Map(
      committedNetworksById.get(previewNetwork.id)?.nodes.map((node) => [node.id, node]) ?? [],
    )
    previewNetwork.nodes.forEach((node) => {
      if (node.kind !== 'busbar-tap') return
      const committedNode = committedNodesById.get(node.id)
      const busbar = previewBusbarsById.get(node.busbarId)
      if (!busbar) return
      const previousResolved = resolvedBusbarTapOffsets[node.id] ?? (
        committedNode?.kind === 'busbar-tap' ? committedNode.offset : node.offset
      )
      const offset = committedNode?.kind === 'busbar-tap' && committedNode.offset !== node.offset
        ? node.offset
        : previousResolved
      resolvedBusbarTapOffsets[node.id] = Math.max(0, Math.min(offset, busbar.length))
    })
  })
  const edges = routed.edges.map((edge) => {
    const committedNetwork = committedNetworksById.get(edge.networkId)
    const previewNetwork = previewNetworksById.get(edge.networkId)
    const committedNodesById = new Map(
      committedNetwork?.nodes.map((node) => [node.id, node]) ?? [],
    )
    const previewNodesById = new Map(previewNetwork?.nodes.map((node) => [node.id, node]) ?? [])
    const sourceNode = committedNodesById.get(edge.sourceNodeId)
    const targetNode = committedNodesById.get(edge.targetNodeId)
    const sourceMovement = previewEndpointMovement(
      sourceNode,
      committedElementsById,
      previewElementsById,
      assetsByKey,
    ) ?? previewBusbarEndpointMovement(
      sourceNode,
      previewNodesById.get(edge.sourceNodeId),
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
      previewNodesById.get(edge.targetNodeId),
      edge.points.at(-1)!,
      edge.points.at(-2),
      previewBusbarsById,
      resolvedBusbarTapOffsets,
    )
    if (!sourceMovement && !targetMovement) return edge
    if (sourceMovement && targetMovement && sameMovement(sourceMovement, targetMovement)) {
      const dx = sourceMovement.to.x - sourceMovement.from.x
      const dy = sourceMovement.to.y - sourceMovement.from.y
      return {
        ...edge,
        points: edge.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      }
    }
    let points = edge.points
    if (sourceMovement) points = attachPreviewEndpoint(points, sourceMovement, gridSize, true)
    if (targetMovement) points = attachPreviewEndpoint(points, targetMovement, gridSize, false)
    return { ...edge, points }
  })
  return {
    ...routed,
    edges,
    crossings: [
      ...findCrossings(edges),
      ...findBusbarCrossings(edges, previewNetworks, previewBusbars),
    ],
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
        if (direction !== undefined && busbarConnectionDirections(busbar).includes(direction)) {
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
    }]
  })
}

function resolveBusbarTapPairOffsets(
  sourceTap: Extract<ConnectionNode, { kind: 'busbar-tap' }>,
  targetTap: Extract<ConnectionNode, { kind: 'busbar-tap' }>,
  busbarsById: Map<string, Busbar>,
  resolvedBusbarTapOffsets: Map<string, number>,
  obstacles: Rect[],
  occupiedEdges: Set<string>,
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
    obstacles,
    occupiedEdges,
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
  routedEdges: RoutedConnectionEdge[],
  tapBusbarIds: Map<string, string>,
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
    return otherEndpoint ? [{ tapIsSource, otherEndpoint }] : []
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
    const busbarDirections = busbarConnectionDirections(busbar)
    const tapEndpoint: RoutedEndpoint = {
      actual: candidate.point,
      grid: candidate.point,
      lead: [candidate.point],
      departureDirections: busbarDirections.filter((direction) => !occupiedDirections.has(direction)),
      arrivalDirections: busbarDirections.filter((direction) => (
        !occupiedDirections.has(reverseDirection(direction))
      )),
    }
    const candidateOccupied = new Set(occupiedEdges)
    let length = 0
    let turns = 0
    let valid = true
    for (const item of incident) {
      const points = item.tapIsSource
        ? routeEndpoints(tapEndpoint, item.otherEndpoint, obstacles, candidateOccupied, gridSize)
        : routeEndpoints(item.otherEndpoint, tapEndpoint, obstacles, candidateOccupied, gridSize)
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

export function routeConnectionNetworks(
  networks: ConnectionNetwork[],
  elements: DiagramElement[],
  assets: AssetDefinition[],
  gridSize: number,
  busbars: Busbar[] = [],
): RoutedConnections {
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  const tapBusbarIds = new Map(networks.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'busbar-tap' ? [[node.id, node.busbarId] as const] : []
  ))))
  const obstacles = elements.map((element) => elementsBounds([element])!).filter(Boolean)
  const occupied = new Set<string>()
  busbars.forEach((busbar) => {
    addOccupiedSegments([busbarPoint(busbar, 0), busbarEndPoint(busbar)], occupied, gridSize)
  })
  const routedEdges: RoutedConnectionEdge[] = []
  const invalidEdgeIds: string[] = []
  const resolvedBusbarTapOffsets = new Map<string, number>()
  let order = 0

  for (const network of networks) {
    const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
    const reusableSegments = new Set<string>()
    for (const edge of network.edges) {
      const source = nodesById.get(edge.sourceNodeId)
      const target = nodesById.get(edge.targetNodeId)
      if (source?.kind === 'busbar-tap' && target?.kind === 'busbar-tap') {
        resolveBusbarTapPairOffsets(
          source,
          target,
          busbarsById,
          resolvedBusbarTapOffsets,
          obstacles,
          occupied,
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
          occupied,
          routedEdges,
          tapBusbarIds,
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
      const points = routeEndpoints(
        sourceEndpoint,
        targetEndpoint,
        obstacles,
        occupied,
        gridSize,
        reusableSegments,
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
        order: order++,
      }
      routedEdges.push(routed)
      addOccupiedSegments(points, reusableSegments, gridSize)
    }
    reusableSegments.forEach((segment) => occupied.add(segment))
  }
  return {
    edges: routedEdges,
    crossings: [
      ...findCrossings(routedEdges),
      ...findBusbarCrossings(routedEdges, networks, busbars),
    ],
    invalidEdgeIds,
    resolvedBusbarTapOffsets: Object.fromEntries(resolvedBusbarTapOffsets),
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
  return terminal.kind === 'anchor'
    ? networkIdByAnchor.get(`${terminal.elementId}::${terminal.anchorId}`)
    : networkIdByBusbar.get(terminal.busbarId)
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
      const directions = busbarConnectionDirections(busbar)
      sourceEndpoint = {
        actual: source.point,
        grid: source.point,
        lead: [source.point],
        departureDirections: directions,
        arrivalDirections: directions,
      }
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
    } else if (!networkIdByBusbar.has(node.busbarId)) {
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
      const directions = busbarConnectionDirections(busbar)
      targetEndpoint = {
        actual: targetTerminal.point,
        grid: targetTerminal.point,
        lead: [targetTerminal.point],
        departureDirections: directions,
        arrivalDirections: directions,
      }
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
  const reusable = new Set<string>()
  const reusableNetworkIds = new Set([
    context.sourceNetworkId,
    targetTerminal
      ? terminalNetworkId(targetTerminal, networkIdByAnchor, networkIdByBusbar)
      : undefined,
  ].filter((networkId): networkId is string => networkId !== undefined))
  segmentNetworkIds.forEach((networkIds, segment) => {
    if ([...networkIds].some((networkId) => reusableNetworkIds.has(networkId))) {
      reusable.add(segment)
    }
    if ([...networkIds].some((networkId) => !reusableNetworkIds.has(networkId))) {
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
      reusableEdges: reusable,
      // Pointer previews prioritize frame latency. The finalized network reroute
      // applies the normal shared-segment preference after the user connects.
      reusableEdgeCost: 1,
      maxSearchStates: 24_000,
      marginSteps: [24],
      blockedEdges,
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

function connectionEdge(sourceNodeId: string, targetNodeId: string): ConnectionEdge {
  return {
    id: createId('connection-edge'),
    sourceNodeId,
    targetNodeId,
  }
}

function nodesHaveEdge(network: ConnectionNetwork, leftNodeId: string, rightNodeId: string) {
  return network.edges.some((edge) => (
    (edge.sourceNodeId === leftNodeId && edge.targetNodeId === rightNodeId) ||
    (edge.sourceNodeId === rightNodeId && edge.targetNodeId === leftNodeId)
  ))
}

function terminalMatches(node: ConnectionNode, terminal: ConnectionTerminal) {
  return terminal.kind === 'anchor'
    ? node.kind === 'element-anchor' &&
      node.elementId === terminal.elementId && node.anchorId === terminal.anchorId
    : node.kind === 'busbar-tap' &&
      node.busbarId === terminal.busbarId && node.offset === terminal.offset
}

function terminalNetworkIndex(
  networks: ConnectionNetwork[],
  terminal: ConnectionTerminal,
) {
  return networks.findIndex((network) => network.nodes.some((node) => (
    terminal.kind === 'busbar'
      ? node.kind === 'busbar-tap' && node.busbarId === terminal.busbarId
      : terminalMatches(node, terminal)
  )))
}

function ensureTerminal(network: ConnectionNetwork, terminal: ConnectionTerminal) {
  const existing = network.nodes.find((node) => terminalMatches(node, terminal))
  if (existing) return { network, nodeId: existing.id }
  const node = terminal.kind === 'anchor' ? anchorNode(terminal) : busbarTapNode(terminal)
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
    const sourceNode = source.kind === 'anchor' ? anchorNode(source) : busbarTapNode(source)
    const targetNode = target.kind === 'anchor' ? anchorNode(target) : busbarTapNode(target)
    return [...networks, {
      id: createId('connection-network'),
      diagramId,
      type,
      nodes: [sourceNode, targetNode],
      edges: [connectionEdge(sourceNode.id, targetNode.id)],
    } satisfies ConnectionNetwork]
  }

  if (sourceIndex === targetIndex) {
    const index = sourceIndex
    if (index < 0) return null
    const withSource = ensureTerminal(networks[index], source)
    const withTarget = ensureTerminal(withSource.network, target)
    if (
      withSource.nodeId === withTarget.nodeId ||
      nodesHaveEdge(withTarget.network, withSource.nodeId, withTarget.nodeId)
    ) return null
    const updated: ConnectionNetwork = {
      ...withTarget.network,
      type,
      edges: [...withTarget.network.edges, connectionEdge(withSource.nodeId, withTarget.nodeId)],
    }
    return networks.map((network, networkIndex) => networkIndex === index ? updated : network)
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
  const merged: ConnectionNetwork = {
    id: withSource.network.id,
    diagramId,
    type,
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
) {
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
    terminalTypeForNode(node, elementsById, assetsByKey, busbarsById) !== null
  ))
  let nodeIds = new Set(nodes.map((node) => node.id))
  let edges = network.edges.filter((edge) => (
    nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
  ))

  let changed = true
  while (changed) {
    changed = false
    const degree = new Map(nodes.map((node) => [node.id, 0]))
    edges.forEach((edge) => {
      degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1)
      degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1)
    })
    const removable = nodes.find((node) => (
      (degree.get(node.id) ?? 0) === 0
    ))
    if (removable) {
      nodes = nodes.filter((node) => node.id !== removable.id)
      edges = edges.filter((edge) => (
        edge.sourceNodeId !== removable.id && edge.targetNodeId !== removable.id
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
      const type = terminalTypeForNode(node, elementsById, assetsByKey, busbarsById)
      return type ? [type] : []
    })
    const type = resolveConnectionType(anchorTypes)
    if (anchorTypes.length < 2 || !type || componentEdges.length === 0) continue
    normalized.push({
      ...network,
      id: normalized.length === 0 ? network.id : createId('connection-network'),
      type,
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

export interface BridgedPathData {
  linePath: string
  bridgeCasingPath: string
}

interface BridgeArc {
  start: Point
  end: Point
  radius: number
  sweep: 0 | 1
}

function bridgeArcsOnSegment(
  start: Point,
  end: Point,
  crossings: ConnectionCrossing[],
  edgeId: string,
  gridSize: number,
) {
  const horizontal = start.y === end.y
  const direction = horizontal ? Math.sign(end.x - start.x) : Math.sign(end.y - start.y)
  if (!direction) return []
  const points = crossings
    .filter((crossing) => crossing.bridgeEdgeId === edgeId && (
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
      gridSize * 0.5,
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

function arcPathCommand(arc: BridgeArc) {
  return `A ${arc.radius} ${arc.radius} 0 0 ${arc.sweep} ${arc.end.x} ${arc.end.y}`
}

export function bridgedPathData(
  route: RoutedConnectionEdge,
  crossings: ConnectionCrossing[],
  gridSize: number,
) : BridgedPathData {
  if (!route.points.length) return { linePath: '', bridgeCasingPath: '' }
  let linePath = `M ${route.points[0].x} ${route.points[0].y}`
  const casingParts: string[] = []
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1]
    const end = route.points[index]
    const arcs = bridgeArcsOnSegment(start, end, crossings, route.edgeId, gridSize)
    for (const arc of arcs) {
      const command = arcPathCommand(arc)
      linePath += ` L ${arc.start.x} ${arc.start.y} ${command}`
      casingParts.push(`M ${arc.start.x} ${arc.start.y} ${command}`)
    }
    linePath += ` L ${end.x} ${end.y}`
  }
  return {
    linePath,
    bridgeCasingPath: casingParts.join(' '),
  }
}

function appendDistinctPoint(points: Point[], point: Point) {
  if (!points.length || !pointsEqual(points[points.length - 1], point)) points.push(point)
}

/**
 * Produces the same display geometry as `bridgedPathData`, but as sampled points
 * suitable for the WebGL monitor overlay. The business route remains unchanged.
 */
export function bridgedPolylinePoints(
  route: RoutedConnectionEdge,
  crossings: ConnectionCrossing[],
  gridSize: number,
  arcSteps = 8,
) {
  if (!route.points.length) return []
  const points: Point[] = [{ ...route.points[0] }]
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1]
    const end = route.points[index]
    const arcs = bridgeArcsOnSegment(start, end, crossings, route.edgeId, gridSize)
    for (const arc of arcs) {
      appendDistinctPoint(points, arc.start)
      const center = {
        x: (arc.start.x + arc.end.x) / 2,
        y: (arc.start.y + arc.end.y) / 2,
      }
      const startAngle = Math.atan2(arc.start.y - center.y, arc.start.x - center.x)
      const delta = arc.sweep ? Math.PI : -Math.PI
      const steps = Math.max(2, Math.round(arcSteps))
      for (let step = 1; step <= steps; step += 1) {
        const angle = startAngle + delta * (step / steps)
        appendDistinctPoint(points, {
          x: center.x + Math.cos(angle) * arc.radius,
          y: center.y + Math.sin(angle) * arc.radius,
        })
      }
    }
    appendDistinctPoint(points, end)
  }
  return points
}

export function pathDataWithBridges(
  route: RoutedConnectionEdge,
  crossings: ConnectionCrossing[],
  gridSize: number,
) {
  return bridgedPathData(route, crossings, gridSize).linePath
}
