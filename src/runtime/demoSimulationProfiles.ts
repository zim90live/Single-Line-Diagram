import type {
  DiagramElement,
  MonitorAlarmSeverity,
  MonitorMetric,
} from '../domain/project'

export const DEMO_SIMULATION_ALGORITHM_VERSION = 'demo-runtime-1'
export const DEMO_DEVICE_PROFILE_VERSION = 'aidc-demo-profile-2026-09-r4'
export const DEFAULT_DEMO_SIMULATION_SEED = 'aidc-leadership-demo'

export type DemoHealthState = MonitorAlarmSeverity | 'offline'

export type DemoDeviceOperation =
  | 'running'
  | 'standby'
  | 'stopped'
  | 'open'
  | 'closed'
  | 'charging'
  | 'discharging'

export type DemoMetricSemanticKey =
  | 'lineVoltage'
  | 'outputVoltage'
  | 'frequency'
  | 'activePower'
  | 'loadRatio'
  | 'powerFactor'
  | 'soc'
  | 'backupTime'
  | 'deviceTemperature'
  | 'inletTemperature'
  | 'supplyTemperature'
  | 'returnTemperature'
  | 'deltaTemperature'
  | 'pressure'
  | 'differentialPressure'
  | 'flowRate'
  | 'outputRatio'
  | 'valvePosition'
  | 'level'
  | 'status'
  | 'communication'

export interface DemoValueRange {
  min: number
  max: number
}

export interface DemoMetricBands {
  normal: DemoValueRange[]
  minor: DemoValueRange[]
  major: DemoValueRange[]
  critical: DemoValueRange[]
}

export interface DemoMetricProfile {
  semanticKey: DemoMetricSemanticKey
  name: string
  unit: string
  precision: 0 | 1 | 2
  bands?: DemoMetricBands
  textValues?: Partial<Record<DemoHealthState, string>>
}

export interface DemoDeviceProfile {
  id: string
  assetKeys: string[]
  operation: DemoDeviceOperation
  metrics: DemoMetricProfile[]
}

export interface DemoFaultAssignment {
  severity: Exclude<DemoHealthState, 'normal'>
  faultCode: string
}

export interface DemoDeviceRuntimeState {
  health: DemoHealthState
  operation: DemoDeviceOperation
  online: boolean
  faultCode?: string
}

const range = (min: number, max: number): DemoValueRange => ({ min, max })

const upperBands = (
  normal: [number, number],
  minor: [number, number],
  major: [number, number],
  critical: [number, number],
): DemoMetricBands => ({
  normal: [range(...normal)],
  minor: [range(...minor)],
  major: [range(...major)],
  critical: [range(...critical)],
})

const outsideBands = (
  normal: [number, number],
  minorLow: [number, number],
  minorHigh: [number, number],
  majorLow: [number, number],
  majorHigh: [number, number],
  criticalLow: [number, number],
  criticalHigh: [number, number],
): DemoMetricBands => ({
  normal: [range(...normal)],
  minor: [range(...minorLow), range(...minorHigh)],
  major: [range(...majorLow), range(...majorHigh)],
  critical: [range(...criticalLow), range(...criticalHigh)],
})

const metric = (
  semanticKey: DemoMetricSemanticKey,
  name: string,
  unit: string,
  precision: 0 | 1 | 2,
  bands: DemoMetricBands,
): DemoMetricProfile => ({ semanticKey, name, unit, precision, bands })

const statusMetric = (
  operation: DemoDeviceOperation,
  normalText = '运行',
): DemoMetricProfile => ({
  semanticKey: 'status',
  name: '状态',
  unit: '',
  precision: 0,
  textValues: {
    normal: normalText,
    minor: operation === 'open' ? '反馈延迟' : '轻微异常',
    major: operation === 'open' ? '动作异常' : '降额运行',
    critical: operation === 'open' ? '卡涩' : '故障',
    offline: '离线',
  },
})

