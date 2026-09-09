import type {
  AssetDefinition,
  CoolingDeviceRole,
  DiagramElement,
  MonitorMetric,
  SymbolAnchor,
} from '../domain/project'
import {
  GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY,
  GENERIC_SYMBOL_DEFAULT_HEIGHT,
  GENERIC_SYMBOL_DEFAULT_WIDTH,
  GENERIC_SYMBOL_KEY,
  normalizeGenericSymbolBackgroundColor,
} from './genericSymbol'

const symbolUrls = import.meta.glob<string>([
  '../assets/symbols/*.svg',
  '../assets/symbols/*.png',
], {
  eager: true,
  query: '?url',
  import: 'default',
})

const COOLING_PUMP_STOPPED_SYMBOL_FILE = 'PumpOff.png'
const CHWP_CWP_STOPPED_SYMBOL_FILE = 'CHWP CWP Off.svg'
const FAULT_SYMBOL_FILES: Record<string, string> = {
  'battery-group': 'Battery-group Fault.svg',
  cabinet: 'Tap-off Unit-group Fault.svg',
  'cabinet-b': 'Tap-off Unit-group Fault.svg',
  'cabinet-device': 'Cabinet Fault.svg',
  'ups-group': 'UPS-group Fault.svg',
  ups: 'UPS Fault.svg',
  fm: 'FM Fault.svg',
  tmu: 'TMU Fault.svg',
  cdu: 'CDU Fault.svg',
  ct: 'CT Fault.svg',
}

export interface SymbolDefinition extends AssetDefinition {
  url: string
  intrinsicWidth: number
  intrinsicHeight: number
  configurableColor: boolean
  defaultColor?: string
  stateMode?: SymbolStateMode
  defaultState?: SymbolVisualState
  stateUrls?: Partial<Record<SymbolVisualState, string>>
  anchorMode?: SymbolAnchorMode
  defaultMonitorMetrics?: SymbolMonitorMetricTemplate[]
  renderMode: 'image' | 'generic-frame'
}

export type SymbolVisualState = 'off' | 'on'
export type SymbolStateMode = 'on-off' | 'running-standby'
export type SymbolAnchorMode = 'standard' | 'measurement-point'
export type SymbolMonitorMetricTemplate = MonitorMetric extends infer Metric
  ? Metric extends MonitorMetric ? Omit<Metric, 'id'> : never
  : never
export type SymbolColorSlot = 'default' | 'switch-off' | 'switch-on' | 'generic-background'

export const DEFAULT_CONFIGURABLE_SYMBOL_COLOR = '#777777'
export const SWITCH_OFF_COLOR_PROPERTY = 'switchOffColor'
export const SWITCH_ON_COLOR_PROPERTY = 'switchOnColor'

interface SymbolMetadata {
  file: string
  key?: string
  name: string
  category: '冷却' | '电力' | '通用'
  width: number
  height: number
  configurableColor?: boolean
  stateMode?: SymbolStateMode
  defaultState?: SymbolVisualState
  stateFiles?: Partial<Record<SymbolVisualState, string>>
  anchorMode?: SymbolAnchorMode
  defaultMonitorMetrics?: SymbolMonitorMetricTemplate[]
  renderMode?: SymbolDefinition['renderMode']
  coolingDeviceRole?: CoolingDeviceRole
  anchors?: SymbolAnchor[]
}

