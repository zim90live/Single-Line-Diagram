import { useEffect, useMemo, useState } from 'react'

import {
  generateMonitorMetricReadings,
  generateMonitorMetricPreviewReadings,
  MONITOR_METRIC_REFRESH_MS,
  type MonitorMetricOwner,
  type MonitorMetricReadings,
} from './elementMetrics'

export function useMonitorMetricReadings(
  enabled: boolean,
  owners: MonitorMetricOwner[],
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
    const update = () => setReadings(generateMonitorMetricReadings(owners))
    update()
    const intervalId = window.setInterval(update, MONITOR_METRIC_REFRESH_MS)
    return () => window.clearInterval(intervalId)
  }, [configurationKey, enabled])

  return enabled ? readings : previewReadings
}
