import { describe, expect, it } from 'vitest'

import type { AssetDefinition, SymbolAnchor } from '../domain/project'
import {
  constrainAnchorDrag,
  createSymbolAnchor,
  deriveAnchorDirection,
  getDefaultAnchorType,
  getLegalAnchorPoints,
  getNextAnchorName,
  isAutomaticAnchorName,
  isLegalAnchorPoint,
  transformAnchorToElement,
} from './anchors'

const asset: AssetDefinition = {
  key: 'chwp',
  name: 'CHWP',
  category: '冷却',
  source: 'CHWP.svg',
  intrinsicWidth: 200,
  intrinsicHeight: 80,
  anchors: [],
}

describe('symbol anchor geometry', () => {
  it('accepts only non-corner 8px points on the asset edge', () => {
    expect(isLegalAnchorPoint({ x: 8, y: 0 }, asset)).toBe(true)
    expect(isLegalAnchorPoint({ x: 0, y: 0 }, asset)).toBe(false)
    expect(isLegalAnchorPoint({ x: 7, y: 0 }, asset)).toBe(false)
    expect(isLegalAnchorPoint({ x: 8, y: 8 }, asset)).toBe(false)
    expect(isLegalAnchorPoint({ x: 0, y: 88 }, asset)).toBe(false)
    expect(deriveAnchorDirection(200, 40, 200, 80)).toBe('right')
  })

  it('generates every legal point without adding corners', () => {
    const points = getLegalAnchorPoints(asset)
    expect(points).toContainEqual({ x: 8, y: 0, direction: 'top' })
    expect(points).toContainEqual({ x: 200, y: 72, direction: 'right' })
    expect(points.some((point) => point.x === 0 && point.y === 0)).toBe(false)
  })

  it('creates a cooling-general anchor with an outward direction and stable name', () => {
    const anchor = createSymbolAnchor(asset, { x: 24, y: 0 })
    expect(anchor).toMatchObject({
      name: '通用 1',
      type: 'cooling-general',
      x: 24,
      y: 0,
      direction: 'top',
    })
    expect(anchor.id).toMatch(/^anchor-/)
  })

  it('defaults a generic symbol anchor to the active diagram system', () => {
    expect(getDefaultAnchorType('通用', 'cooling')).toBe('cooling-general')
    expect(getDefaultAnchorType('通用', 'power')).toBe('electrical')
    expect(getDefaultAnchorType('通用')).toBe('cooling-general')

    const genericAsset = { ...asset, key: 'generic', category: '通用' }
    expect(createSymbolAnchor(genericAsset, { x: 24, y: 0 }, 'cooling')).toMatchObject({
      name: '通用 1',
      type: 'cooling-general',
    })
    expect(createSymbolAnchor(genericAsset, { x: 24, y: 0 }, 'power')).toMatchObject({
      name: '电路 1',
      type: 'electrical',
    })
  })

  it('numbers automatic names by type and preserves the ability to detect custom names', () => {
    const anchors: SymbolAnchor[] = [
      {
        id: 'anchor-1',
        name: '电路 3',
        x: 8,
        y: 0,
        direction: 'top',
        type: 'electrical',
      },
    ]
    expect(getNextAnchorName(anchors, 'electrical')).toBe('电路 4')
    expect(isAutomaticAnchorName('电路 3', 'electrical')).toBe(true)
    expect(isAutomaticAnchorName('主进线', 'electrical')).toBe(false)
  })

  it('keeps a dragged anchor on its original edge and snaps to 8px', () => {
    const anchor: SymbolAnchor = {
      id: 'anchor-1',
      name: '通用 1',
      x: 16,
      y: 0,
      direction: 'top',
      type: 'cooling-general',
    }
    expect(constrainAnchorDrag(anchor, { x: 39, y: 70 }, asset)).toEqual({
      x: 40,
      y: 0,
      direction: 'top',
    })
  })

  it('follows an element scale and 90-degree rotation without re-snapping', () => {
    const anchor: SymbolAnchor = {
      id: 'anchor-1',
      name: '通用 1',
      x: 100,
      y: 0,
      direction: 'top',
      type: 'cooling-general',
    }
    const transformed = transformAnchorToElement(anchor, asset, {
      x: 0,
      y: 0,
      width: 40,
      height: 16,
      rotation: 90,
    })

    expect(transformed.x).toBeCloseTo(28)
    expect(transformed.y).toBeCloseTo(8)
    expect(transformed.direction).toBe('right')
  })
})