const voltage10kV = metric('lineVoltage', '线电压', 'kV', 2, outsideBands(
  [9.8, 10.2], [9.5, 9.8], [10.2, 10.5], [9, 9.5], [10.5, 11], [8.4, 9], [11, 11.6],
))
const voltage400V = metric('outputVoltage', '输出电压', 'V', 0, outsideBands(
  [392, 408], [384, 392], [408, 416], [376, 384], [416, 424], [352, 376], [424, 448],
))
const gridFrequency = metric('frequency', '频率', 'Hz', 2, outsideBands(
  [49.9, 50.1], [49.8, 49.9], [50.1, 50.2], [49.5, 49.8], [50.2, 50.5], [48.8, 49.5], [50.5, 51.2],
))
const equipmentFrequency = metric('frequency', '频率', 'Hz', 1, outsideBands(
  [49.8, 50.2], [49.5, 49.8], [50.2, 50.5], [49, 49.5], [50.5, 51], [48, 49], [51, 52],
))
const loadRatio = metric('loadRatio', '负载率', '%', 0, upperBands(
  [35, 75], [75, 85], [85, 100], [100, 115],
))
const moderateLoadRatio = metric('loadRatio', '负载率', '%', 0, upperBands(
  [25, 75], [75, 85], [85, 100], [100, 115],
))
const deviceTemperature = metric('deviceTemperature', '设备温度', '°C', 1, upperBands(
  [25, 55], [55, 70], [70, 85], [85, 105],
))
const transformerTemperature = metric('deviceTemperature', '绕组温度', '°C', 1, upperBands(
  [45, 75], [75, 85], [85, 95], [95, 115],
))
const batteryTemperature = metric('deviceTemperature', '电池温度', '°C', 1, upperBands(
  [20, 35], [35, 40], [40, 45], [45, 60],
))
const soc = metric('soc', '剩余电量', '%', 0, {
  normal: [range(40, 95)],
  minor: [range(25, 40)],
  major: [range(10, 25)],
  critical: [range(2, 10)],
})
const lithiumBatteryGroupSoc = metric('soc', '剩余电量', '%', 0, {
  normal: [range(82, 98)],
  minor: [range(70, 82)],
  major: [range(45, 70)],
  critical: [range(10, 45)],
})
const lithiumBatteryGroupBackupTime = metric('backupTime', '备电时间', 'h', 1, {
  normal: [range(1.6, 2)],
  minor: [range(1.1, 1.5)],
  major: [range(0.7, 1)],
  critical: [range(0.3, 0.5)],
})
const backupTime = metric('backupTime', '备电时间', 'h', 2, {
  normal: [range(0.5, 2)],
  minor: [range(0.25, 0.5)],
  major: [range(0.08, 0.25)],
  critical: [range(0.01, 0.08)],
})

