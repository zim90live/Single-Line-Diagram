import type { Point } from '../scene/geometry'
import type { MonitorFlowPath } from './flowPresentation'
import { flowPhaseOffsets, polylineLength } from './flowPathGeometry'

export const FLOW_ARROW_SPACING = 20
export const FLOW_ARROW_PERIOD = FLOW_ARROW_SPACING
export const FLOW_ARROW_SPEED = 48

function sample(points: Point[], distance: number) {
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    if (traversed + length >= distance) {
      const t = (distance - traversed) / length
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    traversed += length
  }
  return points.at(-1)!
}

/** Fixed filled triangles, sampled in diagram coordinates. Masks/endpoints remain clear. */
export function buildFlowArrows(paths: MonitorFlowPath[]): MonitorFlowPath[] {
  const offsets = flowPhaseOffsets(paths)
  const arrows: MonitorFlowPath[] = []
  for (const path of paths) {
    const length = polylineLength(path.points)
    if (length < 8 || (path.speedMultiplier ?? 1) <= 0) continue
    const offset = offsets.get(path.id) ?? 0
    const halfWidth = 2
    const halfLength = Math.min(2.5, length / 2 - 1)
    const inset = halfLength + 1
    const first = ((FLOW_ARROW_SPACING / 2 - offset) % FLOW_ARROW_SPACING + FLOW_ARROW_SPACING) % FLOW_ARROW_SPACING
    const candidates: number[] = []
    for (let d = first; d <= length - inset; d += FLOW_ARROW_SPACING) {
      if (d >= inset) candidates.push(d)
    }
    if (!candidates.length && length < FLOW_ARROW_SPACING) candidates.push(length / 2)
    for (const distance of candidates) {
      const center = sample(path.points, distance)
      const before = sample(path.points, distance - halfLength)
      const after = sample(path.points, distance + halfLength)
      const span = Math.hypot(after.x - before.x, after.y - before.y)
      // Do not straddle an abrupt elbow; the brightness wave still passes it.
      if (span < halfLength * 1.9) continue
      const dx = (after.x - before.x) / span
      const dy = (after.y - before.y) / span
      const rear = { x: center.x - dx * halfLength, y: center.y - dy * halfLength }
      arrows.push({
        ...path,
        id: `${path.id}:arrow:${distance}`,
        points: [
          { x: rear.x - dy * halfWidth, y: rear.y + dx * halfWidth },
          { x: center.x + dx * halfLength, y: center.y + dy * halfLength },
          { x: rear.x + dy * halfWidth, y: rear.y - dx * halfWidth },
        ],
        worldWidth: path.worldWidth === undefined ? undefined : Math.min(1, path.worldWidth * 0.2),
        screenWidth: path.worldWidth === undefined ? 1.25 : undefined,
        phasePath: undefined,
        animationPhaseDistance: offset + distance,
      })
    }
  }
  return arrows
}
