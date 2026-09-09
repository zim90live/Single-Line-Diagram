import { forwardRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { symbolAssets } from '../scene/symbolCatalog'
import type { DiagramMonitorCanvas } from './DiagramMonitorCanvas'
import { DiagramRuntimeViewer } from './DiagramRuntimeViewer'
import { createDiagramRuntimeView } from './diagramRuntime'
import type { DiagramRuntimeContext } from './types'

const { diagramCanvasProps } = vi.hoisted(() => ({
  diagramCanvasProps: {
    current: null as ComponentProps<typeof DiagramMonitorCanvas> | null,
  },
}))

vi.mock('./DiagramMonitorCanvas', () => ({
  DiagramMonitorCanvas: forwardRef(function MockDiagramMonitorCanvas(
    props: ComponentProps<typeof DiagramMonitorCanvas>,
    _ref,
  ) {
    diagramCanvasProps.current = props
    const elementId = Object.keys(props.view.navigation)[0]
    return elementId ? (
      <button type="button" onClick={() => props.onElementDrillDown?.(elementId)}>
        打开子图
      </button>
    ) : <div>监控画布</div>
  }),
}))

describe('DiagramRuntimeViewer', () => {
  it('adapts the runtime view to a monitor-only canvas and delegates navigation', async () => {
    const document = createDefaultProject('React 运行时查看器', symbolAssets)
    const parent = document.diagrams[0]
    const child = {
      ...parent,
      id: 'runtime-viewer-child',
      parentId: parent.id,
      name: '目标子图',
      level: 'building' as const,
    }
    document.diagrams.push(child)
    document.elements.push({
      id: 'runtime-viewer-link',
      diagramId: parent.id,
      assetKey: 'ups',
      name: '入口',
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      properties: { drillDownDiagramId: child.id },
      extensions: {},
    })
    const view = createDiagramRuntimeView(document, parent.id)!
    const runtime: DiagramRuntimeContext = {
      state: {
        onOffStates: {},
        coolingPumpRunningStates: {},
        coolingPumpOutputPowerStates: {},
        coolingValveOpenStates: {},
        powerExternalSupplyActive: false,
        powerBatteryBackupActive: false,
      },
      navigation: view.navigation,
    }
    const onNavigate = vi.fn()
    const user = userEvent.setup()

    render(
      <DiagramRuntimeViewer
        view={view}
        runtime={runtime}
        animationPlaying
        onNavigate={onNavigate}
      />,
    )
    await user.click(screen.getByRole('button', { name: '打开子图' }))

    expect(diagramCanvasProps.current).toMatchObject({
      animationPlaying: true,
      view,
      runtime,
    })
    expect(onNavigate).toHaveBeenCalledWith(
      { diagramId: child.id, diagramName: child.name },
      'runtime-viewer-link',
    )
  })
})