const flowRate = (normal: [number, number]) => metric('flowRate', '流量', 'm³/h', 1, {
  normal: [range(...normal)],
  minor: [range(normal[0] * 0.7, normal[0]), range(normal[1], normal[1] * 1.15)],
  major: [range(normal[0] * 0.4, normal[0] * 0.7), range(normal[1] * 1.15, normal[1] * 1.35)],
  critical: [range(normal[0] * 0.1, normal[0] * 0.4), range(normal[1] * 1.35, normal[1] * 1.6)],
})
const pressure = (normal: [number, number]) => metric('pressure', '压力', 'kPa', 0, outsideBands(
  normal,
  [normal[0] * 0.8, normal[0]], [normal[1], normal[1] * 1.12],
  [normal[0] * 0.6, normal[0] * 0.8], [normal[1] * 1.12, normal[1] * 1.28],
  [normal[0] * 0.3, normal[0] * 0.6], [normal[1] * 1.28, normal[1] * 1.5],
))
const pumpFrequency = metric('frequency', '频率', 'Hz', 1, upperBands(
  [30, 50], [50, 55], [55, 60], [60, 66],
))
const supplyTemperature = (normal: [number, number]) => metric(
  'supplyTemperature', '供水温度', '°C', 1,
  outsideBands(
    normal,
    [normal[0] - 2, normal[0]], [normal[1], normal[1] + 2],
    [normal[0] - 4, normal[0] - 2], [normal[1] + 2, normal[1] + 5],
    [normal[0] - 7, normal[0] - 4], [normal[1] + 5, normal[1] + 9],
  ),
)
const measurementTemperature = metric('deviceTemperature', '温度', '°C', 1, {
  normal: [range(16, 32)],
  minor: [range(14, 16), range(32, 34)],
  major: [range(10, 14), range(34, 38)],
  critical: [range(5, 10), range(38, 45)],
})
const returnTemperature = (normal: [number, number]) => metric(
  'returnTemperature', '回水温度', '°C', 1,
  outsideBands(
    normal,
    [normal[0] - 2, normal[0]], [normal[1], normal[1] + 3],
    [normal[0] - 4, normal[0] - 2], [normal[1] + 3, normal[1] + 6],
    [normal[0] - 7, normal[0] - 4], [normal[1] + 6, normal[1] + 10],
  ),
)
const deltaTemperature = metric('deltaTemperature', '温差', '°C', 1, outsideBands(
  [5, 10], [3, 5], [10, 12], [2, 3], [12, 15], [0.5, 2], [15, 18],
))
const differentialPressure = metric('differentialPressure', '压差', 'kPa', 0, upperBands(
  [20, 80], [80, 110], [110, 150], [150, 190],
))
const valvePosition = metric('valvePosition', '阀门开度', '%', 0, {
  normal: [range(85, 100)],
  minor: [range(70, 85)],
  major: [range(20, 70)],
  critical: [range(0, 20)],
})
const tankLevel = metric('level', '液位', '%', 0, outsideBands(
  [40, 85], [25, 40], [85, 92], [10, 25], [92, 98], [1, 10], [98, 100],
))

const activePower = (normal: [number, number], unit = 'kW') => metric(
  'activePower', '有功功率', unit, unit === 'MW' ? 2 : 0,
  upperBands(
    normal,
    [normal[1], normal[1] * 1.13],
    [normal[1] * 1.13, normal[1] * 1.33],
    [normal[1] * 1.33, normal[1] * 1.55],
  ),
)
const cabinetActivePower = metric('activePower', '有功功率', 'kW', 1, upperBands(
  [3, 10], [10, 12], [12, 14], [14, 17],
))

