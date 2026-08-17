import { routeConnectionNetworks } from './connections'
import type { RouteJob, RouteJobResult } from './routeEngine'

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RouteJob>) => void) | null
  postMessage: (result: RouteJobResult) => void
}

workerScope.onmessage = (event) => {
  const { id, input } = event.data
  workerScope.postMessage({
    id,
    routed: routeConnectionNetworks(
      input.networks,
      input.elements,
      input.assets,
      input.gridSize,
      input.busbars,
    ),
  })
}
