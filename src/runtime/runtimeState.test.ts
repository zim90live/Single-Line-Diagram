import { describe, expect, it, vi } from 'vitest'

import type {
  AssetDefinition,
  DiagramElement,
} from '../domain/project'
import type { CoolingRuntimeInput, CoolingRuntimeProvider } from '../monitoring/coolingRuntime'
import { createCoolingRuntimeSnapshot } from './runtimeState'
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
})
