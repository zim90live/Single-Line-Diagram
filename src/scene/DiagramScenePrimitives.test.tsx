import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DiagramElement } from '../domain/project'
import { FLOW_ANIMATION_STYLES, FLOW_DOT_ANIMATION_STYLES } from '../monitoring/flowPresentation'
import type { ElementLabelLayout } from './elementLabels'
import { symbolsByKey } from './symbolCatalog'
import {
  BusbarVisual,
  BusbarTapVisual,
  ConnectionBridgeCasing,
  ConnectionDirectionArrow,
  CoolingPipeOutlineFilter,
  CoolingPipeShell,
  DiagramElementVisual,
  ElementLabelItem,
  MonitorStaticFlowLines,
  MonitorAnimatedFlowLines,
  SymbolColorFilter,
  symbolColorFilterId,
} from './DiagramScenePrimitives'

const element: DiagramElement = {
  id: 'scene-element',
  diagramId: 'scene-diagram',
  assetKey: 'switch',
  name: 'Switch 01',
  x: 16,
  y: 24,
  width: 32,
  height: 32,
  rotation: 0,
  properties: {},
  extensions: {},
}

const label: ElementLabelLayout = {
  elementId: element.id,
  text: 'Switch 01',
  nameText: 'Switch 01',
  placement: 'bottom',
  bounds: { x: 8, y: 60, width: 48, height: 16 },
  textX: 10,
  textY: 71,
  metricRows: [],
}

describe('diagram scene primitives', () => {
  it('keeps label interaction optional while preserving the shared SVG contract', () => {
    const pointerDown = vi.fn()
    const { container, rerender } = render(
      <svg>
        <ElementLabelItem
          layout={label}
          interactive
          selected
          pointerDownRef={{ current: pointerDown }}
        />
      </svg>,
    )

    const group = container.querySelector('[data-element-id="scene-element"]')!
    expect(group).toHaveAttribute('data-interactive', 'true')
    expect(group).toHaveAttribute('data-selected', 'true')
    fireEvent.pointerDown(group.querySelector('.element-label__hit')!)
    expect(pointerDown).toHaveBeenCalledWith(expect.anything(), element.id)

    rerender(<svg><ElementLabelItem layout={label} /></svg>)
    expect(container.querySelector('[data-element-id="scene-element"]'))
      .not.toHaveAttribute('data-interactive')
  })

  it('renders the same symbol body and scoped color filter for either canvas', () => {
    const symbol = symbolsByKey.get('switch')!
    const filterId = symbolColorFilterId('#32D583', 'runtime-a')
    const { container } = render(
      <svg>
        <defs><SymbolColorFilter id={filterId} color="#32D583" /></defs>
        <DiagramElementVisual
          element={element}
          symbol={symbol}
          symbolColor="#32D583"
          visualState="on"
          colorFilterId={filterId}
          clipPathId="unused-image-clip"
        />
      </svg>,
    )

    expect(filterId).toBe('runtime-a-symbol-color-32d583')
    expect(container.querySelector('filter')).toHaveAttribute('id', filterId)
    expect(container.querySelector('.diagram-element__image')).toHaveAttribute(
      'filter',
      `url(#${filterId})`,
    )
    expect(container.querySelector('.diagram-element__image'))
      .toHaveAttribute('data-symbol-state', 'on')
  })

  it('shares cooling filters and static monitor stroke semantics', () => {
    const tapRegistry = { current: new Map<string, SVGCircleElement>() }
    const { container } = render(
      <svg>
        <defs>
          <CoolingPipeOutlineFilter
            id="cooling-filter"
            points={[{ x: 0, y: 0 }, { x: 80, y: 0 }]}
            role="primary"
          />
        </defs>
        <MonitorStaticFlowLines groups={[{
          id: 'static-line',
          kind: 'connection',
          color: '#FFFFFF',
          lineWidth: 2,
          widthSpace: 'screen',
          lineCap: 'round',
          lineJoin: 'round',
          renderPriority: 1,
          paths: [[{ x: 0, y: 0 }, { x: 80, y: 0 }]],
        }]} />
        <BusbarVisual busbar={{
          id: 'shared-busbar',
          diagramId: 'scene-diagram',
          type: 'electrical',
          x: 0,
          y: 16,
          length: 80,
          orientation: 'horizontal',
        }} />
        <BusbarTapVisual
          nodeId="shared-tap"
          busbarId="shared-busbar"
          offset={24}
          point={{ x: 24, y: 16 }}
          color="#32D583"
          zoom={2}
          nodeRegistry={tapRegistry}
        />
        <ConnectionBridgeCasing
          path="M 0 24 L 80 24"
          type="cooling-primary-hot"
          coolingLineRole="primary"
        />
        <CoolingPipeShell
          path="M 0 32 L 80 32"
          type="cooling-primary-hot"
          coolingLineRole="primary"
          filterId="cooling-filter"
          monitorReplay
        />
        <g className="connection-edge">
          <ConnectionDirectionArrow path="M 40 32 L 48 32" />
        </g>
      </svg>,
    )

    expect(container.querySelector('#cooling-filter')).toBeInTheDocument()
    expect(container.querySelector('#cooling-filter feMorphology')).toHaveAttribute('operator', 'erode')
    expect(container.querySelector('#cooling-filter feGaussianBlur')).toBeNull()
    expect(container.querySelector('.monitor-static-flow-line')).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    )
    expect(container.querySelector('[data-busbar-id="shared-busbar"] .busbar__line'))
      .toHaveAttribute('d', 'M 0 16 L 80 16')
    expect(container.querySelector('[data-busbar-id="shared-busbar"] .busbar__line'))
      .not.toHaveAttribute('vector-effect', 'non-scaling-stroke')
    const tap = container.querySelector('[data-busbar-offset="24"]')
    expect(tap).toHaveAttribute('data-connection-type', 'electrical')
    expect(tap).toHaveAttribute('visibility', 'hidden')
    expect(tap).toHaveAttribute('aria-hidden', 'true')
    expect(tap).toHaveAttribute('cx', '24')
    expect(tap).toHaveAttribute('cy', '16')
    expect(tap).toHaveAttribute('r', '1.25')
    expect(tap).toHaveStyle({ '--busbar-color': '#32D583' })
    expect(tapRegistry.current.get('shared-tap')).toBe(tap)
    expect(container.querySelectorAll('.connection-edge__bridge-casing')).toHaveLength(2)
    expect(container.querySelector('.connection-edge__pipe-shell'))
      .toHaveAttribute('data-monitor-pipe-shell-replay', 'true')
    expect(container.querySelector('.connection-edge__direction-arrow'))
      .toHaveAttribute('d', 'M 40 32 L 48 32')
  })

  it('animates suspected leak color only on the existing pipe outline', () => {
    const { container, rerender } = render(<svg><CoolingPipeOutlineFilter
      id="leak" points={[{ x: 0, y: 0 }, { x: 80, y: 0 }]} suspectedLeak
    /></svg>)
    expect(container.querySelector('animate')).toHaveAttribute('attributeName', 'flood-color')
    expect(container.querySelector('animate')).toHaveAttribute('dur', '1s')
    expect(container.querySelector('feMorphology[operator="dilate"]')).toHaveAttribute('radius', '1')
    expect(container.querySelector('feComposite[in="leak-color"]')).toHaveAttribute('in2', 'pipe-outline')
    expect(container.querySelector('feMergeNode[in="pipe-fill"]')).not.toBeNull()
    rerender(<svg><CoolingPipeOutlineFilter id="leak" points={[]} /></svg>)
    expect(container.querySelector('animate')).toBeNull()
  })
})

