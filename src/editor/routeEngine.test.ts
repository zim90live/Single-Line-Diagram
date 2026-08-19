import { describe, expect, it, vi } from 'vitest'

import type { RoutedConnections } from './connections'
import {
  createLatestRouteScheduler,
  type RouteComputationInput,
  type RouteJob,
  type RouteJobResult,
  type RouteJobRunner,
} from './routeEngine'

const emptyRoutes: RoutedConnections = {
  edges: [],
  crossings: [],
  invalidEdgeIds: [],
  resolvedBusbarTapOffsets: {},
}

function input(scopeKey: string): RouteComputationInput {
  return {
    scopeKey,
    networks: [],
    elements: [],
    assets: [],
    gridSize: 8,
    busbars: [],
  }
}

class ControlledRunner implements RouteJobRunner {
  jobs: Array<{
    job: RouteJob
    complete: (result: RouteJobResult) => void
  }> = []
  dispose = vi.fn()

  run(job: RouteJob, complete: (result: RouteJobResult) => void) {
    this.jobs.push({ job, complete })
  }

  finish(index: number, routed = emptyRoutes) {
    const pending = this.jobs[index]
    pending.complete({ id: pending.job.id, routed })
  }
}

class CancellableControlledRunner extends ControlledRunner {
  cancel = vi.fn()
}

describe('latest route scheduler', () => {
  it('keeps only the newest pending route request', () => {
    const runner = new ControlledRunner()
    const apply = vi.fn()
    const scheduler = createLatestRouteScheduler(runner, apply)

    scheduler.request(input('first'))
    scheduler.request(input('second'))
    scheduler.request(input('third'))

    expect(runner.jobs).toHaveLength(1)
    runner.finish(0)
    expect(apply).not.toHaveBeenCalled()
    expect(runner.jobs).toHaveLength(2)
    expect(runner.jobs[1].job.input.scopeKey).toBe('third')

    runner.finish(1)
    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0][0].scopeKey).toBe('third')
  })

  it('applies an uncontested route result and disposes its runner', () => {
    const runner = new ControlledRunner()
    const apply = vi.fn()
    const scheduler = createLatestRouteScheduler(runner, apply)

    scheduler.request(input('only'))
    runner.finish(0)
    scheduler.dispose()

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: 'only' }), emptyRoutes)
    expect(runner.dispose).toHaveBeenCalledOnce()
  })

  it('cancels an active job and starts the latest request immediately when supported', () => {
    const runner = new CancellableControlledRunner()
    const apply = vi.fn()
    const scheduler = createLatestRouteScheduler(runner, apply)

    scheduler.request(input('stale'))
    scheduler.request(input('latest'))

    expect(runner.cancel).toHaveBeenCalledOnce()
    expect(runner.jobs).toHaveLength(2)
    expect(runner.jobs[1].job.input.scopeKey).toBe('latest')

    runner.finish(0)
    expect(apply).not.toHaveBeenCalled()
    runner.finish(1)
    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0][0].scopeKey).toBe('latest')
  })
})
