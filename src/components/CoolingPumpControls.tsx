import { Gauge } from 'lucide-react'

import { clampCoolingPumpOutputPower } from '../monitoring/coolingRuntime'
import { NumericField, Switch } from './ui'

export function RuntimeStateToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="property-toggle">
      <div className="property-toggle__copy">
        <span>{label}</span>
        <small>{description}</small>
      </div>
      <Switch
        className="property-toggle__switch"
        label={<span className="visually-hidden">{label}</span>}
        checked={checked}
        indicatorPosition="end"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </div>
  )
}

export function CoolingPumpControls({
  running,
  outputPower,
  flowRate,
  note,
  onRunningChange,
  onOutputPowerChange,
}: {
  running: boolean
  outputPower: number
  flowRate?: number
  note?: string
  onRunningChange: (running: boolean) => void
  onOutputPowerChange: (outputPower: number) => void
}) {
  const normalizedOutputPower = clampCoolingPumpOutputPower(outputPower)
  return (
    <>
      <RuntimeStateToggle
        label="水泵运行状态"
        description={running ? '当前运行' : '当前停止'}
        checked={running}
        onChange={onRunningChange}
      />
      <div className="monitor-output-control">
        <div className="monitor-output-control__heading">
          <span>输出功率</span>
          <strong>{Math.round(normalizedOutputPower)}%</strong>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={normalizedOutputPower}
          aria-label="水泵输出功率滑块"
          onChange={(event) => onOutputPowerChange(
            clampCoolingPumpOutputPower(Number(event.target.value)),
          )}
        />
        <NumericField
          label="精确数值"
          value={normalizedOutputPower}
          min={0}
          max={100}
          step={5}
          unit="%"
          onCommit={(value) => onOutputPowerChange(clampCoolingPumpOutputPower(value))}
        />
      </div>
      {flowRate !== undefined ? (
        <div className="monitor-flow-reading" aria-label={`模拟流量 ${flowRate.toFixed(1)} 立方米每小时`}>
          <Gauge aria-hidden="true" />
          <div>
            <span>模拟流量</span>
            <strong>{flowRate.toFixed(1)} <small>m³/h</small></strong>
          </div>
        </div>
      ) : null}
      {note ? <p className="monitor-runtime-note">{note}</p> : null}
    </>
  )
}
