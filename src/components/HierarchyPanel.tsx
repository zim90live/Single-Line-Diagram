import {
  GripVertical,
  Pencil,
  Plus,
  Snowflake,
  Trash2,
  Zap,
} from 'lucide-react'
import {
  memo,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'

import monitorTreeArrowClosed from '../assets/monitor-tree/arrow-closed.svg'
import monitorTreeArrowOpen from '../assets/monitor-tree/arrow-open.svg'
import monitorTreeBuilding from '../assets/monitor-tree/building.svg'
import monitorTreeLeaf from '../assets/monitor-tree/leaf.svg'
import monitorTreePark from '../assets/monitor-tree/park.svg'
import monitorTreePod from '../assets/monitor-tree/pod.svg'
import monitorTreeSearch from '../assets/monitor-tree/search.svg'
import type { DiagramDropPosition } from '../domain/diagramHierarchy'
import type { Diagram, LineSystem, ProjectDocument } from '../domain/project'
import { IconButton, Pressable, TextField } from '@aidc/ui'

interface HierarchyPanelProps {
  document: ProjectDocument
  currentDiagramId: string
  editable?: boolean
  onSelectDiagram: (diagramId: string) => void
  onCreateDiagram?: (parentId: string) => string | null
  onRenameDiagram?: (diagramId: string, name: string) => boolean
  onDeleteDiagram?: (diagramId: string) => void
  onMoveDiagram?: (
    sourceId: string,
    targetId: string,
    position: DiagramDropPosition,
  ) => void
}

interface DropTarget {
  diagramId: string
  position: DiagramDropPosition
}

const levelNames: Record<Diagram['level'], string> = {
  campus: '园区',
  building: '楼宇',
  pod: 'POD',
  device: '设备',
}

const monitorLevelIcons: Record<Diagram['level'], string> = {
  campus: monitorTreePark,
  building: monitorTreeBuilding,
  pod: monitorTreePod,
  device: monitorTreeLeaf,
}

function dropPosition(event: DragEvent<HTMLDivElement>, diagram: Diagram): DiagramDropPosition {
  if (diagram.parentId === null) return 'inside'
  const bounds = event.currentTarget.getBoundingClientRect()
  const ratio = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5
  if (ratio < 0.28) return 'before'
  if (ratio > 0.72) return 'after'
  return 'inside'
}

interface DiagramBranchProps {
  diagram: Diagram
  diagrams: Diagram[]
  depth: number
  currentDiagramId: string
  collapsedDiagramIds: ReadonlySet<string>
  editable: boolean
  editingDiagramId: string | null
  renameDraft: string
  renameError: string | null
  draggedDiagramId: string | null
  activeDropTarget: DropTarget | null
  onSelectDiagram: (diagramId: string) => void
  onToggleDiagram: (diagramId: string) => void
  onBeginRename: (diagram: Diagram) => void
  onDeleteDiagram?: (diagramId: string) => void
  onRenameDraftChange: (value: string) => void
  onCommitRename: () => boolean
  onCancelRename: () => void
  onKeyboardMove: (diagram: Diagram, event: KeyboardEvent<HTMLButtonElement>) => void
  onDragStart: (diagram: Diagram, event: DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  onDragOver: (diagram: Diagram, event: DragEvent<HTMLDivElement>) => void
  onDragLeave: (diagram: Diagram, event: DragEvent<HTMLDivElement>) => void
  onDrop: (diagram: Diagram, event: DragEvent<HTMLDivElement>) => void
}

function DiagramBranch({
  diagram,
  diagrams,
  depth,
  currentDiagramId,
  collapsedDiagramIds,
  editable,
  editingDiagramId,
  renameDraft,
  renameError,
  draggedDiagramId,
  activeDropTarget,
  onSelectDiagram,
  onToggleDiagram,
  onBeginRename,
  onDeleteDiagram,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onKeyboardMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: DiagramBranchProps) {
  const children = diagrams.filter((candidate) => candidate.parentId === diagram.id)
  const hasChildren = children.length > 0
  const expanded = hasChildren && !collapsedDiagramIds.has(diagram.id)
  const monitorIcon = monitorLevelIcons[diagram.level]
  const isEditing = editingDiagramId === diagram.id
  const activePosition = activeDropTarget?.diagramId === diagram.id
    ? activeDropTarget.position
    : undefined
  const rowPadding = 4 + (depth + 1) * 18

  return (
    <li
      role="treeitem"
      aria-current={diagram.id === currentDiagramId ? 'page' : undefined}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <div
        className="tree-row-shell"
        data-diagram-id={diagram.id}
        data-drop-position={activePosition}
        data-dragging={draggedDiagramId === diagram.id || undefined}
        data-deletable={editable && diagram.parentId !== null && !isEditing || undefined}
        onDragOver={(event) => onDragOver(diagram, event)}
        onDragLeave={(event) => onDragLeave(diagram, event)}
        onDrop={(event) => onDrop(diagram, event)}
      >
        {isEditing ? (
          <div
            className="tree-row tree-row--editing"
            data-selected="true"
            style={{ paddingInlineStart: rowPadding }}
          >
            <span className="tree-row__branch-slot" aria-hidden="true">
              {hasChildren ? (
                <img
                  className="tree-row__branch"
                  src={expanded ? monitorTreeArrowOpen : monitorTreeArrowClosed}
                  alt=""
                />
              ) : null}
            </span>
            <img className="tree-row__icon" src={monitorIcon} alt="" aria-hidden="true" />
            <TextField
              autoFocus
              containerClassName="tree-row__rename-field"
              label={`重命名${diagram.name}`}
              hideLabel
              maxLength={40}
              value={renameDraft}
              aria-invalid={Boolean(renameError) || undefined}
              aria-describedby={renameError ? 'diagram-rename-error' : undefined}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => {
                if (!onCommitRename()) {
                  window.requestAnimationFrame(() => event.currentTarget.focus())
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onCommitRename()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelRename()
                }
              }}
            />
            {renameError ? (
              <span className="visually-hidden" id="diagram-rename-error" role="alert">
                {renameError}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <Pressable
              className="tree-row"
              data-selected={diagram.id === currentDiagramId || undefined}
              draggable={editable && diagram.parentId !== null}
              aria-expanded={hasChildren ? expanded : undefined}
              aria-keyshortcuts={[
                hasChildren ? 'ArrowLeft ArrowRight' : '',
                editable && diagram.parentId !== null
                  ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight'
                  : '',
              ].filter(Boolean).join(' ') || undefined}
              style={{ paddingInlineStart: rowPadding }}
              title={editable && diagram.parentId !== null
                ? '拖动调整层级或顺序；Alt+方向键也可调整'
                : diagram.name}
              onClick={() => onSelectDiagram(diagram.id)}
              onDoubleClick={() => { if (editable) onBeginRename(diagram) }}
              onKeyDown={(event) => {
                if (!event.altKey && hasChildren) {
                  if ((event.key === 'ArrowLeft' && expanded) ||
                    (event.key === 'ArrowRight' && !expanded)) {
                    event.preventDefault()
                    onToggleDiagram(diagram.id)
                    return
                  }
                }
                onKeyboardMove(diagram, event)
              }}
              onDragStart={(event) => onDragStart(diagram, event)}
              onDragEnd={onDragEnd}
            >
              <span
                className="tree-row__branch-slot"
                title={hasChildren ? (expanded ? '收起子图' : '展开子图') : undefined}
                onClick={hasChildren ? (event) => {
                  event.stopPropagation()
                  onToggleDiagram(diagram.id)
                } : undefined}
                aria-hidden="true"
              >
              {hasChildren ? (
                  <img
                    className="tree-row__branch"
                    src={expanded ? monitorTreeArrowOpen : monitorTreeArrowClosed}
                    alt=""
                  />
                ) : null}
              </span>
              <img className="tree-row__icon" src={monitorIcon} alt="" aria-hidden="true" />
              <span className="tree-row__name">{diagram.name}</span>
              {editable ? (
                <span className="tree-row__drag-slot" aria-hidden="true">
                  {diagram.parentId !== null ? <GripVertical className="tree-row__drag-handle" /> : null}
                </span>
              ) : null}
            </Pressable>
            {editable && diagram.parentId !== null && onDeleteDiagram ? (
              <IconButton
                className="tree-row__delete"
                label={`删除图纸 ${diagram.name}`}
                icon={<Trash2 />}
                variant="neutral-ghost"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteDiagram(diagram.id)
                }}
              />
            ) : null}
          </>
        )}
      </div>
      {expanded ? (
        <ul role="group">
          {children.map((child) => (
            <DiagramBranch
              key={child.id}
              diagram={child}
              diagrams={diagrams}
              depth={depth + 1}
              currentDiagramId={currentDiagramId}
              collapsedDiagramIds={collapsedDiagramIds}
              editable={editable}
              editingDiagramId={editingDiagramId}
              renameDraft={renameDraft}
              renameError={renameError}
              draggedDiagramId={draggedDiagramId}
              activeDropTarget={activeDropTarget}
              onSelectDiagram={onSelectDiagram}
              onToggleDiagram={onToggleDiagram}
              onBeginRename={onBeginRename}
              onDeleteDiagram={onDeleteDiagram}
              onRenameDraftChange={onRenameDraftChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onKeyboardMove={onKeyboardMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

interface LineBranchProps extends Omit<DiagramBranchProps, 'diagram' | 'diagrams' | 'depth'> {
  lineSystem: LineSystem
  document: ProjectDocument
  expanded: boolean
  onToggleLine: (lineSystemId: string) => void
}

function LineBranch({
  lineSystem,
  document,
  expanded,
  onToggleLine,
  ...branchProps
}: LineBranchProps) {
  const root = document.diagrams.find((diagram) => diagram.id === lineSystem.rootDiagramId)
  const Icon = lineSystem.type === 'cooling' ? Snowflake : Zap
  return (
    <li className="tree-line" role="treeitem" aria-expanded={root ? expanded : undefined}>
      <Pressable
        className="tree-line__heading"
        aria-label={`${expanded ? '收起' : '展开'}${lineSystem.name}`}
        aria-expanded={root ? expanded : undefined}
        onClick={() => { if (root) onToggleLine(lineSystem.id) }}
      >
        <img
          className="tree-line__branch"
          src={expanded ? monitorTreeArrowOpen : monitorTreeArrowClosed}
          alt=""
          aria-hidden="true"
        />
        <Icon aria-hidden="true" />
        <span>{lineSystem.name}</span>
      </Pressable>
      {root && expanded ? (
        <ul role="group">
          <DiagramBranch
            {...branchProps}
            diagram={root}
            diagrams={document.diagrams}
            depth={0}
          />
        </ul>
      ) : null}
    </li>
  )
}

export const HierarchyPanel = memo(function HierarchyPanel({
  document,
  currentDiagramId,
  editable = false,
  onSelectDiagram,
  onCreateDiagram,
  onRenameDiagram,
  onDeleteDiagram,
  onMoveDiagram,
}: HierarchyPanelProps) {
  const cancelRenameRef = useRef(false)
  const [editingDiagramId, setEditingDiagramId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [draggedDiagramId, setDraggedDiagramId] = useState<string | null>(null)
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null)
  const [collapsedDiagramIds, setCollapsedDiagramIds] = useState<Set<string>>(() => new Set())
  const [collapsedLineSystemIds, setCollapsedLineSystemIds] = useState<Set<string>>(() => new Set())
  const [monitorQuery, setMonitorQuery] = useState('')

  const currentDiagram = document.diagrams.find((diagram) => diagram.id === currentDiagramId)
  const diagramsById = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
  const normalizedMonitorQuery = monitorQuery.trim().toLocaleLowerCase()
  const visibleDiagramIds = new Set<string>()

  if (normalizedMonitorQuery) {
    for (const lineSystem of document.lineSystems) {
      const lineMatches = [
        lineSystem.name,
        lineSystem.type === 'cooling' ? '冷却' : '电力',
      ].some((value) => value.toLocaleLowerCase().includes(normalizedMonitorQuery))

      if (lineMatches) {
        for (const diagram of document.diagrams) {
          if (diagram.lineSystemId === lineSystem.id) visibleDiagramIds.add(diagram.id)
        }
        continue
      }

      for (const diagram of document.diagrams) {
        if (diagram.lineSystemId !== lineSystem.id) continue
        const diagramMatches = [diagram.name, levelNames[diagram.level]]
          .some((value) => value.toLocaleLowerCase().includes(normalizedMonitorQuery))
        if (!diagramMatches) continue

        visibleDiagramIds.add(diagram.id)
        let parentId = diagram.parentId
        while (parentId) {
          visibleDiagramIds.add(parentId)
          parentId = diagramsById.get(parentId)?.parentId ?? null
        }
      }
    }
  }

  const visibleDocument = normalizedMonitorQuery
    ? {
        ...document,
        diagrams: document.diagrams.filter((diagram) => visibleDiagramIds.has(diagram.id)),
        lineSystems: document.lineSystems.filter((lineSystem) => (
          visibleDiagramIds.has(lineSystem.rootDiagramId)
        )),
      }
    : document
  const currentAncestorIds: string[] = []
  let currentAncestor = currentDiagram?.parentId
  while (currentAncestor) {
    currentAncestorIds.push(currentAncestor)
    currentAncestor = diagramsById.get(currentAncestor)?.parentId ?? null
  }
  const currentAncestorKey = currentAncestorIds.join('/')

  useEffect(() => {
    if (!currentDiagram) return
    setCollapsedLineSystemIds((current) => {
      if (!current.has(currentDiagram.lineSystemId)) return current
      const next = new Set(current)
      next.delete(currentDiagram.lineSystemId)
      return next
    })
    setCollapsedDiagramIds((current) => {
      const next = new Set(current)
      let changed = false
      for (const diagramId of currentAncestorIds) {
        if (next.delete(diagramId)) changed = true
      }
      return changed ? next : current
    })
  }, [currentAncestorKey, currentDiagram?.lineSystemId, currentDiagramId])

  useEffect(() => {
    if (!editingDiagramId) return
    const diagram = document.diagrams.find((candidate) => candidate.id === editingDiagramId)
    if (!diagram) {
      setEditingDiagramId(null)
      return
    }
    setRenameDraft(diagram.name)
    setRenameError(null)
  }, [document.diagrams, editingDiagramId])

  const beginRename = (diagram: Diagram) => {
    cancelRenameRef.current = false
    setEditingDiagramId(diagram.id)
    setRenameDraft(diagram.name)
    setRenameError(null)
  }

  const commitRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      return true
    }
    if (!editingDiagramId) return true
    const nextName = renameDraft.trim()
    if (!nextName) {
      setRenameError('请输入图纸名称')
      return false
    }
    if (nextName.length > 40) {
      setRenameError('图纸名称不能超过 40 个字符')
      return false
    }
    if (onRenameDiagram && !onRenameDiagram(editingDiagramId, nextName)) return false
    setEditingDiagramId(null)
    setRenameError(null)
    return true
  }

  const cancelRename = () => {
    cancelRenameRef.current = true
    setEditingDiagramId(null)
    setRenameError(null)
  }

  const createDiagram = () => {
    if (!currentDiagram || !onCreateDiagram) return
    const parentId = currentDiagram.level === 'device'
      ? currentDiagram.parentId
      : currentDiagram.id
    if (!parentId) return
    const diagramId = onCreateDiagram(parentId)
    if (diagramId) setEditingDiagramId(diagramId)
  }

  const toggleDiagram = (diagramId: string) => {
    setCollapsedDiagramIds((current) => {
      const next = new Set(current)
      if (!next.delete(diagramId)) next.add(diagramId)
      return next
    })
  }

  const toggleLine = (lineSystemId: string) => {
    setCollapsedLineSystemIds((current) => {
      const next = new Set(current)
      if (!next.delete(lineSystemId)) next.add(lineSystemId)
      return next
    })
  }

  const keyboardMove = (diagram: Diagram, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!editable || !event.altKey || !onMoveDiagram || diagram.parentId === null) return
    const siblings = document.diagrams.filter((candidate) => candidate.parentId === diagram.parentId)
    const index = siblings.findIndex((candidate) => candidate.id === diagram.id)
    let target: Diagram | undefined
    let position: DiagramDropPosition | undefined
    if (event.key === 'ArrowUp' && index > 0) {
      target = siblings[index - 1]
      position = 'before'
    } else if (event.key === 'ArrowDown' && index < siblings.length - 1) {
      target = siblings[index + 1]
      position = 'after'
    } else if (event.key === 'ArrowLeft') {
      const parent = diagramsById.get(diagram.parentId)
      if (parent?.parentId) {
        target = parent
        position = 'after'
      }
    } else if (event.key === 'ArrowRight' && index > 0) {
      target = siblings[index - 1]
      position = 'inside'
    }
    if (!target || !position) return
    event.preventDefault()
    if (position === 'inside') {
      setCollapsedDiagramIds((current) => {
        if (!current.has(target.id)) return current
        const next = new Set(current)
        next.delete(target.id)
        return next
      })
    }
    onMoveDiagram(diagram.id, target.id, position)
  }

  const dragStart = (diagram: Diagram, event: DragEvent<HTMLButtonElement>) => {
    if (!editable || diagram.parentId === null) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', diagram.id)
    setDraggedDiagramId(diagram.id)
  }

  const dragEnd = () => {
    setDraggedDiagramId(null)
    setActiveDropTarget(null)
  }

  const dragOver = (diagram: Diagram, event: DragEvent<HTMLDivElement>) => {
    if (!editable || !draggedDiagramId || draggedDiagramId === diagram.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const nextTarget = { diagramId: diagram.id, position: dropPosition(event, diagram) }
    setActiveDropTarget((current) => (
      current?.diagramId === nextTarget.diagramId && current.position === nextTarget.position
        ? current
        : nextTarget
    ))
  }

  const dragLeave = (diagram: Diagram, event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    setActiveDropTarget((current) => current?.diagramId === diagram.id ? null : current)
  }

  const drop = (diagram: Diagram, event: DragEvent<HTMLDivElement>) => {
    if (!editable || !onMoveDiagram) return
    event.preventDefault()
    const sourceId = draggedDiagramId || event.dataTransfer.getData('text/plain')
    const position = activeDropTarget?.diagramId === diagram.id
      ? activeDropTarget.position
      : dropPosition(event, diagram)
    if (sourceId && sourceId !== diagram.id) {
      if (position === 'inside') {
        setCollapsedDiagramIds((current) => {
          if (!current.has(diagram.id)) return current
          const next = new Set(current)
          next.delete(diagram.id)
          return next
        })
      }
      onMoveDiagram(sourceId, diagram.id, position)
    }
    dragEnd()
  }

  const branchProps = {
    currentDiagramId,
    collapsedDiagramIds: normalizedMonitorQuery ? new Set<string>() : collapsedDiagramIds,
    editable,
    editingDiagramId,
    renameDraft,
    renameError,
    draggedDiagramId,
    activeDropTarget,
    onSelectDiagram,
    onToggleDiagram: toggleDiagram,
    onBeginRename: beginRename,
    onDeleteDiagram,
    onRenameDraftChange: (value: string) => {
      setRenameDraft(value)
      setRenameError(null)
    },
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
    onKeyboardMove: keyboardMove,
    onDragStart: dragStart,
    onDragEnd: dragEnd,
    onDragOver: dragOver,
    onDragLeave: dragLeave,
    onDrop: drop,
  }

  return (
    <section
      className="sidebar-section hierarchy-section"
      aria-label={editable ? '图纸层级' : '监控图纸树'}
    >
      <div className="monitor-tree-search">
        <img src={monitorTreeSearch} alt="" aria-hidden="true" />
        <TextField
          containerClassName="monitor-tree-search__field"
          label={editable ? '搜索图纸层级' : '搜索监控图纸'}
          hideLabel
          type="search"
          placeholder="搜索图纸"
          value={monitorQuery}
          onChange={(event) => setMonitorQuery(event.currentTarget.value)}
        />
      </div>
      {editable ? (
        <div className="monitor-tree-actions" aria-label="图纸层级操作">
          <span className="monitor-tree-actions__count">{document.diagrams.length} 张图纸</span>
          <IconButton
            label={currentDiagram?.level === 'device' ? '新增同级图纸' : '新增下级图纸'}
            icon={<Plus />}
            variant="neutral-ghost"
            disabled={!currentDiagram || !onCreateDiagram}
            onClick={createDiagram}
          />
          <IconButton
            label="重命名当前图纸"
            icon={<Pencil />}
            variant="neutral-ghost"
            disabled={!currentDiagram || !onRenameDiagram}
            onClick={() => { if (currentDiagram) beginRename(currentDiagram) }}
          />
        </div>
      ) : null}
      <ul className="hierarchy-tree" role="tree" aria-label="冷却与电力图纸层级">
        {visibleDocument.lineSystems.map((lineSystem) => (
          <LineBranch
            {...branchProps}
            key={lineSystem.id}
            lineSystem={lineSystem}
            document={visibleDocument}
            expanded={Boolean(normalizedMonitorQuery) || !collapsedLineSystemIds.has(lineSystem.id)}
            onToggleLine={toggleLine}
          />
        ))}
      </ul>
      {visibleDocument.lineSystems.length === 0 ? (
        <p className="monitor-tree-empty">没有匹配的图纸</p>
      ) : null}
    </section>
  )
}, (previous, next) => (
  previous.document.diagrams === next.document.diagrams &&
  previous.document.lineSystems === next.document.lineSystems &&
  previous.currentDiagramId === next.currentDiagramId &&
  previous.editable === next.editable &&
  previous.onSelectDiagram === next.onSelectDiagram &&
  previous.onCreateDiagram === next.onCreateDiagram &&
  previous.onRenameDiagram === next.onRenameDiagram &&
  previous.onDeleteDiagram === next.onDeleteDiagram &&
  previous.onMoveDiagram === next.onMoveDiagram
))
