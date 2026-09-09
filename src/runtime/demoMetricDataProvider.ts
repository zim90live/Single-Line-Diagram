import type { MonitorAlarmSeverity, MonitorMetric } from '../domain/project'
import {
  monitorMetricReadingKey,
  type MonitorMetricOwner,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'
import {
  DEFAULT_DEMO_SIMULATION_SEED,
  createDemoAnomalyAssignments,
  createDemoDeviceRuntimeState,
  defaultDemoMetricsForElement,
  demoDeviceProfileForAsset,
  demoMetricProfileFor,
  inferDemoMetricSemantic,
  normalizeDemoMetricUnit,
  stableDemoHash,
  type DemoDeviceRuntimeState,
  type DemoFaultAssignment,
  type DemoHealthState,
  type DemoMetricProfile,
  type DemoValueRange,
} from './demoSimulationProfiles'
import type {
  MonitorMetricDataProvider,
  MonitorMetricRuntimeSnapshot,
} from './metricDataProvider'

export const DEMO_METRIC_REFRESH_MS = 3_000

export interface DemoMonitorMetricOwner extends MonitorMetricOwner {
  diagramId?: string
  assetKey?: string
  monitorDataVisible?: boolean
  runtimeOperation?: 'on' | 'off' | 'running' | 'stopped' | 'standby'
}

export interface DemoMonitorMetricDataProviderOptions {
  seed?: string
  anomalyAssignments?: Record<string, DemoFaultAssignment>
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function rounded(value: number, precision: number) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function targetRange(
  profile: DemoMetricProfile,
  severity: MonitorAlarmSeverity,
  key: string,
) {
  const ranges = profile.bands?.[severity]
  return ranges?.[stableDemoHash(`${key}:range`) % ranges.length]
}

function sampleRange(valueRange: DemoValueRange, key: string, tick: number, precision: number) {
  const phase = stableDemoHash(`${key}:phase`) / 0xffffffff * Math.PI * 2
  const commonPhase = stableDemoHash(key.split(':').slice(0, 2).join(':'))
    / 0xffffffff * Math.PI * 2
  const commonWave = Math.sin(tick * 0.11 + commonPhase) * 0.12
  const deviceWave = Math.sin(tick * 0.19 + phase) * 0.18
  const secondaryWave = Math.sin(tick * 0.071 + phase * 1.7) * 0.06
  const position = clamp(0.5 + commonWave + deviceWave + secondaryWave, 0.08, 0.92)
  return rounded(valueRange.min + (valueRange.max - valueRange.min) * position, precision)
}

function normalizedConfiguredMetric(
  metric: MonitorMetric,
  assetKey: string | undefined,
): MonitorMetric {
  if (metric.valueType === 'text') return metric
  const unit = normalizeDemoMetricUnit(metric.unit)
  const precision = assetKey === 'battery-group' &&
    inferDemoMetricSemantic(metric) === 'backupTime' &&
    metric.precision === 0
      ? 1
      : metric.precision
  return unit === metric.unit && precision === metric.precision
    ? metric
    : { ...metric, unit, precision }
}

function fallbackRangeForMetric(
  metric: Extract<MonitorMetric, { valueType: 'number' }>,
  severity: MonitorAlarmSeverity,
): DemoValueRange {
  const span = metric.simulationMax - metric.simulationMin
  const alarm = metric.alarm
  if (alarm.mode === 'upper') {
    if (severity === 'normal') return { min: metric.simulationMin + span * 0.25, max: alarm.minor * 0.95 }
    if (severity === 'minor') return { min: alarm.minor, max: alarm.major }
    if (severity === 'major') return { min: alarm.major, max: alarm.critical }
    return { min: alarm.critical, max: Math.max(metric.simulationMax, alarm.critical + span * 0.2) }
  }
  if (alarm.mode === 'lower') {
    if (severity === 'normal') return { min: alarm.minor * 1.05, max: metric.simulationMax - span * 0.1 }
    if (severity === 'minor') return { min: alarm.major, max: alarm.minor }
    if (severity === 'major') return { min: alarm.critical, max: alarm.major }
    return { min: Math.min(metric.simulationMin, alarm.critical - span * 0.2), max: alarm.critical }
  }
  if (severity === 'normal') return { min: alarm.minorLow, max: alarm.minorHigh }
  const useLow = stableDemoHash(`${metric.id}:${severity}:side`) % 2 === 0
  if (severity === 'minor') return useLow
    ? { min: alarm.majorLow, max: alarm.minorLow }
    : { min: alarm.minorHigh, max: alarm.majorHigh }
  if (severity === 'major') return useLow
    ? { min: alarm.criticalLow, max: alarm.majorLow }
    : { min: alarm.majorHigh, max: alarm.criticalHigh }
  return useLow
    ? { min: metric.simulationMin, max: alarm.criticalLow }
    : { min: alarm.criticalHigh, max: metric.simulationMax }
}

function textReading(
  metric: Extract<MonitorMetric, { valueType: 'text' }>,
  severity: DemoHealthState,
  profile?: DemoMetricProfile | null,
  runtimeOperation?: DemoMonitorMetricOwner['runtimeOperation'],
) {
  if (severity === 'offline') return { value: '离线', severity: 'critical' as const }
  if (metric.name.trim() === '供电方式') {
    const main = metric.textOptions.find((option) => /^主路(?:供电)?$/.test(option.value.trim()))
    const bypass = metric.textOptions.find((option) => /^旁路(?:供电)?$/.test(option.value.trim()))
    if (severity !== 'normal' && bypass) {
      return { value: bypass.value, severity: bypass.severity === 'normal' ? 'minor' as const : bypass.severity }
    }
    if (main) return { value: main.value, severity: 'normal' as const }
  }
  if (severity === 'normal' && runtimeOperation) {
    const value = runtimeOperation === 'off'
      ? '关闭'
      : runtimeOperation === 'stopped'
        ? '停机'
        : runtimeOperation === 'standby'
          ? '待机'
          : runtimeOperation === 'on'
            ? '开启'
            : '运行'
    return { value, severity: 'normal' as const }
  }
  const profileValue = profile?.textValues?.[severity]
  if (profileValue) return {
    value: profileValue,
    severity: severity as MonitorAlarmSeverity,
  }
  const option = metric.textOptions.find((item) => item.severity === severity)
    ?? metric.textOptions.find((item) => item.severity === 'normal')
    ?? metric.textOptions[0]
  return { value: option.value, severity: severity === 'normal' ? option.severity : severity }
}

function primaryMetricIndex(
  owner: DemoMonitorMetricOwner,
  metrics: readonly MonitorMetric[],
  seed: string,
) {
  if (!metrics.length) return -1
  const eligibleIndexes = owner.assetKey === 'battery-group'
    ? metrics.flatMap((metric, index) => (
        inferDemoMetricSemantic(metric) === 'soc' ? [] : [index]
      ))
    : metrics.map((_, index) => index)
  const candidates = eligibleIndexes.length ? eligibleIndexes : metrics.map((_, index) => index)
  return candidates[stableDemoHash(`${seed}:${owner.id}:primary`) % candidates.length]
}

function lithiumBatteryGroupSocValue(
  owner: DemoMonitorMetricOwner,
  metrics: readonly MonitorMetric[],
  seed: string,
  tick: number,
) {
  if (owner.assetKey !== 'battery-group') return null
  const metric = metrics.find((candidate) => (
    candidate.valueType === 'number' && inferDemoMetricSemantic(candidate) === 'soc'
  ))
  if (!metric || metric.valueType !== 'number') return null
  const profile = demoMetricProfileFor(owner.assetKey, metric)
  const rangeValue = profile
    ? targetRange(profile, 'normal', `${seed}:${owner.id}:${metric.id}`)
    : fallbackRangeForMetric(metric, 'normal')
  return sampleRange(
    rangeValue ?? { min: metric.simulationMin, max: metric.simulationMax },
    `${seed}:${owner.id}:${metric.id}`,
    tick,
    metric.precision,
  )
}

function lithiumBatteryGroupBackupTime(
  socValue: number,
  severity: MonitorAlarmSeverity,
  precision: number,
) {
  const usableCapacityFactor: Record<MonitorAlarmSeverity, number> = {
    normal: 1,
    minor: 0.72,
    major: 0.45,
    critical: 0.22,
  }
  const ratedBackupHoursAtFullCharge = 2
  return rounded(
    ratedBackupHoursAtFullCharge * socValue / 100 * usableCapacityFactor[severity],
    Math.max(1, precision),
  )
}

export class DemoMonitorMetricDataProvider implements MonitorMetricDataProvider {
  readonly mode = 'demo' as const
  readonly refreshMs = DEMO_METRIC_REFRESH_MS
  readonly seed: string
  readonly fixedAssignments?: Record<string, DemoFaultAssignment>
  private tick = 0
  private preparedAssignments: Record<string, DemoFaultAssignment> = {}

  constructor(options: DemoMonitorMetricDataProviderOptions = {}) {
    this.seed = options.seed ?? DEFAULT_DEMO_SIMULATION_SEED
    this.fixedAssignments = options.anomalyAssignments
  }

  prepareOwners(owners: readonly DemoMonitorMetricOwner[]): DemoMonitorMetricOwner[] {
    const elementOwners = owners.filter((owner) => owner.assetKey && owner.diagramId)
    this.preparedAssignments = this.fixedAssignments ?? createDemoAnomalyAssignments(
      elementOwners.map((owner) => ({
        id: owner.id,
        diagramId: owner.diagramId!,
        assetKey: owner.assetKey!,
        monitorDataVisible: owner.monitorDataVisible,
      })),
      this.seed,
    )
    return owners.map((owner) => {
      const assignment = this.preparedAssignments[owner.id]
      const configured = (owner.monitorMetrics ?? []).map((metric) => (
        normalizedConfiguredMetric(metric, owner.assetKey)
      ))
      const deviceProfile = owner.assetKey ? demoDeviceProfileForAsset(owner.assetKey) : undefined
      const compatible = deviceProfile ? configured.filter((item) => (
        demoMetricProfileFor(owner.assetKey, item) || inferDemoMetricSemantic(item) === null
      )) : configured
      const configuredForRuntime = configured.length > 0 && compatible.length === 0 && owner.assetKey
        ? defaultDemoMetricsForElement({ assetKey: owner.assetKey })
        : compatible
      if (configuredForRuntime.length || !assignment || !owner.assetKey || owner.monitorDataVisible === false) {
        return {
          ...owner,
          ...(assignment && owner.monitorDataVisible === undefined
            ? { monitorDataVisible: true }
            : {}),
          monitorMetrics: configuredForRuntime,
        }
      }
      return {
        ...owner,
        monitorDataVisible: true,
        monitorMetrics: defaultDemoMetricsForElement({ assetKey: owner.assetKey }),
      }
    })
  }

  getRuntimeSnapshot(owners: readonly DemoMonitorMetricOwner[]): MonitorMetricRuntimeSnapshot {
    const assignments = this.fixedAssignments ?? (
      Object.keys(this.preparedAssignments).length
        ? this.preparedAssignments
        : createDemoAnomalyAssignments(owners.flatMap((owner) => (
            owner.assetKey && owner.diagramId ? [{
              id: owner.id,
              diagramId: owner.diagramId,
              assetKey: owner.assetKey,
              monitorDataVisible: owner.monitorDataVisible,
            }] : []
          )), this.seed)
    )
    const readings: MonitorMetricReadings = {}
    const deviceStates: Record<string, DemoDeviceRuntimeState> = {}
    owners.forEach((owner) => {
      const assignment = assignments[owner.id]
      const deviceState = createDemoDeviceRuntimeState(
        owner.assetKey,
        assignment,
        owner.runtimeOperation,
      )
      if (owner.assetKey) deviceStates[owner.id] = deviceState
      const metrics = owner.monitorMetrics ?? []
      const primaryIndex = primaryMetricIndex(owner, metrics, this.seed)
      const linkedSocValue = lithiumBatteryGroupSocValue(
        owner,
        metrics,
        this.seed,
        this.tick,
      )
      metrics.forEach((metric, index) => {
        const targetHealth: DemoHealthState = assignment && index === primaryIndex
          ? assignment.severity
          : 'normal'
        const readingKey = monitorMetricReadingKey(owner.id, metric.id)
        if (targetHealth === 'offline') {
          readings[readingKey] = {
            elementId: owner.id,
            metricId: metric.id,
            value: '--',
            severity: 'critical',
          }
          return
        }
        if (metric.valueType === 'text') {
          const value = textReading(
            metric,
            targetHealth,
            demoMetricProfileFor(owner.assetKey, metric),
            owner.runtimeOperation,
          )
          readings[readingKey] = {
            elementId: owner.id,
            metricId: metric.id,
            ...value,
          }
          return
        }
        const profile = demoMetricProfileFor(owner.assetKey, metric)
        const semanticKey = profile?.semanticKey ?? inferDemoMetricSemantic(metric)
        if (
          owner.assetKey === 'battery-group' &&
          semanticKey === 'backupTime' &&
          linkedSocValue !== null
        ) {
          readings[readingKey] = {
            elementId: owner.id,
            metricId: metric.id,
            value: lithiumBatteryGroupBackupTime(
              linkedSocValue,
              targetHealth,
              metric.precision,
            ),
            severity: targetHealth,
          }
          return
        }
        const inactive = ['off', 'stopped', 'standby'].includes(owner.runtimeOperation ?? '')
        if (
          targetHealth === 'normal' &&
          inactive &&
          ['activePower', 'flowRate', 'loadRatio', 'outputRatio'].includes(semanticKey ?? '')
        ) {
          readings[readingKey] = {
            elementId: owner.id,
            metricId: metric.id,
            value: 0,
            severity: 'normal',
          }
          return
        }
        const closedValveRange = semanticKey === 'valvePosition' && owner.runtimeOperation === 'off'
          ? ({
              normal: { min: 0, max: 5 },
              minor: { min: 5, max: 15 },
              major: { min: 15, max: 30 },
              critical: { min: 30, max: 60 },
            } satisfies Record<MonitorAlarmSeverity, DemoValueRange>)[targetHealth]
          : undefined
        const rangeValue = closedValveRange ?? (profile
          ? targetRange(profile, targetHealth, `${this.seed}:${owner.id}:${metric.id}`)
          : fallbackRangeForMetric(metric, targetHealth))
        const value = sampleRange(
          rangeValue ?? { min: metric.simulationMin, max: metric.simulationMax },
          `${this.seed}:${owner.id}:${metric.id}`,
          this.tick,
          metric.precision,
        )
        readings[readingKey] = {
          elementId: owner.id,
          metricId: metric.id,
          value,
          severity: targetHealth,
        }
      })
    })
    const snapshot = {
      timestamp: this.tick * this.refreshMs,
      readings,
      deviceStates,
    }
    return snapshot
  }

  getSnapshot(owners: readonly DemoMonitorMetricOwner[]) {
    return this.getRuntimeSnapshot(owners).readings
  }

  reset() {
    this.tick = 0
  }

  advance() {
    this.tick += 1
  }
}

export const defaultDemoMonitorMetricDataProvider = new DemoMonitorMetricDataProvider()

export function isDemoMonitorMetricDataProvider(
  provider: MonitorMetricDataProvider,
): provider is DemoMonitorMetricDataProvider {
  return provider.mode === 'demo'
}

export function createDemoMetricBindings(owners: readonly DemoMonitorMetricOwner[]) {
  return Object.fromEntries(owners.flatMap((owner) => (
    (owner.monitorMetrics ?? []).flatMap((metric) => {
      const semanticKey = inferDemoMetricSemantic(metric)
      return semanticKey ? [[monitorMetricReadingKey(owner.id, metric.id), {
        ownerId: owner.id,
        metricId: metric.id,
        semanticKey,
        normalizedUnit: metric.valueType === 'number'
          ? normalizeDemoMetricUnit(metric.unit)
          : '',
      }] as const] : []
    })
  )))
}

export function createDemoDeviceProfileRefs(owners: readonly DemoMonitorMetricOwner[]) {
  return Object.fromEntries(owners.flatMap((owner) => {
    const profile = owner.assetKey ? demoDeviceProfileForAsset(owner.assetKey) : undefined
    return profile ? [[owner.id, profile.id] as const] : []
  }))
}
