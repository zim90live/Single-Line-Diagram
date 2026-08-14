import { describe, expect, it, vi } from 'vitest'

import { createLatestFrameScheduler } from './frameScheduler'

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