export const DEMO_DEVICE_PROFILES: DemoDeviceProfile[] = [
  { id: 'grid', assetKeys: ['grid'], operation: 'running', metrics: [voltage10kV, activePower([800, 1800]), gridFrequency] },
  { id: 'supply', assetKeys: ['supply'], operation: 'running', metrics: [voltage400V, activePower([300, 1000]), equipmentFrequency] },
  { id: 'load', assetKeys: ['load'], operation: 'running', metrics: [activePower([100, 800]), moderateLoadRatio, deviceTemperature] },
  { id: 'converter', assetKeys: ['ac-ac-converter', 'rectifier', 'inverter'], operation: 'running', metrics: [voltage400V, moderateLoadRatio, deviceTemperature] },
  { id: 'generator', assetKeys: ['generator'], operation: 'running', metrics: [activePower([300, 800]), equipmentFrequency, voltage400V] },
  { id: 'transformer', assetKeys: ['transformer'], operation: 'running', metrics: [loadRatio, transformerTemperature, voltage400V] },
  { id: 'ups', assetKeys: ['ups', 'ups-group'], operation: 'running', metrics: [moderateLoadRatio, voltage400V, backupTime] },
  { id: 'battery', assetKeys: ['battery'], operation: 'discharging', metrics: [soc, batteryTemperature, backupTime] },
  { id: 'battery-group', assetKeys: ['battery-group'], operation: 'discharging', metrics: [lithiumBatteryGroupSoc, batteryTemperature, lithiumBatteryGroupBackupTime] },
  { id: 'switch', assetKeys: ['switch'], operation: 'closed', metrics: [deviceTemperature, statusMetric('closed', '闭合')] },
  { id: 'tap-off', assetKeys: ['cabinet', 'cabinet-b', 'tap-off-unit'], operation: 'running', metrics: [activePower([0.2, 0.75], 'MW'), moderateLoadRatio, deviceTemperature] },
  { id: 'cabinet', assetKeys: ['cabinet-device'], operation: 'running', metrics: [cabinetActivePower, metric('inletTemperature', '进风温度', '°C', 1, upperBands([20, 27], [27, 30], [30, 35], [35, 42]))] },
  { id: 'pod', assetKeys: ['fm', 'compute-pod', 'power-pod'], operation: 'running', metrics: [loadRatio, activePower([300, 1000])] },
  { id: 'cdu', assetKeys: ['cdu'], operation: 'running', metrics: [supplyTemperature([16, 22]), returnTemperature([24, 32]), deltaTemperature, flowRate([60, 160])] },
  { id: 'tmu', assetKeys: ['tmu'], operation: 'running', metrics: [supplyTemperature([18, 24]), returnTemperature([26, 34]), deltaTemperature, flowRate([20, 80])] },
  { id: 'chwp', assetKeys: ['chwp'], operation: 'running', metrics: [flowRate([70, 110]), pressure([250, 450]), pumpFrequency, supplyTemperature([16, 24])] },
  { id: 'cwp', assetKeys: ['cwp'], operation: 'running', metrics: [flowRate([70, 110]), pressure([200, 400]), pumpFrequency, supplyTemperature([28, 36])] },
  { id: 'ct', assetKeys: ['ct'], operation: 'running', metrics: [supplyTemperature([24, 32]), pumpFrequency, pressure([150, 350]), statusMetric('running')] },
  { id: 'phe', assetKeys: ['phe'], operation: 'running', metrics: [deltaTemperature, differentialPressure] },
  {
    id: 'mp',
    assetKeys: ['mp'],
    operation: 'running',
    metrics: [
      flowRate([40, 120]),
      pressure([200, 450]),
      measurementTemperature,
      supplyTemperature([16, 24]),
      returnTemperature([24, 32]),
    ],
  },
  { id: 'wmt', assetKeys: ['wmt'], operation: 'running', metrics: [tankLevel, statusMetric('running')] },
  { id: 'cpd', assetKeys: ['cpd'], operation: 'running', metrics: [pressure([200, 450]), statusMetric('running')] },
  { id: 'valve', assetKeys: ['2-wv', 'cv'], operation: 'open', metrics: [valvePosition, flowRate([20, 100]), pressure([150, 400]), supplyTemperature([16, 32]), statusMetric('open', '开启')] },
  { id: 'generic', assetKeys: ['generic'], operation: 'running', metrics: [statusMetric('running')] },
]

const profilesByAssetKey = new Map(DEMO_DEVICE_PROFILES.flatMap((profile) => (
  profile.assetKeys.map((assetKey) => [assetKey, profile] as const)
)))

export function stableDemoHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function stableDemoUnit(value: string) {
  return stableDemoHash(value) / 0xffffffff
}

export function normalizeDemoMetricUnit(unit: string | undefined) {
  const trimmed = unit?.trim() ?? ''
  if (/^hz$/i.test(trimmed)) return 'Hz'
  if (/^(?:m²|m2|³m|m3)\/h$/i.test(trimmed)) return 'm³/h'
  if (trimmed === '℃') return '°C'
  return trimmed
}

export function demoDeviceProfileForAsset(assetKey: string) {
  return profilesByAssetKey.get(assetKey)
}

