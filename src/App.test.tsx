import { forwardRef, useImperativeHandle, type Ref } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createDefaultProject, getFirstDiagramId } from './domain/project'
import { symbolAssets } from './editor/symbolCatalog'
import { monitorStateRepository, projectRepository } from './storage/projectRepository'
import { useAppStore } from './store/useAppStore'

const insertBusbarMock = vi.fn()
const duplicateMock = vi.fn()
const toggleDirectLineToolMock = vi.fn()

vi.mock('./editor/DiagramCanvas', () => ({
  DiagramCanvas: forwardRef(function MockDiagramCanvas(
    props: Record<string, unknown>,
    ref: Ref<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      undo: vi.fn(),
      redo: vi.fn(),
      copy: vi.fn(),
      cut: vi.fn(),
      paste: vi.fn(),
      duplicate: duplicateMock,
      deleteSelected: vi.fn(),
      selectAll: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
      toggleDirectLineTool: toggleDirectLineToolMock,
      insertSymbol: vi.fn(),
      insertBusbar: insertBusbarMock,
      previewElementColor: vi.fn(),
      previewSelectionColor: vi.fn(),
      updateSelectionColor: vi.fn(),
      previewCanvasColor: vi.fn(),
      updateCanvasColor: vi.fn(),
      updateElement: vi.fn(),
      updateBusbar: vi.fn(),
      updateConnectionEdge: vi.fn(),
      updateConnectionEdges: vi.fn(),
    }))
    return (
      <div
        data-testid="diagram-canvas"
        data-mode={String(props.mode)}
        data-animation-playing={String(props.animationPlaying)}
      >
        画布
        {props.mode === 'monitor' ? (
          <>
            <button
              type="button"
              onClick={() => (props.onSelectionChange as (ids: string[]) => void)(['switch-test'])}
            >
              选择测试 Switch
            </button>
            <button
              type="button"
              onClick={() => (props.onSelectionChange as (ids: string[]) => void)(['2-wv-test'])}
            >
              选择测试 2WV
            </button>
            <button
              type="button"
              onClick={() => (props.onSelectionChange as (ids: string[]) => void)(['pump-test'])}
            >
              选择测试水泵
            </button>
          </>
        ) : null}
      </div>
    )
  }),
}))

function renderApp() {
  return render(<App />)
}

