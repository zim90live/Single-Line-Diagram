import { describe, expect, it } from 'vitest'

import { inferWheelGestureKind, pinchZoomFactor } from './wheelGestures'

describe('wheel gesture classification', () => {
  it('treats ctrl-wheel as a browser trackpad pinch', () => {
    expect(inferWheelGestureKind({
      ctrlKey: true,
      deltaMode: 0,
      deltaX: 0,
      deltaY: -12.5,
    })).toBe('pinch-zoom')
  })

  it('treats continuous pixel deltas as trackpad panning', () => {
    expect(inferWheelGestureKind({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 4.25,
    })).toBe('trackpad-pan')
    expect(inferWheelGestureKind({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 18,
      deltaY: 96,
    })).toBe('trackpad-pan')
  })

  it('keeps discrete mouse-wheel input on zoom', () => {
    expect(inferWheelGestureKind({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 120,
    })).toBe('mouse-zoom')
    expect(inferWheelGestureKind({
      ctrlKey: false,
      deltaMode: 1,
      deltaX: 0,
      deltaY: 3,
    })).toBe('mouse-zoom')
  })

  it('maps pinch deltas to smooth bounded zoom factors', () => {
    expect(pinchZoomFactor(-10)).toBeGreaterThan(1)
    expect(pinchZoomFactor(10)).toBeLessThan(1)
    expect(pinchZoomFactor(-1000)).toBe(1.25)
    expect(pinchZoomFactor(1000)).toBe(0.8)
  })
})
