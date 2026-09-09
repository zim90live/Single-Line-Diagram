import {
  routeConnectionNetworksIncrementally,
  type ConnectionRouteInput,
  type RoutedConnections,
} from '../scene/connections'

export interface RouteComputationInput extends ConnectionRouteInput {
  scopeKey: string
}

export interface RouteComputationStats {
  durationMs: number
  mode: 'full' | 'incremental' | 'reused'
  dirtyNetworkCount: number
  dirtyEdgeCount: number
  reusedEdgeCount: number
}

export interface RouteJob {
  id: number
  input: RouteComputationInput
}

export interface RouteJobResult {
  id: number
  routed: RoutedConnections
  stats?: RouteComputationStats
}

export interface RouteJobRunner {
  run: (job: RouteJob, complete: (result: RouteJobResult) => void) => void
  cancel?: () => void
  dispose: () => void
}

export interface LatestRouteScheduler {
  request: (input: RouteComputationInput) => number
  dispose: () => void
}

export function createLatestRouteScheduler(
  runner: RouteJobRunner,
  apply: (
    input: RouteComputationInput,
    routed: RoutedConnections,
    stats?: RouteComputationStats,
  ) => void,
): LatestRouteScheduler {
  let nextId = 1
  let latestId = 0
  let active: RouteJob | null = null
  let pending: RouteJob | null = null
  let disposed = false

  const start = (job: RouteJob) => {
    active = job
    runner.run(job, (result) => {
      if (disposed || active?.id !== result.id) return
      const completed = active
      active = null
      if (completed.id === latestId) {
        if (result.stats) apply(completed.input, result.routed, result.stats)
        else apply(completed.input, result.routed)
      }
      const next = pending
      pending = null
      if (next) start(next)
    })
  }

  return {
    request(input) {
      if (disposed) return latestId
      const job = { id: nextId++, input }
      latestId = job.id
      if (active && runner.cancel) {
        pending = null
        active = null
        runner.cancel()
        start(job)
      } else if (active) pending = job
      else start(job)
      return job.id
    },
    dispose() {
      disposed = true
      pending = null
      active = null
      runner.dispose()
    },
  }
}

class DeferredMainThreadRouteRunner implements RouteJobRunner {
  private timer: number | null = null
  private completed: { input: RouteComputationInput; routed: RoutedConnections } | null = null

  run(job: RouteJob, complete: (result: RouteJobResult) => void) {
    this.timer = window.setTimeout(() => {
      this.timer = null
      const startedAt = performance.now()
      const incremental = routeConnectionNetworksIncrementally(
        this.completed?.input.scopeKey === job.input.scopeKey ? this.completed.input : null,
        this.completed?.input.scopeKey === job.input.scopeKey ? this.completed.routed : null,
        job.input,
      )
      this.completed = { input: job.input, routed: incremental.routed }
      complete({
        id: job.id,
        routed: incremental.routed,
        stats: {
          durationMs: performance.now() - startedAt,
          mode: incremental.mode,
          dirtyNetworkCount: incremental.dirtyNetworkCount,
          dirtyEdgeCount: incremental.dirtyEdgeCount,
          reusedEdgeCount: incremental.reusedEdgeCount,
        },
      })
    }, 0)
  }

  cancel = () => {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  dispose() {
    this.cancel()
    this.completed = null
  }
}

class WorkerRouteRunner implements RouteJobRunner {
  private worker: Worker | null = null
  private fallback = new DeferredMainThreadRouteRunner()
  private active: {
    job: RouteJob
    complete: (result: RouteJobResult) => void
  } | null = null

  constructor() {
    this.createWorker()
  }

  private createWorker() {
    try {
      this.worker = new Worker(new URL('./route.worker.ts', import.meta.url), { type: 'module' })
      this.worker.addEventListener('message', this.handleMessage)
      this.worker.addEventListener('error', this.handleError)
    } catch {
      this.worker = null
    }
  }

  run(job: RouteJob, complete: (result: RouteJobResult) => void) {
    if (!this.worker) {
      this.fallback.run(job, complete)
      return
    }
    this.active = { job, complete }
    try {
      this.worker.postMessage(job)
    } catch {
      this.fallbackFromWorker()
    }
  }

  dispose() {
    this.destroyWorker()
    this.active = null
    this.fallback.dispose()
  }

  cancel = () => {
    this.active = null
    this.fallback.cancel()
    this.destroyWorker()
    this.createWorker()
  }

  private handleMessage = (event: MessageEvent<RouteJobResult>) => {
    const current = this.active
    if (!current || current.job.id !== event.data.id) return
    this.active = null
    current.complete(event.data)
  }

  private handleError = (event: ErrorEvent) => {
    event.preventDefault()
    this.fallbackFromWorker()
  }

  private fallbackFromWorker() {
    const current = this.active
    this.destroyWorker()
    this.active = null
    if (current) this.fallback.run(current.job, current.complete)
  }

  private destroyWorker() {
    this.worker?.removeEventListener('message', this.handleMessage)
    this.worker?.removeEventListener('error', this.handleError)
    this.worker?.terminate()
    this.worker = null
  }
}

export function createBrowserRouteJobRunner(): RouteJobRunner {
  return typeof Worker === 'undefined'
    ? new DeferredMainThreadRouteRunner()
    : new WorkerRouteRunner()
}
