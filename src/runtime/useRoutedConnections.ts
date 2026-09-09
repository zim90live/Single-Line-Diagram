import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import {
  connectionRouteInputsEqual,
  previewConnectionRoutesForDiagram,
  type RoutedConnections,
} from '../scene/connections'
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

function currentRouteIdentities(input: RouteComputationInput) {
  return new Set(input.networks.flatMap((network) => network.edges.map((edge) => (
    `${network.id}::${edge.id}`
  ))))
}

function currentEdgeIds(input: RouteComputationInput) {
  return new Set(input.networks.flatMap((network) => network.edges.map((edge) => edge.id)))
}

function retainRoutesForInput(routed: RoutedConnections, input: RouteComputationInput) {
  const retainedRouteIdentities = currentRouteIdentities(input)
  const retainedCurrentEdgeIds = currentEdgeIds(input)
  const seenRouteIdentities = new Set<string>()
  const retainedEdges = routed.edges.reduceRight<RoutedConnections['edges']>((result, edge) => {
    const identity = `${edge.networkId}::${edge.edgeId}`
    if (!retainedRouteIdentities.has(identity) || seenRouteIdentities.has(identity)) return result
    seenRouteIdentities.add(identity)
    result.unshift(edge)
    return result
  }, [])
  const retainedEdgeIds = new Set(retainedEdges.map((edge) => edge.edgeId))
  const retainedBusbarIds = new Set(input.busbars.map((busbar) => `busbar:${busbar.id}`))
  const retainedCrossings = routed.crossings.filter((crossing) => (
    retainedEdgeIds.has(crossing.bridgeEdgeId) && (
      retainedEdgeIds.has(crossing.underEdgeId) || retainedBusbarIds.has(crossing.underEdgeId)
    )
  ))
  const retainedInvalidEdgeIds = routed.invalidEdgeIds.filter((edgeId) => (
    retainedCurrentEdgeIds.has(edgeId)
  ))
  if (
    retainedEdges.length === routed.edges.length &&
    retainedCrossings.length === routed.crossings.length &&
    retainedInvalidEdgeIds.length === routed.invalidEdgeIds.length
  ) return routed

  return {
    ...routed,
    edges: retainedEdges,
    crossings: retainedCrossings,
    invalidEdgeIds: retainedInvalidEdgeIds,
  }
}

export function routedConnectionsForInput(
  snapshot: RouteSnapshot | null,
  input: RouteComputationInput,
) {
  if (!snapshot || snapshot.input.scopeKey !== input.scopeKey) return EMPTY_ROUTED_CONNECTIONS
  const retainedRouted = retainRoutesForInput(snapshot.routed, input)
  if (
    snapshot.input.networks === input.networks &&
    snapshot.input.elements === input.elements &&
    snapshot.input.assets === input.assets &&
    snapshot.input.gridSize === input.gridSize &&
    snapshot.input.busbars === input.busbars &&
    snapshot.input.routeWaypoints === input.routeWaypoints
  ) return retainedRouted
  if (connectionRouteInputsEqual(snapshot.input, input)) return retainedRouted

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

  return { routed, isRouting: isRouting || (input.networks.length > 0 && snapshot?.input.scopeKey !== input.scopeKey), routeStats }
}
