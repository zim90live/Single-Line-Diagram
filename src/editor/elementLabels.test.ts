import { describe, expect, it } from 'vitest'

import type { AssetDefinition, DiagramElement } from '../domain/project'
import {
  ELEMENT_LABEL_AVOIDANCE_STEP,
  ELEMENT_LABEL_FONT_SIZE,
  ELEMENT_LABEL_GAP,
  elementDeviceIdentifier,
  labelPlacementForPointer,
  layoutElementLabels,
  nextDeviceIdentifier,
} from './elementLabels'

const asset: AssetDefinition = {
  key: 'chwp',
  name: 'CHWP',
  category: '冷却',
  source: 'CHWP.svg',
  intrinsicWidth: 80,
  intrinsicHeight: 40,
  anchors: [{
    id: 'bottom-anchor',
    name: '一次回路冷 1',
    x: 40,
    y: 40,
    direction: 'bottom',
    type: 'cooling-primary-cold',
  }],
}

function element(patch: Partial<DiagramElement> = {}): DiagramElement {
  return {
    id: 'element-1',
    diagramId: 'diagram-1',
    assetKey: asset.key,
    name: asset.name,
    x: 0,
    y: 0,
    width: 80,
    height: 40,
    rotation: 0,
    properties: { tag: 'CHWP-01' },
    extensions: {},
    ...patch,
  }
}

describe('element label layout', () => {
  it('uses the device identifier and generates the next unused default', () => {
    const current = element()
    expect(ELEMENT_LABEL_FONT_SIZE).toBe(10)
    expect(ELEMENT_LABEL_GAP).toBe(2)
    expect(ELEMENT_LABEL_AVOIDANCE_STEP).toBe(2)
    expect(elementDeviceIdentifier(current)).toBe('CHWP-01')
    expect(nextDeviceIdentifier('CHWP', 'diagram-1', [current])).toBe('CHWP-02')
  })

  it('selects a canvas-relative side from the pointer', () => {
    const current = element({ rotation: 90 })
    expect(labelPlacementForPointer(current, { x: 40, y: -40 })).toBe('top')
    expect(labelPlacementForPointer(current, { x: 120, y: 20 })).toBe('right')
  })

  it('moves the automatic label away from an outgoing anchor corridor', () => {
    const [layout] = layoutElementLabels([element()], new Map([[asset.key, asset]]))
    expect(layout.placement).not.toBe('bottom')
  })

  it('omits only elements whose label visibility is disabled', () => {
    const layouts = layoutElementLabels([
      element({ id: 'visible-element' }),
      element({ id: 'hidden-element', x: 160, labelVisible: false }),
    ], new Map([[asset.key, asset]]))

    expect(layouts.map((layout) => layout.elementId)).toEqual(['visible-element'])
  })

  it('keeps a manually selected side after element rotation and shifts along that side', () => {
    const current = element({ rotation: 90, labelPlacement: 'bottom' })
    const [layout] = layoutElementLabels([current], new Map([[asset.key, asset]]))
    expect(layout.placement).toBe('bottom')
    expect(layout.bounds.y).toBe(62)
  })

  it('keeps large-diagram label derivation lightweight', () => {
    const elements = Array.from({ length: 80 }, (_, index) => element({
      id: `element-${index}`,
      x: (index % 10) * 240,
      y: Math.floor(index / 10) * 120,
      properties: { tag: `CHWP-${String(index + 1).padStart(2, '0')}` },
    }))
    const assets = new Map([[asset.key, asset]])
    const start = performance.now()
    for (let index = 0; index < 20; index += 1) layoutElementLabels(elements, assets)
    expect(performance.now() - start).toBeLessThan(120)
  })
})