const metadata: SymbolMetadata[] = [
  {
    file: '2WV_Off.svg',
    key: '2-wv',
    name: '2WV',
    category: '冷却',
    width: 32,
    height: 32,
    configurableColor: true,
    defaultState: 'off',
    stateFiles: { off: '2WV_Off.svg', on: '2WV_On.svg' },
  },
  { file: 'CDU.svg', name: 'CDU', category: '冷却', width: 48, height: 48 },
  { file: 'CHWP.svg', name: 'CHWP', category: '冷却', width: 80, height: 128 },
  { file: 'CT.svg', name: 'CT', category: '冷却', width: 96, height: 96 },
  {
    file: 'CV_Off.svg',
    key: 'cv',
    name: 'CV',
    category: '冷却',
    width: 32,
    height: 32,
    configurableColor: true,
    defaultState: 'off',
    stateFiles: { off: 'CV_Off.svg', on: 'CV_On.svg' },
    coolingDeviceRole: 'check-valve',
    anchors: [
      {
        id: 'cv-inlet',
        name: '入口',
        x: 16,
        y: 0,
        direction: 'top',
        type: 'cooling-general',
        flowRole: 'inlet',
      },
      {
        id: 'cv-outlet',
        name: '出口',
        x: 16,
        y: 32,
        direction: 'bottom',
        type: 'cooling-general',
        flowRole: 'outlet',
      },
    ],
  },
  { file: 'CWP.svg', name: 'CWP', category: '冷却', width: 80, height: 128 },
  { file: 'FM.svg', name: 'FM', category: '电力', width: 64, height: 64 },
  {
    file: 'MP.svg',
    name: 'MP',
    category: '冷却',
    width: 32,
    height: 32,
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
    defaultMonitorMetrics: [
      {
        name: '温度',
        valueType: 'number',
        unit: '°C',
        precision: 1,
        simulationMin: 16,
        simulationMax: 32,
        alarm: {
          mode: 'outside',
          criticalLow: 5,
          majorLow: 10,
          minorLow: 14,
          minorHigh: 34,
          majorHigh: 38,
          criticalHigh: 45,
        },
      },
      {
        name: '压力',
        valueType: 'number',
        unit: 'kPa',
        precision: 1,
        simulationMin: 200,
        simulationMax: 450,
        alarm: {
          mode: 'outside',
          criticalLow: 60,
          majorLow: 120,
          minorLow: 160,
          minorHigh: 500,
          majorHigh: 560,
          criticalHigh: 650,
        },
      },
      {
        name: '流量',
        valueType: 'number',
        unit: 'm³/h',
        precision: 1,
        simulationMin: 40,
        simulationMax: 120,
        alarm: {
          mode: 'outside',
          criticalLow: 5,
          majorLow: 20,
          minorLow: 30,
          minorHigh: 130,
          majorHigh: 150,
          criticalHigh: 180,
        },
      },
    ],
  },
  { file: 'PHE.svg', name: 'PHE', category: '冷却', width: 80, height: 128 },
  { file: 'TMU.svg', name: 'TMU', category: '冷却', width: 48, height: 48 },
  { file: 'WMT.svg', name: 'WMT', category: '冷却', width: 80, height: 80 },
  { file: 'Battery.svg', name: 'Battery', category: '电力', width: 48, height: 48 },
  { file: 'Battery-group.svg', name: 'Battery-group', category: '电力', width: 48, height: 48 },
  { file: 'Supply.svg', key: 'supply', name: 'Supply', category: '电力', width: 48, height: 48, configurableColor: true, stateMode: 'running-standby', defaultState: 'on' },
  { file: 'Load.svg', key: 'load', name: 'Load', category: '电力', width: 48, height: 48, configurableColor: true, stateMode: 'running-standby', defaultState: 'on' },
  { file: 'AC-AC Converter.svg', key: 'ac-ac-converter', name: 'AC-AC Converter', category: '电力', width: 48, height: 48 },
  { file: 'Rectifier.svg', key: 'rectifier', name: 'Rectifier', category: '电力', width: 48, height: 48 },
  { file: 'Inverter.svg', key: 'inverter', name: 'Inverter', category: '电力', width: 48, height: 48 },
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
  { file: 'UPS-group.svg', name: 'UPS-group', category: '电力', width: 48, height: 48 },
  { file: 'CPD.png', name: 'CPD', category: '冷却', width: 80, height: 80 },
  { file: 'Cabinet.svg', key: 'cabinet-device', name: 'Cabinet', category: '电力', width: 48, height: 48 },
  { file: 'Tap-off Unit-group.svg', key: 'cabinet', name: 'Tap-off Unit-group', category: '电力', width: 48, height: 48 },
  { file: 'Tap-off Unit-group.svg', key: 'cabinet-b', name: 'Tap-off Unit-group', category: '电力', width: 48, height: 48 },
  {
    file: 'Tap-off Unit.svg',
    key: 'tap-off-unit',
    name: 'Tap-off Unit',
    category: '电力',
    width: 32,
    height: 32,
    configurableColor: true,
  },
  { file: 'ComputePOD.svg', name: '算力 POD', category: '电力', width: 64, height: 64 },
  { file: 'PowerPOD.svg', name: '动力 POD', category: '电力', width: 64, height: 64 },
  {
    file: 'Generic.svg',
    key: GENERIC_SYMBOL_KEY,
    name: '通用图元',
    category: '通用',
    width: GENERIC_SYMBOL_DEFAULT_WIDTH,
    height: GENERIC_SYMBOL_DEFAULT_HEIGHT,
    configurableColor: true,
    renderMode: 'generic-frame',
  },
]

const registeredFiles = new Set(metadata.flatMap((symbol) => [
  `../assets/symbols/${symbol.file}`,
  ...Object.values(symbol.stateFiles ?? {})
    .filter((file): file is string => Boolean(file))
    .map((file) => `../assets/symbols/${file}`),
]).concat(
  `../assets/symbols/${COOLING_PUMP_STOPPED_SYMBOL_FILE}`,
  `../assets/symbols/${CHWP_CWP_STOPPED_SYMBOL_FILE}`,
  ...Object.values(FAULT_SYMBOL_FILES).map((file) => `../assets/symbols/${file}`),
))
const unregisteredFiles = Object.keys(symbolUrls).filter((path) => !registeredFiles.has(path))
if (unregisteredFiles.length) {
  throw new Error(`存在未登记的图元文件：${unregisteredFiles.join('、')}`)
}

