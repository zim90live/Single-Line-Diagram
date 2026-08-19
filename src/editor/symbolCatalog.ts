import type { AssetDefinition, DiagramElement } from '../domain/project'

const symbolUrls = import.meta.glob<string>('../assets/symbols/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

export interface SymbolDefinition extends AssetDefinition {
  url: string
  intrinsicWidth: number
  intrinsicHeight: number
  configurableColor: boolean
  defaultColor?: string
  defaultState?: SymbolVisualState
  stateUrls?: Partial<Record<SymbolVisualState, string>>
}

export type SymbolVisualState = 'off' | 'on'
export type SymbolColorSlot = 'default' | 'switch-off' | 'switch-on'

export const DEFAULT_CONFIGURABLE_SYMBOL_COLOR = '#777777'
export const SWITCH_OFF_COLOR_PROPERTY = 'switchOffColor'
export const SWITCH_ON_COLOR_PROPERTY = 'switchOnColor'

interface SymbolMetadata {
  file: string
  key?: string
  name: string
  category: '冷却' | '电力'
  width: number
  height: number
  configurableColor?: boolean
  defaultState?: SymbolVisualState
  stateFiles?: Partial<Record<SymbolVisualState, string>>
}

const metadata: SymbolMetadata[] = [
  { file: '2WV.svg', name: '2WV', category: '冷却', width: 32, height: 32, configurableColor: true },
  { file: 'CDU.svg', name: 'CDU', category: '冷却', width: 96, height: 96 },
  { file: 'CHWP.svg', name: 'CHWP', category: '冷却', width: 200, height: 80 },
  { file: 'CT.svg', name: 'CT', category: '冷却', width: 160, height: 160 },
  { file: 'CV.svg', name: 'CV', category: '冷却', width: 32, height: 32, configurableColor: true },
  { file: 'CWP.svg', name: 'CWP', category: '冷却', width: 200, height: 80 },
  { file: 'FM.svg', name: 'FM', category: '电力', width: 64, height: 64 },
  { file: 'MP.svg', name: 'MP', category: '冷却', width: 32, height: 32, configurableColor: true },
  { file: 'PHE.svg', name: 'PHE', category: '冷却', width: 80, height: 160 },
  { file: 'WMT.svg', name: 'WMT', category: '冷却', width: 80, height: 80 },
  { file: 'Battery.svg', name: 'Battery', category: '电力', width: 48, height: 48 },
  { file: 'Generator.svg', name: 'Generator', category: '电力', width: 48, height: 48, configurableColor: true },
  { file: 'Grid.svg', name: 'Grid', category: '电力', width: 48, height: 48, configurableColor: true },
  {
    file: 'SwitchOff.svg',
    key: 'switch',
    name: 'Switch',
    category: '电力',
    width: 32,
    height: 32,
    configurableColor: true,
    defaultState: 'off',
    stateFiles: { off: 'SwitchOff.svg', on: 'SwitchOn.svg' },
  },
  { file: 'Transformer.svg', name: 'Transformer', category: '电力', width: 64, height: 64, configurableColor: true },
  { file: 'UPS.svg', name: 'UPS', category: '电力', width: 48, height: 48 },
  { file: 'CPD.svg', name: 'CPD', category: '冷却', width: 80, height: 80 },
  { file: 'Cabinet A.svg', key: 'cabinet', name: 'Cabinet A', category: '电力', width: 48, height: 48 },
  { file: 'Cabinet B.svg', key: 'cabinet-b', name: 'Cabinet B', category: '电力', width: 48, height: 48 },
  { file: 'ComputePOD.svg', name: '算力 POD', category: '电力', width: 64, height: 64 },
  { file: 'PowerPOD.svg', name: '动力 POD', category: '电力', width: 64, height: 64 },
]

const registeredFiles = new Set(metadata.flatMap((symbol) => [
  `../assets/symbols/${symbol.file}`,
  ...Object.values(symbol.stateFiles ?? {})
    .filter((file): file is string => Boolean(file))
    .map((file) => `../assets/symbols/${file}`),
]))
const unregisteredFiles = Object.keys(symbolUrls).filter((path) => !registeredFiles.has(path))
if (unregisteredFiles.length) {
  throw new Error(`存在未登记的图元文件：${unregisteredFiles.join('、')}`)
}

function symbolKey(file: string) {
  return file.replace(/\.svg$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function getSymbolUrl(file: string) {
  const url = symbolUrls[`../assets/symbols/${file}`]
  if (!url) throw new Error(`图元文件未找到：src/assets/symbols/${file}`)
  return url
}

export const symbolCatalog: SymbolDefinition[] = metadata.map((symbol) => ({
  key: symbol.key ?? symbolKey(symbol.file),
  name: symbol.name,
  category: symbol.category,
  source: `src/assets/symbols/${symbol.file}`,
  url: getSymbolUrl(symbol.file),
  intrinsicWidth: symbol.width,
  intrinsicHeight: symbol.height,
  anchors: [],
  configurableColor: symbol.configurableColor ?? false,
  defaultColor: symbol.configurableColor ? DEFAULT_CONFIGURABLE_SYMBOL_COLOR : undefined,
  defaultState: symbol.defaultState,
  stateUrls: symbol.stateFiles
    ? Object.fromEntries(
        Object.entries(symbol.stateFiles)
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([state, file]) => [state, getSymbolUrl(file)]),
      )
    : undefined,
}))

export function normalizeSymbolColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : DEFAULT_CONFIGURABLE_SYMBOL_COLOR
}

export function symbolColorSlotForElement(
  element: DiagramElement,
  state: SymbolVisualState,
): SymbolColorSlot {
  if (element.assetKey !== 'switch') return 'default'
  return state === 'on' ? 'switch-on' : 'switch-off'
}

export function symbolColorPropertyKey(slot: SymbolColorSlot) {
  if (slot === 'switch-off') return SWITCH_OFF_COLOR_PROPERTY
  if (slot === 'switch-on') return SWITCH_ON_COLOR_PROPERTY
  return 'color'
}

export function resolvedSymbolColorForSlot(
  element: DiagramElement,
  slot: SymbolColorSlot,
) {
  const value = element.properties[symbolColorPropertyKey(slot)]
  const legacySwitchColor = element.assetKey === 'switch' ? element.properties.color : undefined
  return normalizeSymbolColor(value ?? legacySwitchColor)
}

export function resolvedSymbolColor(
  element: DiagramElement,
  state: SymbolVisualState = 'off',
) {
  return resolvedSymbolColorForSlot(element, symbolColorSlotForElement(element, state))
}

export function getSymbolStateUrl(
  symbol: SymbolDefinition,
  state: SymbolVisualState = symbol.defaultState ?? 'off',
) {
  return symbol.stateUrls?.[state] ?? symbol.url
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left))
  let b = Math.abs(Math.round(right))
  while (b) [a, b] = [b, a % b]
  return a || 1
}

