import type {
  AssetDefinition,
  Busbar,
  ConnectionNetwork,
  DiagramElement,
} from '../domain/project'
import { routeConnectionNetworks, type RoutedConnections } from './connections'

export interface RouteComputationInput {
  scopeKey: string
  networks: ConnectionNetwork[]
  elements: DiagramElement[]
  assets: AssetDefinition[]
  gridSize: number
  busbars: Busbar[]
}

export interface RouteJob {
  id: number
  input: RouteComputationInput
}

export interface RouteJobResult {
  id: number
  routed: RoutedConnections
}

export interface RouteJobRunner {
  run: (job: RouteJob, complete: (result: RouteJobResult) => void) => void
  dispose: () => void
}

export interface LatestRouteScheduler {
  request: (input: RouteComputationInput) => number
  dispose: () => void
}

export function createLatestRouteScheduler(
  runner: RouteJobRunner,
  apply: (input: RouteComputationInput, routed: RoutedConnections) => void,
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
      if (completed.id === latestId) apply(completed.input, result.routed)
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
      if (active) pending = job
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

  run(job: RouteJob, complete: (result: RouteJobResult) => void) {
    this.timer = window.setTimeout(() => {
      this.timer = null
      complete({
        id: job.id,
        routed: routeConnectionNetworks(
          job.input.networks,
          job.input.elements,
          job.input.assets,
          job.input.gridSize,
          job.input.busbars,
        ),
      })
    }, 0)
  }

  dispose() {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
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
    this.worker?.removeEventListener('message', this.handleMessage)
    this.worker?.removeEventListener('error', this.handleError)
    this.worker?.terminate()
    this.worker = null
    this.active = null
    this.fallback.dispose()
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
    this.worker?.terminate()
    this.worker = null
    this.active = null
    if (current) this.fallback.run(current.job, current.complete)
  }
}

export function createBrowserRouteJobRunner(): RouteJobRunner {
  return typeof Worker === 'undefined'
    ? new DeferredMainThreadRouteRunner()
    : new WorkerRouteRunner()
}