export function inferDemoMetricSemantic(metricValue: MonitorMetric): DemoMetricSemanticKey | null {
  const name = metricValue.name.trim().toLowerCase()
  if (/(通信|通讯|communication)/i.test(name)) return 'communication'
  if (/(运行状态|运营状态|设备状态|^状态$|status)/i.test(name)) return 'status'
  if (/(soc|剩余电量|荷电状态|电池电量)/i.test(name)) return 'soc'
  if (/(备电|后备时间|backup)/i.test(name)) return 'backupTime'
  if (/(功率因数|power factor|\bpf\b)/i.test(name)) return 'powerFactor'
  if (/(负载率|负荷率|load ratio|load%)/i.test(name)) return 'loadRatio'
  if (/(有功功率|功率|active power|power)/i.test(name)) return 'activePower'
  if (/(线电压|相电压|电压|voltage)/i.test(name)) return 'lineVoltage'
  if (/(频率|frequency)/i.test(name)) return 'frequency'
  if (/(压差|差压|differential pressure|delta p)/i.test(name)) return 'differentialPressure'
  if (/(压力|pressure)/i.test(name)) return 'pressure'
  if (/(阀门开度|阀位|valve position|opening)/i.test(name)) return 'valvePosition'
  if (/(流量|flow)/i.test(name)) return 'flowRate'
  if (/(液位|水位|level)/i.test(name)) return 'level'
  if (/(温差|delta t|Δt)/i.test(name)) return 'deltaTemperature'
  if (/(回水|回液|return).*温|回水温度/i.test(name)) return 'returnTemperature'
  if (/(供水|出水|送水|supply).*温|出水温度/i.test(name)) return 'supplyTemperature'
  if (/(进风|inlet).*温|进风温度/i.test(name)) return 'inletTemperature'
  if (/(温度|temperature)/i.test(name)) return 'deviceTemperature'
  return null
}

function temperatureSemantic(semanticKey: DemoMetricSemanticKey) {
  return [
    'deviceTemperature',
    'inletTemperature',
    'supplyTemperature',
    'returnTemperature',
    'deltaTemperature',
  ].includes(semanticKey)
}

export function demoMetricProfileFor(
  assetKey: string | undefined,
  metricValue: MonitorMetric,
) {
  const profile = assetKey ? demoDeviceProfileForAsset(assetKey) : undefined
  const semanticKey = inferDemoMetricSemantic(metricValue)
  if (!profile || !semanticKey) return null
  return profile.metrics.find((candidate) => candidate.semanticKey === semanticKey)
    ?? (temperatureSemantic(semanticKey)
      ? profile.metrics.find((candidate) => temperatureSemantic(candidate.semanticKey))
      : undefined)
    ?? null
}

function alarmForBands(bands: DemoMetricBands) {
  const normalLow = bands.normal[0].min
  const normalHigh = bands.normal.at(-1)!.max
  const hasLow = [...bands.minor, ...bands.major, ...bands.critical]
    .some((item) => item.max <= normalLow)
  const hasHigh = [...bands.minor, ...bands.major, ...bands.critical]
    .some((item) => item.min >= normalHigh)
  if (hasLow && hasHigh) {
    return {
      mode: 'outside' as const,
      criticalLow: Math.min(...bands.critical.map((item) => item.max)),
      majorLow: Math.min(...bands.major.map((item) => item.max)),
      minorLow: Math.min(...bands.minor.map((item) => item.max)),
      minorHigh: Math.max(...bands.minor.map((item) => item.min)),
      majorHigh: Math.max(...bands.major.map((item) => item.min)),
      criticalHigh: Math.max(...bands.critical.map((item) => item.min)),
    }
  }
  if (hasLow) {
    return {
      mode: 'lower' as const,
      critical: bands.critical[0].max,
      major: bands.major[0].max,
      minor: bands.minor[0].max,
    }
  }
  return {
    mode: 'upper' as const,
    minor: bands.minor[0].min,
    major: bands.major[0].min,
    critical: bands.critical[0].min,
  }
}

export function createDemoMonitorMetric(
  assetKey: string,
  metricProfile: DemoMetricProfile,
): MonitorMetric {
  const id = `demo-${assetKey}-${metricProfile.semanticKey}`
  if (metricProfile.textValues) {
    const entries = Object.entries(metricProfile.textValues) as [DemoHealthState, string][]
    return {
      id,
      name: metricProfile.name,
      valueType: 'text',
      textOptions: entries.map(([severity, value]) => ({
        id: `${id}-${severity}`,
        value,
        severity: severity === 'offline' ? 'critical' : severity,
      })),
    }
  }
  const bands = metricProfile.bands!
  const allRanges = Object.values(bands).flat()
  return {
    id,
    name: metricProfile.name,
    valueType: 'number',
    unit: metricProfile.unit,
    precision: metricProfile.precision,
    simulationMin: Math.min(...allRanges.map((item) => item.min)),
    simulationMax: Math.max(...allRanges.map((item) => item.max)),
    alarm: alarmForBands(bands),
  }
}

