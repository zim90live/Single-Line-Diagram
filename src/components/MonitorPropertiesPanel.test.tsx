import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AssetDefinition, DiagramElement } from '../domain/project'
import { MonitorPropertiesPanel } from './MonitorPropertiesPanel'

const element: DiagramElement = {
  id: 'pump-1',
  diagramId: 'diagram',
  assetKey: 'pump',
  name: '水泵',
  x: 0,
  y: 0,
  width: 32,
  height: 32,
  rotation: 0,
  properties: { tag: 'CHWP-01' },
  extensions: {},
}

const pumpAsset: AssetDefinition = {
  key: 'pump',
  name: '冷冻水泵',
  category: '冷却',
  source: 'pump.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  coolingDeviceRole: 'pump',
  anchors: [],
}

describe('monitor properties panel', () => {
  it('controls pump running state and output power while showing visual flow', async () => {
    const user = userEvent.setup()
    const onPumpRunningChange = vi.fn()
    const onPumpOutputPowerChange = vi.fn()
    render(
      <MonitorPropertiesPanel
        selectedElement={element}
        asset={pumpAsset}
        onOff={false}
        pumpRunning
        pumpOutputPower={80}
        pumpFlowRate={64.25}
        valveOpen
        onOnOffChange={vi.fn()}
        onPumpRunningChange={onPumpRunningChange}
        onPumpOutputPowerChange={onPumpOutputPowerChange}
        onValveOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText('64.3')).toBeInTheDocument()
    expect(screen.getByText('m³/h')).toBeInTheDocument()
    expect(screen.queryByText('模拟压力')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '水泵运行状态' }))
    expect(onPumpRunningChange).toHaveBeenCalledWith(false)
    fireEvent.change(screen.getByLabelText('水泵输出功率滑块'), {
      target: { value: '35' },
    })
    expect(onPumpOutputPowerChange).toHaveBeenCalledWith(35)
  })

  it('shows an empty monitor state until a controllable device is selected', () => {
    render(
      <MonitorPropertiesPanel
        onOff={false}
        pumpRunning
        pumpOutputPower={100}
        pumpFlowRate={0}
        valveOpen
        onOnOffChange={vi.fn()}
        onPumpRunningChange={vi.fn()}
        onPumpOutputPowerChange={vi.fn()}
        onValveOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText('选择可控设备')).toBeInTheDocument()
  })
})
