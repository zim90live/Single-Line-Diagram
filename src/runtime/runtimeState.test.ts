import { describe, expect, it, vi } from 'vitest'

import type {
  AssetDefinition,
  DiagramElement,
} from '../domain/project'
import { createDefaultProject } from '../domain/project'
import type { CoolingRuntimeInput, CoolingRuntimeProvider } from '../monitoring/coolingRuntime'
import {
  applyDemoDeviceStatesToRuntime,
  createCoolingRuntimeSnapshot,
  createDiagramRuntimeState,
} from './runtimeState'
import type { DiagramRuntimeState } from './types'

const valveAsset: AssetDefinition = {
  key: '2-wv',
  name: '2WV',
  category: 'cooling',
  source: '/2-wv.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  anchors: [],
  coolingDeviceRole: 'valve',
}

const valveElement: DiagramElement = {
  id: 'valve-a',
  diagramId: 'diagram-a',
  assetKey: '2-wv',
  name: '2WV',
  x: 0,
  y: 0,
  width: 32,
  height: 32,
  rotation: 0,
  properties: {},
  extensions: {},
}

describe('diagram runtime state', () => {
  it('hydrates saved pump controls and lets explicit host overrides win', () => {
    const pumpAsset: AssetDefinition = {
      ...valveAsset,
      key: 'cwp',
      name: 'CWP',
      coolingDeviceRole: 'pump',
    }
    const document = createDefaultProject('水泵运行快照', [pumpAsset])
    document.elements = [{
      ...valveElement,
      id: 'pump-a',
      assetKey: 'cwp',
      coolingPumpRunning: false,
      coolingPumpOutputPower: 35,
    }]

    const persisted = createDiagramRuntimeState({
      document,
      diagramId: document.diagrams[0].id,
      active: true,
      onOffStates: {},
    })
    expect(persisted.coolingPumpRunningStates).toEqual({ 'pump-a': false })
    expect(persisted.coolingPumpOutputPowerStates).toEqual({ 'pump-a': 35 })

    const overridden = createDiagramRuntimeState({
      document,
      diagramId: document.diagrams[0].id,
      active: true,
      onOffStates: {},
      coolingPumpRunningStates: { 'pump-a': true },
      coolingPumpOutputPowerStates: { 'pump-a': 80 },
    })
    expect(overridden.coolingPumpRunningStates).toEqual({ 'pump-a': true })
    expect(overridden.coolingPumpOutputPowerStates).toEqual({ 'pump-a': 80 })
  })

  it('adapts persisted On/Off valve state before invoking an injected provider', () => {
    let capturedInput: CoolingRuntimeInput | undefined
    const getSnapshot = vi.fn((input: CoolingRuntimeInput) => {
      capturedInput = input
      return { source: 'telemetry' as const, timestamp: 123, pumps: {}, valves: {} }
    })
    const provider: CoolingRuntimeProvider = { getSnapshot }
    const state: DiagramRuntimeState = {
      onOffStates: { 'valve-a': false },
      coolingPumpRunningStates: {},
      coolingPumpOutputPowerStates: {},
      coolingValveOpenStates: { 'valve-a': true },
      powerExternalSupplyActive: false,
    }

    const snapshot = createCoolingRuntimeSnapshot({
      elements: [valveElement],
      assets: [valveAsset],
      state,
      provider,
    })

    expect(snapshot).toMatchObject({ source: 'telemetry', timestamp: 123 })
    expect(getSnapshot).toHaveBeenCalledOnce()
    expect(capturedInput?.valveOpenOverrides).toEqual({ 'valve-a': false })
  })

  it('stops an offline pump unless a host supplied an explicit runtime override', () => {
    const pumpAsset: AssetDefinition = {
      ...valveAsset,
      key: 'chwp',
      name: 'CHWP',
      coolingDeviceRole: 'pump',
    }
    const pumpElement: DiagramElement = {
      ...valveElement,
      id: 'pump-a',
      assetKey: 'chwp',
    }
    const base: DiagramRuntimeState = {
      onOffStates: {},
      coolingPumpRunningStates: {},
      coolingPumpOutputPowerStates: {},
      coolingValveOpenStates: {},
      powerExternalSupplyActive: false,
    }
    const offline = {
      'pump-a': {
        health: 'offline' as const,
        operation: 'stopped' as const,
        online: false,
        faultCode: 'communication-offline',
      },
    }

    expect(applyDemoDeviceStatesToRuntime({
      state: base,
      elements: [pumpElement],
      assets: [pumpAsset],
      deviceStates: offline,
    }).coolingPumpRunningStates['pump-a']).toBe(false)
    expect(applyDemoDeviceStatesToRuntime({
      state: { ...base, coolingPumpRunningStates: { 'pump-a': true } },
      elements: [pumpElement],
      assets: [pumpAsset],
      deviceStates: offline,
    }).coolingPumpRunningStates['pump-a']).toBe(true)
  })
})
