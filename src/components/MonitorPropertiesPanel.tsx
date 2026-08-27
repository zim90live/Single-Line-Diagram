import { Activity, Gauge, MousePointer2 } from 'lucide-react'

import {
  elementUsesOnOffState,
  type AssetDefinition,
  type DiagramElement,
} from '../domain/project'
import { clampCoolingPumpOutputPower } from '../monitoring/coolingRuntime'
import { NumericField } from './ui'

function RuntimeToggle({
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
      <button
        type="button"
        className="property-toggle__control"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  )
}

export function MonitorPropertiesPanel({
  selectedElement,
  asset,
  onOff,
  pumpRunning,
  pumpOutputPower,
  pumpFlowRate,
  valveOpen,
  onOnOffChange,
  onPumpRunningChange,
  onPumpOutputPowerChange,
  onValveOpenChange,
}: {
  selectedElement?: DiagramElement
  asset?: AssetDefinition
  onOff: boolean
  pumpRunning: boolean
  pumpOutputPower: number
  pumpFlowRate: number
  valveOpen: boolean
  onOnOffChange: (on: boolean) => void
  onPumpRunningChange: (running: boolean) => void
  onPumpOutputPowerChange: (outputPower: number) => void
  onValveOpenChange: (open: boolean) => void
}) {
  const role = asset?.coolingDeviceRole
  const supportsOnOff = selectedElement ? elementUsesOnOffState(selectedElement) : false
  const controllable = supportsOnOff || role === 'pump' || role === 'valve' || role === 'check-valve'

  return (
    <aside className="properties-panel monitor-properties-panel" aria-labelledby="monitor-properties-title">
      <div className="panel-heading properties-heading">
        <h2 id="monitor-properties-title">运行</h2>
        <span>{controllable ? '模拟数据' : '监控模式'}</span>
      </div>
      {!selectedElement || !controllable ? (
        <div className="properties-empty">
          <MousePointer2 aria-hidden="true" />
          <strong>选择可控设备</strong>
          <span>点击水泵、阀门或开关，在这里调整运行状态。</span>
        </div>
      ) : (
        <div className="property-form" key={selectedElement.id}>
          <div className="monitor-runtime-device">
            <Activity aria-hidden="true" />
            <div>
              <strong>{String(selectedElement.properties.tag || selectedElement.name)}</strong>
              <span>{asset?.name ?? selectedElement.name}</span>
            </div>
          </div>

          {role === 'pump' ? (
            <>
              <RuntimeToggle
                label="水泵运行状态"
                description={pumpRunning ? '当前运行' : '当前停止'}
                checked={pumpRunning}
                onChange={onPumpRunningChange}
              />
              <div className="monitor-output-control">
                <div className="monitor-output-control__heading">
                  <span>输出功率</span>
                  <strong>{Math.round(pumpOutputPower)}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={pumpOutputPower}
                  aria-label="水泵输出功率滑块"
                  onChange={(event) => onPumpOutputPowerChange(
                    clampCoolingPumpOutputPower(Number(event.target.value)),
                  )}
                />
                <NumericField
                  label="精确数值"
                  value={pumpOutputPower}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  onCommit={(value) => onPumpOutputPowerChange(
                    clampCoolingPumpOutputPower(value),
                  )}
                />
              </div>
              <div className="monitor-flow-reading" aria-label={`模拟流量 ${pumpFlowRate.toFixed(1)} 立方米每小时`}>
                <Gauge aria-hidden="true" />
                <div>
                  <span>模拟流量</span>
                  <strong>{pumpFlowRate.toFixed(1)} <small>m³/h</small></strong>
                </div>
              </div>
              <p className="monitor-runtime-note">视觉模拟值，不用于压力或工程水力计算。</p>
            </>
          ) : supportsOnOff ? (
            <RuntimeToggle
              label={selectedElement.assetKey === 'switch' ? '开关状态' : '阀门状态'}
              description={selectedElement.assetKey === 'switch'
                ? onOff ? '当前闭合 · On' : '当前断开 · Off'
                : onOff ? '当前开启 · On' : '当前关闭 · Off'}
              checked={onOff}
              onChange={onOnOffChange}
            />
          ) : (
            <RuntimeToggle
              label="阀门状态"
              description={valveOpen ? '当前打开' : '当前关闭'}
              checked={valveOpen}
              onChange={onValveOpenChange}
            />
          )}

          {role === 'check-valve' ? (
            <p className="monitor-runtime-note">CV 仅允许从入口流向出口。</p>
          ) : null}
        </div>
      )}
    </aside>
  )
}
