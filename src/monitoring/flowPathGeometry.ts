import type { Point } from '../scene/geometry'
import { flowAnimationSpeedMultiplier, type MonitorFlowPath } from './flowPresentation'

export function projectedDistanceAlongPolyline(points: Point[], target: Point) {
  let accumulated = 0
  let best = { distanceAlong: 0, squaredDistance: Number.POSITIVE_INFINITY }
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const length = Math.sqrt(lengthSquared)
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (
          (target.x - start.x) * dx + (target.y - start.y) * dy
        ) / lengthSquared))
    const projected = { x: start.x + dx * ratio, y: start.y + dy * ratio }
    const squaredDistance = (target.x - projected.x) ** 2 +
      (target.y - projected.y) ** 2
    if (squaredDistance < best.squaredDistance) {
      best = { distanceAlong: accumulated + length * ratio, squaredDistance }
    }
    accumulated += length
  }
  return best.distanceAlong
}

export function polylineLength(points: Point[]) {
  return points.slice(1).reduce((length, point, index) => (
    length + Math.hypot(point.x - points[index].x, point.y - points[index].y)
  ), 0)
}

function slicePolylineByDistance(points: Point[], lower: number, upper: number) {
  if (points.length < 2 || upper <= lower) return []
  let accumulated = 0
  const sliced: Point[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (!length) continue
    const segmentStart = accumulated
    const segmentEnd = accumulated + length
    accumulated = segmentEnd
    if (segmentEnd < lower || segmentStart > upper) continue
    const pointAt = (distance: number) => {
      const ratio = Math.max(0, Math.min(1, (distance - segmentStart) / length))
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      }
    }
    const clippedStart = pointAt(Math.max(lower, segmentStart))
    const clippedEnd = pointAt(Math.min(upper, segmentEnd))
    const previous = sliced.at(-1)
    if (!previous || previous.x !== clippedStart.x || previous.y !== clippedStart.y) {
      sliced.push(clippedStart)
    }
    if (clippedStart.x !== clippedEnd.x || clippedStart.y !== clippedEnd.y) {
      sliced.push(clippedEnd)
    }
  }
  return sliced
}

export function splitFlowPathAroundCrossings(
  points: Point[],
  exclusions: Array<{ point: Point; radius: number }>,
) {
  if (points.length < 2 || !exclusions.length) return [points]
  const totalLength = polylineLength(points)
  const intervals = exclusions.map(({ point, radius }) => {
    const center = projectedDistanceAlongPolyline(points, point)
    return [
      Math.max(0, center - radius),
      Math.min(totalLength, center + radius),
    ] as const
  }).filter(([lower, upper]) => upper > lower)
    .sort((left, right) => left[0] - right[0])
  const merged: Array<[number, number]> = []
  intervals.forEach(([lower, upper]) => {
    const previous = merged.at(-1)
    if (previous && lower <= previous[1]) previous[1] = Math.max(previous[1], upper)
    else merged.push([lower, upper])
  })
  const fragments: Point[][] = []
  let cursor = 0
  merged.forEach(([lower, upper]) => {
    const fragment = slicePolylineByDistance(points, cursor, lower)
    if (fragment.length > 1) fragments.push(fragment)
    cursor = upper
  })
  const tail = slicePolylineByDistance(points, cursor, totalLength)
  if (tail.length > 1) fragments.push(tail)
  return fragments
}

/** Continue the animation coordinate over real topology nodes, never crossings.
 * Different rendered speeds are separate domains; raw hydraulic flow values
 * must not split domains when the renderer uses a uniform cooling speed.
 * At unequal-length merges/cycles, the first stable incoming route owns the
 * junction phase, so any unavoidable seam stays at a junction, not in a pipe.
 */
