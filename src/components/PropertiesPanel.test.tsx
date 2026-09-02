import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
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
})