export function getSymbolScaleStep(symbol: SymbolDefinition, gridSize: number) {
  const widthUnits = symbol.intrinsicWidth / gridSize
  const heightUnits = symbol.intrinsicHeight / gridSize
  if (!Number.isInteger(widthUnits) || !Number.isInteger(heightUnits)) {
    throw new Error(`图元 ${symbol.key} 的原始尺寸必须是 ${gridSize}px 的整数倍`)
  }
  return 1 / greatestCommonDivisor(widthUnits, heightUnits)
}

export function snapSymbolScale(
  symbol: SymbolDefinition,
  requestedScale: number,
  gridSize: number,
) {
  const step = getSymbolScaleStep(symbol, gridSize)
  return Number(Math.max(step, Math.round(requestedScale / step) * step).toFixed(8))
}

export function getScaledSymbolSize(
  symbol: SymbolDefinition,
  requestedScale: number,
  gridSize: number,
) {
  const scale = snapSymbolScale(symbol, requestedScale, gridSize)
  return {
    scale,
    width: Math.round(symbol.intrinsicWidth * scale),
    height: Math.round(symbol.intrinsicHeight * scale),
  }
}

export const symbolAssets: AssetDefinition[] = symbolCatalog.map(
  ({ key, name, category, source, intrinsicWidth, intrinsicHeight, anchors }) => ({
    key,
    name,
    category,
    source,
    intrinsicWidth,
    intrinsicHeight,
    anchors: [...anchors],
  }),
)

export const symbolsByKey = new Map(symbolCatalog.map((symbol) => [symbol.key, symbol]))
