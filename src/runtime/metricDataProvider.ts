import {
  generateMonitorMetricReadings,
  MONITOR_METRIC_REFRESH_MS,
  type MonitorMetricOwner,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'

export interface MonitorMetricDataProvider {
  getSnapshot: (owners: readonly MonitorMetricOwner[]) => MonitorMetricReadings
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
