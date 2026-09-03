import { MousePointer2 } from 'lucide-react'

import {
  elementUsesOnOffState,
  elementUsesRunningStandbyState,
  type AssetDefinition,
  type DiagramElement,
} from '../domain/project'
import { InspectorHeading } from './InspectorHeading'
import { CoolingPumpControls, RuntimeStateToggle } from './CoolingPumpControls'

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
      <InspectorHeading
        id="monitor-properties-title"
        eyebrow="运行状态"
        tag={controllable ? '模拟数据' : '监控模式'}
        title={selectedElement
          ? String(selectedElement.properties.tag ?? '').trim() || selectedElement.name
          : '运行监控'}
        description={selectedElement ? asset?.name ?? selectedElement.name : '选择设备查看运行信息'}
      />
      {!selectedElement || !controllable ? (
        <div className="properties-empty">
          <MousePointer2 aria-hidden="true" />
          <strong>选择可控设备</strong>
          <span>点击水泵、阀门、开关或双态设备，在这里调整运行状态。</span>
        </div>
      ) : (
        <div className="property-form" key={selectedElement.id}>
          {role === 'pump' ? (
            <CoolingPumpControls
              running={pumpRunning}
              outputPower={pumpOutputPower}
              flowRate={pumpFlowRate}
              note="视觉模拟值，不用于压力或工程水力计算。"
              onRunningChange={onPumpRunningChange}
              onOutputPowerChange={onPumpOutputPowerChange}
            />
          ) : supportsOnOff ? (
            <RuntimeStateToggle
              label={elementUsesRunningStandbyState(selectedElement)
                ? '运行状态'
                : selectedElement.assetKey === 'switch' ? '开关状态' : '阀门状态'}
              description={elementUsesRunningStandbyState(selectedElement)
                ? onOff ? '当前运行' : '当前待机'
                : selectedElement.assetKey === 'switch'
                  ? onOff ? '当前闭合 · On' : '当前断开 · Off'
                  : onOff ? '当前开启 · On' : '当前关闭 · Off'}
              checked={onOff}
              onChange={onOnOffChange}
            />
          ) : (
            <RuntimeStateToggle
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
