import { describe, expect, it } from 'vitest'

import type { AnchorType } from '../domain/project'
import {
  COOLING_DIRECTION_ARROW_INSET_SCREEN,
  COOLING_AUXILIARY_COLOR_NEUTRAL,
  COOLING_AUXILIARY_COLOR_WEIGHT,
  COOLING_AUXILIARY_PIPE_CORE_WIDTH,
  COOLING_AUXILIARY_PIPE_SHELL_WIDTH,
  COOLING_PIPE_CORE_WIDTH,
  COOLING_PIPE_SHELL_WIDTH,
  coolingLineRoleRenderPriority,
  coolingPipeCoreWidth,
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
  resolvedCoolingLineColor,
  sortByCoolingLineRenderPriority,
} from './connectionAppearance'

describe('connection appearance', () => {
  it('classifies every cooling circuit as a cooling pipe', () => {
    const coolingTypes: AnchorType[] = [
      'cooling-primary-cold',
      'cooling-primary-hot',
      'cooling-secondary-cold',
      'cooling-secondary-hot',
      'cooling-tertiary-cold',
      'cooling-tertiary-hot',
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

  it('defines flat cooling pipe boundaries and interior widths', () => {
    expect(COOLING_PIPE_SHELL_WIDTH).toBe(8)
    expect(COOLING_PIPE_CORE_WIDTH).toBe(6)
    expect(COOLING_AUXILIARY_PIPE_SHELL_WIDTH).toBe(4)
    expect(COOLING_AUXILIARY_PIPE_CORE_WIDTH).toBe(2.4)
    expect(COOLING_PIPE_SHELL_ENDPOINT_INSET).toBe(0)
    expect(COOLING_PIPE_BRIDGE_RADIUS).toBe(6)
    expect(COOLING_PIPE_CORNER_RADIUS).toBe(8)
    expect(coolingPipeFilterRegion([
      { x: 24, y: 40 },
      { x: 104, y: 40 },
    ])).toEqual({ x: 18, y: 34, width: 92, height: 13 })
  })

  it('mutes auxiliary lines while preserving part of their circuit hue', () => {
    expect(COOLING_AUXILIARY_COLOR_NEUTRAL).toBe('#70736F')
    expect(COOLING_AUXILIARY_COLOR_WEIGHT).toBe(0.2)
    expect(resolvedCoolingLineColor('#FFC800', 'auxiliary')).toBe('#8D8459')
    expect(resolvedCoolingLineColor('#00F074', 'auxiliary')).toBe('#5A8C70')
    expect(resolvedCoolingLineColor('#0084FF', 'primary')).toBe('#0084FF')
    expect(resolvedCoolingLineColor('#0084FF', undefined)).toBe('#0084FF')
    expect(coolingPipeCoreWidth('auxiliary')).toBe(2.4)
    expect(coolingPipeCoreWidth('primary')).toBe(6)
    expect(coolingLineRoleRenderPriority('auxiliary')).toBeLessThan(
      coolingLineRoleRenderPriority('primary'),
    )
    expect(sortByCoolingLineRenderPriority([
      { id: 'primary-first', role: 'primary' as const },
      { id: 'auxiliary-later', role: 'auxiliary' as const },
      { id: 'primary-second', role: 'primary' as const },
    ], (item) => item.role).map((item) => item.id)).toEqual([
      'auxiliary-later',
      'primary-first',
      'primary-second',
    ])
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
