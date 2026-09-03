import { describe, expect, it } from 'vitest'

import type { DiagramElement, MonitorMetric } from '../domain/project'
import {
  cloneMonitorMetricsWithNewIds,
  createDefaultMonitorTextOptions,
  defaultMonitorMetricAlarm,
  evaluateMonitorMetricAlarm,
  formatMonitorMetricValue,
  generateMonitorMetricReadings,
  generateMonitorMetricPreviewReadings,
  generateMonitorMetricPreviewValue,
  generateMonitorMetricValue,
  monitorMetricReadingKey,
} from './elementMetrics'

type NumberMetric = Extract<MonitorMetric, { valueType: 'number' }>

function metric(overrides: Partial<NumberMetric> = {}): NumberMetric {
  return {
    id: 'temperature',
    name: '出水温度',
    valueType: 'number',
    unit: '°C',
    precision: 1,
    simulationMin: 0,
    simulationMax: 100,
    alarm: { mode: 'upper', minor: 60, major: 75, critical: 90 },
    ...overrides,
  }
}

describe('monitor element metrics', () => {
  it('clones metric templates with independent metric and text-option ids', () => {
    const source: MonitorMetric[] = [
      metric(),
      {
        id: 'status',
        name: '状态',
        valueType: 'text',
        textOptions: [
          { id: 'running', value: '运行', severity: 'normal' },
          { id: 'stopped', value: '停止', severity: 'major' },
        ],
      },
    ]
    const first = cloneMonitorMetricsWithNewIds(source)
    const second = cloneMonitorMetricsWithNewIds(source)

    expect(first.map((item) => item.id)).not.toEqual(source.map((item) => item.id))
    expect(first.map((item) => item.id)).not.toEqual(second.map((item) => item.id))
    const firstText = first[1] as Extract<MonitorMetric, { valueType: 'text' }>
    const secondText = second[1] as Extract<MonitorMetric, { valueType: 'text' }>
    expect(firstText.textOptions.map((option) => option.id)).not.toEqual(
      secondText.textOptions.map((option) => option.id),
    )
  })

  it('evaluates upper and lower alarms using the highest matching severity', () => {
    const upper = metric()
    expect(evaluateMonitorMetricAlarm(upper, 59.9)).toBe('normal')
    expect(evaluateMonitorMetricAlarm(upper, 60)).toBe('minor')
    expect(evaluateMonitorMetricAlarm(upper, 75)).toBe('major')
    expect(evaluateMonitorMetricAlarm(upper, 90)).toBe('critical')

    const lower = metric({
      alarm: { mode: 'lower', critical: 10, major: 20, minor: 30 },
    })
    expect(evaluateMonitorMetricAlarm(lower, 31)).toBe('normal')
    expect(evaluateMonitorMetricAlarm(lower, 30)).toBe('minor')
    expect(evaluateMonitorMetricAlarm(lower, 20)).toBe('major')
    expect(evaluateMonitorMetricAlarm(lower, 10)).toBe('critical')
  })

  it('evaluates progressively wider outside-range alarms', () => {
    const outside = metric({
      alarm: {
        mode: 'outside',
        criticalLow: 5,
        majorLow: 15,
        minorLow: 30,
        minorHigh: 70,
        majorHigh: 85,
        criticalHigh: 95,
      },
    })
    expect(evaluateMonitorMetricAlarm(outside, 50)).toBe('normal')
    expect(evaluateMonitorMetricAlarm(outside, 70)).toBe('minor')
    expect(evaluateMonitorMetricAlarm(outside, 85)).toBe('major')
    expect(evaluateMonitorMetricAlarm(outside, 95)).toBe('critical')
    expect(evaluateMonitorMetricAlarm(outside, 4)).toBe('critical')
  })

  it('generates rounded values within range and derives instance readings', () => {
    const currentMetric = metric({ simulationMin: 10, simulationMax: 20, precision: 2 })
    expect(generateMonitorMetricValue(currentMetric, () => 0.456)).toBe(14.56)
    expect(formatMonitorMetricValue(currentMetric, 14.5)).toBe('14.50')
    expect(generateMonitorMetricPreviewValue(currentMetric)).toBe(15)

    const element: DiagramElement = {
      id: 'chwp-1',
      diagramId: 'diagram-1',
      assetKey: 'chwp',
      name: 'CHWP',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      rotation: 0,
      properties: {},
      extensions: {},
      monitorMetrics: [currentMetric],
    }
    const readings = generateMonitorMetricReadings([element], () => 0.456)
    expect(readings[monitorMetricReadingKey(element.id, currentMetric.id)]).toEqual({
      elementId: element.id,
      metricId: currentMetric.id,
      value: 14.56,
      severity: 'normal',
    })
    expect(generateMonitorMetricPreviewReadings([element])[
      monitorMetricReadingKey(element.id, currentMetric.id)
    ]).toEqual({
      elementId: element.id,
      metricId: currentMetric.id,
      value: 15,
      severity: 'normal',
    })
  })

  it('creates valid defaults for every threshold mode', () => {
    expect(defaultMonitorMetricAlarm('upper', 0, 100)).toEqual({
      mode: 'upper', minor: 70, major: 85, critical: 95,
    })
    expect(defaultMonitorMetricAlarm('lower', 0, 100)).toEqual({
      mode: 'lower', critical: 5, major: 15, minor: 30,
    })
    expect(defaultMonitorMetricAlarm('outside', 0, 100)).toEqual({
      mode: 'outside',
      criticalLow: 5,
      majorLow: 15,
      minorLow: 30,
      minorHigh: 70,
      majorHigh: 85,
      criticalHigh: 95,
    })
  })

  it('uses normal-dominant weighted text states and a stable normal preview', () => {
    const textMetric: MonitorMetric = {
      id: 'running-state',
      name: '运行状态',
      valueType: 'text',
      textOptions: [
        { id: 'running', value: '运行', severity: 'normal' },
        { id: 'standby', value: '待机', severity: 'minor' },
        { id: 'stopped', value: '停机', severity: 'major' },
        { id: 'offline', value: '离线', severity: 'critical' },
      ],
    }

    expect(generateMonitorMetricValue(textMetric, () => 0.899)).toBe('运行')
    expect(generateMonitorMetricValue(textMetric, () => 0.9)).toBe('待机')
    expect(generateMonitorMetricValue(textMetric, () => 0.96)).toBe('停机')
    expect(generateMonitorMetricValue(textMetric, () => 0.99)).toBe('离线')
    expect(generateMonitorMetricPreviewValue(textMetric)).toBe('运行')
    expect(formatMonitorMetricValue(textMetric, '离线')).toBe('离线')

    const element: DiagramElement = {
      id: 'ups-1',
      diagramId: 'diagram-1',
      assetKey: 'ups',
      name: 'UPS',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      rotation: 0,
      monitorMetrics: [textMetric],
      properties: {},
      extensions: {},
    }
    expect(generateMonitorMetricReadings([element], () => 0.96)[
      monitorMetricReadingKey(element.id, textMetric.id)
    ]).toMatchObject({ value: '停机', severity: 'major' })
    expect(generateMonitorMetricPreviewReadings([element])[
      monitorMetricReadingKey(element.id, textMetric.id)
    ]).toMatchObject({ value: '运行', severity: 'normal' })
    expect(createDefaultMonitorTextOptions().map(({ value, severity }) => ({ value, severity }))).toEqual([
      { value: '运行', severity: 'normal' },
      { value: '停机', severity: 'major' },
      { value: '离线', severity: 'critical' },
    ])
  })
})
