import { forwardRef, useImperativeHandle, type Ref } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createDefaultProject, getFirstDiagramId } from './domain/project'
import { symbolAssets } from './editor/symbolCatalog'
import { projectRepository } from './storage/projectRepository'
import { useAppStore } from './store/useAppStore'

const insertBusbarMock = vi.fn()
const duplicateMock = vi.fn()

vi.mock('./editor/DiagramCanvas', () => ({
  DiagramCanvas: forwardRef(function MockDiagramCanvas(
    _props: Record<string, unknown>,
    ref: Ref<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      undo: vi.fn(),
      redo: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      duplicate: duplicateMock,
      deleteSelected: vi.fn(),
      selectAll: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
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
    }))
    return <div data-testid="diagram-canvas">画布</div>
  }),
}))

function renderApp() {
  return render(<App />)
}

describe('AIDC editor workspace', () => {
  beforeEach(() => {
    insertBusbarMock.mockClear()
    duplicateMock.mockClear()
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
    renderApp()

    expect(screen.getByLabelText('项目名称')).toHaveValue('测试接线图')
    expect(screen.getAllByText('冷却线路').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('电力线路')).toBeInTheDocument()
    expect(screen.getByTestId('diagram-canvas')).toBeInTheDocument()
    expect(screen.getByText('CHWP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '母线' })).toBeDisabled()
    expect(screen.getByText('点击颜色，替换当前画布中同类同色对象。')).toBeInTheDocument()
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
})
