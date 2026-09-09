import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { DiagramElementItem } from './DiagramCanvas'
import { symbolsByKey } from '../scene/symbolCatalog'

describe.each(['tmu', 'fm'] as const)('%s canvas anchor placement', (assetKey) => {
  it.each([0, 90])('moves visible ports and hit targets together at rotation %s', (rotation) => {
    const props: ComponentProps<typeof DiagramElementItem> = {
      mode: 'edit', element: { id: 'tmu', assetKey: 'tmu', diagramId: 'd', name: 'TMU', x: 0, y: 0, width: 48, height: 48, rotation, properties: {}, extensions: {} },
      asset: { key: 'tmu', name: 'TMU', category: '冷却', source: 'TMU.svg', intrinsicWidth: 48, intrinsicHeight: 48, anchors: [
        { id: 'cold', name: '冷', x: 16, y: 0, type: 'cooling-secondary-cold', direction: 'top' },
        { id: 'hot', name: '热', x: 32, y: 48, type: 'cooling-tertiary-hot', direction: 'bottom' },
      ] },
      symbol: symbolsByKey.get('tmu'), selected: true, anchorsVisible: true,
      wiringType: null, lineSystemType: 'cooling', occupiedAnchors: new Set(), zoom: 1,
      visualState: 'on', elementNodes: { current: new Map() },
      startMove: { current: vi.fn() }, enterAnchor: { current: vi.fn() }, leaveAnchor: { current: vi.fn() }, pressAnchor: { current: vi.fn() },
      hoverElement: { current: vi.fn() }, drillDownElement: { current: vi.fn() }, coolingPumpRunning: true, coolingValveOpen: true,
    }
    props.element = { ...props.element, assetKey }
    props.asset = { ...props.asset!, key: assetKey }
    props.symbol = symbolsByKey.get(assetKey)
    const { container, rerender } = render(<svg><DiagramElementItem {...props} /></svg>)
    const port = () => container.querySelector('[data-anchor-id="cold"]')!
    expect(port()).toHaveAttribute('cy', '0')
    rerender(<svg><DiagramElementItem {...props} element={{ ...props.element, [assetKey === 'tmu' ? 'tmuPortsSwapped' : 'fmPortsSwapped']: true }} /></svg>)
    expect(port()).toHaveAttribute('cx', '16')
    expect(port()).toHaveAttribute('cy', '48')
    expect(container.querySelector('[data-anchor-id="hot"]')).toHaveAttribute('cy', '0')
    expect(port()).toHaveAttribute('data-world-x', rotation === 0 ? '16' : '0')
    expect(port()).toHaveAttribute('data-world-y', rotation === 0 ? '48' : '16')
    expect(container.querySelector('.diagram-element')).toHaveAttribute('transform', `rotate(${rotation} 24 24)`)
    rerender(<svg><DiagramElementItem {...props} /></svg>)
    expect(port()).toHaveAttribute('cy', '0')
  })
})
