import { describe, expect, it } from 'vitest'

import type { AnchorType } from '../domain/project'
import {
  COOLING_DIRECTION_ARROW_INSET_SCREEN,
  COOLING_PIPE_CORE_WIDTH,
  COOLING_PIPE_INNER_SHADOW_BLUR,
  COOLING_PIPE_INNER_SHADOW_COLOR,
  COOLING_PIPE_INNER_SHADOW_DX,
  COOLING_PIPE_INNER_SHADOW_DY,
  COOLING_PIPE_INNER_SHADOW_OPACITY,
  COOLING_PIPE_SHELL_WIDTH,
  COOLING_PIPE_SHELL_ENDPOINT_INSET,
  COOLING_PIPE_BRIDGE_RADIUS,
  COOLING_PIPE_CORNER_RADIUS,
  COOLING_PIPE_WORLD_HIT_WIDTH,
  COOLING_ROUTE_HIT_WIDTH_SCREEN,
  DEFAULT_ROUTE_HIT_WIDTH_SCREEN,
  coolingPipeFilterRegion,
  insetPolylineEndpoints,
  isCoolingConnectionType,
  routeHitWidthForConnectionType,
  routeHitWorldWidthForConnectionType,
} from './connectionAppearance'

describe('connection appearance', () => {
  it('classifies every cooling circuit as a cooling pipe', () => {
    const coolingTypes: AnchorType[] = [
      'cooling-primary-cold',
      'cooling-primary-hot',
      'cooling-secondary-cold',
      'cooling-secondary-hot',
      'cooling-general',
    ]

    expect(coolingTypes.every(isCoolingConnectionType)).toBe(true)
    expect(isCoolingConnectionType('electrical')).toBe(false)
  })

  it('keeps cooling edit handles at least as wide as the thickest zoomed pipe', () => {
    expect(routeHitWidthForConnectionType('cooling-general')).toBe(
      COOLING_ROUTE_HIT_WIDTH_SCREEN,
    )
    expect(routeHitWidthForConnectionType('electrical')).toBe(
      DEFAULT_ROUTE_HIT_WIDTH_SCREEN,
    )
    expect(COOLING_ROUTE_HIT_WIDTH_SCREEN).toBe(20)
    expect(COOLING_DIRECTION_ARROW_INSET_SCREEN).toBe(6)
    expect(routeHitWorldWidthForConnectionType('cooling-general', 4)).toBe(
      COOLING_PIPE_WORLD_HIT_WIDTH,
    )
    expect(routeHitWorldWidthForConnectionType('cooling-general', 0.5)).toBe(40)
    expect(routeHitWorldWidthForConnectionType('electrical', 2)).toBe(6)
  })

  it('defines the confirmed cooling pipe shell and inner shadow', () => {
    expect(COOLING_PIPE_SHELL_WIDTH).toBe(10)
    expect(COOLING_PIPE_CORE_WIDTH).toBe(2)
    expect(COOLING_PIPE_SHELL_ENDPOINT_INSET).toBe(0)
    expect(COOLING_PIPE_BRIDGE_RADIUS).toBe(8)
    expect(COOLING_PIPE_CORNER_RADIUS).toBe(8)
    expect({
      dx: COOLING_PIPE_INNER_SHADOW_DX,
      dy: COOLING_PIPE_INNER_SHADOW_DY,
      blur: COOLING_PIPE_INNER_SHADOW_BLUR,
      color: COOLING_PIPE_INNER_SHADOW_COLOR,
      opacity: COOLING_PIPE_INNER_SHADOW_OPACITY,
    }).toEqual({ dx: 0, dy: 1, blur: 3, color: '#FFFFFF', opacity: 0.5 })
    expect(coolingPipeFilterRegion([
      { x: 24, y: 40 },
      { x: 104, y: 40 },
    ])).toEqual({ x: 9, y: 25, width: 110, height: 31 })
  })

  it('insets only the display pipe shell while preserving orthogonal bends', () => {
    expect(insetPolylineEndpoints([
      { x: 0, y: 0 },
      { x: 0, y: 24 },
      { x: 40, y: 24 },
    ], 6, 6)).toEqual([
      { x: 0, y: 6 },
      { x: 0, y: 24 },
      { x: 34, y: 24 },
    ])
    expect(insetPolylineEndpoints([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ], 6, 6)).toEqual([
      { x: 4, y: 0 },
      { x: 4, y: 0 },
    ])
  })
})
