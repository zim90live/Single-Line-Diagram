import { describe, expect, it } from 'vitest'
import { buildFlowArrows } from './flowArrows'
import { buildFlowLineGeometry } from './FlowAnimationLayer'
import type { MonitorFlowPath } from './flowPresentation'

const straight: MonitorFlowPath = { id: 'pipe', style: 'cooling', worldWidth: 6,
  baseColor: '#1BA4FF', points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] }

describe('reduced-motion arrow positions', () => {
  it('places fixed equal-spaced triangles and gives every vertex of each arrow one brightness phase', () => {
    const arrows = buildFlowArrows([straight])
    expect(arrows).toHaveLength(6)
    expect(arrows.map(a => a.animationPhaseDistance)).toEqual([10, 30, 50, 70, 90, 110])
    expect(buildFlowArrows([straight])).toEqual(arrows)
    arrows.forEach(arrow => {
      expect(arrow.points[1].x).toBeGreaterThan(arrow.points[0].x)
      expect(new Set(buildFlowLineGeometry([arrow]).distances).size).toBe(1)
      expect(arrow.baseColor).toBe(straight.baseColor)
    })
  })
  it('points in the reversed direction and omits stopped paths', () => {
    const arrows = buildFlowArrows([{ ...straight, points: [...straight.points].reverse() }])
    expect(arrows[0].points[1].x).toBeLessThan(arrows[0].points[0].x)
    expect(buildFlowArrows([{ ...straight, speedMultiplier: 0 }])).toEqual([])
  })
  it('places one arrow in a short pipe and keeps cross-mask regions empty', () => {
    expect(buildFlowArrows([{ ...straight, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }])).toHaveLength(1)
    const fragments = [
      { ...straight, id: 'before', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }] },
      { ...straight, id: 'after', points: [{ x: 50, y: 0 }, { x: 120, y: 0 }] },
    ]
    const arrows = buildFlowArrows(fragments)
    expect(arrows.every(arrow => arrow.points.every(p => p.x <= 30 || p.x >= 50))).toBe(true)
  })
})

it('uses 5 by 4 diagram units independent of pipe width', () => {
  for (const width of [2.4, 6]) {
    const arrow = buildFlowArrows([{ ...straight, worldWidth: width }])[0]
    expect(Math.max(...arrow.points.map(p => p.x)) - Math.min(...arrow.points.map(p => p.x))).toBe(5)
    expect(Math.max(...arrow.points.map(p => p.y)) - Math.min(...arrow.points.map(p => p.y))).toBe(4)
  }
})
