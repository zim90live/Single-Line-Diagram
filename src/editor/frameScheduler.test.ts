import { describe, expect, it, vi } from 'vitest'

import { createLatestFrameScheduler, createTrailingScheduler } from './frameScheduler'

describe('latest frame scheduler', () => {
  it('coalesces high-frequency values and applies only the latest value per frame', () => {
    let callback: FrameRequestCallback | null = null
    const requestFrame = vi.fn((next: FrameRequestCallback) => {
      callback = next
      return 7
    })
    const cancelFrame = vi.fn()
    const apply = vi.fn()
    const scheduler = createLatestFrameScheduler(requestFrame, cancelFrame, apply)

    scheduler.schedule(1)
    scheduler.schedule(2)
    scheduler.schedule(3)

    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(apply).not.toHaveBeenCalled()
    expect(callback).not.toBeNull()
    ;(callback as unknown as FrameRequestCallback)(16)
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(3)
  })

  it('drops pending work when an interaction is cancelled', () => {
    let callback: FrameRequestCallback | null = null
    const cancelFrame = vi.fn()
    const apply = vi.fn()
    const scheduler = createLatestFrameScheduler(
      (next) => {
        callback = next
        return 9
      },
      cancelFrame,
      apply,
    )

    scheduler.schedule('stale')
    scheduler.cancel()
    expect(cancelFrame).toHaveBeenCalledWith(9)
    ;(callback as unknown as FrameRequestCallback)(16)
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('trailing scheduler', () => {
  it('coalesces repeated work until the interaction becomes idle', () => {
    let callback: (() => void) | null = null
    let nextHandle = 0
    const requestDelay = vi.fn((next: () => void) => {
      callback = next
      nextHandle += 1
      return nextHandle
    })
    const cancelDelay = vi.fn()
    const apply = vi.fn()
    const scheduler = createTrailingScheduler(requestDelay, cancelDelay, 120, apply)

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()

    expect(requestDelay).toHaveBeenCalledTimes(3)
    expect(requestDelay).toHaveBeenLastCalledWith(expect.any(Function), 120)
    expect(cancelDelay).toHaveBeenNthCalledWith(1, 1)
    expect(cancelDelay).toHaveBeenNthCalledWith(2, 2)
    expect(apply).not.toHaveBeenCalled()
    ;(callback as unknown as () => void)()
    expect(apply).toHaveBeenCalledOnce()
  })

  it('flushes pending work immediately and only once', () => {
    const cancelDelay = vi.fn()
    const apply = vi.fn()
    const scheduler = createTrailingScheduler(
      () => 17,
      cancelDelay,
      120,
      apply,
    )

    scheduler.schedule()
    scheduler.flush()
    scheduler.flush()

    expect(cancelDelay).toHaveBeenCalledOnce()
    expect(cancelDelay).toHaveBeenCalledWith(17)
    expect(apply).toHaveBeenCalledOnce()
  })
})
