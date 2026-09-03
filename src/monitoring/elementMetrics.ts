import type {
  MonitorAlarmSeverity,
  MonitorMetric,
  MonitorMetricAlarm,
  MonitorMetricTextOption,
} from '../domain/project'

export const MONITOR_METRIC_REFRESH_MS = 30_000

export interface MonitorMetricReading {
  elementId: string
  metricId: string
  value: number | string
  severity: MonitorAlarmSeverity
}

export type MonitorMetricReadings = Record<string, MonitorMetricReading>

export interface MonitorMetricOwner {
  id: string
  diagramId?: string
  assetKey?: string
  monitorDataVisible?: boolean
  runtimeOperation?: 'on' | 'off' | 'running' | 'stopped' | 'standby'
  monitorMetrics?: MonitorMetric[]
}

const TEXT_SEVERITY_WEIGHT: Record<MonitorAlarmSeverity, number> = {
  normal: 90,
  minor: 6,
  major: 3,
  critical: 1,
}

export function monitorMetricReadingKey(elementId: string, metricId: string) {
  return `${elementId}::${metricId}`
}

export function defaultMonitorMetricAlarm(
  mode: MonitorMetricAlarm['mode'],
  simulationMin: number,
  simulationMax: number,
): MonitorMetricAlarm {
  const span = simulationMax - simulationMin
  const at = (ratio: number) => simulationMin + span * ratio
  if (mode === 'lower') {
    return { mode, critical: at(0.05), major: at(0.15), minor: at(0.3) }
  }
  if (mode === 'outside') {
    return {
      mode,
      criticalLow: at(0.05),
      majorLow: at(0.15),
      minorLow: at(0.3),
      minorHigh: at(0.7),
      majorHigh: at(0.85),
      criticalHigh: at(0.95),
    }
  }
  return { mode, minor: at(0.7), major: at(0.85), critical: at(0.95) }
}

export function createDefaultMonitorMetric(index: number): MonitorMetric {
  const simulationMin = 0
  const simulationMax = 100
  return {
    id: `monitor-metric-${crypto.randomUUID()}`,
    name: `指标 ${index + 1}`,
    valueType: 'number',
    unit: '',
    precision: 1,
    simulationMin,
    simulationMax,
    alarm: defaultMonitorMetricAlarm('upper', simulationMin, simulationMax),
  }
}

export function createDefaultMonitorTextOptions(): MonitorMetricTextOption[] {
  return [
    { id: `monitor-state-${crypto.randomUUID()}`, value: '运行', severity: 'normal' },
    { id: `monitor-state-${crypto.randomUUID()}`, value: '停机', severity: 'major' },
    { id: `monitor-state-${crypto.randomUUID()}`, value: '离线', severity: 'critical' },
  ]
}

export function cloneMonitorMetricsWithNewIds(metrics: MonitorMetric[]): MonitorMetric[] {
  return metrics.map((metric) => {
    const id = `monitor-metric-${crypto.randomUUID()}`
    if (metric.valueType === 'text') {
      return {
        ...metric,
        id,
        textOptions: metric.textOptions.map((option) => ({
          ...option,
          id: `monitor-state-${crypto.randomUUID()}`,
        })),
      }
    }
    return { ...metric, id }
  })
}

export function evaluateMonitorMetricAlarm(
  metric: MonitorMetric,
  value: number,
): MonitorAlarmSeverity {
  if (metric.valueType !== 'number') return 'normal'
  const alarm = metric.alarm
  if (alarm.mode === 'upper') {
    if (value >= alarm.critical) return 'critical'
    if (value >= alarm.major) return 'major'
    if (value >= alarm.minor) return 'minor'
    return 'normal'
  }
  if (alarm.mode === 'lower') {
    if (value <= alarm.critical) return 'critical'
    if (value <= alarm.major) return 'major'
    if (value <= alarm.minor) return 'minor'
    return 'normal'
  }
  if (value <= alarm.criticalLow || value >= alarm.criticalHigh) return 'critical'
  if (value <= alarm.majorLow || value >= alarm.majorHigh) return 'major'
  if (value <= alarm.minorLow || value >= alarm.minorHigh) return 'minor'
  return 'normal'
}

