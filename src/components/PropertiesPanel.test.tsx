import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
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
        { id: 'node-1', kind: 'element-anchor', elementId: '2-wv-element', anchorId: 'a' },
        { id: 'node-2', kind: 'busbar-tap', busbarId: 'busbar-1', offset: 16 },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
    }]
    render(
      <PropertiesPanel
        selectedElements={[]}
        selectedBusbars={[]}
        selectedConnection={null}
        canvasElements={[element('2-wv')]}
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

  it('shows color editing for a supported symbol and commits the selected color', () => {
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('2-wv')]}
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
    expect(onPatch).toHaveBeenLastCalledWith('2-wv-element', {
      properties: { color: '#77B4BF' },
    })
  })

  it('controls Switch runtime state and commits off/on colors independently', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    const onSwitchStateChange = vi.fn()
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
        switchStates={{ [current.id]: false }}
        onSwitchStateChange={onSwitchStateChange}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )

    const stateToggle = screen.getByRole('switch', { name: 'Switch 开关状态' })
    expect(stateToggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('当前断开 · Off')).toBeInTheDocument()
    await user.click(stateToggle)
    expect(onSwitchStateChange).toHaveBeenCalledWith(current.id, true)

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
        switchStates={{ [current.id]: true }}
        onSwitchStateChange={onSwitchStateChange}
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

  it('opens an application-owned HEX picker instead of a native RGB color input', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('2-wv')]}
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

    expect(onPatch).toHaveBeenCalledWith('2-wv-element', {
      properties: { color: '#77B4BF' },
    })
  })

  it('restores the default by removing the custom color property', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('2-wv', { tag: '2WV-01', color: '#E7A23B' })]}
        {...emptySelectionProps}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '恢复默认' }))

    expect(onPatch).toHaveBeenCalledWith('2-wv-element', {
      properties: { tag: '2WV-01' },
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
          edges: [{ ...edge, label: '联络线 01', labelVisible: false }],
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

    fireEvent.change(screen.getByLabelText('子线标签'), { target: { value: '' } })
    fireEvent.blur(screen.getByLabelText('子线标签'))
    expect(onPatchConnectionEdge).toHaveBeenLastCalledWith(edge.id, {
      label: undefined,
    })
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
