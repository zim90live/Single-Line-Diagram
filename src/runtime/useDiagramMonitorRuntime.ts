import { useMemo } from 'react'

import {
  elementUsesRunningStandbyState,
  type AssetDefinition,
  type Busbar,
  type ConnectionNetwork,
  type DiagramElement,
  type LineSystemType,
} from '../domain/project'
import {
  evaluateMonitorMetricAlarm,
  monitorMetricReadingKey,
} from '../monitoring/elementMetrics'
import {
  derivePowerFlowTopology,
  type PowerFlowTopology,
} from '../monitoring/flowTopology'
import { applyDemoDeviceStatesToRuntime, evaluateCoolingRuntime } from './runtimeState'
import type { DiagramRuntimeContext } from './types'
import { defaultDemoMonitorMetricDataProvider } from './demoMetricDataProvider'
import { useMonitorMetricRuntimeSnapshot } from './useMonitorMetricReadings'

function emptyPowerFlowTopology(): PowerFlowTopology {
  return {
    edges: [],
    busbarSegments: [],
    energizedElementIds: new Set<string>(),
    selectedSupplyChannels: {},
  }
}

export function useDiagramMonitorRuntime({
  enabled,
  lineSystemType,
  elements,
  busbars,
  connections,
  assets,
  resolvedBusbarTapOffsets,
  runtime,
  animationPlaying = true,
}: {
  enabled: boolean
  lineSystemType: LineSystemType
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  assets: AssetDefinition[]
  resolvedBusbarTapOffsets: Record<string, number>
  runtime: DiagramRuntimeContext
  animationPlaying?: boolean
}) {
  const metricProvider = runtime.providers?.metrics ?? defaultDemoMonitorMetricDataProvider
  const sourceMetricOwners = useMemo(() => [
    ...busbars,
    ...elements.map((element) => {
      const role = assets.find((asset) => asset.key === element.assetKey)?.coolingDeviceRole
      const runtimeOperation = role === 'pump'
        ? (runtime.state.coolingPumpRunningStates[element.id] ?? true) ? 'running' as const : 'stopped' as const
        : elementUsesRunningStandbyState(element)
          ? (runtime.state.onOffStates[element.id] ?? true) ? 'running' as const : 'standby' as const
        : ['switch', '2-wv', 'cv'].includes(element.assetKey)
          ? (runtime.state.onOffStates[element.id] ?? false) ? 'on' as const : 'off' as const
          : role === 'valve' || role === 'check-valve'
            ? (runtime.state.coolingValveOpenStates[element.id] ?? true) ? 'on' as const : 'off' as const
            : undefined
      return runtimeOperation ? { ...element, runtimeOperation } : element
    }),
    ...connections.flatMap((network) => network.edges),
  ], [assets, busbars, connections, elements, runtime.state])
  const metricOwners = useMemo(() => (
    enabled
      ? metricProvider.prepareOwners?.(sourceMetricOwners) ?? sourceMetricOwners
      : sourceMetricOwners
  ), [enabled, metricProvider, sourceMetricOwners])
  const metricRuntimeSnapshot = useMonitorMetricRuntimeSnapshot(
    enabled,
    metricOwners,
    metricProvider,
    animationPlaying,
  )
  const monitorMetricReadings = metricRuntimeSnapshot.readings
  const preparedOwnersById = useMemo(
    () => new Map(metricOwners.map((owner) => [owner.id, owner])),
    [metricOwners],
  )
  const metricElements = useMemo(() => elements.map((element) => (
    preparedOwnersById.get(element.id) as DiagramElement | undefined ?? element
  )), [elements, preparedOwnersById])
  const metricConnections = useMemo(() => connections.map((network) => ({
    ...network,
    edges: network.edges.map((edge) => (
      preparedOwnersById.get(edge.id) as typeof edge | undefined ?? edge
    )),
  })), [connections, preparedOwnersById])
  const effectiveRuntimeState = useMemo(() => {
    return applyDemoDeviceStatesToRuntime({
      state: runtime.state,
      elements,
      assets,
      deviceStates: metricRuntimeSnapshot.deviceStates,
    })
  }, [assets, elements, metricRuntimeSnapshot.deviceStates, runtime.state])
  const powerFlowTopology = useMemo(() => lineSystemType === 'power'
    ? derivePowerFlowTopology({
        elements,
        assets,
        busbars,
        networks: connections,
        switchStates: effectiveRuntimeState.onOffStates,
        externalSupply: effectiveRuntimeState.powerExternalSupplyActive,
        externalSupplyChannel: effectiveRuntimeState.powerExternalSupplyChannel,
        batteryBackup: effectiveRuntimeState.powerBatteryBackupActive,
        resolvedBusbarTapOffsets,
      })
    : emptyPowerFlowTopology(), [
      busbars,
      connections,
      elements,
      assets,
      lineSystemType,
      resolvedBusbarTapOffsets,
      effectiveRuntimeState.onOffStates,
      effectiveRuntimeState.powerExternalSupplyActive,
      effectiveRuntimeState.powerExternalSupplyChannel,
      effectiveRuntimeState.powerBatteryBackupActive,
    ])
  const coolingRuntime = useMemo(() => evaluateCoolingRuntime({
    active: enabled && lineSystemType === 'cooling',
    elements,
    assets,
    connections,
    state: effectiveRuntimeState,
    provider: runtime.providers?.cooling,
  }), [
    assets,
    connections,
    elements,
    enabled,
    lineSystemType,
    runtime.providers?.cooling,
    effectiveRuntimeState,
  ])
  const metricReadings = useMemo(() => {
    if (!enabled || lineSystemType !== 'cooling') return monitorMetricReadings
    const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
    const next = { ...monitorMetricReadings }
    for (const element of elements) {
      if (assetsByKey.get(element.assetKey)?.coolingDeviceRole !== 'pump') continue
      const flowRate = coolingRuntime.topology.pumpFlowRates[element.id] ?? 0
      for (const metric of element.monitorMetrics ?? []) {
        if (metric.valueType !== 'number' || !/(流量|flow)/i.test(metric.name)) continue
        const factor = 10 ** metric.precision
        const value = Math.round(flowRate * factor) / factor
        const key = monitorMetricReadingKey(element.id, metric.id)
        const current = next[key]
        const severityFactor = current?.severity === 'critical'
          ? 0.25
          : current?.severity === 'major'
            ? 0.6
            : current?.severity === 'minor'
              ? 0.82
              : 1
        const resolvedValue = current?.value === '--'
          ? '--'
          : value * severityFactor
        next[key] = {
          elementId: element.id,
          metricId: metric.id,
          value: typeof resolvedValue === 'number'
            ? Math.round(resolvedValue * factor) / factor
            : resolvedValue,
          severity: current?.severity ?? evaluateMonitorMetricAlarm(metric, value),
        }
      }
    }
    return next
  }, [
    assets,
    coolingRuntime.topology.pumpFlowRates,
    elements,
    enabled,
    lineSystemType,
    monitorMetricReadings,
  ])

  return {
    powerFlowTopology,
    coolingRuntimeSnapshot: coolingRuntime.snapshot,
    coolingFlowTopology: coolingRuntime.topology,
    metricReadings,
    metricElements,
    metricConnections,
    metricDeviceStates: metricRuntimeSnapshot.deviceStates,
    metricTimestamp: metricRuntimeSnapshot.timestamp,
    effectiveRuntimeState,
  }
}
