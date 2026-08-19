import { useEffect, useMemo, useState } from 'react'

import type { DiagramElement } from '../domain/project'
import {
  generateMonitorMetricReadings,
  generateMonitorMetricPreviewReadings,
  MONITOR_METRIC_REFRESH_MS,
  type MonitorMetricReadings,
} from './elementMetrics'

export function useMonitorMetricReadings(
  enabled: boolean,
  elements: DiagramElement[],
) {
  const configurationKey = useMemo(() => JSON.stringify(elements.map((element) => ({
    id: element.id,
    monitorMetrics: element.monitorMetrics,
  }))), [elements])
  const previewReadings = useMemo(
    () => generateMonitorMetricPreviewReadings(elements),
    [configurationKey],
  )
  const [readings, setReadings] = useState<MonitorMetricReadings>({})

  useEffect(() => {
    if (!enabled) {
      setReadings((current) => Object.keys(current).length ? {} : current)
      return
    }
    const update = () => setReadings(generateMonitorMetricReadings(elements))
    update()
    const intervalId = window.setInterval(update, MONITOR_METRIC_REFRESH_MS)
    return () => window.clearInterval(intervalId)
  }, [configurationKey, enabled])

  return enabled ? readings : previewReadings
}
