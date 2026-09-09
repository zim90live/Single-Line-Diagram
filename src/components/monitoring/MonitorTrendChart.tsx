import { useId, useMemo } from 'react'

export interface MonitorTrendSeries {
  id: string
  label: string
  color: 'l1' | 'l2' | 'l3' | 'primary'
  values: number[]
}

interface ChartGeometry {
  width: number
  height: number
  left: number
  top: number
  bottom: number
}

const STANDARD_GEOMETRY: ChartGeometry = {
  width: 452,
  height: 160,
  left: 34,
  top: 15,
  bottom: 143,
}

const COMPACT_GEOMETRY: ChartGeometry = {
  width: 336,
  height: 177,
  left: 16,
  top: 21,
  bottom: 160,
}

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
})

function formatTimeTick(timestamp: number, durationMinutes: number) {
  return durationMinutes <= 24 * 60
    ? TIME_FORMATTER.format(new Date(timestamp))
    : DATE_FORMATTER.format(new Date(timestamp)).replaceAll('/', '-')
}

function niceStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const factor = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10
  return factor * magnitude
}

function pointFor(
  value: number,
  index: number,
  count: number,
  scaleMaximum: number,
  geometry: ChartGeometry,
) {
  const plotWidth = geometry.width - geometry.left
  const plotHeight = geometry.bottom - geometry.top
  const x = geometry.left + (index / Math.max(1, count - 1)) * plotWidth
  const y = geometry.bottom - (Math.max(0, value) / scaleMaximum) * plotHeight
  return { x, y }
}

function buildPaths(values: number[], scaleMaximum: number, geometry: ChartGeometry) {
  const points = values.map((value, index) => pointFor(
    value,
    index,
    values.length,
    scaleMaximum,
    geometry,
  ))
  const line = points.map(({ x, y }, index) => (
    `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`
  )).join(' ')
  const first = points[0] ?? { x: geometry.left, y: geometry.bottom }
  const last = points.at(-1) ?? first
  return {
    line,
    area: `${line} L${last.x.toFixed(2)} ${geometry.bottom} L${first.x.toFixed(2)} ${geometry.bottom} Z`,
  }
}

export function MonitorTrendChart({
  series,
  unit,
  ariaLabel,
  compact = false,
  endTimestamp = Date.now(),
  durationMinutes = 60,
}: {
  series: MonitorTrendSeries[]
  unit: string
  ariaLabel: string
  compact?: boolean
  endTimestamp?: number
  durationMinutes?: number
}) {
  const gradientScope = useId().replaceAll(':', '')
  const geometry = compact ? COMPACT_GEOMETRY : STANDARD_GEOMETRY
  const plotHeight = geometry.bottom - geometry.top
  const plotWidth = geometry.width - geometry.left
  const chart = useMemo(() => {
    const maximum = Math.max(0, ...series.flatMap((item) => item.values))
    const step = niceStep(Math.max(maximum, 1) / (compact ? 4 : 5))
    const intervalCount = compact ? 4 : Math.max(4, Math.min(6, Math.ceil(maximum / step)))
    const scaleMaximum = Math.max(step * intervalCount, 1)
    return {
      ticks: Array.from({ length: intervalCount + 1 }, (_, index) => (
        scaleMaximum - step * index
      )),
      paths: series.map((item) => ({
        ...item,
        ...buildPaths(item.values, scaleMaximum, geometry),
      })),
      scaleMaximum,
    }
  }, [geometry, series, compact])
  const timeTickCount = compact ? 7 : 6
  const timeTicks = Array.from({ length: timeTickCount }, (_, index) => ({
    x: compact ? (index + 0.5) / timeTickCount * geometry.width : geometry.left + index / 5 * plotWidth,
    label: formatTimeTick(
      endTimestamp - (timeTickCount - 1 - index) / (timeTickCount - 1) * durationMinutes * 60_000,
      durationMinutes,
    ),
  }))

  return (
    <div
      className="monitor-trend"
      data-compact={compact || undefined}
      data-duration-minutes={durationMinutes}
    >
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          {chart.paths.map((item) => (
            <linearGradient
              className="monitor-trend__gradient"
              data-color={item.color}
              id={`${gradientScope}-${item.id}`}
              key={item.id}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0" stopOpacity="0.16" />
              <stop offset="1" stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <text className="monitor-trend__unit" x={compact ? 0 : geometry.left - 6} y="9" textAnchor={compact ? 'start' : 'end'}>
          {unit}
        </text>
        {chart.ticks.map((tick) => {
          const y = geometry.bottom - tick / chart.scaleMaximum * plotHeight
          return (
            <g key={tick}>
              <text className="monitor-trend__tick" x={compact ? 0 : geometry.left - 6} y={y + 3} textAnchor={compact ? 'start' : 'end'}>
                {Number.isInteger(tick) ? String(tick) : tick.toFixed(1)}
              </text>
              <line className="monitor-trend__grid" data-baseline={tick === 0 || undefined} x1={geometry.left} x2={geometry.width} y1={y} y2={y} />
            </g>
          )
        })}
        {chart.paths.map((item) => (
          <g className="monitor-trend__series" data-color={item.color} key={item.id}>
            <path
              className="monitor-trend__area"
              d={item.area}
              fill={`url(#${gradientScope}-${item.id})`}
            />
            <path
              className="monitor-trend__line"
              d={item.line}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {timeTicks.map(({ x, label }) => (
          <g key={`${x}:${label}`}>
            <line className="monitor-trend__axis-tick" x1={x} x2={x} y1={geometry.bottom} y2={geometry.bottom + 4} />
            <text
              className="monitor-trend__tick monitor-trend__time-tick"
              x={x}
              y={geometry.height - 2}
              textAnchor="middle"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
