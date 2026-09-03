import type { Point } from '../scene/geometry'

function projectedDistanceAlongPolyline(points: Point[], target: Point) {
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

function polylineLength(points: Point[]) {
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
