import type { CoolingRuntimeProvider } from '../monitoring/coolingRuntime'
import type { MonitorDrillDownTarget } from '../monitoring/diagramDrillDown'
import type { PowerSupplyChannel } from '../domain/project'
import type { MonitorMetricDataProvider } from './metricDataProvider'

export interface DiagramRuntimeState {
  onOffStates: Record<string, boolean>
  coolingPumpRunningStates: Record<string, boolean>
  coolingPumpOutputPowerStates: Record<string, number>
  coolingValveOpenStates: Record<string, boolean>
  powerExternalSupplyActive: boolean
  /** All energized parent feeds; undefined is legacy unclassified supply, [] is none. */
  powerExternalSupplyChannels?: readonly PowerSupplyChannel[]
  /** @deprecated Single-channel host override; use powerExternalSupplyChannels. */
  powerExternalSupplyChannel?: PowerSupplyChannel
  powerBatteryBackupActive: boolean
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
