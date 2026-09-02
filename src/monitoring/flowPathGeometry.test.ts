import { describe, expect, it } from 'vitest'

import { splitFlowPathAroundCrossings } from './flowPathGeometry'

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
