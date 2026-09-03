import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DiagramElement } from '../domain/project'
import { monitorMetricReadingKey } from '../monitoring/elementMetrics'
import { MonitorDevicePanel } from './MonitorDevicePanel'
import { MonitorMetricDataPanel } from './monitoring/MonitorMetricDataPanel'

const loadMetric = {
  id: 'ups-load',
  name: '负载率',
  valueType: 'number' as const,
  unit: '%',
  precision: 1 as const,
  simulationMin: 0,
  simulationMax: 100,
  alarm: { mode: 'upper' as const, minor: 80, major: 90, critical: 96 },
}

function device(assetKey: string): DiagramElement {
  return {
    id: `${assetKey}-device`,
    diagramId: 'power-diagram',
    assetKey,
    name: assetKey,
    x: 0,
    y: 0,
    width: 48,
    height: 48,
    rotation: 0,
    monitorMetrics: [loadMetric],
    properties: { tag: assetKey === 'ups' ? 'TR04-UPS01-BAT0-02' : 'GEN-01' },
    extensions: {},
  }
}

describe('MonitorDevicePanel', () => {
  it('renders the UPS detail with project symbols, schematic connections, alarms, and trend', () => {
    const element = device('ups')
    const readingKey = monitorMetricReadingKey(element.id, loadMetric.id)
    const { container } = render(
      <MonitorDevicePanel
        element={element}
        diagramName="4号楼电力系统"
        timestamp={Date.UTC(2026, 8, 3, 6, 30)}
        readings={{
          [readingKey]: {
            elementId: element.id,
            metricId: loadMetric.id,
            value: 93.4,
            severity: 'major',
          },
        }}
        deviceState={{ health: 'major', operation: 'running', online: true }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'TR04-UPS01-BAT0-02' })).toBeInTheDocument()
    const upsScene = screen.getByRole('img', { name: 'UPS内部一次接线图' })
    expect(upsScene).toHaveAttribute('data-routed-edge-count', '7')
    expect(upsScene).toHaveAttribute('data-routing-invalid-count', '0')
    expect(upsScene).toHaveAttribute('data-active-edge-count', '5')
    expect(upsScene).toHaveAttribute('data-content-center-x', '226')
    expect(upsScene).toHaveAttribute('data-content-center-y', '180')
    expect(container.querySelectorAll('.read-only-diagram-scene__element image')).toHaveLength(7)
    expect(container.querySelectorAll('.read-only-diagram-scene .connection-edge__line')).toHaveLength(7)
    expect(container.querySelector('.read-only-diagram-scene .monitor-static-flow-line')).toBeInTheDocument()
    expect(container.querySelector('.ups-line-diagram__readings')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.ups-line-diagram__labels .composite-element-label')).toHaveLength(4)
    expect(screen.getByRole('group', { name: '主路数据' })).toHaveTextContent('A：')
    expect(screen.getByRole('group', { name: '主路数据' })).toHaveTextContent('V')
    expect(screen.getByRole('group', { name: '主路数据' })).toHaveTextContent('A')
    expect(screen.getByRole('group', { name: '电池数据' })).toHaveTextContent('电量：')
    expect(screen.getByText('重要告警')).toBeInTheDocument()
    expect(screen.getByText('重要')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '时间' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '级别' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '告警名称' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '告警位置' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'UPS负载率趋势' })).toBeInTheDocument()
    expect(container.querySelector('.monitor-trend__area')).toBeInTheDocument()
    const upsTrend = screen.getByRole('img', { name: 'UPS负载率趋势' }).parentElement
    expect(upsTrend).toHaveAttribute('data-duration-minutes', '1440')
    fireEvent.click(screen.getByRole('button', { name: '周' }))
    expect(upsTrend).toHaveAttribute('data-duration-minutes', '10080')
    expect(Array.from(upsTrend?.querySelectorAll('.monitor-trend__time-tick') ?? []).every(
      (tick) => /^\d{2}-\d{2}$/.test(tick.textContent ?? ''),
    )).toBe(true)
  })

  it('uses the electrical detail layout for Generator', () => {
    const element = device('generator')
    const { container } = render(
      <MonitorDevicePanel
        element={element}
        diagramName="Generator Diagram"
        timestamp={Date.UTC(2026, 8, 3, 6, 30)}
        readings={{}}
      />,
    )

    expect(screen.getByRole('heading', { name: 'GEN-01' })).toBeInTheDocument()
    expect(screen.getByText('三相平均电压')).toBeInTheDocument()
    expect(screen.getByText('三相总电流')).toBeInTheDocument()
    expect(screen.getByText('总有功功率')).toBeInTheDocument()
    expect(screen.getByLabelText('图例')).toHaveTextContent('L1L2L3')
    expect(screen.getByRole('group', { name: '趋势时间范围' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '线电压趋势' })).toBeInTheDocument()
    expect(container.querySelectorAll('.monitor-trend__series[data-color]').length).toBe(9)
    expect(container.querySelectorAll('.monitor-trend__area').length).toBe(9)
    const voltageTrend = screen.getByRole('img', { name: '线电压趋势' }).parentElement
    expect(voltageTrend).toHaveAttribute('data-duration-minutes', '1440')
    expect(Array.from(voltageTrend?.querySelectorAll('.monitor-trend__time-tick') ?? []).every(
      (tick) => /^\d{2}:\d{2}$/.test(tick.textContent ?? ''),
    )).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '周' }))
    expect(voltageTrend).toHaveAttribute('data-duration-minutes', '10080')
    expect(Array.from(voltageTrend?.querySelectorAll('.monitor-trend__time-tick') ?? []).every(
      (tick) => /^\d{2}-\d{2}$/.test(tick.textContent ?? ''),
    )).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '月' }))
    expect(voltageTrend).toHaveAttribute('data-duration-minutes', '43200')
  })

  it('renders the compact data panel with the Figma time-range control and area trend', () => {
    const { container } = render(
      <MonitorMetricDataPanel
        ownerName="MLVR-6A-TR17"
        metric={{
          ...loadMetric,
          id: 'active-power',
          name: '有功功率',
          unit: 'kW',
          simulationMin: 0,
          simulationMax: 1200,
        }}
        reading={{
          elementId: 'mlvr-device',
          metricId: 'active-power',
          value: 843.6,
          severity: 'normal',
        }}
        anchor={{ left: 200, top: 400, right: 260, bottom: 430, width: 60, height: 30 }}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'MLVR-6A-TR17 有功功率数据面板' })).toBeInTheDocument()
    const period = screen.getByRole('combobox', { name: '趋势时间范围' })
    expect(period).toHaveValue('hour')
    fireEvent.change(period, { target: { value: 'six-hours' } })
    expect(period).toHaveValue('six-hours')
    expect(screen.getByRole('img', { name: '有功功率6小时趋势' })).toBeInTheDocument()
    expect(container.querySelector('.monitor-trend__series[data-color="primary"]')).toBeInTheDocument()
    expect(container.querySelector('.monitor-trend__area')).toBeInTheDocument()
  })
})
