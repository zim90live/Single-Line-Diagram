import { createRef, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { symbolAssets } from '../scene/symbolCatalog'
import {
  DiagramMonitorCanvas,
  type DiagramMonitorCanvasHandle,
} from './DiagramMonitorCanvas'
import { createDiagramRuntimeView } from './diagramRuntime'
import type { DiagramRuntimeContext } from './types'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ fallback }: { fallback?: ReactNode }) => (
    <div data-testid="mock-grid-canvas">{fallback}</div>
  ),
}))

vi.mock('../monitoring/FlowAnimationLayer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../monitoring/FlowAnimationLayer')>()
  return {
    ...original,
    FlowAnimationLayer: () => <div data-testid="mock-flow-layer" />,
  }
})

vi.mock('./useRoutedConnections', () => ({
  useRoutedConnections: () => ({
    routed: {
      edges: [{
        networkId: 'runtime-monitor-network',
        edgeId: 'runtime-monitor-edge',
        type: 'electrical',
        sourceNodeId: 'runtime-monitor-source',
        targetNodeId: 'runtime-monitor-target',
        order: 0,
        points: [{ x: 0, y: 80 }, { x: 80, y: 80 }],
      }],
      crossings: [],
      invalidEdgeIds: [],
      resolvedBusbarTapOffsets: {},
    },
    isRouting: false,
    routeStats: null,
  }),
}))

describe('DiagramMonitorCanvas', () => {
  it('renders a readonly runtime scene without editor commands and keeps host navigation', async () => {
    const document = createDefaultProject('只读监控场景', symbolAssets)
    const parent = document.diagrams[0]
    const child = document.diagrams.find((diagram) => diagram.parentId === parent.id)!
    document.elements.push(
      {
        id: 'runtime-monitor-link',
        diagramId: parent.id,
        assetKey: 'ups',
        name: '下探入口',
        x: 0,
        y: 0,
        width: 48,
        height: 48,
        rotation: 0,
        properties: { drillDownDiagramId: child.id },
        extensions: {},
      },
      {
        id: 'runtime-monitor-switch',
        diagramId: parent.id,
        assetKey: 'switch',
        name: '运行开关',
        x: 80,
        y: 0,
        width: 32,
        height: 32,
        rotation: 0,
        onOffState: 'on',
        properties: {},
        extensions: {},
      },
    )
    document.connections.push({
      id: 'runtime-monitor-network',
      diagramId: parent.id,
      type: 'electrical',
      nodes: [
        { id: 'runtime-monitor-source', kind: 'node', x: 0, y: 80 },
        { id: 'runtime-monitor-target', kind: 'node', x: 80, y: 80 },
      ],
      edges: [{
        id: 'runtime-monitor-edge',
        sourceNodeId: 'runtime-monitor-source',
        targetNodeId: 'runtime-monitor-target',
      }],
    })
    const view = createDiagramRuntimeView(document, parent.id)!
    const runtime: DiagramRuntimeContext = {
      state: {
        onOffStates: { 'runtime-monitor-switch': true },
        coolingPumpRunningStates: {},
        coolingPumpOutputPowerStates: {},
        coolingValveOpenStates: {},
        powerExternalSupplyActive: false,
      },
      navigation: view.navigation,
    }
    const onSelectionChange = vi.fn()
    const onElementDrillDown = vi.fn()
    const onViewportChange = vi.fn()
    const ref = createRef<DiagramMonitorCanvasHandle>()
    const user = userEvent.setup()

    render(
      <DiagramMonitorCanvas
        ref={ref}
        view={view}
        runtime={runtime}
        animationPlaying={false}
        onSelectionChange={onSelectionChange}
        onElementDrillDown={onElementDrillDown}
        onViewportChange={onViewportChange}
      />,
    )

    const canvas = screen.getByTestId('diagram-monitor-canvas')
    expect(canvas).toHaveAttribute('data-runtime-scene', 'readonly')
    expect(canvas).toHaveAttribute('data-mode', 'monitor')
    expect(screen.getByTestId('runtime-monitor-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('connection-layer').querySelector(
      '.monitor-static-flow-line',
    )).toBeInTheDocument()

    await user.click(canvas.querySelector(
      '[data-element-id="runtime-monitor-link"] image',
    )!)
    expect(onElementDrillDown).toHaveBeenCalledWith('runtime-monitor-link')

    await user.click(canvas.querySelector(
      '[data-element-id="runtime-monitor-switch"] image',
    )!)
    expect(onSelectionChange).toHaveBeenLastCalledWith(['runtime-monitor-switch'])
    expect(canvas.querySelector(
      '[data-element-id="runtime-monitor-switch"]',
    )).toHaveAttribute('data-selected', 'true')

    const viewport = screen.getByLabelText('一次接线图监控画布')
    const drillDownImage = canvas.querySelector(
      '[data-element-id="runtime-monitor-link"] image',
    )!
    viewport.focus()
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.pointerDown(drillDownImage, {
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 34, clientY: 26 })
    fireEvent.pointerUp(viewport, { pointerId: 7, clientX: 34, clientY: 26 })
    fireEvent.keyUp(window, { code: 'Space' })
    expect(onElementDrillDown).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tx: 24,
      ty: 16,
    }))

    act(() => ref.current?.zoomIn())
    expect(Number(canvas.getAttribute('data-grid-zoom'))).toBeGreaterThan(1)
    expect(canvas.querySelector('.transform-controls')).not.toBeInTheDocument()
    expect(canvas.querySelector('.connection-junction-handle')).not.toBeInTheDocument()
  })
})