it('renders embedded power waves in the line color with a continuous half-opacity tail', () => {
  const { container } = render(<svg><MonitorAnimatedFlowLines paths={[{
    id: 'power', style: 'power', baseColor: '#1BA4FF',
    points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
  }]} /></svg>)
  const gradient = container.querySelector('linearGradient')!
  expect(gradient).toHaveAttribute('spreadMethod', 'repeat')
  expect(Number(gradient.getAttribute('x2')) - Number(gradient.getAttribute('x1'))).toBe(FLOW_ANIMATION_STYLES.power.dashLength + FLOW_ANIMATION_STYLES.power.gapLength)
  expect([...gradient.querySelectorAll('stop')].map(stop => stop.getAttribute('stop-color'))).toEqual(['#1BA4FF', '#1BA4FF', '#1BA4FF'])
  expect([...gradient.querySelectorAll('stop')].map(stop => stop.getAttribute('stop-opacity'))).toEqual(['0.5', '1', '0.5'])
  expect(container.querySelector('[stroke-dasharray]')).toBeNull()
})

it('moves a filled dot pattern forward and pauses the owning SVG timeline', () => {
  const paths = [{ id: 'power', style: 'power' as const, baseColor: '#1BA4FF',
    points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] }]
  const { container, rerender } = render(<svg><MonitorAnimatedFlowLines paths={paths} animationMode="dots" playing /></svg>)
  const pattern = container.querySelector('pattern')!
  const config = FLOW_DOT_ANIMATION_STYLES.power
  expect(pattern).toHaveAttribute('width', String(config.dotSpacing))
  expect(pattern).toHaveAttribute('height', String(config.dotSize))
  expect(pattern.querySelector('circle')).toHaveAttribute('r', String(config.dotSize / 2))
  expect(pattern.querySelector('animateTransform')).toHaveAttribute('to', `${config.dotSpacing} 0`)
  const svg = container.querySelector('svg')!
  svg.pauseAnimations = vi.fn()
  svg.unpauseAnimations = vi.fn()
  rerender(<svg><MonitorAnimatedFlowLines paths={paths} animationMode="dots" playing={false} /></svg>)
  expect(svg.pauseAnimations).toHaveBeenCalled()
  expect(container.querySelector('[data-dot-playing]')).toHaveAttribute('data-dot-playing', 'false')
  rerender(<svg><MonitorAnimatedFlowLines paths={paths} animationMode="dots" playing /></svg>)
  expect(svg.unpauseAnimations).toHaveBeenCalled()
})
