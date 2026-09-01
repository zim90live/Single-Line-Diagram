import { describe, expect, it } from 'vitest'

import type { DiagramElement } from '../domain/project'
import {
  fitGenericSymbolTag,
  GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR,
  genericSymbolDisplayedWidth,
  getSnappedGenericSymbolSize,
  normalizeGenericSymbolBackgroundColor,
  resolvedGenericSymbolBackgroundColor,
} from './genericSymbol'

function genericElement(rotation = 0): DiagramElement {
  return {
    id: 'generic-1',
    diagramId: 'diagram-1',
    assetKey: 'generic',
    name: '通用图元',
    x: 0,
    y: 0,
    width: 96,
    height: 48,
    rotation,
    properties: { tag: 'GENERIC-01' },
    extensions: {},
  }
}

describe('generic symbol geometry and tag fitting', () => {
  it('snaps width and height independently while preserving usable minimums', () => {
    expect(getSnappedGenericSymbolSize(101, 61, 8)).toEqual({ width: 104, height: 64 })
    expect(getSnappedGenericSymbolSize(1, 1, 8)).toEqual({ width: 32, height: 24 })
  })

  it('uses the horizontal displayed span after quarter-turn rotation', () => {
    expect(genericSymbolDisplayedWidth(genericElement(0))).toBe(96)
    expect(genericSymbolDisplayedWidth(genericElement(90))).toBe(48)
    expect(genericSymbolDisplayedWidth(genericElement(270))).toBe(48)
  })

  it('keeps short identifiers and truncates long identifiers with an ellipsis', () => {
    expect(fitGenericSymbolTag('GEN-01', 96)).toBe('GEN-01')
    expect(fitGenericSymbolTag('这是一个非常长的设备标识', 48)).toMatch(/…$/)
    expect(fitGenericSymbolTag('这是一个非常长的设备标识', 48))
      .not.toBe('这是一个非常长的设备标识')
  })

  it('normalizes an instance background color and falls back to the default', () => {
    expect(normalizeGenericSymbolBackgroundColor('#2a3b4c')).toBe('#2A3B4C')
    expect(normalizeGenericSymbolBackgroundColor('invalid')).toBe(
      GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR,
    )
    expect(resolvedGenericSymbolBackgroundColor({
      ...genericElement(),
      properties: { tag: 'GENERIC-01', genericBackgroundColor: '#445566' },
    })).toBe('#445566')
  })
})
