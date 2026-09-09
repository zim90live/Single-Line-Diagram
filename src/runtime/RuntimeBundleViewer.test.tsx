import { forwardRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { symbolAssets } from '../scene/symbolCatalog'
import { DiagramRuntimeViewer } from './DiagramRuntimeViewer'
import { createDiagramRuntimeBundle } from './runtimeBundle'
import { RuntimeBundleViewer } from './RuntimeBundleViewer'

const { runtimeViewerProps } = vi.hoisted(() => ({
  runtimeViewerProps: {
    current: null as ComponentProps<typeof DiagramRuntimeViewer> | null,
  },
}))

vi.mock('./DiagramRuntimeViewer', () => ({
  DiagramRuntimeViewer: forwardRef(function MockDiagramRuntimeViewer(
    props: ComponentProps<typeof DiagramRuntimeViewer>,
    _ref,
  ) {
    runtimeViewerProps.current = props
    const [elementId, target] = Object.entries(props.view.navigation)[0] ?? []
    return target ? (
      <button type="button" onClick={() => props.onNavigate?.(target, elementId)}>
        打开运行时子图
      </button>
    ) : <div>{props.view.diagram.name}</div>
  }),
}))

describe('RuntimeBundleViewer', () => {
  it('hosts a bundle independently, merges runtime overrides, and manages navigation', async () => {
    const document = createDefaultProject('独立 React 宿主', symbolAssets)
    const parent = document.diagrams[0]
    const child = document.diagrams.find((diagram) => diagram.parentId === parent.id)!
    document.elements.push({
      id: 'runtime-host-link',
      diagramId: parent.id,
      assetKey: 'switch',
      name: '下探入口',
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      onOffState: 'off',
      properties: { drillDownDiagramId: child.id },
      extensions: {},
    })
    const bundle = createDiagramRuntimeBundle(document, [parent.id], {
      onOffStates: { 'runtime-host-link': true },
    })
    const onDiagramChange = vi.fn()
    const onRuntimePresentationChange = vi.fn()
    const user = userEvent.setup()

    render(
      <RuntimeBundleViewer
        bundle={bundle}
        animationPlaying
        stateOverrides={{
          onOffStates: { 'runtime-host-link': false },
          powerExternalSupplyActive: true,
          powerExternalSupplyChannel: 'b',
          powerBatteryBackupActive: true,
        }}
        onDiagramChange={onDiagramChange}
        onRuntimePresentationChange={onRuntimePresentationChange}
      />,
    )

    expect(runtimeViewerProps.current?.view.diagram.id).toBe(parent.id)
    expect(runtimeViewerProps.current?.runtime.state.onOffStates['runtime-host-link']).toBe(false)
    expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyActive).toBe(true)
    expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyChannel).toBe('b')
    expect(runtimeViewerProps.current?.runtime.state.powerBatteryBackupActive).toBe(true)
    expect(runtimeViewerProps.current?.onRuntimePresentationChange)
      .toBe(onRuntimePresentationChange)

    await user.click(screen.getByRole('button', { name: '打开运行时子图' }))

    expect(onDiagramChange).toHaveBeenCalledWith(child.id)
    expect(runtimeViewerProps.current?.view.diagram.id).toBe(child.id)
  })
})
