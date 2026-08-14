import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  getScaledSymbolSize,
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
  it('registers every SVG from the formal symbol directory', () => {
    expect(symbolCatalog).toHaveLength(20)
    expect(symbolCatalog.every((symbol) => symbol.source.startsWith('src/assets/symbols/'))).toBe(true)
  })

  it('registers Switch as one configurable symbol presented in Off state', () => {
    const switchSymbol = symbolsByKey.get('switch')

    expect(symbolsByKey.has('switch-off')).toBe(false)
    expect(symbolsByKey.has('switch-on')).toBe(false)
    expect(switchSymbol).toMatchObject({
      name: 'Switch',
      source: 'src/assets/symbols/SwitchOff.svg',
      defaultState: 'off',
      configurableColor: true,
      defaultColor: DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
    })
    expect(getSymbolStateUrl(switchSymbol!, 'off')).toBe(switchSymbol?.url)
    expect(getSymbolStateUrl(switchSymbol!, 'on')).not.toBe(switchSymbol?.url)
  })

  it('allows color changes only for the requested seven symbols', () => {
    expect(symbolCatalog.filter((symbol) => symbol.configurableColor).map((symbol) => symbol.key))
      .toEqual(['2-wv', 'cv', 'mp', 'generator', 'grid', 'switch', 'transformer'])
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
    expect(symbolsByKey.get('fm')?.category).toBe('电力')
    expect(symbolsByKey.get('cabinet')?.category).toBe('电力')
    expect(symbolsByKey.get('compute-pod')?.category).toBe('电力')
    expect(symbolsByKey.get('power-pod')?.category).toBe('电力')
  })

  it('uses each SVG intrinsic size as its insertion size', () => {
    const chwp = symbolsByKey.get('chwp')
    expect(chwp).toMatchObject({ intrinsicWidth: 200, intrinsicHeight: 80 })
    expect(getScaledSymbolSize(chwp!, 1, 8)).toEqual({ scale: 1, width: 200, height: 80 })
  })

  it('keeps catalog dimensions synchronized with SVG width and height attributes', () => {
    for (const symbol of symbolCatalog) {
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
