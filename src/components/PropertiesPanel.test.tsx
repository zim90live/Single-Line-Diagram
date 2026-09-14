import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type {
  AssetDefinition,
  Busbar,
  ConnectionEdge,
  ConnectionNetwork,
  DiagramElement,
} from '../domain/project'
import { GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR } from '../editor/genericSymbol'
import { defaultConnectionColor } from '../editor/objectColors'
import { DEFAULT_CONFIGURABLE_SYMBOL_COLOR } from '../editor/symbolCatalog'
import { PropertiesPanel } from './PropertiesPanel'

function element(assetKey: string, properties: DiagramElement['properties'] = {}): DiagramElement {
  return {
    id: `${assetKey}-element`,
    diagramId: 'diagram-1',
    assetKey,
    name: assetKey,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    rotation: 0,
    properties,
    extensions: {},
  }
}

const emptySelectionProps = {
  selectedBusbars: [] as Busbar[],
  selectedConnection: null,
  onSelectionColorPreview: vi.fn(),
  onSelectionColorCommit: vi.fn(),
}

describe('PropertiesPanel color property', () => {
  it.each(['electrical', 'cooling-secondary-cold'] as const)('sets and resets %s line width for the selected edges', (type) => {
    const onPatchConnectionEdges = vi.fn()
    render(<PropertiesPanel {...emptySelectionProps} selectedElements={[]}
      selectedConnection={{ id: 'selection', type, edges: [
        { id: 'e1', sourceNodeId: 'a', targetNodeId: 'b' },
        { id: 'e2', sourceNodeId: 'b', targetNodeId: 'c' },
      ] }} onPatch={vi.fn()} onColorPreview={vi.fn()} onDelete={vi.fn()} onPatchConnectionEdges={onPatchConnectionEdges} />)
    const field = screen.getByRole('textbox', { name: type === 'electrical' ? '子线粗细 (px)' : '管路粗细 (px)' })
    fireEvent.change(field, { target: { value: '5' } })
    fireEvent.blur(field)
    expect(onPatchConnectionEdges).toHaveBeenLastCalledWith(['e1', 'e2'], { lineWidth: 5 })
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(onPatchConnectionEdges).toHaveBeenLastCalledWith(['e1', 'e2'], { lineWidth: undefined })
  })
  it('edits standalone text content and typography without device controls', () => {
    const onPatch = vi.fn()
    render(<PropertiesPanel {...emptySelectionProps} selectedElements={[element('text')]}
      onPatch={onPatch} onColorPreview={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByLabelText('设备标识')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '显示运行数据' })).not.toBeInTheDocument()
    const content = screen.getByLabelText('文字内容')
    expect(content).toHaveValue('文字')
    fireEvent.change(content, { target: { value: 'POD A' } })
    fireEvent.blur(content)
    expect(onPatch).toHaveBeenLastCalledWith('text-element', expect.objectContaining({ properties: { text: 'POD A' } }))
    const size = screen.getByRole('textbox', { name: '字体大小' })
    expect(size).toHaveValue('24')
    fireEvent.change(size, { target: { value: '32' } })
    fireEvent.blur(size)
    expect(onPatch).toHaveBeenLastCalledWith('text-element', expect.objectContaining({ properties: { fontSize: 32 } }))
    const weight = screen.getByRole('combobox', { name: '字重' })
    expect(weight).toHaveValue('700')
    fireEvent.change(weight, { target: { value: '400' } })
    expect(onPatch).toHaveBeenLastCalledWith('text-element', expect.objectContaining({ properties: { fontWeight: 400 } }))
    const color = screen.getByLabelText('文字颜色 HEX')
    expect(color).toHaveValue('#888888')
    fireEvent.change(color, { target: { value: '#123456' } })
    fireEvent.blur(color)
    expect(onPatch).toHaveBeenLastCalledWith('text-element', expect.objectContaining({ properties: { textColor: '#123456' } }))
  })
  it('copies a selected busbar metric template to all selected busbars', async () => {
    const user = userEvent.setup()
    const onPatchBusbarMetrics = vi.fn()
    const onPatchBusbars = vi.fn()
    const metric = { id: 'power', name: '功率', valueType: 'number' as const, unit: 'kW', precision: 0 as const,
      simulationMin: 0, simulationMax: 100, alarm: { mode: 'upper' as const, minor: 60, major: 75, critical: 90 } }
    const bars: Busbar[] = ['one', 'two'].map((id, index) => ({ id, diagramId: 'd', type: 'electrical',
      orientation: 'horizontal', x: 0, y: index * 80, length: 160, monitorMetrics: index ? [metric] : [] }))
    render(<PropertiesPanel {...emptySelectionProps} selectedElements={[]} selectedBusbars={bars}
      onPatch={vi.fn()} onColorPreview={vi.fn()} onDelete={vi.fn()}
      onPatchBusbarMetrics={onPatchBusbarMetrics} onPatchBusbars={onPatchBusbars} />)
    expect(screen.queryByRole('button', { name: '应用到 2 个对象' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '指标模板' }), 'two')
    await user.click(screen.getByRole('button', { name: '应用到 2 个对象' }))
    expect(onPatchBusbarMetrics).toHaveBeenCalledWith(['one', 'two'], [metric])
    await user.click(screen.getByRole('switch', { name: '显示运行数据' }))
    expect(onPatchBusbars).toHaveBeenCalledWith(['one', 'two'], { monitorDataVisible: true })
    await user.selectOptions(screen.getByRole('combobox', { name: '指标模板' }), '__blank__')
    await user.click(screen.getByRole('button', { name: '应用到 2 个对象' }))
    expect(onPatchBusbarMetrics).toHaveBeenLastCalledWith(['one', 'two'], [])
  })
  it('commits project-wide element label scale from the empty panel', () => {
    const onElementLabelScaleChange = vi.fn()
    render(<PropertiesPanel {...emptySelectionProps} selectedElements={[]} onPatch={vi.fn()} onColorPreview={vi.fn()} onDelete={vi.fn()} elementLabelScale={1} onElementLabelScaleChange={onElementLabelScaleChange} />)
    const input = screen.getByRole('textbox', { name: '图元标签大小 (%)' })
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)
    expect(onElementLabelScaleChange).toHaveBeenCalledWith(1.5)
  })
  it('exposes independent busbar data and metric label visibility', () => {
    const onPatchBusbar = vi.fn()
    render(<PropertiesPanel {...emptySelectionProps} selectedBusbars={[{ id: 'bar', diagramId: 'd', type: 'electrical', orientation: 'horizontal', x: 0, y: 0, length: 160 }]} selectedElements={[]} onPatch={vi.fn()} onPatchBusbar={onPatchBusbar} onColorPreview={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: '显示运行数据' }))
    expect(onPatchBusbar).toHaveBeenCalledWith('bar', { monitorDataVisible: true })
    fireEvent.click(screen.getByRole('switch', { name: '显示指标名称与单位' }))
    expect(onPatchBusbar).toHaveBeenCalledWith('bar', { monitorMetricLabelsVisible: false })
  })
  it.each(['tmu', 'fm'])('changes only the selected %s port placement', (assetKey) => {
    const onPatch = vi.fn()
    render(<PropertiesPanel {...emptySelectionProps} selectedElements={[element(assetKey)]} onPatch={onPatch} onColorPreview={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: '上下接口对调' }))
    expect(onPatch).toHaveBeenCalledWith(`${assetKey}-element`, { [assetKey === 'tmu' ? 'tmuPortsSwapped' : 'fmPortsSwapped']: true })
  })
  it('exposes project palette editing in the empty selection panel', () => {
    render(<PropertiesPanel {...emptySelectionProps} selectedElements={[]} onPatch={vi.fn()} onColorPreview={vi.fn()} onDelete={vi.fn()}
      onCircuitPaletteChange={vi.fn()} circuitPalette={{ a: '#112233' }} />)
    expect(screen.getByText('A路颜色')).toBeInTheDocument()
    expect(screen.getByText('B路颜色')).toBeInTheDocument()
    expect(screen.getByText('三次回路冷颜色')).toBeInTheDocument()
  })

  it('edits a whole power network and locks it when an A interface is connected', () => {
    const onChangePowerCircuit = vi.fn()
    const network: ConnectionNetwork = { id: 'network', diagramId: 'diagram-1', type: 'electrical', powerSupplyChannel: 'a',
      nodes: [{ id: 'source', kind: 'node', x: 0, y: 0 }, { id: 'target', kind: 'node', x: 8, y: 0 }],
      edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'target', color: '#123456' }],
    }
    const props = { ...emptySelectionProps, selectedElements: [], onPatch: vi.fn(), onColorPreview: vi.fn(), onDelete: vi.fn(),
      selectedConnection: { id: 'edge', type: 'electrical' as const, edges: network.edges }, canvasConnections: [network], onChangePowerCircuit,
    }
    const { rerender } = render(<PropertiesPanel {...props} />)
    expect(screen.getByLabelText('链路类型')).toHaveValue('a')
    fireEvent.change(screen.getByLabelText('链路类型'), { target: { value: 'b' } })
    expect(onChangePowerCircuit).toHaveBeenCalledWith(['edge'], 'b', [])
    expect(screen.getByText('颜色跟随链路类型，请在空选状态修改项目级配色。')).toBeInTheDocument()
    const device = element('ups')
    const asset: AssetDefinition = { key: 'ups', name: 'UPS', category: '电力', source: 'ups.svg', intrinsicWidth: 32, intrinsicHeight: 32,
      anchors: [{ id: 'in', name: 'A', x: 8, y: 0, direction: 'top', type: 'electrical', powerSupplyChannel: 'a' }],
    }
    rerender(<PropertiesPanel {...props} canvasElements={[device]} assetsByKey={new Map([['ups', asset]])}
      canvasConnections={[{ ...network, nodes: [{ id: 'source', kind: 'element-anchor', elementId: device.id, anchorId: 'in' }, network.nodes[1]] }]} />)
    expect(screen.getByLabelText('链路类型')).toBeDisabled()
  })

  it('offers restoring selected manually routed child lines to automatic routing', async () => {
    const user = userEvent.setup()
    const onResetConnectionRouting = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edge-1',
          type: 'electrical',
          edges: [{
            id: 'edge-1',
            sourceNodeId: 'node-a',
            targetNodeId: 'node-b',
            routeNodeIds: ['waypoint-a', 'waypoint-b'],
          }],
        }}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onResetConnectionRouting={onResetConnectionRouting}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '恢复自动布线' }))
    expect(onResetConnectionRouting).toHaveBeenCalledOnce()
  })

  it('offers automatic routing for a selected node-bounded span', () => {
    const canvasConnections: ConnectionNetwork[] = [{
      id: 'network-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      nodes: [
        { id: 'left', kind: 'busbar-tap', busbarId: 'left-busbar', offset: 0 },
        { id: 'middle', kind: 'node', x: 80, y: 40 },
        { id: 'right', kind: 'busbar-tap', busbarId: 'right-busbar', offset: 0 },
      ],
      edges: [
        {
          id: 'left-span',
          sourceNodeId: 'left',
          targetNodeId: 'middle',
          logicalConnectionId: 'logical-edge',
        },
        {
          id: 'right-span',
          sourceNodeId: 'middle',
          targetNodeId: 'right',
          logicalConnectionId: 'logical-edge',
        },
      ],
    }]
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'left-span',
          type: 'electrical',
          edges: [canvasConnections[0].edges[0]],
        }}
        canvasConnections={canvasConnections}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '恢复自动布线' })).toBeInTheDocument()
  })

  it('describes mixed waypoint selections without exposing element scaling controls', () => {
    render(
      <PropertiesPanel
        selectedElements={[element('ups')]}
        selectedBusbars={[]}
        selectedConnection={null}
        selectedRouteWaypointCount={2}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText(/包含节点的混合选区不能缩放/)).toBeInTheDocument()
    expect(screen.queryByLabelText('缩放')).not.toBeInTheDocument()
  })

  it('explains the degree-aware behavior for deleting a selected node', () => {
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={null}
        selectedJunctionCount={1}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('线路节点')).toBeInTheDocument()
    expect(screen.getByText(/删除二连节点会恢复局部自动布线/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除节点' })).toBeInTheDocument()
  })

  it('groups current canvas colors by object type and globally replaces a clicked color', async () => {
    const user = userEvent.setup()
    const onCanvasColorPreview = vi.fn()
    const onCanvasColorCommit = vi.fn()
    const canvasBusbars: Busbar[] = [{
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 80,
      length: 160,
    }]
    const canvasConnections: ConnectionNetwork[] = [{
      id: 'network-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      nodes: [
        { id: 'node-1', kind: 'element-anchor', elementId: 'mp-element', anchorId: 'a' },
        { id: 'node-2', kind: 'busbar-tap', busbarId: 'busbar-1', offset: 16 },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
    }]
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={null}
        canvasElements={[element('mp')]}
        canvasBusbars={canvasBusbars}
        canvasConnections={canvasConnections}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onCanvasColorPreview={onCanvasColorPreview}
        onCanvasColorCommit={onCanvasColorCommit}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '图元' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '母线' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '子线' })).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: `全局修改图元颜色 ${DEFAULT_CONFIGURABLE_SYMBOL_COLOR}`,
    }))
      .toHaveTextContent('1 个')
    expect(screen.getByRole('button', { name: '全局修改母线颜色 #D5B96F' }))
      .toHaveTextContent('1 条')
    expect(screen.getByRole('button', { name: '全局修改子线颜色 #D5B96F' }))
      .toHaveTextContent('1 条')

    await user.click(screen.getByRole('button', {
      name: `全局修改图元颜色 ${DEFAULT_CONFIGURABLE_SYMBOL_COLOR}`,
    }))
    expect(screen.getByRole('group', { name: '全局替换图元颜色 HEX 选择器' }))
      .toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('全局替换图元颜色 选择器 HEX'), {
      target: { value: '#77b4bf' },
    })
    expect(onCanvasColorPreview).toHaveBeenLastCalledWith(
      { category: 'element', color: DEFAULT_CONFIGURABLE_SYMBOL_COLOR, count: 1 },
      '#77B4BF',
    )
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(onCanvasColorCommit).toHaveBeenCalledWith(
      { category: 'element', color: DEFAULT_CONFIGURABLE_SYMBOL_COLOR, count: 1 },
      '#77B4BF',
    )
  })

  it('warns without blocking when the device identifier is duplicated', () => {
    render(
      <PropertiesPanel
        selectedElements={[element('chwp', { tag: 'CHWP-01' })]}
        duplicateDeviceIdentifier
        {...emptySelectionProps}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('当前图纸中存在重复的设备标识')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如 UPS-01')).toHaveValue('CHWP-01')
  })

  it('toggles the selected element label independently from the properties panel', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const current = element('chwp', { tag: 'CHWP-01' })
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const visibleSwitch = screen.getByRole('switch', { name: '显示图元标签' })
    expect(visibleSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(visibleSwitch)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, { labelVisible: false })

    rerender(
      <PropertiesPanel
        selectedElements={[{ ...current, labelVisible: false }]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const hiddenSwitch = screen.getByRole('switch', { name: '显示图元标签' })
    expect(hiddenSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(hiddenSwitch)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, { labelVisible: true })
  })

  it('edits a generic frame visibility, size, border color, and background independently', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    const current = {
      ...element('generic', { tag: 'GEN-01' }),
      name: '通用图元',
      width: 96,
      height: 48,
    }
    render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.queryByRole('switch', { name: '显示图元标签' })).not.toBeInTheDocument()
    const borderSwitch = screen.getByRole('switch', { name: '显示虚线框' })
    expect(borderSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(borderSwitch)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      properties: { tag: 'GEN-01', genericBorderVisible: false },
    })
    expect(screen.queryByLabelText('缩放')).not.toBeInTheDocument()
    expect(screen.getByLabelText('虚线框颜色 HEX')).toHaveValue(
      DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
    )
    const backgroundColor = screen.getByLabelText('背景颜色 HEX')
    expect(backgroundColor).toHaveValue(GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR)
    fireEvent.change(backgroundColor, { target: { value: '#334455' } })
    expect(onColorPreview).toHaveBeenLastCalledWith(
      current.id,
      '#334455',
      'generic-background',
    )
    expect(onPatch).toHaveBeenCalledTimes(1)
    fireEvent.blur(backgroundColor)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      properties: { tag: 'GEN-01', genericBackgroundColor: '#334455' },
    })

    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '160' } })
    fireEvent.blur(screen.getByLabelText('宽度'))
    expect(onPatch).toHaveBeenLastCalledWith(current.id, { width: 160 })

    fireEvent.change(screen.getByLabelText('高度'), { target: { value: '64' } })
    fireEvent.blur(screen.getByLabelText('高度'))
    expect(onPatch).toHaveBeenLastCalledWith(current.id, { height: 64 })
  })

  it('configures runtime-data visibility and metrics on the selected element instance', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const current = element('chwp', { tag: 'CHWP-01' })
    render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const dataSwitch = screen.getByRole('switch', { name: '显示运行数据' })
    expect(dataSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(dataSwitch)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, { monitorDataVisible: true })

    const metricLabelsSwitch = screen.getByRole('switch', { name: '显示指标名称与单位' })
    expect(metricLabelsSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(metricLabelsSwitch)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      monitorMetricLabelsVisible: false,
    })

    await user.click(screen.getByRole('button', { name: '添加' }))
    const metricPatch = onPatch.mock.calls.find(([, patch]) => 'monitorMetrics' in patch)?.[1]
    expect(metricPatch.monitorMetrics).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^monitor-metric-/),
        name: '指标 1',
        valueType: 'number',
        precision: 1,
        alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
      }),
    ])
  })

  it('converts an instance metric to text states with normal-dominant defaults', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const current: DiagramElement = {
      ...element('chwp', { tag: 'CHWP-01' }),
      monitorMetrics: [{
        id: 'metric-1',
        name: '运行状态',
        valueType: 'number',
        unit: '',
        precision: 1,
        simulationMin: 0,
        simulationMax: 100,
        alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
      }],
    }
    render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByText('运行状态'))
    await user.selectOptions(screen.getByLabelText('数据类型'), 'text')

    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      monitorMetrics: [{
        id: 'metric-1',
        name: '运行状态',
        valueType: 'text',
        textOptions: [
          expect.objectContaining({ value: '运行', severity: 'normal' }),
          expect.objectContaining({ value: '停机', severity: 'major' }),
          expect.objectContaining({ value: '离线', severity: 'critical' }),
        ],
      }],
    })
  })

  it('shows color editing for Tap-off Unit and commits the selected color', () => {
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('tap-off-unit')]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('图元颜色 HEX')
    expect(screen.getByText('HEX')).toBeInTheDocument()
    expect(input).toHaveValue(DEFAULT_CONFIGURABLE_SYMBOL_COLOR)
    for (const color of ['#6688aa', '#6699bb', '#77aacc', '#77b4bf']) {
      fireEvent.change(input, { target: { value: color } })
    }

    expect(onPatch).not.toHaveBeenCalled()
    expect(onColorPreview).toHaveBeenCalledTimes(4)
    fireEvent.blur(input)

    expect(onPatch).toHaveBeenCalledOnce()
    expect(onPatch).toHaveBeenLastCalledWith('tap-off-unit-element', {
      properties: { color: '#77B4BF' },
    })
  })

  it.each([
    { assetKey: 'supply', symbolName: 'Supply' },
    { assetKey: 'load', symbolName: 'Load' },
  ])('controls $symbolName running/standby state and colors independently', async ({
    assetKey,
    symbolName,
  }) => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    const onOnOffStateChange = vi.fn()
    const current = element(assetKey, {
      switchOffColor: '#556677',
      switchOnColor: '#77B4BF',
    })
    render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onOnOffStateChange={onOnOffStateChange}
        onDelete={vi.fn()}
      />,
    )

    const stateToggle = screen.getByRole('switch', { name: `${symbolName} 运行状态` })
    expect(stateToggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('当前运行')).toBeInTheDocument()
    await user.click(stateToggle)
    expect(onOnOffStateChange).toHaveBeenCalledWith(current.id, false)

    const standbyColor = screen.getByLabelText(`${symbolName} 待机状态颜色 HEX`)
    const runningColor = screen.getByLabelText(`${symbolName} 运行状态颜色 HEX`)
    expect(standbyColor).toHaveValue('#556677')
    expect(runningColor).toHaveValue('#77B4BF')
    fireEvent.change(runningColor, { target: { value: '#88aacc' } })
    expect(onColorPreview).toHaveBeenLastCalledWith(current.id, '#88AACC', 'switch-on')
    fireEvent.blur(runningColor)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      properties: {
        switchOffColor: '#556677',
        switchOnColor: '#88AACC',
      },
    })
  })

  it('edits persisted pump running state and output power for pump assets', async () => {
    const user = userEvent.setup()
    const onCoolingPumpRunningChange = vi.fn()
    const onCoolingPumpOutputPowerChange = vi.fn()
    const pump = {
      ...element('chwp', { tag: 'CHWP-01' }),
      coolingPumpRunning: false,
      coolingPumpOutputPower: 42,
    }
    const pumpAsset: AssetDefinition = {
      key: 'chwp',
      name: 'CHWP',
      category: '冷却',
      source: 'CHWP.png',
      intrinsicWidth: 200,
      intrinsicHeight: 80,
      coolingDeviceRole: 'pump',
      anchors: [],
    }
    render(
      <PropertiesPanel
        selectedElements={[pump]}
        {...emptySelectionProps}
        assetsByKey={new Map([[pumpAsset.key, pumpAsset]])}
        onPatch={vi.fn()}
        onCoolingPumpRunningChange={onCoolingPumpRunningChange}
        onCoolingPumpOutputPowerChange={onCoolingPumpOutputPowerChange}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const stateToggle = screen.getByRole('switch', { name: '水泵运行状态' })
    expect(stateToggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText('水泵输出功率滑块')).toHaveValue('42')
    expect(screen.getByText('启停状态和输出功率随项目保存。')).toBeInTheDocument()

    await user.click(stateToggle)
    expect(onCoolingPumpRunningChange).toHaveBeenCalledWith(pump.id, true)
    fireEvent.change(screen.getByLabelText('水泵输出功率滑块'), {
      target: { value: '65' },
    })
    expect(onCoolingPumpOutputPowerChange).toHaveBeenCalledWith(pump.id, 65)
  })

  it('configures each Switch monitor click behavior independently', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const current = element('switch', { tag: 'MLVR307-6B-HD01' })
    render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('监控点击行为')).toHaveValue('control')
    await user.selectOptions(screen.getByLabelText('监控点击行为'), 'device-panel')
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      monitorInteraction: 'device-panel',
    })
  })

  it('controls Switch runtime state and commits off/on colors independently', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    const onOnOffStateChange = vi.fn()
    const offReplacement = defaultConnectionColor('cooling-primary-hot')
    const current = element('switch', {
      tag: 'SW-01',
      switchOffColor: '#556677',
      switchOnColor: '#77B4BF',
    })
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onOffStates={{ [current.id]: false }}
        onOnOffStateChange={onOnOffStateChange}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )

    const stateToggle = screen.getByRole('switch', { name: 'Switch 开关状态' })
    expect(stateToggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('当前断开 · Off')).toBeInTheDocument()
    await user.click(stateToggle)
    expect(onOnOffStateChange).toHaveBeenCalledWith(current.id, true)

    const offColor = screen.getByLabelText('Switch 关状态颜色 HEX')
    const onColor = screen.getByLabelText('Switch 开状态颜色 HEX')
    expect(offColor).toHaveValue('#556677')
    expect(onColor).toHaveValue('#77B4BF')
    fireEvent.change(offColor, { target: { value: offReplacement } })
    expect(onColorPreview).toHaveBeenLastCalledWith(current.id, offReplacement, 'switch-off')
    fireEvent.blur(offColor)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      properties: {
        tag: 'SW-01',
        switchOffColor: offReplacement,
        switchOnColor: '#77B4BF',
      },
    })

    const updated = {
      ...current,
      properties: { ...current.properties, switchOffColor: offReplacement },
    }
    rerender(
      <PropertiesPanel
        selectedElements={[updated]}
        {...emptySelectionProps}
        onOffStates={{ [current.id]: true }}
        onOnOffStateChange={onOnOffStateChange}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('当前闭合 · On')).toBeInTheDocument()
    expect(stateToggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByLabelText('Switch 开状态颜色 HEX'), {
      target: { value: '#77aacc' },
    })
    expect(onColorPreview).toHaveBeenLastCalledWith(current.id, '#77AACC', 'switch-on')
    fireEvent.blur(screen.getByLabelText('Switch 开状态颜色 HEX'))
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      properties: {
        tag: 'SW-01',
        switchOffColor: offReplacement,
        switchOnColor: '#77AACC',
      },
    })
  })

  it.each([
    { assetKey: '2-wv', symbolName: '2WV' },
    { assetKey: 'cv', symbolName: 'CV' },
  ])('controls $symbolName like Switch with separate Off/On colors', async ({
    assetKey,
    symbolName,
  }) => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    const onOnOffStateChange = vi.fn()
    const current = element(assetKey, { color: '#556677' })
    render(
      <PropertiesPanel
        selectedElements={[current]}
        {...emptySelectionProps}
        onOffStates={{ [current.id]: false }}
        onOnOffStateChange={onOnOffStateChange}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )

    const stateToggle = screen.getByRole('switch', { name: `${symbolName} 开关状态` })
    expect(stateToggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('当前关闭 · Off')).toBeInTheDocument()
    await user.click(stateToggle)
    expect(onOnOffStateChange).toHaveBeenCalledWith(current.id, true)

    expect(screen.getByLabelText(`${symbolName} 关状态颜色 HEX`)).toHaveValue('#556677')
    const onColor = screen.getByLabelText(`${symbolName} 开状态颜色 HEX`)
    expect(onColor).toHaveValue('#556677')
    fireEvent.change(onColor, { target: { value: '#77b4bf' } })
    expect(onColorPreview).toHaveBeenLastCalledWith(current.id, '#77B4BF', 'switch-on')
    fireEvent.blur(onColor)
    expect(onPatch).toHaveBeenLastCalledWith(current.id, {
      properties: {
        switchOffColor: '#556677',
        switchOnColor: '#77B4BF',
      },
    })
  })

  it('opens an application-owned HEX picker instead of a native RGB color input', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('mp')]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '打开图元颜色选择器' }))

    expect(screen.getByRole('group', { name: '图元颜色 HEX 选择器' })).toBeInTheDocument()
    expect(document.querySelector('input[type="color"]')).not.toBeInTheDocument()
    const pickerHex = screen.getByLabelText('图元颜色 选择器 HEX')
    expect(pickerHex).toHaveValue(DEFAULT_CONFIGURABLE_SYMBOL_COLOR)
    fireEvent.change(pickerHex, { target: { value: '#77b4bf' } })
    await user.click(screen.getByRole('button', { name: '完成' }))

    expect(onPatch).toHaveBeenCalledWith('mp-element', {
      properties: { color: '#77B4BF' },
    })
  })

  it('restores the default by removing the custom color property', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('mp', { tag: 'MP-01', color: '#E7A23B' })]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '恢复默认' }))

    expect(onPatch).toHaveBeenCalledWith('mp-element', {
      properties: { tag: 'MP-01' },
    })
  })

  it('does not expose color editing for unsupported symbols', () => {
    render(
      <PropertiesPanel
        selectedElements={[element('chwp')]}
        {...emptySelectionProps}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('图元颜色')).not.toBeInTheDocument()
  })

  it('commits a busbar color from the default HEX editor', () => {
    const onSelectionColorPreview = vi.fn()
    const onSelectionColorCommit = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[{
          id: 'busbar-1',
          diagramId: 'diagram-1',
          type: 'electrical',
          orientation: 'horizontal',
          x: 0,
          y: 0,
          length: 160,
        }]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={onSelectionColorPreview}
        onSelectionColorCommit={onSelectionColorCommit}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('母线颜色 HEX')
    expect(input).toHaveValue('#D5B96F')
    fireEvent.change(input, { target: { value: '#12ab34' } })
    expect(onSelectionColorPreview).toHaveBeenLastCalledWith('#12AB34')
    fireEvent.blur(input)

    expect(onSelectionColorCommit).toHaveBeenCalledOnce()
    expect(onSelectionColorCommit).toHaveBeenLastCalledWith('#12AB34')
  })

  it('adds and clears an optional busbar label', () => {
    const onPatchBusbar = vi.fn()
    const selectedBusbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[selectedBusbar]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('母线标签')
    expect(screen.getByRole('switch', { name: '显示母线标签' }))
      .toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('填写标签后生效')).toBeInTheDocument()
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: '市电母线' } })
    fireEvent.blur(input)
    expect(onPatchBusbar).toHaveBeenLastCalledWith('busbar-1', { label: '市电母线' })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[{ ...selectedBusbar, label: '市电母线' }]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('母线标签'), { target: { value: '' } })
    fireEvent.blur(screen.getByLabelText('母线标签'))
    expect(onPatchBusbar).toHaveBeenLastCalledWith('busbar-1', { label: undefined })
  })

  it('configures and restores the selected busbar label color', () => {
    const onPatchBusbar = vi.fn()
    const onBusbarLabelColorPreview = vi.fn()
    const selectedBusbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
      label: '市电母线',
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[selectedBusbar]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onBusbarLabelColorPreview={onBusbarLabelColorPreview}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('标签颜色 HEX')
    expect(input).toHaveValue('#B6B8B4')
    fireEvent.change(input, { target: { value: '#12ab34' } })
    expect(onBusbarLabelColorPreview).toHaveBeenLastCalledWith('busbar-1', '#12AB34')
    fireEvent.blur(input)
    expect(onPatchBusbar).toHaveBeenLastCalledWith('busbar-1', { labelColor: '#12AB34' })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[{ ...selectedBusbar, labelColor: '#12AB34' }]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onBusbarLabelColorPreview={onBusbarLabelColorPreview}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('标签颜色 HEX')).toHaveValue('#12AB34')
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(onPatchBusbar).toHaveBeenLastCalledWith('busbar-1', { labelColor: undefined })
  })

  it('toggles only the selected busbar label while preserving its text', async () => {
    const user = userEvent.setup()
    const onPatchBusbar = vi.fn()
    const selectedBusbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
      label: '市电母线',
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[selectedBusbar]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const visibleSwitch = screen.getByRole('switch', { name: '显示母线标签' })
    expect(visibleSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(visibleSwitch)
    expect(onPatchBusbar).toHaveBeenLastCalledWith('busbar-1', { labelVisible: false })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[{ ...selectedBusbar, labelVisible: false }]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('母线标签')).toHaveValue('市电母线')
    const hiddenSwitch = screen.getByRole('switch', { name: '显示母线标签' })
    expect(hiddenSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(hiddenSwitch)
    expect(onPatchBusbar).toHaveBeenLastCalledWith('busbar-1', { labelVisible: true })
  })

  it('configures and toggles a label for one selected child line', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdge = vi.fn()
    const edge = {
      id: 'edge-1',
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: edge.id,
          type: 'electrical',
          edges: [edge],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const labelInput = screen.getByLabelText('子线标签')
    expect(labelInput).toHaveValue('')
    expect(screen.getByRole('switch', { name: '显示子线标签' }))
      .toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '显示运行数据' }))
      .toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: '显示指标名称与单位' }))
      .toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('heading', { name: '运行指标' })).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '显示运行数据' }))
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      monitorDataVisible: true,
    })
    expect(screen.getByRole('combobox', { name: '通行方向' })).toHaveValue('bidirectional')
    await user.selectOptions(screen.getByRole('combobox', { name: '通行方向' }), 'forward')
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      flowDirection: 'forward',
    })
    fireEvent.change(labelInput, { target: { value: '联络线 01' } })
    fireEvent.blur(labelInput)
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      label: '联络线 01',
    })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: edge.id,
          type: 'electrical',
          edges: [{
            ...edge,
            flowDirection: 'forward',
            label: '联络线 01',
            labelVisible: false,
            monitorDataVisible: true,
            monitorMetricLabelsVisible: false,
            monitorMetrics: [{
              id: 'line-current',
              name: '电流',
              valueType: 'number',
              unit: 'A',
              precision: 1,
              simulationMin: 0,
              simulationMax: 100,
              alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
            }],
          }],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('子线标签')).toHaveValue('联络线 01')
    const hiddenSwitch = screen.getByRole('switch', { name: '显示子线标签' })
    expect(hiddenSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(hiddenSwitch)
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      labelVisible: true,
    })
    expect(screen.getByRole('switch', { name: '显示运行数据' }))
      .toHaveAttribute('aria-checked', 'true')
    const hiddenMetricLabels = screen.getByRole('switch', { name: '显示指标名称与单位' })
    expect(hiddenMetricLabels).toHaveAttribute('aria-checked', 'false')
    await user.click(hiddenMetricLabels)
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      monitorMetricLabelsVisible: true,
    })
    expect(screen.getByText('电流')).toBeInTheDocument()

    expect(screen.getByRole('combobox', { name: '通行方向' })).toHaveValue('forward')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '通行方向' }),
      'bidirectional',
    )
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      flowDirection: undefined,
    })

    fireEvent.change(screen.getByLabelText('子线标签'), { target: { value: '' } })
    fireEvent.blur(screen.getByLabelText('子线标签'))
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      label: undefined,
    })
  })

  it('batch configures the flow direction of multiple selected child lines', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdge = vi.fn()
    const onPatchConnectionEdges = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edges:edge-1,edge-2',
          type: 'electrical',
          edges: [
            {
              id: 'edge-1',
              sourceNodeId: 'node-1',
              targetNodeId: 'node-2',
              flowDirection: 'forward',
            },
            {
              id: 'edge-2',
              sourceNodeId: 'node-3',
              targetNodeId: 'node-4',
            },
          ],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const direction = screen.getByRole('combobox', { name: '通行方向' })
    expect(direction).toHaveValue('mixed')
    expect(direction).toHaveAccessibleDescription('同时应用到 2 条所选子线')

    await user.selectOptions(direction, 'reverse')

    expect(onPatchConnectionEdges).toHaveBeenCalledTimes(1)
    expect(onPatchConnectionEdges).toHaveBeenCalledWith(
      ['edge-1', 'edge-2'],
      { flowDirection: 'reverse' },
    )
    expect(onPatchConnectionEdge).not.toHaveBeenCalled()
  })

  it('configures cooling child lines as primary or auxiliary in one batch', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdge = vi.fn()
    const onPatchConnectionEdges = vi.fn()
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edges:edge-1,edge-2',
          type: 'cooling-secondary-cold',
          edges: [
            {
              id: 'edge-1',
              sourceNodeId: 'node-1',
              targetNodeId: 'node-2',
              coolingLineRole: 'auxiliary',
            },
            {
              id: 'edge-2',
              sourceNodeId: 'node-3',
              targetNodeId: 'node-4',
            },
          ],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const role = screen.getByRole('combobox', { name: '管路级别' })
    expect(role).toHaveValue('mixed')
    expect(screen.getByText('同时应用到 2 条所选冷却子线')).toBeInTheDocument()
    await user.selectOptions(role, 'auxiliary')
    expect(onPatchConnectionEdges).toHaveBeenCalledWith(
      ['edge-1', 'edge-2'],
      { coolingLineRole: 'auxiliary' },
    )

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edge-1',
          type: 'cooling-secondary-cold',
          edges: [{
            id: 'edge-1',
            sourceNodeId: 'node-1',
            targetNodeId: 'node-2',
            coolingLineRole: 'auxiliary',
          }],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '管路级别' }),
      'primary',
    )
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith('edge-1', {
      coolingLineRole: undefined,
    })
  })

  it('configures whole child-line crossing layers and restores automatic order', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdge = vi.fn()
    const onPatchConnectionEdges = vi.fn()
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edges:edge-1,edge-2',
          type: 'cooling-secondary-cold',
          edges: [
            {
              id: 'edge-1',
              sourceNodeId: 'node-1',
              targetNodeId: 'node-2',
              crossingLayer: 'upper',
            },
            {
              id: 'edge-2',
              sourceNodeId: 'node-3',
              targetNodeId: 'node-4',
            },
          ],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const layer = screen.getByRole('combobox', { name: '跨线层级' })
    expect(layer).toHaveValue('mixed')
    expect(layer).toHaveAccessibleDescription('同时应用到 2 条所选子线')
    await user.selectOptions(layer, 'lower')
    expect(onPatchConnectionEdges).toHaveBeenCalledWith(
      ['edge-1', 'edge-2'],
      { crossingLayer: 'lower' },
    )

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edge-1',
          type: 'electrical',
          edges: [{
            id: 'edge-1',
            sourceNodeId: 'node-1',
            targetNodeId: 'node-2',
            crossingLayer: 'upper',
          }],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByRole('combobox', { name: '跨线层级' }), 'auto')
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith('edge-1', {
      crossingLayer: undefined,
    })
  })

  it('does not show cooling line roles for electrical or mixed-system selections', () => {
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edge-1',
          type: 'electrical',
          edges: [{ id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
        }}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: '管路级别' })).not.toBeInTheDocument()

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edges:edge-1,edge-2',
          type: 'electrical',
          edgeTypes: {
            'edge-1': 'electrical',
            'edge-2': 'cooling-primary-cold',
          },
          edges: [
            { id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' },
            { id: 'edge-2', sourceNodeId: 'node-3', targetNodeId: 'node-4' },
          ],
        }}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: '管路级别' })).not.toBeInTheDocument()
  })

  it('edits selected busbars and child lines through one mixed color field', () => {
    const onSelectionColorPreview = vi.fn()
    const onSelectionColorCommit = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[{
          id: 'busbar-1',
          diagramId: 'diagram-1',
          type: 'electrical',
          orientation: 'horizontal',
          x: 0,
          y: 0,
          length: 160,
        }]}
        selectedConnection={{
          id: 'edges:edge-1,edge-2',
          type: 'electrical',
          edgeTypes: {
            'edge-1': 'electrical',
            'edge-2': 'cooling-primary-cold',
          },
          isNetwork: false,
          edges: [
            { id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' },
            {
              id: 'edge-2',
              sourceNodeId: 'node-3',
              targetNodeId: 'node-4',
              color: '#77B4BF',
            },
          ],
        }}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={onSelectionColorPreview}
        onSelectionColorCommit={onSelectionColorCommit}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('1 条母线 · 2 条子线')).toBeInTheDocument()
    const input = screen.getByLabelText('线路颜色 HEX')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', '多种颜色')
    expect(screen.queryByRole('combobox', { name: '通行方向' })).not.toBeInTheDocument()

    const replacement = defaultConnectionColor('cooling-secondary-hot')
    fireEvent.change(input, { target: { value: replacement } })
    expect(onSelectionColorPreview).toHaveBeenLastCalledWith(replacement)
    fireEvent.blur(input)
    expect(onSelectionColorCommit).toHaveBeenCalledOnce()
    expect(onSelectionColorCommit).toHaveBeenLastCalledWith(replacement)
  })

  it('edits all logical edges when a shared connection network is selected', async () => {
    const user = userEvent.setup()
    const onSelectionColorCommit = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'network:network-1',
          type: 'electrical',
          edges: [
            { id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2', color: '#D5B96F' },
            { id: 'edge-2', sourceNodeId: 'node-1', targetNodeId: 'node-3', color: '#77B4BF' },
          ],
        }}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={onSelectionColorCommit}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('线路网络')).toBeInTheDocument()
    expect(screen.getByText('2 条逻辑子线')).toBeInTheDocument()
    expect(screen.getByLabelText('子线颜色 HEX')).toHaveValue('')
    expect(screen.getByLabelText('子线颜色 HEX')).toHaveAttribute('placeholder', '多种颜色')
    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(onSelectionColorCommit).toHaveBeenCalledWith(null)
  })

  it('re-syncs a persisted child-line color after the line is selected again', () => {
    const commonProps = {
      selectedElements: [] as DiagramElement[],
      selectedBusbars: [] as Busbar[],
      onPatch: vi.fn(),
      onColorPreview: vi.fn(),
      onSelectionColorPreview: vi.fn(),
      onSelectionColorCommit: vi.fn(),
      onDelete: vi.fn(),
    }
    const selectedConnection = {
      id: 'edge-1',
      type: 'electrical' as const,
      edges: [{
        id: 'edge-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        color: '#77B4BF',
      }],
    }
    const { rerender } = render(
      <PropertiesPanel {...commonProps} selectedConnection={selectedConnection} />,
    )
    expect(screen.getByLabelText('子线颜色 HEX')).toHaveValue('#77B4BF')

    rerender(<PropertiesPanel {...commonProps} selectedConnection={null} />)
    rerender(<PropertiesPanel {...commonProps} selectedConnection={selectedConnection} />)

    expect(screen.getByLabelText('子线颜色 HEX')).toHaveValue('#77B4BF')
  })

  it('batch-edits mixed element toggles, runtime state, and state colors once', async () => {
    const user = userEvent.setup()
    const onPatchElements = vi.fn()
    const onOnOffStatesChange = vi.fn()
    const onElementSelectionColorCommit = vi.fn()
    const first = {
      ...element('switch'),
      id: 'switch-1',
      labelVisible: true,
    }
    const second = {
      ...element('switch'),
      id: 'switch-2',
      labelVisible: false,
    }
    render(
      <PropertiesPanel
        selectedElements={[first, second]}
        selectedBusbars={[]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchElements={onPatchElements}
        onPatchElementMetrics={vi.fn()}
        onOffStates={{ 'switch-1': false, 'switch-2': true }}
        onOnOffStatesChange={onOnOffStatesChange}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onElementSelectionColorPreview={vi.fn()}
        onElementSelectionColorCommit={onElementSelectionColorCommit}
        onDelete={vi.fn()}
      />,
    )

    const labelToggle = screen.getByRole('switch', { name: '显示图元标签' })
    expect(labelToggle).toHaveAttribute('aria-checked', 'mixed')
    await user.click(labelToggle)
    expect(onPatchElements).toHaveBeenCalledWith(
      ['switch-1', 'switch-2'],
      { labelVisible: true },
    )

    const stateToggle = screen.getByRole('switch', { name: '运行状态' })
    expect(stateToggle).toHaveAttribute('aria-checked', 'mixed')
    await user.click(stateToggle)
    expect(onOnOffStatesChange).toHaveBeenCalledWith(['switch-1', 'switch-2'], true)

    fireEvent.change(screen.getByLabelText('关状态颜色 HEX'), {
      target: { value: '#77b4bf' },
    })
    fireEvent.blur(screen.getByLabelText('关状态颜色 HEX'))
    expect(onElementSelectionColorCommit).toHaveBeenCalledWith(
      ['switch-1', 'switch-2'],
      '#77B4BF',
      'switch-off',
    )
  })

  it('requires an explicit source before replacing mixed element metric templates', async () => {
    const user = userEvent.setup()
    const onPatchElementMetrics = vi.fn()
    const metric = {
      id: 'temperature',
      name: '温度',
      valueType: 'number' as const,
      unit: '°C',
      precision: 1 as const,
      simulationMin: 0,
      simulationMax: 100,
      alarm: { mode: 'upper' as const, minor: 60, major: 75, critical: 90 },
    }
    render(
      <PropertiesPanel
        selectedElements={[
          { ...element('chwp'), id: 'chwp-1', name: 'CHWP 01', monitorMetrics: [] },
          { ...element('chwp'), id: 'chwp-2', name: 'CHWP 02', monitorMetrics: [metric] },
        ]}
        selectedBusbars={[]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchElementMetrics={onPatchElementMetrics}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '应用到 2 个对象' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '指标模板' }), 'chwp-2')
    await user.click(screen.getByRole('button', { name: '应用到 2 个对象' }))
    expect(onPatchElementMetrics).toHaveBeenCalledWith(
      ['chwp-1', 'chwp-2'],
      [metric],
    )
  })

  it('batch-edits child-line visibility and applies one selected metric template', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdges = vi.fn()
    const onPatchConnectionMetrics = vi.fn()
    const metric = {
      id: 'power',
      name: '功率',
      valueType: 'number' as const,
      unit: 'kW',
      precision: 0 as const,
      simulationMin: 0,
      simulationMax: 100,
      alarm: { mode: 'upper' as const, minor: 60, major: 75, critical: 90 },
    }
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edges:edge-1,edge-2',
          type: 'electrical',
          edges: [
            {
              id: 'edge-1',
              sourceNodeId: 'node-1',
              targetNodeId: 'node-2',
              labelVisible: true,
              monitorMetrics: [metric],
            },
            {
              id: 'edge-2',
              sourceNodeId: 'node-3',
              targetNodeId: 'node-4',
              labelVisible: false,
            },
          ],
        }}
        onPatch={vi.fn()}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onPatchConnectionMetrics={onPatchConnectionMetrics}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const labelToggle = screen.getByRole('switch', { name: '显示子线标签' })
    expect(labelToggle).toHaveAttribute('aria-checked', 'mixed')
    await user.click(labelToggle)
    expect(onPatchConnectionEdges).toHaveBeenCalledWith(
      ['edge-1', 'edge-2'],
      { labelVisible: true },
    )
    await user.selectOptions(screen.getByRole('combobox', { name: '指标模板' }), 'edge-1')
    await user.click(screen.getByRole('button', { name: '应用到 2 个对象' }))
    expect(onPatchConnectionMetrics).toHaveBeenCalledWith(
      ['edge-1', 'edge-2'],
      [metric],
    )
  })

  it('batch-edits busbar label visibility through one callback', async () => {
    const user = userEvent.setup()
    const onPatchBusbars = vi.fn()
    const busbar = (id: string, labelVisible: boolean): Busbar => ({
      id,
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
      labelVisible,
    })
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[busbar('busbar-1', true), busbar('busbar-2', false)]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbars={onPatchBusbars}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('switch', { name: '显示母线标签' })
    expect(toggle).toHaveAttribute('aria-checked', 'mixed')
    await user.click(toggle)
    expect(onPatchBusbars).toHaveBeenCalledWith(
      ['busbar-1', 'busbar-2'],
      { labelVisible: true },
    )
  })

  it('configures single and batch external supply entry endpoints on power child lines', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdge = vi.fn()
    const onPatchConnectionEdges = vi.fn()
    const edge: ConnectionEdge = {
      id: 'entry-edge',
      sourceNodeId: 'outside',
      targetNodeId: 'inside',
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{ id: edge.id, type: 'electrical', edges: [edge] }}
        allowExternalSupplyEntry
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const singleEntry = screen.getByRole('combobox', { name: '外部供电入口' })
    expect(singleEntry).toHaveValue('none')
    await user.selectOptions(singleEntry, 'source')
    expect(onPatchConnectionEdge).toHaveBeenCalledWith(edge.id, {
      externalSupplyEndpoint: 'source',
    })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: edge.id,
          type: 'electrical',
          edges: [{
            ...edge,
            flowDirection: 'reverse',
            externalSupplyEndpoint: 'source',
          }],
        }}
        allowExternalSupplyEntry
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const conflictingEntry = screen.getByRole('combobox', { name: '外部供电入口' })
    expect(conflictingEntry).toHaveAccessibleDescription(
      '当前通行方向阻断了所选入口，监控模式不会产生电流',
    )
    const entryChannel = screen.getByRole('combobox', { name: '入口通道' })
    await user.selectOptions(entryChannel, 'b')
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      externalSupplyChannel: 'b',
    })
    await user.selectOptions(conflictingEntry, 'none')
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      externalSupplyEndpoint: undefined,
      externalSupplyChannel: undefined,
    })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: 'edges:entry-edge,second-edge',
          type: 'electrical',
          edges: [
            { ...edge, externalSupplyEndpoint: 'source' },
            {
              id: 'second-edge',
              sourceNodeId: 'outside-2',
              targetNodeId: 'inside-2',
              externalSupplyEndpoint: 'target',
            },
          ],
        }}
        allowExternalSupplyEntry
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onPatchConnectionEdges={onPatchConnectionEdges}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const batchEntry = screen.getByRole('combobox', { name: '外部供电入口' })
    expect(batchEntry).toHaveValue('mixed')
    await user.selectOptions(batchEntry, 'target')
    expect(onPatchConnectionEdges).toHaveBeenCalledWith(
      ['entry-edge', 'second-edge'],
      { externalSupplyEndpoint: 'target' },
    )
  })

  it('configures cooling line endpoints as water flow sources', async () => {
    const user = userEvent.setup()
    const onPatchConnectionEdge = vi.fn()
    const edge: ConnectionEdge = {
      id: 'cooling-source-edge',
      sourceNodeId: 'outside',
      targetNodeId: 'inside',
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: edge.id,
          type: 'cooling-primary-cold',
          edges: [edge],
        }}
        allowCoolingFlowSource
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const source = screen.getByRole('combobox', { name: '水流源头' })
    expect(source).toHaveValue('none')
    expect(source).toHaveAccessibleDescription(
      '从所选端点注入模拟流量；仍受管路方向和泵阀状态约束',
    )
    await user.selectOptions(source, 'target')
    expect(onPatchConnectionEdge).toHaveBeenCalledWith(edge.id, {
      externalSupplyEndpoint: 'target',
    })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={{
          id: edge.id,
          type: 'cooling-primary-cold',
          edges: [{
            ...edge,
            flowDirection: 'reverse',
            externalSupplyEndpoint: 'source',
          }],
        }}
        allowCoolingFlowSource
        onPatch={vi.fn()}
        onPatchConnectionEdge={onPatchConnectionEdge}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: '水流源头' }))
      .toHaveAccessibleDescription('当前通行方向阻断了所选源头，监控模式不会产生水流')
  })

  it('links a device to a direct child diagram from the property panel', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const parentElement = element('compute-pod', { tag: '算力 POD-01' })
    render(
      <PropertiesPanel
        selectedElements={[parentElement]}
        {...emptySelectionProps}
        childDiagrams={[{
          id: 'pod-child', lineSystemId: 'power-line', parentId: 'diagram-1',
          level: 'pod', name: '算力 POD-01',
          canvas: { gridSize: 8, viewport: { zoom: 1, tx: 0, ty: 0 } },
        }]}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /下探图纸/ }), 'pod-child')
    expect(onPatch).toHaveBeenCalledWith(parentElement.id, {
      properties: { tag: '算力 POD-01', drillDownDiagramId: 'pod-child' },
    })
  })

  it('sets contextual single and mixed batch busbar monitor flow directions', async () => {
    const user = userEvent.setup()
    const onPatchBusbar = vi.fn()
    const onPatchBusbars = vi.fn()
    const horizontalBusbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
    }
    const { rerender } = render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[horizontalBusbar]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onPatchBusbars={onPatchBusbars}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const singleDirection = screen.getByRole('combobox', { name: '监控电流方向' })
    expect(screen.getByRole('option', { name: '左端 → 右端' })).toBeInTheDocument()
    await user.selectOptions(singleDirection, 'start-to-end')
    expect(onPatchBusbar).toHaveBeenCalledWith('busbar-1', {
      monitorFlowDirection: 'start-to-end',
    })

    rerender(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[
          { ...horizontalBusbar, monitorFlowDirection: 'start-to-end' },
          {
            ...horizontalBusbar,
            id: 'busbar-2',
            orientation: 'vertical',
            monitorFlowDirection: 'end-to-start',
          },
        ]}
        selectedConnection={null}
        onPatch={vi.fn()}
        onPatchBusbar={onPatchBusbar}
        onPatchBusbars={onPatchBusbars}
        onColorPreview={vi.fn()}
        onSelectionColorPreview={vi.fn()}
        onSelectionColorCommit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const batchDirection = screen.getByRole('combobox', { name: '监控电流方向' })
    expect(batchDirection).toHaveValue('mixed')
    await user.selectOptions(batchDirection, 'end-to-start')
    expect(onPatchBusbars).toHaveBeenCalledWith(['busbar-1', 'busbar-2'], {
      monitorFlowDirection: 'end-to-start',
    })
  })
})