function symbolKey(file: string) {
  return file.replace(/\.(?:svg|png)$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function getSymbolUrl(file: string) {
  const url = symbolUrls[`../assets/symbols/${file}`]
  if (!url) throw new Error(`图元文件未找到：src/assets/symbols/${file}`)
  return url
}

export const COOLING_PUMP_STOPPED_SYMBOL_URL = getSymbolUrl(
  COOLING_PUMP_STOPPED_SYMBOL_FILE,
)

export const symbolCatalog: SymbolDefinition[] = metadata.map((symbol) => ({
  key: symbol.key ?? symbolKey(symbol.file),
  name: symbol.name,
  category: symbol.category,
  source: `src/assets/symbols/${symbol.file}`,
  url: getSymbolUrl(symbol.file),
  intrinsicWidth: symbol.width,
  intrinsicHeight: symbol.height,
  coolingDeviceRole: symbol.coolingDeviceRole,
  anchors: symbol.anchors?.map((anchor) => ({ ...anchor })) ?? [],
  configurableColor: symbol.configurableColor ?? false,
  defaultColor: symbol.configurableColor ? DEFAULT_CONFIGURABLE_SYMBOL_COLOR : undefined,
  stateMode: symbol.stateMode ?? (symbol.stateFiles ? 'on-off' : undefined),
  defaultState: symbol.defaultState,
  stateUrls: symbol.stateFiles
    ? Object.fromEntries(
        Object.entries(symbol.stateFiles)
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([state, file]) => [state, getSymbolUrl(file)]),
      )
    : undefined,
  anchorMode: symbol.anchorMode ?? 'standard',
  defaultMonitorMetrics: symbol.defaultMonitorMetrics?.map((metric) => ({
    ...metric,
    ...(metric.valueType === 'number' ? { alarm: { ...metric.alarm } } : {
      textOptions: metric.textOptions.map((option) => ({ ...option })),
    }),
  })),
  renderMode: symbol.renderMode ?? 'image',
}))

export function normalizeSymbolColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : DEFAULT_CONFIGURABLE_SYMBOL_COLOR
}

export function symbolSupportsOnOffState(
  symbol: SymbolDefinition | undefined,
): symbol is SymbolDefinition & { stateMode: SymbolStateMode } {
  return Boolean(symbol?.stateMode)
}

export function elementSupportsOnOffState(element: DiagramElement) {
  return symbolSupportsOnOffState(symbolsByKey.get(element.assetKey))
}

export function symbolColorSlotForElement(
  element: DiagramElement,
  state: SymbolVisualState,
): SymbolColorSlot {
  if (!elementSupportsOnOffState(element)) return 'default'
  return state === 'on' ? 'switch-on' : 'switch-off'
}

export function symbolColorPropertyKey(slot: SymbolColorSlot) {
  if (slot === 'switch-off') return SWITCH_OFF_COLOR_PROPERTY
  if (slot === 'switch-on') return SWITCH_ON_COLOR_PROPERTY
  if (slot === 'generic-background') return GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY
  return 'color'
}

export function resolvedSymbolColorForSlot(
  element: DiagramElement,
  slot: SymbolColorSlot,
) {
  const value = element.properties[symbolColorPropertyKey(slot)]
  if (slot === 'generic-background') return normalizeGenericSymbolBackgroundColor(value)
  const legacyStateColor = elementSupportsOnOffState(element)
    ? element.properties.color
    : undefined
  return normalizeSymbolColor(value ?? legacyStateColor)
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

export function getSymbolDisplayUrl(
  symbol: SymbolDefinition,
  state: SymbolVisualState = symbol.defaultState ?? 'off',
  coolingPumpStopped = false,
  fault = false,
) {
  if (fault && FAULT_SYMBOL_FILES[symbol.key]) return getSymbolUrl(FAULT_SYMBOL_FILES[symbol.key])
  return coolingPumpStopped
    ? symbol.key === 'chwp' || symbol.key === 'cwp'
      ? getSymbolUrl(CHWP_CWP_STOPPED_SYMBOL_FILE)
      : COOLING_PUMP_STOPPED_SYMBOL_URL
    : getSymbolStateUrl(symbol, state)
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
  ({ key, name, category, source, intrinsicWidth, intrinsicHeight, coolingDeviceRole, anchors }) => ({
    key,
    name,
    category,
    source,
    intrinsicWidth,
    intrinsicHeight,
    coolingDeviceRole,
    anchors: [...anchors],
  }),
)

export const symbolsByKey = new Map(symbolCatalog.map((symbol) => [symbol.key, symbol]))
