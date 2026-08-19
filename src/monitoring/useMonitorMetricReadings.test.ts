import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DiagramElement } from '../domain/project'
import { monitorMetricReadingKey } from './elementMetrics'
import { useMonitorMetricReadings } from './useMonitorMetricReadings'

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
})
