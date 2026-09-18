import { forwardRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { symbolAssets } from '../scene/symbolCatalog'
import { DiagramRuntimeViewer } from './DiagramRuntimeViewer'
import { createDiagramRuntimeBundle, parseDiagramRuntimeBundle, serializeDiagramRuntimeBundle } from './runtimeBundle'
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
    expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyChannels).toEqual(['b'])
    expect(runtimeViewerProps.current?.runtime.state.powerBatteryBackupActive).toBe(true)
    expect(runtimeViewerProps.current?.onRuntimePresentationChange)
      .toBe(onRuntimePresentationChange)

    await user.click(screen.getByRole('button', { name: '打开运行时子图' }))

    expect(onDiagramChange).toHaveBeenCalledWith(child.id)
    expect(runtimeViewerProps.current?.view.diagram.id).toBe(child.id)
  })

  it('preserves inherited dual feeds through bundle serialization and applies channel override precedence', () => {
    const document = createDefaultProject('双路运行包', symbolAssets)
    const line = document.lineSystems.find((system) => system.type === 'power')!
    const parent = document.diagrams.find((diagram) => diagram.id === line.rootDiagramId)!
    const child = document.diagrams.find((diagram) => diagram.parentId === parent.id)!
    const receiverAsset = document.assets.find((asset) => asset.key === 'compute-pod')!
    receiverAsset.anchors = [
      { id: 'a', name: 'A', x: 0, y: 24, direction: 'left', type: 'electrical', powerSupplyChannel: 'a' },
      { id: 'b', name: 'B', x: 64, y: 24, direction: 'right', type: 'electrical', powerSupplyChannel: 'b' },
    ]
    const gridAsset = document.assets.find((asset) => asset.key === 'grid')!
    gridAsset.anchors = [{ id: 'out', name: '输出', x: 24, y: 48, direction: 'bottom', type: 'electrical' }]
    document.elements.push({
      id: 'parent-load', diagramId: parent.id, assetKey: 'compute-pod', name: '双路负载',
      x: 160, y: 0, width: 64, height: 64, rotation: 0,
      properties: { drillDownDiagramId: child.id }, extensions: {},
    })
    for (const channel of ['a', 'b'] as const) {
      document.elements.push({
        id: `grid-${channel}`, diagramId: parent.id, assetKey: 'grid', name: `Grid ${channel}`,
        x: 0, y: channel === 'a' ? 0 : 80, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
      })
      document.connections.push({
        id: `network-${channel}`, diagramId: parent.id, type: 'electrical', powerSupplyChannel: channel,
        nodes: [
          { id: `source-${channel}`, kind: 'element-anchor', elementId: `grid-${channel}`, anchorId: 'out' },
          { id: `load-${channel}`, kind: 'element-anchor', elementId: 'parent-load', anchorId: channel },
        ],
        edges: [{ id: `feed-${channel}`, sourceNodeId: `source-${channel}`, targetNodeId: `load-${channel}` }],
      })
    }
    const bundle = parseDiagramRuntimeBundle(serializeDiagramRuntimeBundle(createDiagramRuntimeBundle(document, [child.id])))
    const { rerender } = render(<RuntimeBundleViewer bundle={bundle} animationPlaying />)
    expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyChannels).toEqual(['a', 'b'])

    rerender(<RuntimeBundleViewer bundle={bundle} animationPlaying stateOverrides={{ powerExternalSupplyChannel: 'b' }} />)
    expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyChannels).toEqual(['b'])

    for (const channels of [['a', 'b'], ['a'], []] as const) {
      rerender(<RuntimeBundleViewer bundle={bundle} animationPlaying stateOverrides={{
        powerExternalSupplyChannel: 'b', powerExternalSupplyChannels: channels,
      }} />)
      expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyChannels).toEqual(channels)
    }
    rerender(<RuntimeBundleViewer bundle={bundle} animationPlaying />)
    expect(runtimeViewerProps.current?.runtime.state.powerExternalSupplyChannels).toEqual(['a', 'b'])
  })
})
