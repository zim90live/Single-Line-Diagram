import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { HierarchyPanel } from './HierarchyPanel'

describe('HierarchyPanel', () => {
  it('creates and renames diagrams from the editing controls', () => {
    const document = createDefaultProject('层级面板测试')
    const rootId = document.lineSystems[0].rootDiagramId
    const onCreateDiagram = vi.fn(() => null)
    const onRenameDiagram = vi.fn(() => true)

    render(
      <HierarchyPanel
        document={document}
        currentDiagramId={rootId}
        editable
        onSelectDiagram={vi.fn()}
        onCreateDiagram={onCreateDiagram}
        onRenameDiagram={onRenameDiagram}
        onMoveDiagram={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '新增下级图纸' }))
    expect(onCreateDiagram).toHaveBeenCalledWith(rootId)

    fireEvent.click(screen.getByRole('button', { name: '重命名当前图纸' }))
    const input = screen.getByRole('textbox', { name: '重命名园区总图' })
    fireEvent.change(input, { target: { value: '冷却园区总图' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameDiagram).toHaveBeenCalledWith(rootId, '冷却园区总图')
  })

  it('reports a center drop as moving the source inside the target', () => {
    const document = createDefaultProject('层级面板测试')
    const coolingRoot = document.lineSystems[0].rootDiagramId
    const building = document.diagrams.find((diagram) => diagram.parentId === coolingRoot)!
    const pod = document.diagrams.find((diagram) => diagram.parentId === building.id)!
    const onMoveDiagram = vi.fn()
    const { container } = render(
      <HierarchyPanel
        document={document}
        currentDiagramId={pod.id}
        editable
        onSelectDiagram={vi.fn()}
        onCreateDiagram={vi.fn(() => null)}
        onRenameDiagram={vi.fn(() => true)}
        onMoveDiagram={onMoveDiagram}
      />,
    )
    const source = container.querySelector<HTMLButtonElement>(
      `[data-diagram-id="${pod.id}"] .tree-row`,
    )!
    const target = container.querySelector<HTMLDivElement>(
      `[data-diagram-id="${coolingRoot}"]`,
    )!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 28,
      width: 200,
      height: 28,
      toJSON: () => ({}),
    })
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    }

    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(target, { clientY: 14, dataTransfer })
    fireEvent.drop(target, { clientY: 14, dataTransfer })

    expect(onMoveDiagram).toHaveBeenCalledWith(pod.id, coolingRoot, 'inside')
  })

  it('adds a sibling beside a selected device-level diagram', () => {
    const document = createDefaultProject('层级面板测试')
    const device = document.diagrams.find((diagram) => diagram.level === 'device')!
    const onCreateDiagram = vi.fn(() => null)
    render(
      <HierarchyPanel
        document={document}
        currentDiagramId={device.id}
        editable
        onSelectDiagram={vi.fn()}
        onCreateDiagram={onCreateDiagram}
        onRenameDiagram={vi.fn(() => true)}
        onMoveDiagram={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '新增同级图纸' }))
    expect(onCreateDiagram).toHaveBeenCalledWith(device.parentId)
  })

  it('keeps hierarchy management controls out of read-only mode', () => {
    const document = createDefaultProject('层级面板测试')
    render(
      <HierarchyPanel
        document={document}
        currentDiagramId={document.lineSystems[0].rootDiagramId}
        onSelectDiagram={vi.fn()}
        onDeleteDiagram={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '新增下级图纸' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重命名当前图纸' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^删除图纸 / })).not.toBeInTheDocument()
  })

  it('deletes a non-root row without selecting it and protects line roots', () => {
    const document = createDefaultProject('层级面板测试')
    const coolingRootId = document.lineSystems[0].rootDiagramId
    const coolingRoot = document.diagrams.find((diagram) => diagram.id === coolingRootId)!
    const building = document.diagrams.find((diagram) => diagram.parentId === coolingRootId)!
    const onSelectDiagram = vi.fn()
    const onDeleteDiagram = vi.fn()
    const { container } = render(
      <HierarchyPanel
        document={document}
        currentDiagramId={coolingRootId}
        editable
        onSelectDiagram={onSelectDiagram}
        onCreateDiagram={vi.fn(() => null)}
        onRenameDiagram={vi.fn(() => true)}
        onDeleteDiagram={onDeleteDiagram}
        onMoveDiagram={vi.fn()}
      />,
    )
    const rootShell = container.querySelector<HTMLElement>(
      `[data-diagram-id="${coolingRoot.id}"]`,
    )!
    const buildingShell = container.querySelector<HTMLElement>(
      `[data-diagram-id="${building.id}"]`,
    )!

    expect(within(rootShell).queryByRole('button', { name: `删除图纸 ${coolingRoot.name}` }))
      .not.toBeInTheDocument()
    fireEvent.click(within(buildingShell).getByRole('button', {
      name: `删除图纸 ${building.name}`,
    }))
    expect(onDeleteDiagram).toHaveBeenCalledWith(building.id)
    expect(onSelectDiagram).not.toHaveBeenCalled()
  })

  it('collapses and expands an entire line system without selecting a diagram', () => {
    const document = createDefaultProject('层级面板测试')
    const onSelectDiagram = vi.fn()
    const { container } = render(
      <HierarchyPanel
        document={document}
        currentDiagramId={document.lineSystems[0].rootDiagramId}
        onSelectDiagram={onSelectDiagram}
      />,
    )
    const coolingLine = container.querySelectorAll<HTMLElement>('.tree-line')[0]
    const root = document.diagrams.find((diagram) => (
      diagram.id === document.lineSystems[0].rootDiagramId
    ))!

    fireEvent.click(within(coolingLine).getByRole('button', { name: '收起冷却线路' }))
    expect(within(coolingLine).queryByText(root.name, { exact: true })).not.toBeInTheDocument()
    expect(within(coolingLine).getByRole('button', { name: '展开冷却线路' }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(onSelectDiagram).not.toHaveBeenCalled()

    fireEvent.click(within(coolingLine).getByRole('button', { name: '展开冷却线路' }))
    expect(within(coolingLine).getByText(root.name, { exact: true })).toBeInTheDocument()
  })

  it('collapses diagram children by chevron and supports arrow-key expansion', () => {
    const document = createDefaultProject('层级面板测试')
    const coolingRoot = document.lineSystems[0].rootDiagramId
    const building = document.diagrams.find((diagram) => diagram.parentId === coolingRoot)!
    const child = document.diagrams.find((diagram) => diagram.parentId === building.id)!
    const onSelectDiagram = vi.fn()
    const { container } = render(
      <HierarchyPanel
        document={document}
        currentDiagramId={coolingRoot}
        editable
        onSelectDiagram={onSelectDiagram}
        onCreateDiagram={vi.fn(() => null)}
        onRenameDiagram={vi.fn(() => true)}
        onMoveDiagram={vi.fn()}
      />,
    )
    const buildingShell = container.querySelector<HTMLElement>(
      `[data-diagram-id="${building.id}"]`,
    )!
    const coolingLine = container.querySelectorAll<HTMLElement>('.tree-line')[0]
    const buildingRow = buildingShell.querySelector<HTMLButtonElement>('.tree-row')!
    const toggle = buildingShell.querySelector<HTMLElement>('.tree-row__branch-slot')!

    fireEvent.click(toggle)
    expect(within(coolingLine).queryByText(child.name, { exact: true })).not.toBeInTheDocument()
    expect(buildingRow).toHaveAttribute('aria-expanded', 'false')
    expect(onSelectDiagram).not.toHaveBeenCalled()

    fireEvent.keyDown(buildingRow, { key: 'ArrowRight' })
    expect(within(coolingLine).getByText(child.name, { exact: true })).toBeInTheDocument()
    expect(buildingRow).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(buildingRow, { key: 'ArrowLeft' })
    expect(within(coolingLine).queryByText(child.name, { exact: true })).not.toBeInTheDocument()
  })
})
