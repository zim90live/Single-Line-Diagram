import { useEffect, useMemo, useRef, useState } from 'react'

import {
  generateMonitorMetricPreviewReadings,
  MONITOR_METRIC_REFRESH_MS,
  type MonitorMetricOwner,
} from '../monitoring/elementMetrics'
import {
  defaultMonitorMetricDataProvider,
  type MonitorMetricDataProvider,
  type MonitorMetricRuntimeSnapshot,
} from './metricDataProvider'

const EMPTY_RUNTIME_SNAPSHOT: MonitorMetricRuntimeSnapshot = {
  timestamp: 0,
  readings: {},
  deviceStates: {},
}

export function useMonitorMetricRuntimeSnapshot(
  enabled: boolean,
  owners: MonitorMetricOwner[],
  provider: MonitorMetricDataProvider = defaultMonitorMetricDataProvider,
  playing = true,
) {
  const configurationKey = useMemo(() => JSON.stringify(owners.map((owner) => ({
    id: owner.id,
    assetKey: owner.assetKey,
    monitorDataVisible: owner.monitorDataVisible,
    runtimeOperation: owner.runtimeOperation,
    monitorMetrics: owner.monitorMetrics,
  }))), [owners])
  const previewReadings = useMemo(
    () => generateMonitorMetricPreviewReadings(owners),
    [configurationKey],
  )
  const [snapshot, setSnapshot] = useState<MonitorMetricRuntimeSnapshot>(EMPTY_RUNTIME_SNAPSHOT)
  const pausedConfigurationRef = useRef<string | null>(null)
  const pausedProviderRef = useRef<MonitorMetricDataProvider | null>(null)

  useEffect(() => {
    if (!enabled) {
      setSnapshot((current) => Object.keys(current.readings).length
        ? EMPTY_RUNTIME_SNAPSHOT
        : current)
      return
    }
    const update = (advance = false) => {
      if (advance) provider.advance?.()
      setSnapshot(provider.getRuntimeSnapshot?.(owners) ?? {
        timestamp: Date.now(),
        readings: provider.getSnapshot(owners),
        deviceStates: {},
      })
    }
    if (!playing) {
      if (
        pausedConfigurationRef.current !== configurationKey ||
        pausedProviderRef.current !== provider
      ) update()
      pausedConfigurationRef.current = configurationKey
      pausedProviderRef.current = provider
      return
    }
    pausedConfigurationRef.current = configurationKey
    pausedProviderRef.current = provider
    update()
    if (provider.subscribe) {
      return provider.subscribe(owners, (readings) => setSnapshot((current) => ({
        ...current,
        timestamp: Date.now(),
        readings,
      })))
    }
    const refreshMs = provider.refreshMs === undefined
      ? MONITOR_METRIC_REFRESH_MS
      : provider.refreshMs
    if (refreshMs === null) return
    const intervalId = window.setInterval(() => update(true), refreshMs)
    return () => window.clearInterval(intervalId)
  }, [configurationKey, enabled, playing, provider])

  return enabled ? snapshot : {
    timestamp: 0,
    readings: previewReadings,
    deviceStates: {},
  }
}

export function useMonitorMetricReadings(
  enabled: boolean,
  owners: MonitorMetricOwner[],
  provider: MonitorMetricDataProvider = defaultMonitorMetricDataProvider,
) {
  const preparedOwners = useMemo(
    () => provider.prepareOwners?.(owners) ?? owners,
    [owners, provider],
  )
  return useMonitorMetricRuntimeSnapshot(enabled, preparedOwners, provider).readings
}
