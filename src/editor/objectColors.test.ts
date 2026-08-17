import { describe, expect, it } from 'vitest'

import { hexToHsv, hsvToHex, normalizeHexColor } from './objectColors'

describe('object colors', () => {
  it('normalizes editable HEX values', () => {
    expect(normalizeHexColor('77b4bf', '#D5B96F')).toBe('#77B4BF')
    expect(normalizeHexColor('invalid', '#D5B96F')).toBe('#D5B96F')
  })

  it('round-trips HEX through the custom picker HSV model', () => {
    for (const color of ['#D5B96F', '#77B4BF', '#DF816F', '#141518']) {
      expect(hsvToHex(hexToHsv(color))).toBe(color)
    }
  })

  it('maps saturation and value picker corners deterministically', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#FF0000')
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00FF00')
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000FF')
    expect(hsvToHex({ h: 180, s: 0, v: 0.5 })).toBe('#808080')
  })
})
