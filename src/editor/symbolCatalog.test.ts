import { describe, expect, it } from 'vitest'

import {
  COOLING_PUMP_STOPPED_SYMBOL_URL,
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  getScaledSymbolSize,
  getSymbolDisplayUrl,
  getSymbolStateUrl,
  getSymbolScaleStep,
  symbolCatalog,
  symbolsByKey,
} from './symbolCatalog'

const rawSymbols = import.meta.glob<string>('../assets/symbols/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

describe('symbol catalog', () => {
  it('registers every active symbol from the formal symbol directory', () => {
    expect(symbolCatalog).toHaveLength(27)
    expect(symbolCatalog.every((symbol) => symbol.source.startsWith('src/assets/symbols/'))).toBe(true)
  })

  it('registers Battery-group as an independent 48 by 48 power symbol', () => {
    expect(symbolsByKey.get('battery-group')).toMatchObject({
      name: 'Battery-group',
      source: 'src/assets/symbols/Battery-group.svg',
      category: '电力',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
      configurableColor: false,
      anchors: [],
      renderMode: 'image',
    })
  })

  it('registers UPS-group as an independent 48 by 48 power symbol', () => {
    expect(symbolsByKey.get('ups-group')).toMatchObject({
      name: 'UPS-group',
      source: 'src/assets/symbols/UPS-group.svg',
      category: '电力',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
      configurableColor: false,
      anchors: [],
      renderMode: 'image',
    })
  })

  it('registers TMU as a 64 by 96 cooling PNG symbol', () => {
    const tmu = symbolsByKey.get('tmu')

    expect(tmu).toMatchObject({
      name: 'TMU',
      source: 'src/assets/symbols/TMU.png',
      category: '冷却',
      intrinsicWidth: 64,
      intrinsicHeight: 96,
      renderMode: 'image',
    })
    expect(getScaledSymbolSize(tmu!, 1, 8)).toEqual({ scale: 1, width: 64, height: 96 })
  })

  it('registers CDU as a 192 by 96 cooling SVG symbol', () => {
    const cdu = symbolsByKey.get('cdu')

    expect(cdu).toMatchObject({
      name: 'CDU',
      source: 'src/assets/symbols/CDU.svg',
      category: '冷却',
      intrinsicWidth: 192,
      intrinsicHeight: 96,
      renderMode: 'image',
    })
    expect(getScaledSymbolSize(cdu!, 1, 8)).toEqual({ scale: 1, width: 192, height: 96 })
  })

  it('uses the dedicated stopped image only for a stopped cooling pump presentation', () => {
    const chwp = symbolsByKey.get('chwp')!

    expect(COOLING_PUMP_STOPPED_SYMBOL_URL).toContain('PumpOff.png')
    expect(getSymbolDisplayUrl(chwp, 'off', false)).toBe(chwp.url)
    expect(getSymbolDisplayUrl(chwp, 'off', true)).toBe(COOLING_PUMP_STOPPED_SYMBOL_URL)
  })

  it('registers Cabinet separately and keeps both renamed Tap-off Units on legacy keys', () => {
    expect(symbolsByKey.get('cabinet-device')).toMatchObject({
      name: 'Cabinet',
      source: 'src/assets/symbols/Cabinet.svg',
      category: '电力',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
    })
    expect(symbolsByKey.get('cabinet')).toMatchObject({
      name: 'Tap-off Unit A',
      source: 'src/assets/symbols/Cabinet A.svg',
      category: '电力',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
    })
    expect(symbolsByKey.get('cabinet-b')).toMatchObject({
      name: 'Tap-off Unit B',
      source: 'src/assets/symbols/Cabinet B.svg',
      category: '电力',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
    })
    expect(symbolsByKey.get('tap-off-unit')).toMatchObject({
      name: 'Tap-off Unit',
      source: 'src/assets/symbols/Tap-off Unit.svg',
      category: '电力',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      configurableColor: true,
      defaultColor: DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
      anchors: [],
    })
  })

  it('registers Switch, 2WV, and CV as one symbol each presented in Off state', () => {
    const statefulSymbols = [
      { key: 'switch', name: 'Switch', source: 'SwitchOff.svg' },
      { key: '2-wv', name: '2WV', source: '2WV_Off.svg' },
      { key: 'cv', name: 'CV', source: 'CV_Off.svg' },
    ]

    for (const { key, name, source } of statefulSymbols) {
      const symbol = symbolsByKey.get(key)
      expect(symbol).toMatchObject({
        name,
        source: `src/assets/symbols/${source}`,
        defaultState: 'off',
        configurableColor: true,
        defaultColor: DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
      })
      expect(getSymbolStateUrl(symbol!, 'off')).toBe(symbol?.url)
      expect(getSymbolStateUrl(symbol!, 'on')).not.toBe(symbol?.url)
    }
    expect(symbolsByKey.has('switch-off')).toBe(false)
    expect(symbolsByKey.has('switch-on')).toBe(false)
    expect(symbolsByKey.has('2-wv-off')).toBe(false)
    expect(symbolsByKey.has('2-wv-on')).toBe(false)
    expect(symbolsByKey.has('cv-off')).toBe(false)
    expect(symbolsByKey.has('cv-on')).toBe(false)
    expect(symbolsByKey.get('cv')).toMatchObject({
      coolingDeviceRole: 'check-valve',
      anchors: [
        { id: 'cv-inlet', flowRole: 'inlet' },
        { id: 'cv-outlet', flowRole: 'outlet' },
      ],
    })
  })

  it('allows color changes for the requested equipment and the generic frame', () => {
    expect(symbolCatalog.filter((symbol) => symbol.configurableColor).map((symbol) => symbol.key))
      .toEqual([
        '2-wv',
        'cv',
        'mp',
        'generator',
        'grid',
        'switch',
        'transformer',
        'tap-off-unit',
        'generic',
      ])
  })

  it('registers the generic symbol with a dedicated frame renderer', () => {
    expect(symbolsByKey.get('generic')).toMatchObject({
      name: '通用图元',
      category: '通用',
      intrinsicWidth: 96,
      intrinsicHeight: 48,
      configurableColor: true,
      defaultColor: DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
      renderMode: 'generic-frame',
    })
  })

  it('registers both POD symbols at their 64px intrinsic size', () => {
    expect(symbolsByKey.get('compute-pod')).toMatchObject({
      name: '算力 POD',
      category: '电力',
      intrinsicWidth: 64,
      intrinsicHeight: 64,
    })
    expect(symbolsByKey.get('power-pod')).toMatchObject({
      name: '动力 POD',
      category: '电力',
      intrinsicWidth: 64,
      intrinsicHeight: 64,
    })
  })

  it('uses the confirmed cooling and power equipment categories', () => {
    expect(symbolsByKey.get('cpd')?.category).toBe('冷却')
    expect(symbolsByKey.get('tmu')?.category).toBe('冷却')
    expect(symbolsByKey.get('fm')?.category).toBe('电力')
    expect(symbolsByKey.get('battery-group')?.category).toBe('电力')
    expect(symbolsByKey.get('ups-group')?.category).toBe('电力')
    expect(symbolsByKey.get('cabinet')?.category).toBe('电力')
    expect(symbolsByKey.get('cabinet-b')?.category).toBe('电力')
    expect(symbolsByKey.get('compute-pod')?.category).toBe('电力')
    expect(symbolsByKey.get('power-pod')?.category).toBe('电力')
  })

  it('uses PNG replacements for the five updated cooling symbols', () => {
    expect(['chwp', 'cwp', 'cpd', 'ct', 'phe'].map((key) => {
      const symbol = symbolsByKey.get(key)
      return {
        source: symbol?.source,
        width: symbol?.intrinsicWidth,
        height: symbol?.intrinsicHeight,
      }
    })).toEqual([
      { source: 'src/assets/symbols/CHWP.png', width: 200, height: 80 },
      { source: 'src/assets/symbols/CWP.png', width: 200, height: 80 },
      { source: 'src/assets/symbols/CPD.png', width: 80, height: 80 },
      { source: 'src/assets/symbols/CT.png', width: 160, height: 160 },
      { source: 'src/assets/symbols/PHE.png', width: 200, height: 80 },
    ])
  })

  it('uses each SVG intrinsic size as its insertion size', () => {
    const chwp = symbolsByKey.get('chwp')
    expect(chwp).toMatchObject({ intrinsicWidth: 200, intrinsicHeight: 80 })
    expect(getScaledSymbolSize(chwp!, 1, 8)).toEqual({ scale: 1, width: 200, height: 80 })
  })

  it('keeps catalog dimensions synchronized with SVG width and height attributes', () => {
    for (const symbol of symbolCatalog.filter((candidate) => candidate.source.endsWith('.svg'))) {
      const raw = rawSymbols[`../assets/symbols/${symbol.source.split('/').at(-1)}`]
      expect(raw, symbol.source).toBeTypeOf('string')
      const root = raw.match(/<svg\b[^>]*>/)?.[0] ?? ''
      expect(Number(root.match(/\bwidth="([\d.]+)"/)?.[1]), symbol.source).toBe(symbol.intrinsicWidth)
      expect(Number(root.match(/\bheight="([\d.]+)"/)?.[1]), symbol.source).toBe(symbol.intrinsicHeight)
    }
  })

  it('derives grid-safe proportional scaling with the expected CHWP minimum', () => {
    const chwp = symbolsByKey.get('chwp')!
    expect(getSymbolScaleStep(chwp, 8)).toBe(0.2)
    expect(getScaledSymbolSize(chwp, 0.01, 8)).toEqual({ scale: 0.2, width: 40, height: 16 })
    expect(getScaledSymbolSize(chwp, 0.62, 8)).toEqual({ scale: 0.6, width: 120, height: 48 })
  })
})
