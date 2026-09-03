import {
  elementUsesOnOffState,
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

export const defaultCoolingRuntimeProvider = new MockCoolingRuntimeProvider()

export const EMPTY_DIAGRAM_RUNTIME_STATE: DiagramRuntimeState = {
  onOffStates: {},
  coolingPumpRunningStates: {},
  coolingPumpOutputPowerStates: {},
  coolingValveOpenStates: {},
  powerExternalSupplyActive: false,
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
  return {
    onOffStates,
    coolingPumpRunningStates,
    coolingPumpOutputPowerStates,
    coolingValveOpenStates,
    powerExternalSupplyActive: active && lineSystem?.type === 'power'
      ? isPowerDiagramExternallyEnergized({ document, diagramId, switchStates: onOffStates })
      : false,
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
