import { describe, expect, it } from 'vitest'

import type { Busbar, DiagramElement, DiagramViewport } from '../domain/project'
import {
  busbarInsideRect,
  diagramObjectsBounds,
  elementInsideRect,
  elementsBounds,
  screenToWorld,
  snap,
  worldToScreen,
  worldDeltaToLocal,
  zoomAroundPoint,
} from './geometry'

const viewport: DiagramViewport = { zoom: 2, tx: 100, ty: -40 }

function createElement(patch: Partial<DiagramElement> = {}): DiagramElement {
  return {
    id: 'element-1',
    diagramId: 'diagram-1',
    assetKey: 'pump',
    name: '泵',
    x: 10,
    y: 20,
    width: 40,
    height: 20,
    rotation: 0,
    properties: {},
    extensions: {},
    ...patch,
  }
}

describe('editor geometry', () => {
  it('round-trips world and screen coordinates', () => {
    const world = { x: 35, y: 80 }
    expect(screenToWorld(worldToScreen(world, viewport), viewport)).toEqual(world)
  })

  it('keeps the world point under the cursor fixed while zooming', () => {
    const cursor = { x: 420, y: 260 }
    const worldBefore = screenToWorld(cursor, viewport)
    const next = zoomAroundPoint(viewport, cursor, 3.2)
    expect(screenToWorld(cursor, next)).toEqual(worldBefore)
  })

  it('snaps movement to the configured grid', () => {
    expect(snap(26, 10)).toBe(30)
    expect(snap(-14, 10)).toBe(-10)
  })

  it('strict marquee selection accounts for rotation', () => {
    const rotated = createElement({ rotation: 45 })
    expect(elementInsideRect(rotated, { x: 0, y: 0, width: 60, height: 60 })).toBe(true)
    expect(elementInsideRect(rotated, { x: 10, y: 20, width: 40, height: 20 })).toBe(false)
  })

  it('computes an axis-aligned group bound from every rotated element', () => {
    const bounds = elementsBounds([
      createElement({ x: 0, y: 0, width: 40, height: 20 }),
      createElement({ id: 'element-2', x: 80, y: 0, width: 40, height: 20, rotation: 90 }),
    ])
    expect(bounds).toEqual({ x: 0, y: -10, width: 110, height: 40 })
  })

  it('includes complete busbars in marquee selection and mixed bounds', () => {
    const busbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 64,
      y: 80,
      length: 96,
    }

    expect(busbarInsideRect(busbar, { x: 56, y: 72, width: 112, height: 16 })).toBe(true)
    expect(busbarInsideRect(busbar, { x: 72, y: 72, width: 96, height: 16 })).toBe(false)
    expect(diagramObjectsBounds([createElement({ x: 0, y: 0 })], [busbar])).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 80,
    })
  })

  it('converts rotated resize movement into element-local axes', () => {
    expect(worldDeltaToLocal({ x: 0, y: 20 }, 90).x).toBeCloseTo(20)
    expect(worldDeltaToLocal({ x: 0, y: 20 }, 90).y).toBeCloseTo(0)
  })
})