function clampRandom(random: () => number) {
  return Math.min(1 - Number.EPSILON, Math.max(0, random()))
}

function generateNumericMonitorMetricValue(
  metric: Extract<MonitorMetric, { valueType: 'number' }>,
  random: () => number,
) {
  const sample = clampRandom(random)
  const factor = 10 ** metric.precision
  return Math.round(
    (metric.simulationMin + (metric.simulationMax - metric.simulationMin) * sample) * factor,
  ) / factor
}

function selectTextMonitorMetricOption(
  metric: Extract<MonitorMetric, { valueType: 'text' }>,
  random: () => number,
) {
  const countBySeverity = metric.textOptions.reduce<Record<MonitorAlarmSeverity, number>>(
    (counts, option) => ({ ...counts, [option.severity]: counts[option.severity] + 1 }),
    { normal: 0, minor: 0, major: 0, critical: 0 },
  )
  const weightedOptions = metric.textOptions.map((option) => ({
    option,
    weight: TEXT_SEVERITY_WEIGHT[option.severity] / countBySeverity[option.severity],
  }))
  const totalWeight = weightedOptions.reduce((total, item) => total + item.weight, 0)
  let target = clampRandom(random) * totalWeight
  for (const item of weightedOptions) {
    target -= item.weight
    if (target < 0) return item.option
  }
  return weightedOptions.at(-1)!.option
}

export function generateMonitorMetricValue(
  metric: MonitorMetric,
  random = Math.random,
): number | string {
  if (metric.valueType === 'number') return generateNumericMonitorMetricValue(metric, random)
  return selectTextMonitorMetricOption(metric, random).value
}

export function generateMonitorMetricPreviewValue(metric: MonitorMetric): number | string {
  if (metric.valueType === 'number') return generateNumericMonitorMetricValue(metric, () => 0.5)
  return (metric.textOptions.find((option) => option.severity === 'normal')
    ?? metric.textOptions[0]).value
}

function createMonitorMetricReading(
  elementId: string,
  metric: MonitorMetric,
  preview: boolean,
  random: () => number,
): MonitorMetricReading {
  if (metric.valueType === 'text') {
    const option = preview
      ? metric.textOptions.find((candidate) => candidate.severity === 'normal') ?? metric.textOptions[0]
      : selectTextMonitorMetricOption(metric, random)
    return {
      elementId,
      metricId: metric.id,
      value: option.value,
      severity: option.severity,
    }
  }
  const value = preview
    ? generateNumericMonitorMetricValue(metric, () => 0.5)
    : generateNumericMonitorMetricValue(metric, random)
  return {
    elementId,
    metricId: metric.id,
    value,
    severity: evaluateMonitorMetricAlarm(metric, value),
  }
}

export function generateMonitorMetricReadings(
  owners: MonitorMetricOwner[],
  random = Math.random,
): MonitorMetricReadings {
  return Object.fromEntries(owners.flatMap((owner) => (
    (owner.monitorMetrics ?? []).map((metric) => [
      monitorMetricReadingKey(owner.id, metric.id),
      createMonitorMetricReading(owner.id, metric, false, random),
    ] as const)
  )))
}

export function generateMonitorMetricPreviewReadings(
  owners: MonitorMetricOwner[],
): MonitorMetricReadings {
  return Object.fromEntries(owners.flatMap((owner) => (
    (owner.monitorMetrics ?? []).map((metric) => [
      monitorMetricReadingKey(owner.id, metric.id),
      createMonitorMetricReading(owner.id, metric, true, Math.random),
    ] as const)
  )))
}

export function formatMonitorMetricValue(
  metric: MonitorMetric,
  value: number | string,
) {
  if (metric.valueType === 'text') return String(value)
  return typeof value === 'number' ? value.toFixed(metric.precision) : value
}

export const monitorAlarmSeverityLabel: Record<MonitorAlarmSeverity, string> = {
  normal: '正常',
  minor: '次要告警',
  major: '重要告警',
  critical: '紧急告警',
}
