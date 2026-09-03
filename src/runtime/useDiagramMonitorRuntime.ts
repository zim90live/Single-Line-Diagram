import { useMemo } from 'react'

import type {
  AssetDefinition,
  Busbar,
  ConnectionNetwork,
  DiagramElement,
  LineSystemType,
} from '../domain/project'
import {
  evaluateMonitorMetricAlarm,
  monitorMetricReadingKey,
} from '../monitoring/elementMetrics'
import {
  derivePowerFlowTopology,
  type PowerFlowTopology,
} from '../monitoring/flowTopology'
import { evaluateCoolingRuntime } from './runtimeState'
import type { DiagramRuntimeContext } from './types'
import { useMonitorMetricReadings } from './useMonitorMetricReadings'

function emptyPowerFlowTopology(): PowerFlowTopology {
  return { edges: [], busbarSegments: [], energizedElementIds: new Set<string>() }
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
}: {
  enabled: boolean
  lineSystemType: LineSystemType
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  assets: AssetDefinition[]
  resolvedBusbarTapOffsets: Record<string, number>
  runtime: DiagramRuntimeContext
}) {
  const metricOwners = useMemo(() => [
    ...elements,
    ...connections.flatMap((network) => network.edges),
  ], [connections, elements])
  const monitorMetricReadings = useMonitorMetricReadings(
    enabled,
    metricOwners,
    runtime.providers?.metrics,
  )
  const powerFlowTopology = useMemo(() => lineSystemType === 'power'
    ? derivePowerFlowTopology({
        elements,
        busbars,
        networks: connections,
        switchStates: runtime.state.onOffStates,
        externalSupply: runtime.state.powerExternalSupplyActive,
        resolvedBusbarTapOffsets,
      })
    : emptyPowerFlowTopology(), [
      busbars,
      connections,
      elements,
      lineSystemType,
      resolvedBusbarTapOffsets,
      runtime.state.onOffStates,
      runtime.state.powerExternalSupplyActive,
    ])
  const coolingRuntime = useMemo(() => evaluateCoolingRuntime({
    active: enabled && lineSystemType === 'cooling',
    elements,
    assets,
    connections,
    state: runtime.state,
    provider: runtime.providers?.cooling,
  }), [
    assets,
    connections,
    elements,
    enabled,
    lineSystemType,
    runtime.providers?.cooling,
    runtime.state,
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
        next[monitorMetricReadingKey(element.id, metric.id)] = {
          elementId: element.id,
          metricId: metric.id,
          value,
          severity: evaluateMonitorMetricAlarm(metric, value),
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
  }
}