export function flowPhaseOffsets(paths: MonitorFlowPath[]) {
  type Link = { start: string; end: string; length: number }
  const links = new Map<string, Link>()
  const pathKeys = new Map<string, string>()
  for (const path of paths) {
    if (!path.phasePath) continue
    const ref = path.phasePath
    const domain = JSON.stringify([path.style ?? 'power', ref.networkId, flowAnimationSpeedMultiplier(path)])
    const key = JSON.stringify([domain, ref.id])
    pathKeys.set(path.id, key)
    links.set(key, {
      start: JSON.stringify([domain, ref.startNodeId]),
      end: JSON.stringify([domain, ref.endNodeId]),
      length: polylineLength(ref.points),
    })
  }
  const outgoing = new Map<string, Link[]>()
  const incoming = new Set<string>()
  const nodes = new Set<string>()
  for (const [, link] of [...links].sort(([a], [b]) => a.localeCompare(b))) {
    nodes.add(link.start)
    nodes.add(link.end)
    incoming.add(link.end)
    const children = outgoing.get(link.start) ?? []
    children.push(link)
    outgoing.set(link.start, children)
  }
  const distances = new Map<string, number>()
  const roots = [...nodes].sort((a, b) => (
    Number(incoming.has(a)) - Number(incoming.has(b)) || a.localeCompare(b)
  ))
  for (const root of roots) {
    if (distances.has(root)) continue
    distances.set(root, 0)
    const queue = [root]
    for (let index = 0; index < queue.length; index += 1) {
      const node = queue[index]
      for (const edge of outgoing.get(node) ?? []) {
        if (distances.has(edge.end)) continue
        distances.set(edge.end, distances.get(node)! + edge.length)
        queue.push(edge.end)
      }
    }
  }
  const offsets = new Map<string, number>()
  for (const path of paths) {
    const key = pathKeys.get(path.id)
    const ref = path.phasePath
    if (!key || !ref || !path.points.length) continue
    const link = links.get(key)!
    offsets.set(path.id, (distances.get(link.start) ?? 0) +
      projectedDistanceAlongPolyline(ref.points, path.points[0]))
  }
  return offsets
}

/** Only real, visible topology endpoints may extend a strip join. A crossing
 * mask endpoint must stay clipped, even when another pipe shares its position.
 */
export function flowEndpointDirections(paths: MonitorFlowPath[]) {
  type Arm = { pathId: string; atStart: boolean; outward: Point; point: Point }
  const nodes = new Map<string, Arm[]>()
  const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.001
  for (const path of paths) {
    const ref = path.phasePath
    if (!ref || path.points.length < 2) continue
    for (const atStart of [true, false]) {
      const point = atStart ? path.points[0] : path.points.at(-1)!
      const endpoint = atStart ? ref.points[0] : ref.points.at(-1)!
      if (!endpoint || !same(point, endpoint)) continue
      const neighbor = atStart ? path.points.find((p) => !same(p, point))
        : [...path.points].reverse().find((p) => !same(p, point))
      if (!neighbor) continue
      const length = Math.hypot(neighbor.x - point.x, neighbor.y - point.y)
      const outward = { x: (neighbor.x - point.x) / length, y: (neighbor.y - point.y) / length }
      const key = JSON.stringify([path.style ?? 'power', ref.networkId, atStart ? ref.startNodeId : ref.endNodeId])
      const arms = nodes.get(key) ?? []
      arms.push({ pathId: path.id, atStart, outward, point })
      nodes.set(key, arms)
    }
  }
  const directions = new Map<string, { start?: Point; end?: Point }>()
  for (const arms of nodes.values()) {
    for (const arm of arms) {
      const others = arms.filter((other) => same(arm.point, other.point) &&
        !same(arm.outward, other.outward))
      // A two-direction bend may be referenced by multiple logical edges.
      // At a T/cross junction keep the intersecting strips' flat ends.
      if (!others.length || others.some((other) => !same(other.outward, others[0].outward))) continue
      const current = directions.get(arm.pathId) ?? {}
      current[arm.atStart ? 'start' : 'end'] = others[0].outward
      directions.set(arm.pathId, current)
    }
  }
  return directions
}
