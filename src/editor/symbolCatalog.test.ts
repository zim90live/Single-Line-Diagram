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
    expect(symbolCatalog).toHaveLength(32)
    expect(symbolCatalog.every((symbol) => symbol.source.startsWith('src/assets/symbols/'))).toBe(true)
  })

  it('registers five new 48 by 48 power symbols and only makes Supply and Load configurable', () => {
    expect([
      'supply',
      'load',
      'ac-ac-converter',
      'rectifier',
      'inverter',
    ].map((key) => {
      const symbol = symbolsByKey.get(key)
      return {
        key: symbol?.key,
        name: symbol?.name,
        category: symbol?.category,
        width: symbol?.intrinsicWidth,
        height: symbol?.intrinsicHeight,
        configurableColor: symbol?.configurableColor,
        defaultColor: symbol?.defaultColor,
        stateMode: symbol?.stateMode,
        defaultState: symbol?.defaultState,
      }
    })).toEqual([
      { key: 'supply', name: 'Supply', category: '电力', width: 48, height: 48, configurableColor: true, defaultColor: DEFAULT_CONFIGURABLE_SYMBOL_COLOR, stateMode: 'running-standby', defaultState: 'on' },
      { key: 'load', name: 'Load', category: '电力', width: 48, height: 48, configurableColor: true, defaultColor: DEFAULT_CONFIGURABLE_SYMBOL_COLOR, stateMode: 'running-standby', defaultState: 'on' },
      { key: 'ac-ac-converter', name: 'AC-AC Converter', category: '电力', width: 48, height: 48, configurableColor: false, defaultColor: undefined, stateMode: undefined, defaultState: undefined },
      { key: 'rectifier', name: 'Rectifier', category: '电力', width: 48, height: 48, configurableColor: false, defaultColor: undefined, stateMode: undefined, defaultState: undefined },
      { key: 'inverter', name: 'Inverter', category: '电力', width: 48, height: 48, configurableColor: false, defaultColor: undefined, stateMode: undefined, defaultState: undefined },
    ])
    expect(getSymbolStateUrl(symbolsByKey.get('supply')!, 'off')).toBe(
      getSymbolStateUrl(symbolsByKey.get('supply')!, 'on'),
    )
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

  it('registers TMU as a 48 by 48 cooling SVG symbol', () => {
    const tmu = symbolsByKey.get('tmu')

    expect(tmu).toMatchObject({
      name: 'TMU',
      source: 'src/assets/symbols/TMU.svg',
      category: '冷却',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
      renderMode: 'image',
    })
    expect(getScaledSymbolSize(tmu!, 1, 8)).toEqual({ scale: 1, width: 48, height: 48 })
  })

  it('registers CDU as a 48 by 48 cooling SVG symbol', () => {
    const cdu = symbolsByKey.get('cdu')

    expect(cdu).toMatchObject({
      name: 'CDU',
      source: 'src/assets/symbols/CDU.svg',
      category: '冷却',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
      renderMode: 'image',
    })
    expect(getScaledSymbolSize(cdu!, 1, 8)).toEqual({ scale: 1, width: 48, height: 48 })
  })

  it('registers MP as a single-anchor cooling measurement point', () => {
    expect(symbolsByKey.get('mp')).toMatchObject({
      name: 'MP',
      source: 'src/assets/symbols/MP.svg',
      category: '冷却',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      configurableColor: true,
      anchorMode: 'measurement-point',
      anchors: [{
        id: 'mp-measurement-point',
        name: '测量点',
        x: 16,
        y: 32,
        direction: 'bottom',
        type: 'cooling-general',
      }],
    })
    expect(rawSymbols['../assets/symbols/MP.svg']).toContain('M16 21V32')
    expect(rawSymbols['../assets/symbols/MP.svg']).not.toContain('M16 0V32')
    expect(symbolsByKey.get('mp')?.defaultMonitorMetrics?.map((metric) => (
      metric.valueType === 'number' ? `${metric.name}:${metric.unit}` : metric.name
    ))).toEqual(['温度:°C', '压力:kPa', '流量:m³/h'])
  })

  it('uses the dedicated stopped image only for a stopped cooling pump presentation', () => {
    const chwp = symbolsByKey.get('chwp')!

    expect(COOLING_PUMP_STOPPED_SYMBOL_URL).toContain('PumpOff.png')
    expect(getSymbolDisplayUrl(chwp, 'off', false)).toBe(chwp.url)
    expect(decodeURIComponent(getSymbolDisplayUrl(chwp, 'off', true))).toContain('CHWP CWP Off.svg')
    const cwp = symbolsByKey.get('cwp')!
    expect(getSymbolDisplayUrl(cwp, 'off', true)).toBe(getSymbolDisplayUrl(chwp, 'off', true))
    expect(getSymbolDisplayUrl(cwp, 'off', false)).toBe(cwp.url)
    expect(getSymbolDisplayUrl(symbolsByKey.get('ct')!, 'off', true)).toBe(COOLING_PUMP_STOPPED_SYMBOL_URL)
  })

  it('uses fault artwork for supported assets and restores their normal artwork', () => {
    const files = {
      'battery-group': 'Battery-group', cabinet: 'Tap-off Unit-group',
      'cabinet-b': 'Tap-off Unit-group', 'cabinet-device': 'Cabinet',
      'ups-group': 'UPS-group', ups: 'UPS', fm: 'FM', tmu: 'TMU', cdu: 'CDU', ct: 'CT',
    }
    for (const [key, file] of Object.entries(files)) {
      const symbol = symbolsByKey.get(key)!
      expect(decodeURIComponent(getSymbolDisplayUrl(symbol, 'on', false, true)))
        .toContain(`${file} Fault.svg`)
      expect(getSymbolDisplayUrl(symbol, 'on', false, false)).toBe(symbol.url)
    }
    const pump = symbolsByKey.get('chwp')!
    expect(getSymbolDisplayUrl(pump, 'on', false, true)).toBe(pump.url)
    expect(symbolCatalog.some((symbol) => symbol.source.includes(' Fault.svg'))).toBe(false)
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
      name: 'Tap-off Unit-group',
      source: 'src/assets/symbols/Tap-off Unit-group.svg',
      category: '电力',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
    })
    expect(symbolsByKey.get('cabinet-b')).toMatchObject({
      name: 'Tap-off Unit-group',
      source: 'src/assets/symbols/Tap-off Unit-group.svg',
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
        'supply',
        'load',
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

  it('uses the latest SVG replacements for CWP, CHWP, CT, and PHE', () => {
    expect(['chwp', 'cwp', 'cpd', 'ct', 'phe'].map((key) => {
      const symbol = symbolsByKey.get(key)
      return {
        source: symbol?.source,
        width: symbol?.intrinsicWidth,
        height: symbol?.intrinsicHeight,
      }
    })).toEqual([
      { source: 'src/assets/symbols/CHWP.svg', width: 80, height: 128 },
      { source: 'src/assets/symbols/CWP.svg', width: 80, height: 128 },
      { source: 'src/assets/symbols/CPD.png', width: 80, height: 80 },
      { source: 'src/assets/symbols/CT.svg', width: 96, height: 96 },
      { source: 'src/assets/symbols/PHE.svg', width: 80, height: 128 },
    ])
  })

  it('uses each SVG intrinsic size as its insertion size', () => {
    const chwp = symbolsByKey.get('chwp')
    expect(chwp).toMatchObject({ intrinsicWidth: 80, intrinsicHeight: 128 })
    expect(getScaledSymbolSize(chwp!, 1, 8)).toEqual({ scale: 1, width: 80, height: 128 })
  })

  it('keeps catalog dimensions synchronized with SVG width and height attributes', () => {
    for (const symbol of symbolCatalog.filter((candidate) => candidate.source.endsWith('.svg'))) {
      const raw = rawSymbols[`../assets/symbols/${symbol.source.split('/').at(-1)}`]
      expect(raw, symbol.source).toBeTypeOf('string')
      const root = raw.match(/<svg\b[^>]*>/)?.[0] ?? ''
      const sourceWidth = Number(root.match(/\bwidth="([\d.]+)"/)?.[1])
      const sourceHeight = Number(root.match(/\bheight="([\d.]+)"/)?.[1])
      expect(sourceWidth, symbol.source).toBe(symbol.intrinsicWidth)
      expect(sourceHeight, symbol.source).toBe(symbol.intrinsicHeight)
    }
  })

  it('derives grid-safe proportional scaling with the updated CHWP dimensions', () => {
    const chwp = symbolsByKey.get('chwp')!
    expect(getSymbolScaleStep(chwp, 8)).toBe(0.5)
    expect(getScaledSymbolSize(chwp, 0.01, 8)).toEqual({ scale: 0.5, width: 40, height: 64 })
    expect(getScaledSymbolSize(chwp, 0.62, 8)).toEqual({ scale: 0.5, width: 40, height: 64 })
  })
})