export function defaultDemoMetricsForElement(element: Pick<DiagramElement, 'assetKey'>) {
  const profile = demoDeviceProfileForAsset(element.assetKey)
  if (!profile) return []
  return profile.metrics.slice(0, 2).map((item) => createDemoMonitorMetric(element.assetKey, item))
}

export function demoAnomalyCount(deviceCount: number, seedKey: string) {
  if (deviceCount <= 0) return 0
  if (deviceCount <= 7) return 1
  if (deviceCount <= 30) return 1 + stableDemoHash(`${seedKey}:count`) % 2
  return 2 + stableDemoHash(`${seedKey}:count`) % 2
}

const DEMO_OFFLINE_SAFE_ASSET_KEYS = new Set([
  'cabinet-device',
  'battery',
  'ups-group',
])

export function canDemoDeviceGoOffline(assetKey: string) {
  return DEMO_OFFLINE_SAFE_ASSET_KEYS.has(assetKey)
}

function derivedSeverity(seedKey: string): DemoFaultAssignment['severity'] {
  const sample = stableDemoHash(`${seedKey}:severity`) % 100
  if (sample < 58) return 'minor'
  if (sample < 88) return 'major'
  if (sample < 97) return 'critical'
  return 'offline'
}

export function createDemoAnomalyAssignments(
  elements: readonly Pick<DiagramElement, 'id' | 'diagramId' | 'assetKey' | 'monitorDataVisible'>[],
  seed = DEFAULT_DEMO_SIMULATION_SEED,
) {
  const result: Record<string, DemoFaultAssignment> = {}
  const byDiagram = new Map<string, typeof elements[number][]>()
  elements.forEach((element) => {
    if (!demoDeviceProfileForAsset(element.assetKey) || element.monitorDataVisible === false) return
    const current = byDiagram.get(element.diagramId) ?? []
    current.push(element)
    byDiagram.set(element.diagramId, current)
  })
  ;[...byDiagram.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([
    diagramId,
    candidates,
  ]) => {
    const count = demoAnomalyCount(candidates.length, `${seed}:${diagramId}`)
    candidates
      .map((element) => ({
        element,
        score: stableDemoHash(`${seed}:${diagramId}:${element.id}`),
      }))
      .sort((left, right) => left.score - right.score || left.element.id.localeCompare(right.element.id))
      .slice(0, count)
      .forEach(({ element }) => {
        const derived = derivedSeverity(`${seed}:${diagramId}:${element.id}`)
        const severity = derived === 'offline' && !canDemoDeviceGoOffline(element.assetKey)
          ? 'critical'
          : derived
        result[element.id] = {
          severity,
          faultCode: severity === 'offline' ? 'communication-offline' : 'profile-anomaly',
        }
      })
  })
  return result
}

export function createDemoDeviceRuntimeState(
  assetKey: string | undefined,
  assignment?: DemoFaultAssignment,
  runtimeOperation?: 'on' | 'off' | 'running' | 'stopped' | 'standby',
): DemoDeviceRuntimeState {
  const profile = assetKey ? demoDeviceProfileForAsset(assetKey) : undefined
  const health = assignment?.severity ?? 'normal'
  const operation = runtimeOperation === 'on'
    ? profile?.operation === 'open' ? 'open' : profile?.operation === 'closed' ? 'closed' : 'running'
    : runtimeOperation === 'off'
      ? profile?.operation === 'open' || profile?.operation === 'closed' ? 'closed' : 'stopped'
      : runtimeOperation ?? profile?.operation ?? 'running'
  return {
    health,
    operation: health === 'offline' ? 'stopped' : operation,
    online: health !== 'offline',
    ...(assignment ? { faultCode: assignment.faultCode } : {}),
  }
}
