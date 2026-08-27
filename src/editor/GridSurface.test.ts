import { describe, expect, it } from 'vitest'

import {
  getAdaptiveGridScale,
  GRID_DOT_SCREEN_RADIUS,
} from './gridScale'

describe('grid screen metrics', () => {
  it('shows the complete 8px lattice at 100% and above', () => {
    expect(getAdaptiveGridScale(8, 4)).toEqual({
      density: 1,
      worldStep: 8,
      screenStep: 32,
      dotScreenRadius: GRID_DOT_SCREEN_RADIUS,
    })
    expect(getAdaptiveGridScale(8, 1).worldStep).toBe(8)
  })

  it('uses successive 8px multiples as the view is reduced', () => {
    expect(getAdaptiveGridScale(8, 1 / 1.12).worldStep).toBe(16)
    expect(getAdaptiveGridScale(8, 0.5).worldStep).toBe(16)
    expect(getAdaptiveGridScale(8, 0.49).worldStep).toBe(24)
    expect(getAdaptiveGridScale(8, 0.25).worldStep).toBe(32)
    expect(getAdaptiveGridScale(8, 0.25).dotScreenRadius).toBe(GRID_DOT_SCREEN_RADIUS)
  })

})
