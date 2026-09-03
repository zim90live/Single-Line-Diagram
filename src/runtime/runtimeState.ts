import {
  elementUsesOnOffState,
  projectOnOffStates,
  type AssetDefinition,
  type ConnectionNetwork,
  type DiagramElement,
  type ProjectDocument,
} from '../domain/project'
import {
  deriveCoolingFlowTopology,
  type CoolingFlowTopology,
} from '../monitoring/coolingFlowTopology'
import {
  MockCoolingRuntimeProvider,
  type CoolingRuntimeProvider,
  type CoolingRuntimeSnapshot,
} from '../monitoring/coolingRuntime'
import { isPowerDiagramExternallyEnergized } from '../monitoring/powerDiagramContext'
import type { DiagramRuntimeState } from './types'
import type { DemoDeviceRuntimeState } from './demoSimulationProfiles'

export const defaultCoolingRuntimeProvider = new MockCoolingRuntimeProvider()

export const EMPTY_DIAGRAM_RUNTIME_STATE: DiagramRuntimeState = {
  onOffStates: {},
  coolingPumpRunningStates: {},
  coolingPumpOutputPowerStates: {},
  coolingValveOpenStates: {},
  powerExternalSupplyActive: false,
}

export function projectCoolingPumpRuntimeStates(document: ProjectDocument) {
  const pumpAssetKeys = new Set(document.assets.flatMap((asset) => (
    asset.coolingDeviceRole === 'pump' ? [asset.key] : []
  )))
  return document.elements.reduce<Pick<
    DiagramRuntimeState,
    'coolingPumpRunningStates' | 'coolingPumpOutputPowerStates'
  >>((states, element) => {
    if (!pumpAssetKeys.has(element.assetKey)) return states
    if (element.coolingPumpRunning !== undefined) {
      states.coolingPumpRunningStates[element.id] = element.coolingPumpRunning
    }
    if (element.coolingPumpOutputPower !== undefined) {
      states.coolingPumpOutputPowerStates[element.id] = element.coolingPumpOutputPower
    }
    return states
  }, {
    coolingPumpRunningStates: {},
    coolingPumpOutputPowerStates: {},
  })
}

export function createDiagramRuntimeState({
  document,
  diagramId,
  active,
  onOffStates,
  coolingPumpRunningStates = {},
  coolingPumpOutputPowerStates = {},
  coolingValveOpenStates = {},
}: {
  document: ProjectDocument
  diagramId: string
  active: boolean
  onOffStates: Record<string, boolean>
  coolingPumpRunningStates?: Record<string, boolean>
  coolingPumpOutputPowerStates?: Record<string, number>
  coolingValveOpenStates?: Record<string, boolean>
}): DiagramRuntimeState {
  const diagram = document.diagrams.find((candidate) => candidate.id === diagramId)
  const lineSystem = document.lineSystems.find((candidate) => (
    candidate.id === diagram?.lineSystemId
  ))
  const persistedPumpStates = projectCoolingPumpRuntimeStates(document)
  return {
    onOffStates: {
      ...projectOnOffStates(document),
      ...onOffStates,
    },
    coolingPumpRunningStates: {
      ...persistedPumpStates.coolingPumpRunningStates,
      ...coolingPumpRunningStates,
    },
    coolingPumpOutputPowerStates: {
      ...persistedPumpStates.coolingPumpOutputPowerStates,
      ...coolingPumpOutputPowerStates,
    },
    coolingValveOpenStates,
    powerExternalSupplyActive: active && lineSystem?.type === 'power'
      ? isPowerDiagramExternallyEnergized({ document, diagramId, switchStates: onOffStates })
      : false,
  }
}

export function applyDemoDeviceStatesToRuntime({
  state,
  elements,
  assets,
  deviceStates,
}: {
  state: DiagramRuntimeState
  elements: DiagramElement[]
  assets: AssetDefinition[]
  deviceStates: Record<string, DemoDeviceRuntimeState>
}): DiagramRuntimeState {
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const coolingPumpRunningStates = { ...state.coolingPumpRunningStates }
  const coolingValveOpenStates = { ...state.coolingValveOpenStates }
  const onOffStates = { ...state.onOffStates }
  elements.forEach((element) => {
    const deviceState = deviceStates[element.id]
    if (deviceState?.online !== false) return
    const role = assetsByKey.get(element.assetKey)?.coolingDeviceRole
    if (role === 'pump' && !(element.id in coolingPumpRunningStates)) {
      coolingPumpRunningStates[element.id] = false
    }
    if ((role === 'valve' || role === 'check-valve') && !(element.id in coolingValveOpenStates)) {
      coolingValveOpenStates[element.id] = false
    }
    if (!(element.id in onOffStates) && elementUsesOnOffState(element)) {
      onOffStates[element.id] = false
    }
  })
  return {
    ...state,
    onOffStates,
    coolingPumpRunningStates,
    coolingValveOpenStates,
  }
}

export function createCoolingRuntimeSnapshot({
  elements,
  assets,
  state,
  provider = defaultCoolingRuntimeProvider,
}: {
  elements: DiagramElement[]
  assets: AssetDefinition[]
  state: DiagramRuntimeState
  provider?: CoolingRuntimeProvider
}): CoolingRuntimeSnapshot {
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const persistentValveOpenStates = Object.fromEntries(elements.flatMap((element) => (
    ['valve', 'check-valve'].includes(
      assetsByKey.get(element.assetKey)?.coolingDeviceRole ?? '',
    ) && elementUsesOnOffState(element)
      ? [[element.id, state.onOffStates[element.id] ?? false] as const]
      : []
  )))
  return provider.getSnapshot({
    elements,
    assets,
    pumpRunningOverrides: state.coolingPumpRunningStates,
    pumpOutputPowerOverrides: state.coolingPumpOutputPowerStates,
    valveOpenOverrides: {
      ...state.coolingValveOpenStates,
      ...persistentValveOpenStates,
    },
  })
}

function emptyCoolingFlowTopology(): CoolingFlowTopology {
  return {
    edges: [],
    diagnostics: [],
    activePumpElementIds: new Set<string>(),
    pumpFlowRates: {},
  }
}

export function evaluateCoolingRuntime({
  active,
  elements,
  assets,
  connections,
  state,
  provider,
}: {
  active: boolean
  elements: DiagramElement[]
  assets: AssetDefinition[]
  connections: ConnectionNetwork[]
  state: DiagramRuntimeState
  provider?: CoolingRuntimeProvider
}) {
  const snapshot = createCoolingRuntimeSnapshot({ elements, assets, state, provider })
  return {
    snapshot,
    topology: active
      ? deriveCoolingFlowTopology({ elements, assets, networks: connections, runtime: snapshot })
      : emptyCoolingFlowTopology(),
  }
}
