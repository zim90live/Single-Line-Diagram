import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import {
  connectionRouteInputsEqual,
  previewConnectionRoutesForDiagram,
  type RoutedConnections,
} from './connections'
import {
  createBrowserRouteJobRunner,
  createLatestRouteScheduler,
  type LatestRouteScheduler,
  type RouteComputationInput,
  type RouteComputationStats,
} from './routeEngine'

const EMPTY_ROUTED_CONNECTIONS: RoutedConnections = {
  edges: [],
  crossings: [],
  invalidEdgeIds: [],
  resolvedBusbarTapOffsets: {},
}

export interface RouteSnapshot {
  input: RouteComputationInput
  routed: RoutedConnections
}

function currentEdgeIds(input: RouteComputationInput) {
  return new Set(input.networks.flatMap((network) => network.edges.map((edge) => edge.id)))
}

export function routedConnectionsForInput(
  snapshot: RouteSnapshot | null,
  input: RouteComputationInput,
) {
  if (!snapshot || snapshot.input.scopeKey !== input.scopeKey) return EMPTY_ROUTED_CONNECTIONS
  if (
    snapshot.input.networks === input.networks &&
    snapshot.input.elements === input.elements &&
    snapshot.input.assets === input.assets &&
    snapshot.input.gridSize === input.gridSize &&
    snapshot.input.busbars === input.busbars
  ) return snapshot.routed
  if (connectionRouteInputsEqual(snapshot.input, input)) return snapshot.routed

  const retainedEdgeIds = currentEdgeIds(input)
  const retainedEdges = snapshot.routed.edges.filter((edge) => retainedEdgeIds.has(edge.edgeId))
  const retainedRouteIds = new Set(retainedEdges.map((edge) => edge.edgeId))
  const retainedRouted: RoutedConnections = {
    ...snapshot.routed,
    edges: retainedEdges,
    crossings: snapshot.routed.crossings.filter((crossing) => (
      retainedRouteIds.has(crossing.bridgeEdgeId) && retainedRouteIds.has(crossing.underEdgeId)
    )),
  }
  return previewConnectionRoutesForDiagram(
    retainedRouted,
    snapshot.input.networks,
    input.networks,
    snapshot.input.elements,
    input.elements,
    input.assets,
    input.gridSize,
    snapshot.input.busbars,
    input.busbars,
  )
}

export function useRoutedConnections(input: RouteComputationInput) {
  const schedulerRef = useRef<LatestRouteScheduler | null>(null)
  const requestedInputRef = useRef<RouteComputationInput | null>(null)
  const [snapshot, setSnapshot] = useState<RouteSnapshot | null>(null)
  const [isRouting, setIsRouting] = useState(false)
  const [routeStats, setRouteStats] = useState<RouteComputationStats | null>(null)

  useEffect(() => {
    schedulerRef.current = createLatestRouteScheduler(
      createBrowserRouteJobRunner(),
      (completedInput, routed, stats) => {
        startTransition(() => {
          setSnapshot({ input: completedInput, routed })
          setRouteStats(stats ?? null)
          setIsRouting(false)
        })
      },
    )
    return () => {
      schedulerRef.current?.dispose()
      schedulerRef.current = null
      requestedInputRef.current = null
    }
  }, [])

  useEffect(() => {
    const requested = requestedInputRef.current
    if (
      requested?.scopeKey === input.scopeKey &&
      connectionRouteInputsEqual(requested, input)
    ) return
    requestedInputRef.current = input
    setIsRouting(true)
    schedulerRef.current?.request(input)
  }, [input])

  const routed = useMemo(
    () => routedConnectionsForInput(snapshot, input),
    [input, snapshot],
  )

  return { routed, isRouting, routeStats }
}
