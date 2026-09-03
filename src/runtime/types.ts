import type { CoolingRuntimeProvider } from '../monitoring/coolingRuntime'
import type { MonitorDrillDownTarget } from '../monitoring/diagramDrillDown'
import type { MonitorMetricDataProvider } from './metricDataProvider'

export interface DiagramRuntimeState {
  onOffStates: Record<string, boolean>
  coolingPumpRunningStates: Record<string, boolean>
  coolingPumpOutputPowerStates: Record<string, number>
  coolingValveOpenStates: Record<string, boolean>
  powerExternalSupplyActive: boolean
}

export interface DiagramRuntimeProviders {
  cooling?: CoolingRuntimeProvider
  metrics?: MonitorMetricDataProvider
}

export interface DiagramRuntimeContext {
  state: DiagramRuntimeState
  navigation: Readonly<Record<string, MonitorDrillDownTarget>>
  providers?: DiagramRuntimeProviders
}
