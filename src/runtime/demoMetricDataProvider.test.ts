import { describe, expect, it } from 'vitest'

import type { DiagramElement, MonitorMetric } from '../domain/project'
import { monitorMetricReadingKey } from '../monitoring/elementMetrics'
import { symbolAssets } from '../scene/symbolCatalog'
import { DemoMonitorMetricDataProvider } from './demoMetricDataProvider'
import {
  createDemoAnomalyAssignments,
  defaultDemoMetricsForElement,
  demoDeviceProfileForAsset,
  demoAnomalyCount,
  demoMetricProfileFor,
  normalizeDemoMetricUnit,
} from './demoSimulationProfiles'

function element(
  id: string,
  assetKey = 'cabinet-device',
  monitorMetrics?: MonitorMetric[],
): DiagramElement {
  return {
    id,
    diagramId: 'diagram-a',
    assetKey,
    name: id,
    x: 0,
    y: 0,
    width: 48,
    height: 48,
    rotation: 0,
    monitorMetrics,
    properties: {},
    extensions: {},
  }
}

describe('demo metric data provider', () => {
  it('keeps the named UPS bypass device on bypass without affecting other UPS devices', () => {
    const metric: MonitorMetric = { id: 'supply', name: '供电方式', valueType: 'text',
      textOptions: [{ id: 'main', value: '主路', severity: 'normal' }, { id: 'bypass', value: '旁路', severity: 'minor' }] }
    const owners = ['UPS-group-旁路', 'UPS-group-01'].map((tag) => ({
      ...element(tag, 'ups-group', [metric]), properties: { tag },
    }))
    const provider = new DemoMonitorMetricDataProvider({ anomalyAssignments: {} })
    const snapshot = provider.getRuntimeSnapshot(provider.prepareOwners(owners))
    expect(snapshot.readings[monitorMetricReadingKey(owners[0].id, metric.id)]).toMatchObject({ value: '旁路', severity: 'minor' })
    expect(snapshot.readings[monitorMetricReadingKey(owners[1].id, metric.id)].value).toBe('主路')
  })
  it.each(['算力 POD', 'UPS L', 'POD A'])('does not append anomaly metrics on %s', (diagramId) => {
    const owner = { ...element('configured', 'ups', defaultDemoMetricsForElement({ assetKey: 'ups' }).slice(0, 1)), diagramId, monitorDataVisible: true }
    const provider = new DemoMonitorMetricDataProvider()
    const prepared = provider.prepareOwners([owner])
    expect(prepared[0].monitorMetrics?.map((metric) => metric.id)).toEqual(owner.monitorMetrics!.map((metric) => metric.id))
    expect(Object.keys(provider.getRuntimeSnapshot(prepared).readings)).toHaveLength(1)
  })
  it.each([true, false, undefined])('preserves manual visibility %s for new and legacy anomalies', (monitorDataVisible) => {
    for (const assignment of [
      { severity: 'critical' as const, faultCode: 'test', secondarySeverity: 'minor' as const },
      { severity: 'critical' as const, faultCode: 'legacy' },
    ]) {
      const owner = { ...element('visibility'), monitorDataVisible }
      const provider = new DemoMonitorMetricDataProvider({ anomalyAssignments: { [owner.id]: assignment } })
      const prepared = provider.prepareOwners([owner])
      expect(prepared[0].monitorDataVisible).toBe(monitorDataVisible)
      expect(provider.getRuntimeSnapshot(prepared).deviceStates[owner.id].health).toBe('critical')
    }
  })
  it('never adds readings for empty metric configurations, even on anomalous pages', () => {
    const owners = symbolAssets.filter((asset) => asset.key !== 'text').map((asset) => ({
      ...element(asset.key, asset.key), diagramId: asset.key, monitorDataVisible: false,
    }))
    const provider = new DemoMonitorMetricDataProvider()
    const prepared = provider.prepareOwners(owners)
    for (let tick = 0; tick < 5; tick++) {
      const snapshot = provider.getRuntimeSnapshot(prepared)
      for (const owner of prepared) {
        expect(owner.monitorDataVisible).toBe(false)
        const readings = Object.values(snapshot.readings).filter((reading) => reading.elementId === owner.id)
        expect(readings, owner.assetKey).toEqual([])
      }
      provider.advance()
    }
  })
  it('shows main supply as normal and bypass as abnormal, including legacy option severities', () => {
    const metric: MonitorMetric = {
      id: 'supply-mode', name: '供电方式', valueType: 'text',
      textOptions: [
        { id: 'main', value: '主路', severity: 'major' },
        { id: 'bypass', value: '旁路供电', severity: 'normal' },
      ],
    }
    const owner = element('ups-supply', 'ups', [metric])
    for (const fault of [false, true]) {
      const provider = new DemoMonitorMetricDataProvider({
        anomalyAssignments: fault ? { [owner.id]: { severity: 'critical', faultCode: 'test' } } : {},
      })
      const reading = provider.getRuntimeSnapshot(provider.prepareOwners([owner])).readings[
        monitorMetricReadingKey(owner.id, metric.id)
      ]
      expect(reading).toMatchObject(fault
        ? { value: '旁路供电', severity: 'minor' }
        : { value: '主路', severity: 'normal' })
    }
  })
  it('covers every registered symbol asset with a device profile', () => {
    const missing = symbolAssets
      .map((asset) => asset.key)
      .filter((assetKey) => assetKey !== 'text' && !demoDeviceProfileForAsset(assetKey))

    expect(missing).toEqual([])
  })

  it('uses pipeline temperature bands for the default MP temperature metric', () => {
    const metric: MonitorMetric = {
      id: 'mp-temperature',
      name: '温度',
      valueType: 'number',
      unit: '°C',
      precision: 1,
      simulationMin: 16,
      simulationMax: 32,
      alarm: {
        mode: 'outside',
        minorLow: 14,
        minorHigh: 34,
        majorLow: 10,
        majorHigh: 38,
        criticalLow: 5,
        criticalHigh: 45,
      },
    }

    expect(demoMetricProfileFor('mp', metric)).toMatchObject({
      semanticKey: 'deviceTemperature',
      bands: {
        normal: [{ min: 16, max: 32 }],
        minor: [{ min: 14, max: 16 }, { min: 32, max: 34 }],
        major: [{ min: 10, max: 14 }, { min: 34, max: 38 }],
        critical: [{ min: 5, max: 10 }, { min: 38, max: 45 }],
      },
    })
  })

  it('allocates a small deterministic anomaly budget per page', () => {
    const elements = Array.from({ length: 40 }, (_, index) => element(`cabinet-${index}`))
    const first = createDemoAnomalyAssignments(elements, 'stable-seed')
    const second = createDemoAnomalyAssignments([...elements].reverse(), 'stable-seed')

    expect(first).toEqual(second)
    expect(Object.keys(first)).toHaveLength(demoAnomalyCount(40, 'stable-seed:diagram-a'))
    expect(Object.keys(first)).toHaveLength(1)
  })

  it('does not take a unique source or pump offline in the default demo', () => {
    const protectedElements = [
      element('grid-only', 'grid'),
      { ...element('pump-only', 'chwp'), diagramId: 'diagram-b' },
    ]
    const assignments = createDemoAnomalyAssignments(protectedElements, 'offline-protection')

    expect(Object.values(assignments).map((item) => item.severity)).not.toContain('offline')
  })

  it('assigns one online fault per page, preferring fault artwork even with hidden metrics', () => {
    const elements = [
      element('grid', 'grid'),
      { ...element('tmu', 'tmu'), monitorDataVisible: false },
      { ...element('ct', 'ct'), diagramId: 'diagram-b' },
      { ...element('pump', 'chwp'), diagramId: 'diagram-b' },
    ]
    const assignments = createDemoAnomalyAssignments(elements, 'one-fault-per-page')
    expect(Object.keys(assignments).sort()).toEqual(['ct', 'tmu'])
    expect(Object.values(assignments).every((assignment) => assignment.severity !== 'offline')).toBe(true)
    expect(createDemoAnomalyAssignments([], 'one-fault-per-page')).toEqual({})
  })

  it('retains fault states without injecting metrics and reproduces them after reset', () => {
    const elements = Array.from({ length: 8 }, (_, index) => element(`cabinet-${index}`))
    const provider = new DemoMonitorMetricDataProvider({ seed: 'provider-seed' })
    const prepared = provider.prepareOwners(elements)
    const injected = prepared.filter((owner) => owner.monitorMetrics?.length)

    expect(injected).toHaveLength(0)
    const first = provider.getRuntimeSnapshot(prepared)
    provider.reset()
    const replay = provider.getRuntimeSnapshot(prepared)

    expect(replay).toEqual(first)
    expect(Object.values(first.deviceStates).filter((state) => state.health !== 'normal')).toHaveLength(1)
  })

  it('does not move the scenario clock when a page only reads another snapshot', () => {
    const owner = element('clock-cabinet', 'cabinet-device', defaultDemoMetricsForElement({ assetKey: 'cabinet-device' }))
    const provider = new DemoMonitorMetricDataProvider({
      anomalyAssignments: {
        [owner.id]: { severity: 'minor', faultCode: 'profile-anomaly' },
      },
    })
    const prepared = provider.prepareOwners([owner])
    const first = provider.getRuntimeSnapshot(prepared)
    const reread = provider.getRuntimeSnapshot(prepared)
    provider.advance()
    const advanced = provider.getRuntimeSnapshot(prepared)

    expect(reread).toEqual(first)
    expect(advanced.timestamp).toBe(3_000)
    expect(advanced.readings).not.toEqual(first.readings)
  })

  it('uses profile severity instead of an arbitrary configured threshold', () => {
    const configured: MonitorMetric = {
      id: 'cabinet-power',
      name: '有功功率',
      valueType: 'number',
      unit: 'kW',
      precision: 1,
      simulationMin: 0,
      simulationMax: 9999,
      alarm: { mode: 'upper', minor: 1, major: 2, critical: 3 },
    }
    const owner = element('cabinet-profile', 'cabinet-device', [configured])
    const provider = new DemoMonitorMetricDataProvider({
      seed: 'profile-seed',
      anomalyAssignments: {
        [owner.id]: { severity: 'major', faultCode: 'profile-anomaly' },
      },
    })
    const reading = provider.getRuntimeSnapshot(provider.prepareOwners([owner])).readings[
      monitorMetricReadingKey(owner.id, configured.id)
    ]

    expect(reading.severity).toBe('major')
    expect(reading.value).toBeTypeOf('number')
    expect(reading.value as number).toBeGreaterThanOrEqual(12)
    expect(reading.value as number).toBeLessThan(14)
  })

  it('keeps lithium battery-group SOC above 80 and derives backup time from it', () => {
    const backupMetric: MonitorMetric = {
      id: 'battery-backup',
      name: '备电时间',
      valueType: 'number',
      unit: 'h',
      precision: 0,
      simulationMin: 0,
      simulationMax: 100,
      alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
    }
    const socMetric: MonitorMetric = {
      id: 'battery-soc',
      name: '剩余电量',
      valueType: 'number',
      unit: '%',
      precision: 0,
      simulationMin: 0,
      simulationMax: 100,
      alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
    }
    const owner = element('battery-group-1', 'battery-group', [backupMetric, socMetric])
    const provider = new DemoMonitorMetricDataProvider({
      anomalyAssignments: {
        [owner.id]: { severity: 'major', faultCode: 'profile-anomaly' },
      },
    })
    const prepared = provider.prepareOwners([owner])
    const runtimeBackupMetric = prepared[0].monitorMetrics?.find((metric) => (
      metric.id === backupMetric.id
    ))

    expect(runtimeBackupMetric?.valueType).toBe('number')
    expect(runtimeBackupMetric?.valueType === 'number' && runtimeBackupMetric.precision).toBe(1)
    expect(backupMetric.precision).toBe(0)

    for (let tick = 0; tick < 12; tick += 1) {
      const readings = provider.getRuntimeSnapshot(prepared).readings
      const backupReading = readings[monitorMetricReadingKey(owner.id, backupMetric.id)]
      const socReading = readings[monitorMetricReadingKey(owner.id, socMetric.id)]

      expect(backupReading.severity).toBe('major')
      expect(socReading.severity).toBe('normal')
      expect(socReading.value).toBeTypeOf('number')
      expect(socReading.value as number).toBeGreaterThan(80)
      expect(backupReading.value).toBe(
        Math.round(2 * (socReading.value as number) / 100 * 0.45 * 10) / 10,
      )
      provider.advance()
    }
  })

  it('normalizes historical runtime units without mutating the source metric', () => {
    expect(normalizeDemoMetricUnit('HZ')).toBe('Hz')
    expect(normalizeDemoMetricUnit('m²/h')).toBe('m³/h')
    expect(normalizeDemoMetricUnit('³m/h')).toBe('m³/h')
  })

  it('preserves configured metrics instead of replacing them with extra profile metrics', () => {
    const invalidMetric: MonitorMetric = {
      id: 'phe-frequency',
      name: '频率',
      valueType: 'number',
      unit: 'Hz',
      precision: 1,
      simulationMin: 0,
      simulationMax: 100,
      alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
    }
    const owner = element('phe-1', 'phe', [invalidMetric])
    const provider = new DemoMonitorMetricDataProvider({
      anomalyAssignments: {
        [owner.id]: { severity: 'minor', faultCode: 'profile-anomaly' },
      },
    })
    const prepared = provider.prepareOwners([owner])[0]

    expect(prepared.monitorMetrics?.map((item) => item.name)).toEqual(['频率'])
    expect(owner.monitorMetrics?.[0]).toBe(invalidMetric)
  })

  it('represents offline readings as unavailable and stops the device state', () => {
    const owner = element('offline-pump', 'chwp', defaultDemoMetricsForElement({ assetKey: 'chwp' }))
    const provider = new DemoMonitorMetricDataProvider({
      anomalyAssignments: {
        [owner.id]: { severity: 'offline', faultCode: 'communication-offline' },
      },
    })
    const prepared = provider.prepareOwners([owner])
    const snapshot = provider.getRuntimeSnapshot(prepared)

    expect(snapshot.deviceStates[owner.id]).toMatchObject({
      health: 'offline',
      operation: 'stopped',
      online: false,
    })
    expect(Object.values(snapshot.readings)).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '--', severity: 'critical' }),
    ]))
  })

  it('keeps a normally closed valve neutral with a near-zero position', () => {
    const positionMetric: MonitorMetric = {
      id: 'valve-position',
      name: '阀门开度',
      valueType: 'number',
      unit: '%',
      precision: 0,
      simulationMin: 0,
      simulationMax: 100,
      alarm: { mode: 'lower', critical: 20, major: 40, minor: 70 },
    }
    const owner = {
      ...element('closed-valve', '2-wv', [positionMetric]),
      runtimeOperation: 'off' as const,
    }
    const provider = new DemoMonitorMetricDataProvider({
      anomalyAssignments: {
        [owner.id]: { severity: 'minor', faultCode: 'profile-anomaly' },
      },
    })
    const prepared = provider.prepareOwners([owner])
    const snapshot = provider.getRuntimeSnapshot(prepared)
    const valveMetric = prepared[0].monitorMetrics?.find((item) => item.name === '阀门开度')
    const reading = valveMetric
      ? snapshot.readings[monitorMetricReadingKey(owner.id, valveMetric.id)]
      : undefined

    expect(snapshot.deviceStates[owner.id].operation).toBe('closed')
    expect(reading?.value).toBeTypeOf('number')
    expect(reading?.value as number).toBeGreaterThanOrEqual(5)
    expect(reading?.value as number).toBeLessThan(15)
    expect(reading?.severity).toBe('minor')
  })

  it('keeps Supply and Load standby state neutral while zeroing active metrics', () => {
    const activePowerMetric: MonitorMetric = {
      id: 'active-power',
      name: '有功功率',
      valueType: 'number',
      unit: 'kW',
      precision: 0,
      simulationMin: 0,
      simulationMax: 1000,
      alarm: { mode: 'upper', minor: 800, major: 900, critical: 1000 },
    }
    const owners = ['supply', 'load'].map((assetKey) => ({
      ...element(`${assetKey}-standby`, assetKey, [activePowerMetric]),
      runtimeOperation: 'standby' as const,
    }))
    const provider = new DemoMonitorMetricDataProvider({ anomalyAssignments: {} })
    const prepared = provider.prepareOwners(owners)
    const snapshot = provider.getRuntimeSnapshot(prepared)

    for (const owner of prepared) {
      expect(snapshot.deviceStates[owner.id]).toMatchObject({
        health: 'normal',
        operation: 'standby',
        online: true,
      })
      expect(snapshot.readings[monitorMetricReadingKey(owner.id, activePowerMetric.id)])
        .toMatchObject({ value: 0, severity: 'normal' })
    }
  })
})
