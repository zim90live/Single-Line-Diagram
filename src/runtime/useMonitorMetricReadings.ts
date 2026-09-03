import { useEffect, useMemo, useState } from 'react'

import {
  generateMonitorMetricPreviewReadings,
  MONITOR_METRIC_REFRESH_MS,
  type MonitorMetricOwner,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'
import {
  defaultMonitorMetricDataProvider,
  type MonitorMetricDataProvider,
} from './metricDataProvider'

export function useMonitorMetricReadings(
  enabled: boolean,
  owners: MonitorMetricOwner[],
  provider: MonitorMetricDataProvider = defaultMonitorMetricDataProvider,
) {
  const configurationKey = useMemo(() => JSON.stringify(owners.map((owner) => ({
    id: owner.id,
    monitorMetrics: owner.monitorMetrics,
  }))), [owners])
  const previewReadings = useMemo(
    () => generateMonitorMetricPreviewReadings(owners),
    [configurationKey],
  )
  const [readings, setReadings] = useState<MonitorMetricReadings>({})

  useEffect(() => {
    if (!enabled) {
      setReadings((current) => Object.keys(current).length ? {} : current)
      return
    }
    const update = () => setReadings(provider.getSnapshot(owners))
    update()
    if (provider.subscribe) return provider.subscribe(owners, setReadings)
    const refreshMs = provider.refreshMs === undefined
      ? MONITOR_METRIC_REFRESH_MS
      : provider.refreshMs
    if (refreshMs === null) return
    const intervalId = window.setInterval(update, refreshMs)
    return () => window.clearInterval(intervalId)
  }, [configurationKey, enabled, provider])

  return enabled ? readings : previewReadings
}
