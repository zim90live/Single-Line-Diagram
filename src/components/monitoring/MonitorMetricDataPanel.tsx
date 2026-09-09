import { useMemo, useState, type CSSProperties, type PointerEvent } from 'react'

import type { MonitorMetric } from '../../domain/project'
import {
  formatMonitorMetricValue,
  type MonitorMetricReading,
} from '../../monitoring/elementMetrics'
import { createMonitorTrendValues } from '../../monitoring/monitorPanelData'
import { SelectField } from '@aidc/ui'
import { MonitorTrendChart } from './MonitorTrendChart'

type MetricTrendPeriod = 'hour' | 'six-hours' | 'day'

const DATA_PERIODS = {
  hour: { label: '1小时', count: 31, minutes: 60 },
  'six-hours': { label: '6小时', count: 37, minutes: 360 },
  day: { label: '24小时', count: 49, minutes: 1440 },
} as const

export interface MonitorMetricPanelAnchor {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function panelPosition(anchor: MonitorMetricPanelAnchor) {
  const width = Math.min(360, Math.max(280, window.innerWidth - 16))
  const left = Math.min(
    window.innerWidth - width - 8,
    Math.max(8, anchor.left + anchor.width / 2 - width / 2),
  )
  const topAbove = anchor.top - 241
  const top = topAbove >= 8
    ? topAbove
    : Math.min(window.innerHeight - 241, anchor.bottom + 8)
  return { left, top, width }
}

export function MonitorMetricDataPanel({
  ownerName,
  metric,
  reading,
  anchor,
}: {
  ownerName: string
  metric: MonitorMetric
  reading?: MonitorMetricReading
  anchor: MonitorMetricPanelAnchor
}) {
  const position = panelPosition(anchor)
  const [period, setPeriod] = useState<MetricTrendPeriod>('hour')
  const [endTimestamp] = useState(() => Date.now())
  const numericMetric = metric.valueType === 'number' ? metric : null
  const numericValue = numericMetric && typeof reading?.value === 'number' ? reading.value : null
  const periodConfig = DATA_PERIODS[period]
  const series = useMemo(() => numericMetric === null || numericValue === null ? [] : [{
    id: numericMetric.id,
    label: numericMetric.name,
    color: 'primary' as const,
    values: createMonitorTrendValues({
      key: `${ownerName}:${numericMetric.id}:${period}`,
      current: numericValue,
      count: periodConfig.count,
      spread: Math.max((numericMetric.simulationMax - numericMetric.simulationMin) * 0.08, 0.5),
      minimum: numericMetric.simulationMin,
      maximum: numericMetric.simulationMax,
    }),
  }], [numericMetric, numericValue, ownerName, period, periodConfig.count])

  return (
    <section
      className="monitor-data-panel"
      role="dialog"
      aria-label={`${ownerName} ${metric.name}数据面板`}
      style={{
        '--monitor-data-left': `${position.left}px`,
        '--monitor-data-top': `${position.top}px`,
        '--monitor-data-width': `${position.width}px`,
      } as CSSProperties}
      onPointerDown={(event: PointerEvent<HTMLElement>) => event.stopPropagation()}
    >
      <header>
        <h2>{ownerName} / {metric.name}</h2>
        <SelectField
          containerClassName="monitor-data-panel__period"
          label="趋势时间范围"
          hideLabel
          value={period}
          onChange={(event) => setPeriod(event.target.value as MetricTrendPeriod)}
        >
          {Object.entries(DATA_PERIODS).map(([value, option]) => (
            <option value={value} key={value}>{option.label}</option>
          ))}
        </SelectField>
      </header>
      <div className="monitor-data-panel__body" data-severity={reading?.severity ?? 'normal'}>
        {series.length ? (
          <MonitorTrendChart
            compact
            series={series}
            unit={metric.valueType === 'number' ? metric.unit ?? '' : ''}
            ariaLabel={`${metric.name}${periodConfig.label}趋势`}
            endTimestamp={endTimestamp}
            durationMinutes={periodConfig.minutes}
          />
        ) : (
          <div className="monitor-data-panel__state">
            <span>当前状态</span>
            <strong>{reading
              ? formatMonitorMetricValue(metric, reading.value)
              : '--'}</strong>
          </div>
        )}
      </div>
    </section>
  )
}
