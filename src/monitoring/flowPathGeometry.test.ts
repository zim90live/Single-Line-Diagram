import { describe, expect, it } from 'vitest'

import { flowPhaseOffsets, splitFlowPathAroundCrossings } from './flowPathGeometry'

describe('monitor flow crossing geometry', () => {
  it('removes the bridge-mask interval from an animated underpass', () => {
    expect(splitFlowPathAroundCrossings(
      [{ x: 0, y: 0 }, { x: 32, y: 0 }],
      [{ point: { x: 16, y: 0 }, radius: 8 }],
    )).toEqual([
      [{ x: 0, y: 0 }, { x: 8, y: 0 }],
      [{ x: 24, y: 0 }, { x: 32, y: 0 }],
    ])
  })

  it('merges adjacent exclusions while retaining orthogonal path geometry', () => {
    expect(splitFlowPathAroundCrossings(
      [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 32 }],
      [
        { point: { x: 16, y: 8 }, radius: 8 },
        { point: { x: 16, y: 16 }, radius: 8 },
      ],
    )).toEqual([
      [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      [{ x: 16, y: 24 }, { x: 16, y: 32 }],
    ])
  })
})

describe('cooling animation continuity', () => {
  function path(id: string, start: string, end: string, points: Array<{ x: number; y: number }>, networkId = 'water') {
    return {
      id, points, style: 'cooling' as const, worldWidth: 6, speedMultiplier: 1,
      phasePath: { id, networkId, startNodeId: start, endNodeId: end, points },
    }
  }

  it('keeps a 192px tail continuous across shorter logical pipes, regardless of input order', () => {
    const a = path('a', 'source', 'n1', [{ x: 0, y: 0 }, { x: 80, y: 0 }])
    const b = path('b', 'n1', 'n2', [{ x: 80, y: 0 }, { x: 140, y: 0 }])
    const c = path('c', 'n2', 'sink', [{ x: 140, y: 0 }, { x: 140, y: 100 }])
    for (const paths of [[a, b, c], [c, a, b]]) {
      const offsets = flowPhaseOffsets(paths)
      expect([offsets.get('a'), offsets.get('b'), offsets.get('c')]).toEqual([0, 80, 140])
    }
  })

  it('preserves hidden crossing distance, including reverse flow', () => {
    for (const points of [
      [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      [{ x: 300, y: 0 }, { x: 0, y: 0 }],
    ]) {
      const whole = path('pipe', 'in', 'out', points)
      const fragments = splitFlowPathAroundCrossings(points, [{ point: { x: 150, y: 0 }, radius: 10 }])
        .map((points, index) => ({ ...whole, id: `fragment-${index}`, points }))
      const offsets = flowPhaseOffsets(fragments)
      expect(offsets.get('fragment-0')).toBe(0)
      expect(offsets.get('fragment-1')).toBe(160)
    }
  })

  it('continues both branches but never joins coincident separate networks or different speeds', () => {
    const trunk = path('trunk', 'source', 'junction', [{ x: 0, y: 0 }, { x: 100, y: 0 }])
    const left = path('left', 'junction', 'left-end', [{ x: 100, y: 0 }, { x: 100, y: 50 }])
    const right = path('right', 'junction', 'right-end', [{ x: 100, y: 0 }, { x: 200, y: 0 }])
    const other = path('other', 'junction', 'other-end', right.points, 'other-water')
    const slow = { ...right, id: 'slow', speedMultiplier: 0.5 }
    const offsets = flowPhaseOffsets([trunk, left, right, other, slow])
    expect(offsets.get('left')).toBe(100)
    expect(offsets.get('right')).toBe(100)
    expect(offsets.get('other')).toBe(0)
    expect(offsets.get('slow')).toBe(0)
  })

  it('terminates on a directed loop with deterministic finite phases', () => {
    const a = path('a', 'a', 'b', [{ x: 0, y: 0 }, { x: 80, y: 0 }])
    const b = path('b', 'b', 'a', [{ x: 80, y: 0 }, { x: 0, y: 0 }])
    expect([...flowPhaseOffsets([a, b]).values()]).toEqual([0, 80])
  })
})

it('continues power waves across logical lines and isolated busbar masks', () => {
  const points = [{ x: 0, y: 0 }, { x: 140, y: 0 }]
  const paths = [{
    id: 'power', style: 'power' as const, points,
    phasePath: { id: 'power', networkId: 'a', startNodeId: 'source', endNodeId: 'tap', points },
  }, {
    id: 'branch', style: 'power' as const, points: [{ x: 140, y: 0 }, { x: 140, y: 40 }],
    phasePath: { id: 'branch', networkId: 'a', startNodeId: 'tap', endNodeId: 'load', points: [{ x: 140, y: 0 }, { x: 140, y: 40 }] },
  }]
  expect(flowPhaseOffsets(paths).get('branch')).toBe(140)
})
