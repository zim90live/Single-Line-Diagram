import {
  generateMonitorMetricReadings,
  MONITOR_METRIC_REFRESH_MS,
  type MonitorMetricOwner,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'
import type { DemoDeviceRuntimeState } from './demoSimulationProfiles'

export interface MonitorMetricRuntimeSnapshot {
  timestamp: number
  readings: MonitorMetricReadings
  deviceStates: Record<string, DemoDeviceRuntimeState>
}

export interface MonitorMetricDataProvider {
  mode?: 'demo' | 'external'
  getSnapshot: (owners: readonly MonitorMetricOwner[]) => MonitorMetricReadings
  getRuntimeSnapshot?: (
    owners: readonly MonitorMetricOwner[],
  ) => MonitorMetricRuntimeSnapshot
  prepareOwners?: (
    owners: readonly MonitorMetricOwner[],
  ) => MonitorMetricOwner[]
  advance?: () => void
  subscribe?: (
    owners: readonly MonitorMetricOwner[],
    onSnapshot: (readings: MonitorMetricReadings) => void,
  ) => () => void
  refreshMs?: number | null
}

export class MockMonitorMetricDataProvider implements MonitorMetricDataProvider {
  readonly refreshMs = MONITOR_METRIC_REFRESH_MS

  getSnapshot(owners: readonly MonitorMetricOwner[]) {
    return generateMonitorMetricReadings([...owners])
  }
}

export const defaultMonitorMetricDataProvider = new MockMonitorMetricDataProvider()
