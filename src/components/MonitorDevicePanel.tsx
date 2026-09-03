import { useMemo, useState, type ReactNode } from 'react'

import type { DiagramElement, MonitorMetric } from '../domain/project'
import {
  monitorAlarmSeverityLabel,
  monitorMetricReadingKey,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'
import {
  createMonitorTrendValues,
  deterministicFallback,
  numericMetricForSemantic,
} from '../monitoring/monitorPanelData'
import { elementDeviceIdentifier } from '../scene/elementLabels'
import type { DemoDeviceRuntimeState } from '../runtime/demoSimulationProfiles'
import { SegmentedControl } from './ui'
import { MonitorTrendChart, type MonitorTrendSeries } from './monitoring/MonitorTrendChart'
import { UpsLineDiagram } from './monitoring/UpsLineDiagram'

type TrendPeriod = 'day' | 'week' | 'month'

const PERIOD_OPTIONS = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
] as const

const PERIOD_CONFIG: Record<TrendPeriod, { count: number; durationMinutes: number }> = {
  day: { count: 31, durationMinutes: 24 * 60 },
  week: { count: 29, durationMinutes: 7 * 24 * 60 },
  month: { count: 31, durationMinutes: 30 * 24 * 60 },
}

function formatPanelTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp)).replaceAll('/', '-')
}

function metricAlarmRows(
  ownerId: string,
  metrics: MonitorMetric[] | undefined,
  readings: MonitorMetricReadings,
) {
  return (metrics ?? []).flatMap((metric) => {
    const reading = readings[monitorMetricReadingKey(ownerId, metric.id)]
    return reading && reading.severity !== 'normal' ? [{ metric, reading }] : []
  })
}

function PanelHeader({
  title,
  diagramName,
  timestamp,
  state,
}: {
  title: string
  diagramName: string
  timestamp: number
  state?: DemoDeviceRuntimeState
}) {
  const normal = !state || state.health === 'normal'
  const statusLabel = !state || state.health === 'normal'
    ? state?.operation === 'standby' ? '正常待机' : '正常运行'
    : state.health === 'offline'
      ? '离线'
      : monitorAlarmSeverityLabel[state.health]
  return (
    <header className="monitor-device-panel__header">
      <h2 id="monitor-device-title">{title}</h2>
      <div>
        <span className="monitor-device-panel__status" data-normal={normal || undefined}>
          {state?.online === false ? '离线' : statusLabel}
        </span>
        <span>{diagramName}</span>
        <time>{formatPanelTimestamp(timestamp)}</time>
      </div>
    </header>
  )
}

function SummaryCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="monitor-device-summary__item">
      <span>{label}</span>
      <strong>{value}<small>{unit}</small></strong>
    </div>
  )
}

function ChartSection({
  title,
  series,
  unit,
  endTimestamp,
  durationMinutes,
  toolbar,
}: {
  title: string
  series: MonitorTrendSeries[]
  unit: string
  endTimestamp: number
  durationMinutes: number
  toolbar?: ReactNode
}) {
  return (
    <section className="monitor-device-section monitor-device-section--chart">
      <div className="monitor-device-section__heading">
        <h3>{title}</h3>
        {toolbar}
      </div>
      <MonitorTrendChart
        series={series}
        unit={unit}
        ariaLabel={`${title}趋势`}
        endTimestamp={endTimestamp}
        durationMinutes={durationMinutes}
      />
    </section>
  )
}

function TrendToolbar({
  series,
  period,
  onPeriodChange,
}: {
  series: MonitorTrendSeries[]
  period: TrendPeriod
  onPeriodChange: (period: TrendPeriod) => void
}) {
  return (
    <div className="monitor-device-chart-tools">
      <div className="monitor-trend__legend" aria-label="图例">
        {series.map((item) => (
          <span data-color={item.color} key={item.id}><i />{item.label}</span>
        ))}
      </div>
      <SegmentedControl
        className="monitor-device-panel__period"
        label="趋势时间范围"
        options={PERIOD_OPTIONS}
        value={period}
        onValueChange={onPeriodChange}
      />
    </div>
  )
}

