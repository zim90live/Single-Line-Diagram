import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MonitorTrendChart } from './MonitorTrendChart'

it('matches the compact Figma plot proportions and seven time ticks without changing the standard chart', () => {
  const props = { series: [{ id: 'power', label: '功率', color: 'primary' as const, values: [20, 75, 40] }], unit: 'kW', ariaLabel: '功率趋势', endTimestamp: 0 }
  const { container, rerender } = render(<MonitorTrendChart {...props} compact />)
  expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 336 177')
  expect(container.querySelectorAll('.monitor-trend__time-tick')).toHaveLength(7)
  expect(container.querySelectorAll('.monitor-trend__grid')).toHaveLength(5)
  expect(container.querySelector('.monitor-trend__unit')).toHaveAttribute('x', '0')
  expect(container.querySelector('[data-baseline="true"]')).toBeInTheDocument()
  rerender(<MonitorTrendChart {...props} />)
  expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 452 160')
  expect(container.querySelectorAll('.monitor-trend__time-tick')).toHaveLength(6)
})
