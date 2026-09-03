import type { MonitorAlarmSeverity, MonitorMetric } from '../domain/project'
import {
  formatMonitorMetricValue,
  monitorMetricReadingKey,
  type MonitorMetricReadings,
} from './elementMetrics'
import {
  inferDemoMetricSemantic,
  stableDemoHash,
  type DemoMetricSemanticKey,
} from '../runtime/demoSimulationProfiles'

export interface MonitorPanelMetricValue {
  metric?: MonitorMetric
  value: number
  formatted: string
  unit: string
  severity: MonitorAlarmSeverity
}

export function numericMetricForSemantic(
  ownerId: string,
  metrics: MonitorMetric[] | undefined,
  readings: MonitorMetricReadings,
  semantic: DemoMetricSemanticKey,
  fallback: { value: number; unit: string; precision?: number },
): MonitorPanelMetricValue {
  const metric = metrics?.find((candidate) => (
    candidate.valueType === 'number' && inferDemoMetricSemantic(candidate) === semantic
  ))
  const reading = metric ? readings[monitorMetricReadingKey(ownerId, metric.id)] : undefined
  const value = typeof reading?.value === 'number' ? reading.value : fallback.value
  return {
    metric,
    value,
    formatted: metric
      ? formatMonitorMetricValue(metric, value)
      : value.toFixed(fallback.precision ?? 1),
    unit: metric?.valueType === 'number' ? metric.unit ?? fallback.unit : fallback.unit,
    severity: reading?.severity ?? 'normal',
  }
}

export function createMonitorTrendValues({
  key,
  current,
  count = 24,
  spread = Math.max(Math.abs(current) * 0.08, 1),
  minimum,
  maximum,
}: {
  key: string
  current: number
  count?: number
  spread?: number
  minimum?: number
  maximum?: number
}) {
  const seed = stableDemoHash(key)
  const phase = (seed % 360) * Math.PI / 180
  const values = Array.from({ length: Math.max(2, count) }, (_, index) => {
    const ratio = index / Math.max(1, count - 1)
    const wave = Math.sin(phase + ratio * Math.PI * 3.2) * 0.56 +
      Math.sin(phase * 0.37 + ratio * Math.PI * 7.4) * 0.22
    const drift = (ratio - 1) * spread * (((seed >>> 8) % 21) - 10) / 50
    const value = current + wave * spread + drift
    return Math.min(maximum ?? Number.POSITIVE_INFINITY, Math.max(
      minimum ?? Number.NEGATIVE_INFINITY,
      value,
    ))
  })
  values[values.length - 1] = Math.min(maximum ?? Number.POSITIVE_INFINITY, Math.max(
    minimum ?? Number.NEGATIVE_INFINITY,
    current,
  ))
  return values
}

export function deterministicFallback(key: string, min: number, max: number) {
  return min + (stableDemoHash(key) / 0xffffffff) * (max - min)
}
