import {
  routeConnectionNetworksIncrementally,
  type RoutedConnections,
} from './connections'
import type { RouteComputationInput, RouteJob, RouteJobResult } from './routeEngine'

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RouteJob>) => void) | null
  postMessage: (result: RouteJobResult) => void
}

let completed: { input: RouteComputationInput; routed: RoutedConnections } | null = null

workerScope.onmessage = (event) => {
  const { id, input } = event.data
  const startedAt = performance.now()
  const incremental = routeConnectionNetworksIncrementally(
    completed?.input.scopeKey === input.scopeKey ? completed.input : null,
    completed?.input.scopeKey === input.scopeKey ? completed.routed : null,
    input,
  )
  completed = { input, routed: incremental.routed }
  workerScope.postMessage({
    id,
    routed: incremental.routed,
    stats: {
      durationMs: performance.now() - startedAt,
      mode: incremental.mode,
      dirtyNetworkCount: incremental.dirtyNetworkCount,
      reusedEdgeCount: incremental.reusedEdgeCount,
    },
  })
}
