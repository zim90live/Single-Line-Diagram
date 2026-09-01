export type WheelGestureKind = 'mouse-zoom' | 'trackpad-pan' | 'pinch-zoom'

export interface WheelGestureSample {
  ctrlKey: boolean
  deltaMode: number
  deltaX: number
  deltaY: number
  devicePixelRatio?: number
  wheelDelta?: number
  wheelDeltaY?: number
}

const PIXEL_DELTA_MODE = 0
const DISCRETE_MOUSE_WHEEL_DELTA = 80
const LEGACY_WHEEL_TICK_DELTA = 120
const LEGACY_WHEEL_TICK_TOLERANCE = 2
const PINCH_ZOOM_SENSITIVITY = 0.01
const MIN_PINCH_ZOOM_FACTOR = 0.8
const MAX_PINCH_ZOOM_FACTOR = 1.25

function isLegacyWheelTick(value: number) {
  const tickCount = Math.round(value / LEGACY_WHEEL_TICK_DELTA)
  return tickCount >= 1 &&
    Math.abs(value - tickCount * LEGACY_WHEEL_TICK_DELTA) <= LEGACY_WHEEL_TICK_TOLERANCE
}

function hasDiscreteMouseWheelTick(sample: WheelGestureSample) {
  if (sample.deltaX !== 0) return false

  // WheelEvent has no standard device type. Chromium/WebKit retain a 120-based
  // physical wheel tick even when macOS reports the standard delta in pixels.
  const legacyDelta = sample.wheelDeltaY ?? sample.wheelDelta
  if (legacyDelta === undefined || !Number.isFinite(legacyDelta) || legacyDelta === 0) {
    return false
  }

  const absoluteDelta = Math.abs(legacyDelta)
  const pixelRatio = sample.devicePixelRatio && sample.devicePixelRatio > 0
    ? sample.devicePixelRatio
    : 1
  return isLegacyWheelTick(absoluteDelta) || isLegacyWheelTick(absoluteDelta * pixelRatio)
}

export function inferWheelGestureKind(sample: WheelGestureSample): WheelGestureKind {
  if (sample.ctrlKey) return 'pinch-zoom'
  if (sample.deltaMode !== PIXEL_DELTA_MODE) return 'mouse-zoom'
  if (hasDiscreteMouseWheelTick(sample)) return 'mouse-zoom'

  const hasHorizontalMovement = sample.deltaX !== 0
  const hasContinuousVerticalMovement =
    Math.abs(sample.deltaY) < DISCRETE_MOUSE_WHEEL_DELTA ||
    !Number.isInteger(sample.deltaY)
  return hasHorizontalMovement || hasContinuousVerticalMovement
    ? 'trackpad-pan'
    : 'mouse-zoom'
}

export function pinchZoomFactor(deltaY: number) {
  return Math.min(
    MAX_PINCH_ZOOM_FACTOR,
    Math.max(MIN_PINCH_ZOOM_FACTOR, Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY)),
  )
}
