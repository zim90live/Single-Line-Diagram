import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  monitorMetricSchema,
  type MonitorAlarmSeverity,
  type MonitorMetric,
  type MonitorMetricAlarm,
  type MonitorMetricPrecision,
  type MonitorMetricTextOption,
} from '../domain/project'
import {
  createDefaultMonitorMetric,
  createDefaultMonitorTextOptions,
  defaultMonitorMetricAlarm,
} from '../monitoring/elementMetrics'
import { Button, IconButton, NumericField, SelectField, TextField } from './ui'

const NUMBER_MIN = -1_000_000_000_000
const NUMBER_MAX = 1_000_000_000_000
const THRESHOLD_EPSILON = 0.000001

function CommittedMetricTextField({
  label,
  value,
  maxLength,
  allowEmpty = false,
  onCommit,
}: {
  label: string
  value: string
  maxLength: number
  allowEmpty?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(value)
    setError(null)
  }, [value])
  const commit = () => {
    const next = draft.trim()
    if (!allowEmpty && !next) {
      setError('不能为空')
      return
    }
    setError(null)
    if (next !== value) onCommit(next)
  }
  return (
    <TextField
      label={label}
      value={draft}
      maxLength={maxLength}
      error={error ?? undefined}
      onChange={(event) => {
        setDraft(event.currentTarget.value)
        setError(null)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          setError(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

interface ThresholdFieldProps {
  label: string
  value: number
  min?: number
  max?: number
  onCommit: (value: number) => void
}

function ThresholdField({
  label,
  value,
  min = NUMBER_MIN,
  max = NUMBER_MAX,
  onCommit,
}: ThresholdFieldProps) {
  return (
    <NumericField
      label={label}
      value={value}
      min={min}
      max={max}
      step={1}
      onCommit={onCommit}
    />
  )
}

function MetricThresholdFields({
  alarm,
  onChange,
}: {
  alarm: MonitorMetricAlarm
  onChange: (alarm: MonitorMetricAlarm) => void
}) {
  if (alarm.mode === 'upper') {
    return (
      <div className="monitor-metric-editor__threshold-grid">
        <ThresholdField
          label="次要"
          value={alarm.minor}
          max={alarm.major - THRESHOLD_EPSILON}
          onCommit={(minor) => onChange({ ...alarm, minor })}
        />
        <ThresholdField
          label="重要"
          value={alarm.major}
          min={alarm.minor + THRESHOLD_EPSILON}
          max={alarm.critical - THRESHOLD_EPSILON}
          onCommit={(major) => onChange({ ...alarm, major })}
        />
        <ThresholdField
          label="紧急"
          value={alarm.critical}
          min={alarm.major + THRESHOLD_EPSILON}
          onCommit={(critical) => onChange({ ...alarm, critical })}
        />
      </div>
    )
  }
  if (alarm.mode === 'lower') {
    return (
      <div className="monitor-metric-editor__threshold-grid">
        <ThresholdField
          label="次要"
          value={alarm.minor}
          min={alarm.major + THRESHOLD_EPSILON}
          onCommit={(minor) => onChange({ ...alarm, minor })}
        />
        <ThresholdField
          label="重要"
          value={alarm.major}
          min={alarm.critical + THRESHOLD_EPSILON}
          max={alarm.minor - THRESHOLD_EPSILON}
          onCommit={(major) => onChange({ ...alarm, major })}
        />
        <ThresholdField
          label="紧急"
          value={alarm.critical}
          max={alarm.major - THRESHOLD_EPSILON}
          onCommit={(critical) => onChange({ ...alarm, critical })}
        />
      </div>
    )
  }
  return (
    <div className="monitor-metric-editor__threshold-grid" data-columns="2">
      <ThresholdField
        label="次要下界"
        value={alarm.minorLow}
        min={alarm.majorLow + THRESHOLD_EPSILON}
        max={alarm.minorHigh - THRESHOLD_EPSILON}
        onCommit={(minorLow) => onChange({ ...alarm, minorLow })}
      />
      <ThresholdField
        label="次要上界"
        value={alarm.minorHigh}
        min={alarm.minorLow + THRESHOLD_EPSILON}
        max={alarm.majorHigh - THRESHOLD_EPSILON}
        onCommit={(minorHigh) => onChange({ ...alarm, minorHigh })}
      />
      <ThresholdField
        label="重要下界"
        value={alarm.majorLow}
        min={alarm.criticalLow + THRESHOLD_EPSILON}
        max={alarm.minorLow - THRESHOLD_EPSILON}
        onCommit={(majorLow) => onChange({ ...alarm, majorLow })}
      />
      <ThresholdField
        label="重要上界"
        value={alarm.majorHigh}
        min={alarm.minorHigh + THRESHOLD_EPSILON}
        max={alarm.criticalHigh - THRESHOLD_EPSILON}
        onCommit={(majorHigh) => onChange({ ...alarm, majorHigh })}
      />
      <ThresholdField
        label="紧急下界"
        value={alarm.criticalLow}
        max={alarm.majorLow - THRESHOLD_EPSILON}
        onCommit={(criticalLow) => onChange({ ...alarm, criticalLow })}
      />
      <ThresholdField
        label="紧急上界"
        value={alarm.criticalHigh}
        min={alarm.majorHigh + THRESHOLD_EPSILON}
        onCommit={(criticalHigh) => onChange({ ...alarm, criticalHigh })}
      />
    </div>
  )
}

function createMonitorTextOption(index: number): MonitorMetricTextOption {
  return {
    id: `monitor-state-${crypto.randomUUID()}`,
    value: `状态 ${index + 1}`,
    severity: 'normal',
  }
}

function changeMonitorMetricValueType(
  metric: MonitorMetric,
  valueType: MonitorMetric['valueType'],
): MonitorMetric {
  if (metric.valueType === valueType) return metric
  if (valueType === 'text') {
    return {
      id: metric.id,
      name: metric.name,
      valueType,
      textOptions: createDefaultMonitorTextOptions(),
    }
  }
  const simulationMin = 0
  const simulationMax = 100
  return {
    id: metric.id,
    name: metric.name,
    valueType,
    unit: '',
    precision: 1,
    simulationMin,
    simulationMax,
    alarm: defaultMonitorMetricAlarm('upper', simulationMin, simulationMax),
  }
}

function MetricTextOptions({
  options,
  onChange,
}: {
  options: MonitorMetricTextOption[]
  onChange: (options: MonitorMetricTextOption[]) => void
}) {
  const updateOption = (optionId: string, patch: Partial<MonitorMetricTextOption>) => {
    onChange(options.map((option) => option.id === optionId ? { ...option, ...patch } : option))
  }
  return (
    <div className="monitor-metric-editor__states">
      <div className="monitor-metric-editor__states-heading">
        <span>候选状态</span>
        <Button
          variant="neutral-ghost"
          leadingIcon={<Plus />}
          onClick={() => onChange([...options, createMonitorTextOption(options.length)])}
        >
          添加状态
        </Button>
      </div>
      <p>监控模式正常状态优先，告警状态低频出现。</p>
      {options.map((option, index) => (
        <div className="monitor-metric-editor__state" key={option.id}>
          <CommittedMetricTextField
            label={`状态 ${index + 1}`}
            value={option.value}
            maxLength={24}
            onCommit={(value) => updateOption(option.id, { value })}
          />
          <SelectField
            label="状态等级"
            value={option.severity}
            onChange={(event) => updateOption(option.id, {
              severity: event.currentTarget.value as MonitorAlarmSeverity,
            })}
          >
            <option value="normal">正常</option>
            <option value="minor">次要</option>
            <option value="major">重要</option>
            <option value="critical">紧急</option>
          </SelectField>
          <IconButton
            label={`删除状态 ${index + 1}`}
            variant="danger-soft"
            icon={<Trash2 />}
            disabled={options.length === 1}
            onClick={() => onChange(options.filter((candidate) => candidate.id !== option.id))}
          />
        </div>
      ))}
    </div>
  )
}

export function MonitorMetricsEditor({
  metrics,
  onChange,
}: {
  metrics: MonitorMetric[]
  onChange: (metrics: MonitorMetric[]) => void
}) {
  const commitMetric = (metricId: string, next: MonitorMetric) => {
    const parsed = monitorMetricSchema.safeParse(next)
    if (!parsed.success) return
    onChange(metrics.map((metric) => metric.id === metricId ? parsed.data : metric))
  }
  const moveMetric = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= metrics.length) return
    const next = [...metrics]
    const [current] = next.splice(index, 1)
    next.splice(target, 0, current)
    onChange(next)
  }

  return (
    <section className="monitor-metric-editor" aria-labelledby="monitor-metrics-title">
      <div className="monitor-metric-editor__heading">
        <div>
          <h3 id="monitor-metrics-title">运行指标</h3>
          <span>{metrics.length} / 5</span>
        </div>
        <Button
          variant="neutral-ghost"
          leadingIcon={<Plus />}
          disabled={metrics.length >= 5}
          onClick={() => onChange([...metrics, createDefaultMonitorMetric(metrics.length)])}
        >
          添加
        </Button>
      </div>
      {metrics.length === 0 ? (
        <p className="monitor-metric-editor__empty">
          编辑模式固定预览，监控模式每 30 秒更新。
        </p>
      ) : (
        <div className="monitor-metric-editor__list">
          {metrics.map((metric, index) => (
            <details
              className="monitor-metric-editor__item"
              key={metric.id}
            >
              <summary>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{metric.name}</strong>
                <small>{metric.valueType === 'text' ? '文本状态' : metric.unit || '数值'}</small>
              </summary>
              <div className="monitor-metric-editor__body">
                <div className="monitor-metric-editor__commands" aria-label={`${metric.name} 排序与删除`}>
                  <IconButton
                    label="上移指标"
                    icon={<ChevronUp />}
                    disabled={index === 0}
                    onClick={() => moveMetric(index, -1)}
                  />
                  <IconButton
                    label="下移指标"
                    icon={<ChevronDown />}
                    disabled={index === metrics.length - 1}
                    onClick={() => moveMetric(index, 1)}
                  />
                  <span />
                  <IconButton
                    label="删除指标"
                    variant="danger-soft"
                    icon={<Trash2 />}
                    onClick={() => onChange(metrics.filter((candidate) => candidate.id !== metric.id))}
                  />
                </div>
                <div className="monitor-metric-editor__identity-grid">
                  <CommittedMetricTextField
                    label="指标名称"
                    value={metric.name}
                    maxLength={40}
                    onCommit={(name) => commitMetric(metric.id, { ...metric, name })}
                  />
                  <SelectField
                    label="数据类型"
                    value={metric.valueType}
                    onChange={(event) => commitMetric(
                      metric.id,
                      changeMonitorMetricValueType(
                        metric,
                        event.currentTarget.value as MonitorMetric['valueType'],
                      ),
                    )}
                  >
                    <option value="number">数值</option>
                    <option value="text">文本</option>
                  </SelectField>
                </div>
                {metric.valueType === 'number' ? (
                  <>
                    <div className="monitor-metric-editor__identity-grid">
                      <CommittedMetricTextField
                        label="单位"
                        value={metric.unit ?? ''}
                        maxLength={12}
                        allowEmpty
                        onCommit={(unit) => commitMetric(metric.id, { ...metric, unit })}
                      />
                      <SelectField
                        label="数值精度"
                        value={String(metric.precision)}
                        onChange={(event) => commitMetric(metric.id, {
                          ...metric,
                          precision: Number(event.currentTarget.value) as MonitorMetricPrecision,
                        })}
                      >
                        <option value="0">0 位小数</option>
                        <option value="1">1 位小数</option>
                        <option value="2">2 位小数</option>
                      </SelectField>
                    </div>
                    <div className="monitor-metric-editor__range-grid">
                      <NumericField
                        label="模拟最小值"
                        value={metric.simulationMin}
                        min={NUMBER_MIN}
                        max={metric.simulationMax - THRESHOLD_EPSILON}
                        onCommit={(simulationMin) => commitMetric(metric.id, { ...metric, simulationMin })}
                      />
                      <NumericField
                        label="模拟最大值"
                        value={metric.simulationMax}
                        min={metric.simulationMin + THRESHOLD_EPSILON}
                        max={NUMBER_MAX}
                        onCommit={(simulationMax) => commitMetric(metric.id, { ...metric, simulationMax })}
                      />
                    </div>
                    <SelectField
                      label="阈值模式"
                      value={metric.alarm.mode}
                      onChange={(event) => commitMetric(metric.id, {
                        ...metric,
                        alarm: defaultMonitorMetricAlarm(
                          event.currentTarget.value as MonitorMetricAlarm['mode'],
                          metric.simulationMin,
                          metric.simulationMax,
                        ),
                      })}
                    >
                      <option value="upper">高于阈值告警</option>
                      <option value="lower">低于阈值告警</option>
                      <option value="outside">超出正常区间告警</option>
                    </SelectField>
                    <div className="monitor-metric-editor__thresholds">
                      <span>三级阈值</span>
                      <MetricThresholdFields
                        alarm={metric.alarm}
                        onChange={(alarm) => commitMetric(metric.id, { ...metric, alarm })}
                      />
                    </div>
                  </>
                ) : (
                  <MetricTextOptions
                    options={metric.textOptions}
                    onChange={(textOptions) => commitMetric(metric.id, { ...metric, textOptions })}
                  />
                )}
              </div>
            </details>
          ))}
        </div>
      )}
      {metrics.length >= 5 ? (
        <span className="monitor-metric-editor__limit">每个图元最多 5 项</span>
      ) : null}
    </section>
  )
}