function AlarmTable({
  ownerId,
  deviceLabel,
  location,
  metrics,
  readings,
  timestamp,
}: {
  ownerId: string
  deviceLabel: string
  location: string
  metrics: MonitorMetric[] | undefined
  readings: MonitorMetricReadings
  timestamp: number
}) {
  const rows = metricAlarmRows(ownerId, metrics, readings)
  return (
    <section className="monitor-device-section monitor-device-section--alarms">
      <div className="monitor-device-section__heading">
        <h3>活动告警</h3>
      </div>
      <div className="monitor-alarm-table" role="table" aria-label="活动告警">
        <div role="row" className="monitor-alarm-table__head">
          <span role="columnheader">时间</span>
          <span role="columnheader">级别</span>
          <span role="columnheader">告警名称</span>
          <span role="columnheader">告警位置</span>
        </div>
        {rows.length ? (
          rows.map(({ metric, reading }, index) => (
            <div role="row" key={metric.id}>
              <span role="cell">{new Date(timestamp - index * 173_000).toLocaleTimeString('zh-CN', { hour12: false })}</span>
              <strong role="cell" data-severity={reading.severity}>
                {monitorAlarmSeverityLabel[reading.severity].replace('告警', '')}
              </strong>
              <span role="cell">{metric.name}</span>
              <span role="cell">{location || deviceLabel}</span>
            </div>
          ))
        ) : <p className="monitor-alarm-empty">当前无活动告警</p>}
      </div>
    </section>
  )
}

function createThreePhaseSeries(
  key: string,
  current: number,
  spread: number,
  ratios: readonly [number, number, number],
  count: number,
): MonitorTrendSeries[] {
  return [
    { id: 'l1', label: 'L1', color: 'l1', ratio: ratios[0] },
    { id: 'l2', label: 'L2', color: 'l2', ratio: ratios[1] },
    { id: 'l3', label: 'L3', color: 'l3', ratio: ratios[2] },
  ].map((item) => ({
    id: item.id,
    label: item.label,
    color: item.color as MonitorTrendSeries['color'],
    values: createMonitorTrendValues({
      key: `${key}:${item.id}`,
      current: current * item.ratio,
      spread: spread * item.ratio,
      count,
      minimum: 0,
    }),
  }))
}

function ElectricalDeviceBody({
  element,
  diagramName,
  readings,
  timestamp,
}: {
  element: DiagramElement
  diagramName: string
  readings: MonitorMetricReadings
  timestamp: number
}) {
  const [period, setPeriod] = useState<TrendPeriod>('day')
  const periodConfig = PERIOD_CONFIG[period]
  const count = periodConfig.count
  const key = element.id
  const voltage = numericMetricForSemantic(key, element.monitorMetrics, readings, 'lineVoltage', {
    value: deterministicFallback(`${key}:voltage`, 176, 186),
    unit: 'V',
    precision: 1,
  })
  const power = numericMetricForSemantic(key, element.monitorMetrics, readings, 'activePower', {
    value: deterministicFallback(`${key}:power`, 840, 920),
    unit: 'kW',
    precision: 1,
  })
  const current = deterministicFallback(`${key}:current`, 92, 104)
  const voltageSeries = createThreePhaseSeries(
    `${key}:voltage:${period}`,
    voltage.value,
    Math.max(voltage.value * 0.025, 4),
    [1.24, 0.8, 0.66],
    count,
  )
  return (
    <>
      <section className="monitor-device-summary" aria-label="设备摘要">
        <SummaryCard label="三相平均电压" value={voltage.formatted} unit={voltage.unit} />
        <SummaryCard label="三相总电流" value={current.toFixed(0)} unit="A" />
        <SummaryCard label="总有功功率" value={power.formatted} unit={power.unit} />
      </section>
      <ChartSection
        title="线电压"
        unit="V"
        series={voltageSeries}
        endTimestamp={timestamp}
        durationMinutes={periodConfig.durationMinutes}
        toolbar={<TrendToolbar series={voltageSeries} period={period} onPeriodChange={setPeriod} />}
      />
      <ChartSection
        title="线电流"
        unit="A"
        series={createThreePhaseSeries(
          `${key}:current:${period}`,
          current,
          Math.max(current * 0.08, 4),
          [0.36, 0.2, 0.15],
          count,
        )}
        endTimestamp={timestamp}
        durationMinutes={periodConfig.durationMinutes}
      />
      <ChartSection
        title="有功功率"
        unit={power.unit}
        series={createThreePhaseSeries(
          `${key}:power:${period}`,
          power.value,
          Math.max(power.value * 0.04, 5),
          [1, 0.72, 0.56],
          count,
        )}
        endTimestamp={timestamp}
        durationMinutes={periodConfig.durationMinutes}
      />
      <AlarmTable
        ownerId={key}
        deviceLabel={elementDeviceIdentifier(element)}
        location={diagramName}
        metrics={element.monitorMetrics}
        readings={readings}
        timestamp={timestamp}
      />
    </>
  )
}

