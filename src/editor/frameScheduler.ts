export interface LatestFrameScheduler<T> {
  schedule: (value: T) => void
  cancel: () => void
}

export interface TrailingScheduler {
  schedule: () => void
  flush: () => void
  cancel: () => void
}

export function createLatestFrameScheduler<T>(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  apply: (value: T) => void,
): LatestFrameScheduler<T> {
  let frameHandle: number | null = null
  let pending: { value: T } | null = null

  return {
    schedule(value) {
      pending = { value }
      if (frameHandle !== null) return
      frameHandle = requestFrame(() => {
        frameHandle = null
        const next = pending
        pending = null
        if (next) apply(next.value)
      })
    },
    cancel() {
      if (frameHandle !== null) cancelFrame(frameHandle)
      frameHandle = null
      pending = null
    },
  }
}

export function createTrailingScheduler(
  requestDelay: (callback: () => void, delay: number) => number,
  cancelDelay: (handle: number) => void,
  delay: number,
  apply: () => void,
): TrailingScheduler {
  let delayHandle: number | null = null

  const run = () => {
    if (delayHandle === null) return
    delayHandle = null
    apply()
  }

  return {
    schedule() {
      if (delayHandle !== null) cancelDelay(delayHandle)
      delayHandle = requestDelay(run, delay)
    },
    flush() {
      if (delayHandle === null) return
      cancelDelay(delayHandle)
      run()
    },
    cancel() {
      if (delayHandle !== null) cancelDelay(delayHandle)
      delayHandle = null
    },
  }
}