describe('AIDC editor workspace', () => {
  beforeEach(() => {
    insertBusbarMock.mockClear()
    duplicateMock.mockClear()
    toggleDirectLineToolMock.mockClear()
    const document = createDefaultProject('测试接线图', symbolAssets)
    useAppStore.setState({
      document,
      documentEpoch: 0,
      currentDiagramId: getFirstDiagramId(document),
      selectedElementIds: [],
      dirty: false,
    })
  })

  it('renders the project, both line trees, canvas, symbols, and properties panel', () => {
    const { container } = renderApp()

    expect(screen.getByLabelText('项目名称')).toHaveValue('测试接线图')
    expect(screen.getAllByText('冷却线路').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('电力线路')).toBeInTheDocument()
    expect(screen.getByTestId('diagram-canvas')).toBeInTheDocument()
    expect(screen.getByText('CHWP')).toBeInTheDocument()
    expect(screen.getByText('TMU')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '母线' })).toBeDisabled()
    expect(screen.getByText('点击颜色，替换当前画布中同类同色对象。')).toBeInTheDocument()

    const canvasFrame = container.querySelector('.canvas-frame')
    expect(canvasFrame).not.toBeNull()
    expect(container.querySelector('.context-toolbar')).not.toBeInTheDocument()
    expect(canvasFrame?.querySelector('.canvas-titlebar')).not.toBeNull()
    expect(canvasFrame?.querySelector('.status-bar')).not.toBeNull()
    expect(within(canvasFrame as HTMLElement).getByRole('button', { name: '返回上一级' })).toBeDisabled()
    expect(within(canvasFrame as HTMLElement).getByRole('button', { name: '缩小画布' })).toBeEnabled()
    expect(within(canvasFrame as HTMLElement).getByRole('button', { name: '重置画布缩放' })).toBeEnabled()
    expect(within(canvasFrame as HTMLElement).getByRole('button', { name: '放大画布' })).toBeEnabled()
  })

  it('collapses and expands the left menu as session-only workspace state', async () => {
    const user = userEvent.setup()
    const beforeDocument = structuredClone(useAppStore.getState().document)
    const { container } = renderApp()
    const workspace = container.querySelector('.workspace-main')
    const leftSidebar = container.querySelector('.left-sidebar')

    const collapseButton = screen.getByRole('button', { name: '收起左侧菜单' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')
    expect(collapseButton.querySelector('svg')).toHaveClass('lucide-chevron-left')
    expect(leftSidebar).toHaveAttribute('aria-hidden', 'false')

    await user.click(collapseButton)

    expect(workspace).toHaveAttribute('data-left-sidebar-collapsed', 'true')
    expect(leftSidebar).toHaveAttribute('data-collapsed', 'true')
    expect(leftSidebar).toHaveAttribute('aria-hidden', 'true')
    const expandButton = screen.getByRole('button', { name: '展开左侧菜单' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    expect(expandButton.querySelector('svg')).toHaveClass('lucide-chevron-right')
    expect(useAppStore.getState().document).toEqual(beforeDocument)
    expect(useAppStore.getState().dirty).toBe(false)

    await user.click(screen.getByRole('tab', { name: '监控模式' }))
    expect(workspace).toHaveAttribute('data-left-sidebar-collapsed', 'true')

    await user.click(screen.getByRole('button', { name: '展开左侧菜单' }))

    expect(workspace).not.toHaveAttribute('data-left-sidebar-collapsed')
    expect(leftSidebar).toHaveAttribute('data-collapsed', 'false')
    expect(leftSidebar).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('button', { name: '收起左侧菜单' })).toHaveAttribute('aria-expanded', 'true')
    expect(useAppStore.getState().document).toEqual(beforeDocument)
    expect(useAppStore.getState().dirty).toBe(false)
  })

  it('enables the busbar tool only on power diagrams', async () => {
    const document = createDefaultProject('母线工具', symbolAssets)
    const powerDiagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    useAppStore.setState({
      document,
      documentEpoch: 0,
      currentDiagramId: powerDiagramId,
      selectedElementIds: [],
      dirty: false,
    })
    const user = userEvent.setup()
    renderApp()

    const busbarTool = screen.getByRole('button', { name: '母线' })
    expect(busbarTool).toBeEnabled()
    await user.dblClick(busbarTool)
    expect(insertBusbarMock).toHaveBeenCalledOnce()
  })

  it('starts direct line drawing only from its explicit toolbar button', async () => {
    const user = userEvent.setup()
    renderApp()

    const tool = screen.getByRole('button', { name: '绘制线路' })
    expect(tool).toHaveAttribute('aria-pressed', 'false')

    await user.click(tool)

    expect(toggleDirectLineToolMock).toHaveBeenCalledOnce()
  })

  it('drills into a child diagram and enables return navigation', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getAllByText('1 号楼')[0])

    expect(screen.getByRole('button', { name: /返回/ })).toBeEnabled()
    expect(screen.getByRole('region', { name: '1 号楼编辑区' })).toBeInTheDocument()
  })

  it('saves through Command/Ctrl+S and prevents the browser default', async () => {
    const save = vi.spyOn(projectRepository, 'save').mockResolvedValue()
    renderApp()

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(await screen.findByText('项目已保存到当前浏览器')).toBeInTheDocument()
    save.mockRestore()
  })

  it('ignores a repeated save shortcut', () => {
    const save = vi.spyOn(projectRepository, 'save').mockResolvedValue()
    renderApp()

    fireEvent.keyDown(window, { key: 's', ctrlKey: true, repeat: true })

    expect(save).not.toHaveBeenCalled()
    save.mockRestore()
  })

  it('switches to a read-only monitor workspace and snapshots On/Off states into the project', async () => {
    const user = userEvent.setup()
    const loadRuntime = vi.spyOn(monitorStateRepository, 'getOnOffStates').mockResolvedValue({})
    const saveRuntime = vi.spyOn(monitorStateRepository, 'setOnOffState').mockResolvedValue()
    const before = useAppStore.getState()
    useAppStore.setState({
      document: {
        ...before.document,
        assets: before.document.assets.map((asset) => asset.key === 'chwp'
          ? { ...asset, coolingDeviceRole: 'pump' as const }
          : asset),
        elements: [
          {
            id: 'switch-test',
            diagramId: before.currentDiagramId,
            assetKey: 'switch',
            name: 'Switch',
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            rotation: 0,
            onOffState: 'off',
            properties: { tag: 'SW-01' },
            extensions: {},
          },
          {
            id: '2-wv-test',
            diagramId: before.currentDiagramId,
            assetKey: '2-wv',
            name: '2WV',
            x: 40,
            y: 0,
            width: 32,
            height: 32,
            rotation: 0,
            onOffState: 'off',
            properties: { tag: '2WV-01' },
            extensions: {},
          },
          {
            id: 'pump-test',
            diagramId: before.currentDiagramId,
            assetKey: 'chwp',
            name: 'CHWP',
            x: 80,
            y: 0,
            width: 40,
            height: 16,
            rotation: 0,
            properties: { tag: 'CHWP-01' },
            extensions: {},
          },
        ],
      },
    })
    const beforeDocument = structuredClone(useAppStore.getState().document)
    renderApp()

    await user.click(screen.getByRole('tab', { name: '监控模式' }))

    expect(screen.getByTestId('diagram-canvas')).toHaveAttribute('data-mode', 'monitor')
    expect(screen.getByLabelText('项目名称')).toBeDisabled()
    expect(screen.queryByText('CHWP')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '播放流动' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '播放流动' }))
    expect(screen.getByTestId('diagram-canvas')).toHaveAttribute('data-animation-playing', 'true')

    await user.click(screen.getByRole('button', { name: '选择测试 Switch' }))
    await user.click(screen.getByRole('switch', { name: '开关状态' }))
    await waitFor(() => expect(saveRuntime).toHaveBeenCalledWith(
      beforeDocument.project.id,
      'switch-test',
      true,
    ))
    await user.click(screen.getByRole('button', { name: '选择测试 2WV' }))
    await user.click(screen.getByRole('switch', { name: '阀门状态' }))
    await waitFor(() => expect(saveRuntime).toHaveBeenCalledWith(
      beforeDocument.project.id,
      '2-wv-test',
      true,
    ))
    await user.click(screen.getByRole('button', { name: '选择测试水泵' }))
    expect(screen.getByRole('switch', { name: '水泵运行状态' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByLabelText('水泵输出功率滑块')).toHaveValue('100')
    fireEvent.change(screen.getByLabelText('水泵输出功率滑块'), { target: { value: '50' } })
    expect(screen.getByLabelText('水泵输出功率滑块')).toHaveValue('50')
    await user.click(screen.getByRole('switch', { name: '水泵运行状态' }))
    expect(screen.getByRole('switch', { name: '水泵运行状态' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(await screen.findByText('水泵已停止')).toBeInTheDocument()
    expect(useAppStore.getState().document.elements).toMatchObject([
      { id: 'switch-test', onOffState: 'on' },
      { id: '2-wv-test', onOffState: 'on' },
      { id: 'pump-test' },
    ])
    expect(useAppStore.getState().document.project.updatedAt)
      .toBe(beforeDocument.project.updatedAt)
    expect(useAppStore.getState().dirty).toBe(false)

    loadRuntime.mockRestore()
    saveRuntime.mockRestore()
  })

  it('hydrates only legacy missing On/Off fields from the compatibility state table', async () => {
    const before = useAppStore.getState()
    useAppStore.setState({
      document: {
        ...before.document,
        elements: [
          {
            id: 'legacy-switch',
            diagramId: before.currentDiagramId,
            assetKey: 'switch',
            name: 'Legacy Switch',
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            rotation: 0,
            properties: { tag: 'SW-LEGACY' },
            extensions: {},
          },
          {
            id: 'exported-switch',
            diagramId: before.currentDiagramId,
            assetKey: 'switch',
            name: 'Exported Switch',
            x: 40,
            y: 0,
            width: 32,
            height: 32,
            rotation: 0,
            onOffState: 'off',
            properties: { tag: 'SW-EXPORTED' },
            extensions: {},
          },
        ],
      },
    })
    const loadRuntime = vi.spyOn(monitorStateRepository, 'getOnOffStates').mockResolvedValue({
      'legacy-switch': true,
      'exported-switch': true,
    })

    renderApp()

    await waitFor(() => expect(
      useAppStore.getState().document.elements.map((element) => ({
        id: element.id,
        onOffState: element.onOffState,
      })),
    ).toEqual([
      { id: 'legacy-switch', onOffState: 'on' },
      { id: 'exported-switch', onOffState: 'off' },
    ]))
    expect(useAppStore.getState().dirty).toBe(false)

    loadRuntime.mockRestore()
  })

  it('opens the symbol anchor editor and applies anchor changes immediately', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: '编辑 CHWP 锚点' }))

    expect(screen.getByRole('dialog', { name: '接线锚点编辑器' })).toBeInTheDocument()
    expect(screen.getByTestId('anchor-editor-canvas')).toHaveAttribute('data-grid-size', '8')
    expect(screen.getByTestId('anchor-editor-canvas')).toHaveAttribute('data-selected-asset', 'chwp')

    await user.click(screen.getByRole('button', { name: '在 8, 0 添加锚点' }))

    const anchorName = screen.getByLabelText('锚点名称')
    expect(anchorName).toHaveValue('通用 1')
    expect(useAppStore.getState().dirty).toBe(true)
    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')?.anchors,
    ).toHaveLength(1)

    await user.clear(anchorName)
    await user.type(anchorName, '主回水')
    await user.selectOptions(screen.getByLabelText('锚点类型'), 'cooling-primary-hot')

    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')?.anchors[0],
    ).toMatchObject({ name: '主回水', type: 'cooling-primary-hot', direction: 'top' })

    await user.click(screen.getByRole('button', { name: '删除所选锚点' }))
    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')?.anchors,
    ).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '撤销锚点修改' }))
    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')?.anchors,
    ).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '关闭图元编辑器' }))
    expect(screen.queryByRole('dialog', { name: '接线锚点编辑器' })).not.toBeInTheDocument()
  })

  it('configures a cooling asset as a pump with unique inlet and outlet roles', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: '编辑 CHWP 锚点' }))
    await user.selectOptions(screen.getByLabelText('冷却设备角色'), 'pump')
    expect(screen.getByText('水泵需要配置一个入口和一个出口；配置完成前不会驱动监控动画。'))
      .toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '在 8, 0 添加锚点' }))
    await user.selectOptions(screen.getByLabelText('水流端口角色'), 'inlet')
    await user.click(screen.getByRole('button', { name: '在 16, 0 添加锚点' }))
    await user.selectOptions(screen.getByLabelText('水流端口角色'), 'outlet')

    const pump = useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')
    expect(pump?.coolingDeviceRole).toBe('pump')
    expect(pump?.anchors.map((anchor) => anchor.flowRole)).toEqual(['inlet', 'outlet'])
    expect(screen.queryByText('水泵需要配置一个入口和一个出口；配置完成前不会驱动监控动画。'))
      .not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('水流端口角色'), 'inlet')
    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')
        ?.anchors.map((anchor) => anchor.flowRole),
    ).toEqual([undefined, 'inlet'])

    await user.selectOptions(screen.getByLabelText('冷却设备角色'), 'valve')
    const valve = useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')
    expect(valve?.coolingDeviceRole).toBe('valve')
    expect(valve?.anchors.every((anchor) => anchor.flowRole === undefined)).toBe(true)
  })

  it('keeps CV fixed as a top-to-bottom check valve', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: '编辑 CV 锚点' }))
    expect(screen.getByLabelText('冷却设备角色')).toHaveValue('check-valve')
    expect(screen.getByLabelText('冷却设备角色')).toBeDisabled()
    expect(useAppStore.getState().document.assets.find((asset) => asset.key === 'cv'))
      .toMatchObject({
        coolingDeviceRole: 'check-valve',
        anchors: [
          { id: 'cv-inlet', flowRole: 'inlet' },
          { id: 'cv-outlet', flowRole: 'outlet' },
        ],
      })
  })
})
