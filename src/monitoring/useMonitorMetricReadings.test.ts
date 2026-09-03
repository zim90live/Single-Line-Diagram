import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DiagramElement } from '../domain/project'
import type { MonitorMetricDataProvider } from '../runtime/metricDataProvider'
import { monitorMetricReadingKey } from './elementMetrics'
import {
  useMonitorMetricReadings,
  useMonitorMetricRuntimeSnapshot,
} from './useMonitorMetricReadings'

const element: DiagramElement = {
  id: 'ups-1',
  diagramId: 'diagram-1',
  assetKey: 'ups',
  name: 'UPS',
  x: 0,
  y: 0,
  width: 80,
  height: 80,
  rotation: 0,
  monitorMetrics: [{
    id: 'load',
    name: '负载率',
    valueType: 'number',
    unit: '%',
    precision: 1,
    simulationMin: 0,
    simulationMax: 100,
    alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
  }],
  properties: {},
  extensions: {},
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useMonitorMetricReadings', () => {
  it('uses a stable midpoint preview outside monitor mode and refreshes only while live', () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.96)
    const key = monitorMetricReadingKey(element.id, 'load')
    const { result, rerender } = renderHook(
      ({ enabled }) => useMonitorMetricReadings(enabled, [element]),
      { initialProps: { enabled: false } },
    )

    expect(result.current[key]).toMatchObject({ value: 50, severity: 'normal' })
    expect(random).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    rerender({ enabled: true })
    expect(result.current[key]).toMatchObject({ value: 20, severity: 'normal' })

    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current[key]).toMatchObject({ value: 96, severity: 'critical' })

    rerender({ enabled: false })
    expect(result.current[key]).toMatchObject({ value: 50, severity: 'normal' })
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(30_000))
    expect(random).toHaveBeenCalledTimes(2)
  })

  it('accepts an injected provider without forcing the mock refresh timer', () => {
    vi.useFakeTimers()
    const key = monitorMetricReadingKey(element.id, 'load')
    const getSnapshot = vi.fn(() => ({
      [key]: {
        elementId: element.id,
        metricId: 'load',
        value: 72,
        severity: 'minor' as const,
      },
    }))
    const provider: MonitorMetricDataProvider = { getSnapshot, refreshMs: null }
    const { result } = renderHook(() => (
      useMonitorMetricReadings(true, [element], provider)
    ))

    expect(result.current[key]).toMatchObject({ value: 72, severity: 'minor' })
    expect(getSnapshot).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('freezes the runtime snapshot while playback is paused', () => {
    vi.useFakeTimers()
    let tick = 0
    const getRuntimeSnapshot = vi.fn(() => ({
      timestamp: tick,
      readings: {},
      deviceStates: {},
    }))
    getRuntimeSnapshot.mockImplementation(() => ({
      timestamp: tick++,
      readings: {},
      deviceStates: {},
    }))
    const provider: MonitorMetricDataProvider = {
      getSnapshot: () => ({}),
      getRuntimeSnapshot,
      refreshMs: 3_000,
    }
    const { result, rerender } = renderHook(
      ({ playing }) => useMonitorMetricRuntimeSnapshot(true, [element], provider, playing),
      { initialProps: { playing: false } },
    )

    expect(result.current.timestamp).toBe(0)
    expect(getRuntimeSnapshot).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(9_000))
    expect(getRuntimeSnapshot).toHaveBeenCalledOnce()

    rerender({ playing: true })
    expect(result.current.timestamp).toBe(1)
    act(() => vi.advanceTimersByTime(3_000))
    expect(result.current.timestamp).toBe(2)

    rerender({ playing: false })
    act(() => vi.advanceTimersByTime(9_000))
    expect(result.current.timestamp).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
