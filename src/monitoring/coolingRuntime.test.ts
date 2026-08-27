import { describe, expect, it } from 'vitest'

import type { AssetDefinition, DiagramElement } from '../domain/project'
import {
  MockCoolingRuntimeProvider,
  diagnoseCoolingPumpAsset,
  resolveCoolingPumpPorts,
  resolveCoolingCheckValvePorts,
} from './coolingRuntime'

const pumpAsset: AssetDefinition = {
  key: 'pump',
  name: '测试水泵',
  category: '冷却',
  source: 'pump.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  coolingDeviceRole: 'pump',
  anchors: [
    {
      id: 'inlet',
      name: '入口',
      x: 16,
      y: 0,
      direction: 'top',
      type: 'cooling-primary-cold',
      flowRole: 'inlet',
    },
    {
      id: 'outlet',
      name: '出口',
      x: 16,
      y: 32,
      direction: 'bottom',
      type: 'cooling-general',
      flowRole: 'outlet',
    },
  ],
}

function element(id: string, assetKey: string): DiagramElement {
  return {
    id,
    diagramId: 'diagram',
    assetKey,
    name: id,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

describe('cooling runtime provider', () => {
  it('accepts one compatible cooling inlet and outlet', () => {
    expect(diagnoseCoolingPumpAsset(pumpAsset)).toEqual([])
    expect(resolveCoolingPumpPorts(pumpAsset)).toMatchObject({
      inlet: { id: 'inlet' },
      outlet: { id: 'outlet' },
    })
  })

  it('reports incomplete and incompatible pump port configuration', () => {
    const invalid: AssetDefinition = {
      ...pumpAsset,
      anchors: [
        { ...pumpAsset.anchors[0], type: 'electrical' },
        { ...pumpAsset.anchors[1], flowRole: undefined },
      ],
    }
    expect(diagnoseCoolingPumpAsset(invalid).map((item) => item.code)).toEqual([
      'pump-outlet-missing',
      'pump-port-electrical',
    ])
    expect(resolveCoolingPumpPorts(invalid)).toBeNull()
  })

  it('resolves a check valve only when it has one compatible inlet and outlet', () => {
    const checkValveAsset: AssetDefinition = {
      ...pumpAsset,
      key: 'check-valve',
      name: '测试止回阀',
      coolingDeviceRole: 'check-valve',
    }
    expect(resolveCoolingCheckValvePorts(checkValveAsset)).toMatchObject({
      inlet: { id: 'inlet' },
      outlet: { id: 'outlet' },
    })
    expect(resolveCoolingCheckValvePorts({
      ...checkValveAsset,
      anchors: checkValveAsset.anchors.map((anchor) => ({ ...anchor, flowRole: 'inlet' })),
    })).toBeNull()
  })

  it('produces deterministic session runtime without changing project data', () => {
    const valveAsset: AssetDefinition = {
      ...pumpAsset,
      key: 'valve',
      name: '测试阀门',
      coolingDeviceRole: 'valve',
      anchors: pumpAsset.anchors.map(({ flowRole: _flowRole, ...anchor }) => anchor),
    }
    const provider = new MockCoolingRuntimeProvider(50)
    const input = {
      elements: [
        element('pump-1', 'pump'),
        element('valve-1', 'valve'),
        element('check-valve-1', 'check-valve'),
      ],
      assets: [pumpAsset, valveAsset, {
        ...pumpAsset,
        key: 'check-valve',
        coolingDeviceRole: 'check-valve' as const,
      }],
      pumpRunningOverrides: { 'pump-1': false },
      pumpOutputPowerOverrides: { 'pump-1': 72 },
      valveOpenOverrides: { 'valve-1': false, 'check-valve-1': true },
    }
    expect(provider.getSnapshot(input)).toEqual(provider.getSnapshot(input))
    expect(provider.getSnapshot(input)).toMatchObject({
      source: 'mock',
      timestamp: 0,
      pumps: {
        'pump-1': {
          running: false,
          outputPowerPercent: 72,
          ratedFlow: 100,
          targetFlow: 0,
        },
      },
      valves: {
        'valve-1': { open: false },
        'check-valve-1': { open: true },
      },
    })
  })

  it('derives target flow from clamped output power', () => {
    const provider = new MockCoolingRuntimeProvider()
    const pump = element('pump-1', 'pump')
    expect(provider.getSnapshot({
      elements: [pump],
      assets: [pumpAsset],
      pumpOutputPowerOverrides: { 'pump-1': 50 },
    }).pumps['pump-1']).toMatchObject({
      running: true,
      outputPowerPercent: 50,
      ratedFlow: 100,
      targetFlow: 50,
    })
    expect(provider.getSnapshot({
      elements: [pump],
      assets: [pumpAsset],
      pumpOutputPowerOverrides: { 'pump-1': 120 },
    }).pumps['pump-1'].targetFlow).toBe(100)
  })
})
