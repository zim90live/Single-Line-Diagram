import { describe, expect, it } from 'vitest'

import {
  createRulerTicks,
  getAdaptiveGridScale,
  getRulerScale,
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

  it('keeps ruler ticks on the currently visible dot lattice', () => {
    const viewport = { zoom: 1 / 1.12, tx: 53.5714285714, ty: 20 }
    const ticks = createRulerTicks(viewport, 800, 'x', 8)

    expect(ticks.every((tick) => tick.value % 16 === 0)).toBe(true)
    expect(ticks.find((tick) => tick.value === 48)?.major).toBe(true)
    expect(ticks.find((tick) => tick.value === 48)?.position).toBeCloseTo(
      48 * viewport.zoom + viewport.tx,
    )
  })

  it('derives ruler labels from the same adaptive grid step', () => {
    expect(getRulerScale(8, 0.25)).toEqual({
      gridWorldStep: 32,
      gridScreenStep: 8,
      density: 4,
      labelInterval: 5,
      labelWorldStep: 160,
    })
    const ticks = createRulerTicks({ zoom: 0.25, tx: 0, ty: 0 }, 800, 'x', 8)
    expect(ticks.every((tick) => tick.value % 32 === 0)).toBe(true)
  })
})