function UpsDeviceBody({
  element,
  diagramName,
  readings,
  timestamp,
  animationPlaying,
}: {
  element: DiagramElement
  diagramName: string
  readings: MonitorMetricReadings
  timestamp: number
  animationPlaying: boolean
}) {
  const [period, setPeriod] = useState<TrendPeriod>('day')
  const load = numericMetricForSemantic(element.id, element.monitorMetrics, readings, 'loadRatio', {
    value: deterministicFallback(`${element.id}:load`, 42, 78),
    unit: '%',
    precision: 1,
  })
  const voltage = numericMetricForSemantic(element.id, element.monitorMetrics, readings, 'lineVoltage', {
    value: deterministicFallback(`${element.id}:voltage`, 392, 405),
    unit: 'V',
    precision: 1,
  })
  const outputVoltage = voltage.value * (0.997 + deterministicFallback(
    `${element.id}:output-voltage`,
    0,
    0.004,
  ))
  const batteryLevel = deterministicFallback(`${element.id}:battery`, 82, 98)
  const inputCurrent = deterministicFallback(`${element.id}:input-current`, 368, 386)
  const outputCurrent = inputCurrent * load.value / 100
  const periodConfig = PERIOD_CONFIG[period]
  const count = periodConfig.count
  const series = useMemo(() => [{
    id: 'load-ratio',
    label: '负载率',
    color: 'primary' as const,
    values: createMonitorTrendValues({
      key: `${element.id}:load:${period}`,
      current: load.value,
      count,
      spread: 12,
      minimum: 0,
      maximum: 100,
    }),
  }], [count, element.id, load.value, period])
  return (
    <>
      <section
        className="monitor-device-section monitor-device-section--line"
        aria-label="线路画布"
      >
        <UpsLineDiagram
          inputVoltage={`${voltage.formatted}${voltage.unit}`}
          outputVoltage={`${outputVoltage.toFixed(1)}${voltage.unit}`}
          batteryLevel={`${Math.round(batteryLevel)}%`}
          inputCurrent={`${inputCurrent.toFixed(1)}A`}
          outputCurrent={`${outputCurrent.toFixed(1)}A`}
          animationPlaying={animationPlaying}
        />
      </section>
      <AlarmTable
        ownerId={element.id}
        deviceLabel={elementDeviceIdentifier(element)}
        location={diagramName}
        metrics={element.monitorMetrics}
        readings={readings}
        timestamp={timestamp}
      />
      <section className="monitor-device-section monitor-device-section--chart">
        <div className="monitor-device-section__heading">
          <h3>负载率趋势</h3>
          <SegmentedControl
            className="monitor-device-panel__period"
            label="负载率趋势时间范围"
            options={PERIOD_OPTIONS}
            value={period}
            onValueChange={setPeriod}
          />
        </div>
        <MonitorTrendChart
          series={series}
          unit="%"
          ariaLabel="UPS负载率趋势"
          endTimestamp={timestamp}
          durationMinutes={periodConfig.durationMinutes}
        />
      </section>
    </>
  )
}

export function MonitorDevicePanel({
  element,
  diagramName,
  timestamp,
  readings,
  deviceState,
  animationPlaying = false,
}: {
  element: DiagramElement
  diagramName: string
  timestamp: number
  readings: MonitorMetricReadings
  deviceState?: DemoDeviceRuntimeState
  animationPlaying?: boolean
}) {
  const title = elementDeviceIdentifier(element)
  const panelType = element.assetKey === 'ups' ? 'ups' : element.assetKey === 'generator' ? 'generator' : 'mlvr'
  return (
    <aside
      className="properties-panel monitor-device-panel"
      data-panel-type={panelType}
      aria-labelledby="monitor-device-title"
    >
      <PanelHeader
        title={title}
        diagramName={diagramName}
        timestamp={timestamp}
        state={deviceState}
      />
      {panelType === 'ups' ? (
        <UpsDeviceBody
          element={element}
          diagramName={diagramName}
          readings={readings}
          timestamp={timestamp}
          animationPlaying={animationPlaying}
        />
      ) : (
        <ElectricalDeviceBody
          element={element}
          diagramName={diagramName}
          readings={readings}
          timestamp={timestamp}
        />
      )}
    </aside>
  )
}
