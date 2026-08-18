import { describe, expect, it } from 'vitest'

import { buildFlowLineGeometry } from './FlowAnimationLayer'

describe('monitor flow geometry', () => {
  it('keeps cumulative distance through orthogonal and sampled bridge segments', () => {
    const geometry = buildFlowLineGeometry([{
      id: 'path',
      points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }],
    }])

    expect([...geometry.positions]).toHaveLength(36)
    expect([...geometry.ends]).toHaveLength(24)
    expect([...geometry.sides]).toEqual([
      -1, 1, 1, -1, 1, -1,
      -1, 1, 1, -1, 1, -1,
    ])
    expect([...geometry.alongs]).toEqual([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 0, 1, 1,
    ])
    expect([...geometry.widths]).toEqual(new Array(12).fill(2))
    expect([...geometry.distances]).toEqual([
      0, 0, 8, 0, 8, 8,
      8, 8, 14, 8, 14, 14,
    ])
  })

  it('batches a shared directed segment only once', () => {
    const geometry = buildFlowLineGeometry([
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] },
      { id: 'b', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 16, y: 0 }] },
    ])

    expect(geometry.positions).toHaveLength(36)
    expect(geometry.distances).toHaveLength(12)
  })

  it('keeps a wider screen-space strip for busbar flow', () => {
    const geometry = buildFlowLineGeometry([{
      id: 'busbar',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      screenWidth: 4.5,
    }])

    expect([...geometry.widths]).toEqual(new Array(6).fill(4.5))
  })
})
