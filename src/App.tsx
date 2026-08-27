import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  FileJson,
  FilePlus2,
  FolderOpen,
  Minus,
  MonitorPlay,
  Pause,
  PencilLine,
  Play,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HierarchyPanel } from './components/HierarchyPanel'
import { MonitorPropertiesPanel } from './components/MonitorPropertiesPanel'
import { PropertiesPanel } from './components/PropertiesPanel'
import { SymbolAnchorEditorDialog } from './components/SymbolAnchorEditorDialog'
import { SymbolLibrary } from './components/SymbolLibrary'
import { Button, IconButton, StatusTag, TextField } from './components/ui'
import {
  elementUsesOnOffState,
  getDiagramPath,
  parseProjectDocument,
  projectOnOffStates,
  withOnOffStateSnapshot,
  type Busbar,
  type ConnectionNetwork,
  type CoolingDeviceRole,
  type DiagramElement,
  type RouteWaypoint,
} from './domain/project'
import {
  DiagramCanvas,
  type DiagramCanvasHandle,
  type EditorCommandState,
  type CanvasMode,
} from './editor/DiagramCanvas'
import { getAnchorTypeLabel } from './editor/anchors'
import { getAdaptiveGridScale } from './editor/gridScale'
import { routeWaypointsForNetworks } from './editor/routeWaypoints'
import { symbolAssets } from './editor/symbolCatalog'
import { deriveCoolingFlowTopology } from './monitoring/coolingFlowTopology'
import {
  DEFAULT_COOLING_PUMP_OUTPUT_POWER_PERCENT,
  MockCoolingRuntimeProvider,
  clampCoolingPumpOutputPower,
} from './monitoring/coolingRuntime'
import {
  monitorStateRepository,
  projectRepository,
  type ProjectSummary,
} from './storage/projectRepository'
import { useAppStore } from './store/useAppStore'
import { downloadProject, parseProjectText } from './utils/projectFile'

const initialCommandState: EditorCommandState = {
  canUndo: false,
  canRedo: false,
  canCopy: false,
  hasSelection: false,
  zoom: 1,
  selectedConnection: false,
  selectedBusbar: false,
  selectedConnectionId: null,
  selectedConnectionEdgeIds: [],
  selectedBusbarIds: [],
  selectedRouteWaypointCount: 0,
  selectedRouteWaypointMaxReferenceCount: 0,
  selectedJunctionCount: 0,
  wiringType: null,
}

interface ConfirmRequest {
  title: string
  content: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

interface ToastState {
  id: string
  message: string
  tone: 'success' | 'danger'
}

function formatSavedTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-content"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-card__header">
          <FileJson aria-hidden="true" />
          <h2 id="confirm-title">{request.title}</h2>
        </div>
        <p id="confirm-content">{request.content}</p>
        <div className="dialog-card__actions">
          <Button disabled={busy} onClick={onClose}>取消</Button>
          <Button
            loading={busy}
            variant={request.danger ? 'danger-soft' : 'primary-solid'}
            onClick={async () => {
              setBusy(true)
              try {
                await request.onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const editorRef = useRef<DiagramCanvasHandle>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const monitorStateRevisionRef = useRef(0)
  const coolingRuntimeProviderRef = useRef(new MockCoolingRuntimeProvider())
  const [openPanel, setOpenPanel] = useState(false)
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [commandState, setCommandState] = useState(initialCommandState)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [anchorEditorAssetKey, setAnchorEditorAssetKey] = useState<string | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<CanvasMode>('edit')
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false)
  const [animationPlaying, setAnimationPlaying] = useState(false)
  const [onOffStates, setOnOffStates] = useState<Record<string, boolean>>({})
  const [coolingPumpRunningStates, setCoolingPumpRunningStates] = useState<Record<string, boolean>>({})
  const [coolingPumpOutputPowerStates, setCoolingPumpOutputPowerStates] = useState<Record<string, number>>({})
  const [coolingValveOpenStates, setCoolingValveOpenStates] = useState<Record<string, boolean>>({})

  const {
    document,
    documentEpoch,
    currentDiagramId,
    selectedElementIds,
    dirty,
    replaceDocument,
    createProject,
    setCurrentDiagram,
    setSelectedElementIds,
    replaceDiagramContent,
    syncElementOnOffStates,
    replaceAssetDefinition,
    renameProject,
    markSaved,
  } = useAppStore()

  const showToast = (message: string, tone: ToastState['tone'] = 'success') => {
    const id = crypto.randomUUID()
    setToast({ id, message, tone })
    window.setTimeout(() => {
      setToast((current) => current?.id === id ? null : current)
    }, 2600)
  }

  const currentDiagram = document.diagrams.find((diagram) => diagram.id === currentDiagramId)
  const currentLine = document.lineSystems.find(
    (lineSystem) => lineSystem.id === currentDiagram?.lineSystemId,
  )
  const diagramPath = getDiagramPath(document, currentDiagramId)
  const currentElements = useMemo(
    () => document.elements.filter((element) => element.diagramId === currentDiagramId),
    [currentDiagramId, document.elements],
  )
  const currentConnections = useMemo(
    () => document.connections.filter((network) => network.diagramId === currentDiagramId),
    [currentDiagramId, document.connections],
  )
  const currentRouteWaypoints = useMemo(
    () => routeWaypointsForNetworks(currentConnections),
    [currentConnections],
  )
  const currentBusbars = useMemo(
    () => document.busbars.filter((busbar) => busbar.diagramId === currentDiagramId),
    [currentDiagramId, document.busbars],
  )
  const selectedElements = useMemo(
    () => document.elements.filter((element) => selectedElementIds.includes(element.id)),
    [document.elements, selectedElementIds],
  )
  const currentAssetsByKey = useMemo(
    () => new Map(document.assets.map((asset) => [asset.key, asset])),
    [document.assets],
  )
  const selectedMonitorElement = selectedElements.length === 1 ? selectedElements[0] : undefined
  const selectedMonitorAsset = selectedMonitorElement
    ? currentAssetsByKey.get(selectedMonitorElement.assetKey)
    : undefined
  const coolingRuntimeSnapshot = useMemo(() => {
    const persistentValveOpenStates = Object.fromEntries(currentElements.flatMap((element) => (
      ['valve', 'check-valve'].includes(
        currentAssetsByKey.get(element.assetKey)?.coolingDeviceRole ?? '',
      ) && elementUsesOnOffState(element)
        ? [[element.id, onOffStates[element.id] ?? false] as const]
        : []
    )))
    return coolingRuntimeProviderRef.current.getSnapshot({
      elements: currentElements,
      assets: document.assets,
      pumpRunningOverrides: coolingPumpRunningStates,
      pumpOutputPowerOverrides: coolingPumpOutputPowerStates,
      valveOpenOverrides: {
        ...coolingValveOpenStates,
        ...persistentValveOpenStates,
      },
    })
  }, [
    coolingPumpOutputPowerStates,
    coolingPumpRunningStates,
    coolingValveOpenStates,
    currentAssetsByKey,
    currentElements,
    document.assets,
    onOffStates,
  ])
  const coolingFlowTopology = useMemo(() => (
    workspaceMode === 'monitor' && currentLine?.type === 'cooling'
  )
    ? deriveCoolingFlowTopology({
        elements: currentElements,
        assets: document.assets,
        networks: currentConnections,
        runtime: coolingRuntimeSnapshot,
      })
    : {
        edges: [],
        diagnostics: [],
        activePumpElementIds: new Set<string>(),
        pumpFlowRates: {},
      }, [
        coolingRuntimeSnapshot,
        currentConnections,
        currentElements,
        currentLine?.type,
        document.assets,
        workspaceMode,
      ])
  const duplicateDeviceIdentifier = useMemo(() => {
    if (selectedElements.length !== 1) return false
    const tag = selectedElements[0].properties.tag
    if (typeof tag !== 'string' || !tag.trim()) return false
    return currentElements.filter((element) => (
      typeof element.properties.tag === 'string' &&
      element.properties.tag.trim() === tag.trim()
    )).length > 1
  }, [currentElements, selectedElements])
  const selectedBusbars = useMemo(() => {
    const ids = new Set(commandState.selectedBusbarIds)
    return currentBusbars.filter((busbar) => ids.has(busbar.id))
  }, [commandState.selectedBusbarIds, currentBusbars])
  const selectedConnection = useMemo(() => {
    if (!commandState.selectedConnectionId || !commandState.selectedConnectionEdgeIds.length) {
      return null
    }
    const edgeIds = new Set(commandState.selectedConnectionEdgeIds)
    const selections = currentConnections.flatMap((network) => (
      network.edges.flatMap((edge) => edgeIds.has(edge.id) ? [{ network, edge }] : [])
    ))
    if (!selections.length) return null
    return {
      id: commandState.selectedConnectionId,
      type: selections[0].network.type,
      edgeTypes: Object.fromEntries(selections.map(({ network, edge }) => (
        [edge.id, network.type]
      ))),
      edges: selections.map(({ edge }) => edge),
      isNetwork: commandState.selectedConnectionId.startsWith('network:'),
    }
  }, [
    commandState.selectedConnectionEdgeIds,
    commandState.selectedConnectionId,
    currentConnections,
  ])
  const insertSymbol = useCallback(
    (symbolKey: string) => editorRef.current?.insertSymbol(symbolKey),
    [],
  )
  const insertBusbar = useCallback(() => editorRef.current?.insertBusbar(), [])
  const handleDiagramChange = useCallback((
    nextElements: DiagramElement[],
    nextBusbars: Busbar[],
    nextConnections: ConnectionNetwork[],
    nextRouteWaypoints: RouteWaypoint[],
  ) => {
    replaceDiagramContent(
      currentDiagramId,
      nextElements,
      nextBusbars,
      nextConnections,
      nextRouteWaypoints,
    )
  }, [currentDiagramId, replaceDiagramContent])
  useEffect(() => {
    let cancelled = false
    const revision = monitorStateRevisionRef.current + 1
    monitorStateRevisionRef.current = revision
    const documentStates = projectOnOffStates(document)
    const legacyStateElementIds = new Set(document.elements.flatMap((element) => (
      elementUsesOnOffState(element) && element.onOffState === undefined
        ? [element.id]
        : []
    )))
    setOnOffStates(documentStates)
    syncElementOnOffStates(documentStates)
    setCoolingPumpRunningStates({})
    setCoolingPumpOutputPowerStates({})
    setCoolingValveOpenStates({})
    void monitorStateRepository.getOnOffStates(document.project.id)
      .then((states) => {
        if (cancelled || monitorStateRevisionRef.current !== revision) return
        const legacyStates = Object.fromEntries(Object.entries(states).filter(([elementId]) => (
          legacyStateElementIds.has(elementId)
        )))
        const mergedStates = { ...documentStates, ...legacyStates }
        setOnOffStates(mergedStates)
        syncElementOnOffStates(mergedStates)
      })
      .catch((error) => {
        if (!cancelled) showToast(
          error instanceof Error ? error.message : '无法读取监控运行状态。',
          'danger',
        )
      })
    return () => { cancelled = true }
  }, [document.project.id, documentEpoch, syncElementOnOffStates])

  const setMode = (mode: CanvasMode) => {
    setWorkspaceMode(mode)
    setAnimationPlaying(false)
    setSelectedElementIds([])
    setAnchorEditorAssetKey(null)
  }

  const handleOnOffStateChange = (elementId: string, on: boolean) => {
    const previous = onOffStates[elementId] ?? false
    monitorStateRevisionRef.current += 1
    setOnOffStates((current) => ({ ...current, [elementId]: on }))
    syncElementOnOffStates({ [elementId]: on })
    void monitorStateRepository
      .setOnOffState(document.project.id, elementId, on)
      .catch((error) => {
        setOnOffStates((current) => (
          current[elementId] === on ? { ...current, [elementId]: previous } : current
        ))
        syncElementOnOffStates({ [elementId]: previous })
        showToast(error instanceof Error ? error.message : 'On/Off 状态保存失败。', 'danger')
      })
  }

  const handleCoolingRuntimeStateChange = (
    elementId: string,
    role: CoolingDeviceRole,
    active: boolean,
  ) => {
    if (role === 'pump') {
      setCoolingPumpRunningStates((current) => ({ ...current, [elementId]: active }))
      showToast(active ? '水泵已运行' : '水泵已停止')
    } else {
      setCoolingValveOpenStates((current) => ({ ...current, [elementId]: active }))
      showToast(active ? '阀门已打开' : '阀门已关闭')
    }
  }

  const handleCoolingPumpOutputPowerChange = (elementId: string, outputPower: number) => {
    setCoolingPumpOutputPowerStates((current) => ({
      ...current,
      [elementId]: clampCoolingPumpOutputPower(outputPower),
    }))
  }

  const saveProject = async () => {
    try {
      await projectRepository.save(withOnOffStateSnapshot(useAppStore.getState().document))
      markSaved()
      showToast('项目已保存到当前浏览器')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '项目保存失败，请重试。', 'danger')
    }
  }

  useEffect(() => {
    const handleSaveShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.repeat ||
        event.altKey ||
        (!event.metaKey && !event.ctrlKey) ||
        event.key.toLowerCase() !== 's'
      ) return
      event.preventDefault()
      void saveProject()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [saveProject])

  useEffect(() => {
    const handleClipboardShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        workspaceMode !== 'edit' ||
        event.defaultPrevented ||
        event.repeat ||
        isTextEditingTarget(event.target) ||
        !(event.ctrlKey || event.metaKey)
      ) return
      const key = event.key.toLowerCase()
      if (!['c', 'x', 'v'].includes(key)) return
      event.preventDefault()
      if (key === 'c') editorRef.current?.copy()
      if (key === 'x') editorRef.current?.cut()
      if (key === 'v') editorRef.current?.paste()
    }
    window.addEventListener('keydown', handleClipboardShortcut)
    return () => window.removeEventListener('keydown', handleClipboardShortcut)
  }, [workspaceMode])

  const confirmNewProject = () => {
    const create = () => {
      createProject()
      showToast('已创建新项目')
    }
    if (!dirty) {
      create()
      return
    }
    setConfirmRequest({
      title: '新建项目？',
      content: '当前项目包含未保存修改。新建后仍可通过已导出的 JSON 或已保存项目恢复。',
      confirmLabel: '继续新建',
      onConfirm: create,
    })
  }

  const refreshSavedProjects = async () => {
    setLoadingProjects(true)
    try {
      setSavedProjects(await projectRepository.list())
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法读取本地项目。', 'danger')
    } finally {
      setLoadingProjects(false)
    }
  }

  const showOpenPanel = () => {
    setOpenPanel(true)
    void refreshSavedProjects()
  }

  const openSavedProject = async (projectId: string) => {
    const open = async () => {
      try {
        const stored = await projectRepository.get(projectId)
        if (!stored) throw new Error('该项目不存在，可能已被其他标签页删除。')
        replaceDocument(parseProjectDocument(stored, symbolAssets), { dirty: false })
        setOpenPanel(false)
        showToast('项目已打开')
      } catch (error) {
        showToast(error instanceof Error ? error.message : '项目打开失败。', 'danger')
      }
    }

    if (!useAppStore.getState().dirty) {
      await open()
      return
    }
    setConfirmRequest({
      title: '打开其他项目？',
      content: '当前项目包含未保存修改。继续打开将丢失这些修改。',
      confirmLabel: '继续打开',
      onConfirm: open,
    })
  }

  const deleteSavedProject = (summary: ProjectSummary) => {
    setConfirmRequest({
      title: `删除“${summary.name}”？`,
      content: '这只会删除当前浏览器中的本地副本，已导出的 JSON 文件不受影响。',
      confirmLabel: '删除',
      danger: true,
      onConfirm: async () => {
        await projectRepository.delete(summary.id)
        await refreshSavedProjects()
      },
    })
  }

  const importProject = async (file: File) => {
    try {
      const imported = parseProjectText(await file.text())
      const applyImport = () => {
        replaceDocument(imported, { dirty: true })
        showToast(`已导入 ${file.name}`)
      }
      if (useAppStore.getState().dirty) {
        setConfirmRequest({
          title: '导入并替换当前项目？',
          content: '当前项目包含未保存修改。继续导入将丢失这些修改。',
          confirmLabel: '继续导入',
          onConfirm: applyImport,
        })
      } else {
        applyImport()
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '项目导入失败。', 'danger')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const exportProject = () => {
    downloadProject(withOnOffStateSnapshot(useAppStore.getState().document))
    showToast('项目 JSON 已导出')
  }

  if (!currentDiagram) {
    return <div className="fatal-state">当前项目缺少有效图纸，请重新导入项目文件。</div>
  }

  const parentDiagram = currentDiagram.parentId
    ? document.diagrams.find((diagram) => diagram.id === currentDiagram.parentId)
    : undefined

  return (
    <div className="app-shell" data-testid="app-shell" data-mode={workspaceMode}>
      <header className="workspace-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <div>
            <strong>AIDC 接线图</strong>
            <small>{workspaceMode === 'edit' ? '编辑模式' : '监控模式'} · AIDC 运维工作台</small>
          </div>
        </div>

        <div className="workspace-mode-tabs" role="tablist" aria-label="工作模式">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'edit'}
            onClick={() => setMode('edit')}
          >
            <PencilLine aria-hidden="true" />
            编辑模式
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'monitor'}
            onClick={() => setMode('monitor')}
          >
            <MonitorPlay aria-hidden="true" />
            监控模式
          </button>
        </div>

        <div className="project-name-control">
          <FileJson aria-hidden="true" />
          <TextField
            label="项目名称"
            hideLabel
            disabled={workspaceMode === 'monitor'}
            value={document.project.name}
            onChange={(event) => renameProject(event.target.value || '未命名项目')}
          />
          <StatusTag tone={dirty ? 'warning' : 'success'} dot>
            {dirty ? '未保存' : '已保存'}
          </StatusTag>
        </div>

        <nav className="file-actions" aria-label="项目文件操作">
          <Button leadingIcon={<FilePlus2 />} onClick={confirmNewProject}>新建</Button>
          <Button leadingIcon={<FolderOpen />} onClick={showOpenPanel}>打开</Button>
          <Button variant="primary-solid" leadingIcon={<Save />} onClick={() => void saveProject()}>保存</Button>
          <span className="toolbar-divider" />
          <Button leadingIcon={<Upload />} onClick={() => importInputRef.current?.click()}>导入</Button>
          <Button leadingIcon={<Download />} onClick={exportProject}>导出</Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importProject(file)
            }}
          />
        </nav>
      </header>

      <main
        className="workspace-main"
        data-mode={workspaceMode}
        data-left-sidebar-collapsed={leftSidebarCollapsed || undefined}
      >
        <aside
          id="left-sidebar"
          className="left-sidebar"
          data-mode={workspaceMode}
          data-collapsed={leftSidebarCollapsed}
          aria-hidden={leftSidebarCollapsed}
        >
          <HierarchyPanel document={document} currentDiagramId={currentDiagramId} onSelectDiagram={setCurrentDiagram} />
          {workspaceMode === 'edit' ? (
            <SymbolLibrary
              onInsert={insertSymbol}
              onEdit={setAnchorEditorAssetKey}
              onInsertBusbar={insertBusbar}
              canInsertBusbar={currentLine?.type === 'power'}
            />
          ) : null}
        </aside>

        <IconButton
          className="left-sidebar-toggle"
          label={leftSidebarCollapsed ? '展开左侧菜单' : '收起左侧菜单'}
          icon={leftSidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
          aria-controls="left-sidebar"
          aria-expanded={!leftSidebarCollapsed}
          onClick={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
        />

        <section
          className="canvas-column"
          data-mode={workspaceMode}
          aria-label={`${currentDiagram.name}${workspaceMode === 'edit' ? '编辑区' : '监控区'}`}
        >
          <div className="canvas-frame">
            <DiagramCanvas
              ref={editorRef}
              mode={workspaceMode}
              animationPlaying={animationPlaying}
              onOffStates={onOffStates}
              coolingPumpRunningStates={coolingPumpRunningStates}
              coolingPumpOutputPowerStates={coolingPumpOutputPowerStates}
              coolingValveOpenStates={coolingValveOpenStates}
              diagramId={currentDiagramId}
              lineSystemType={currentLine?.type ?? 'cooling'}
              documentEpoch={documentEpoch}
              gridSize={currentDiagram.canvas.gridSize}
              viewport={currentDiagram.canvas.viewport}
              assets={document.assets}
              elements={currentElements}
              busbars={currentBusbars}
              connections={currentConnections}
              routeWaypoints={currentRouteWaypoints}
              onDiagramChange={handleDiagramChange}
              onSelectionChange={setSelectedElementIds}
              onCommandStateChange={setCommandState}
              onActionMessage={showToast}
            />
            <div className="canvas-titlebar" aria-label="画布信息与导航">
              <IconButton
                className="canvas-back-button"
                label="返回上一级"
                icon={<ArrowLeft />}
                disabled={!parentDiagram}
                onClick={() => { if (parentDiagram) setCurrentDiagram(parentDiagram.id) }}
              />
              <span className="canvas-line-context" data-line-type={currentLine?.type}>
                {currentLine?.name}
              </span>
              <nav className="breadcrumbs" aria-label="当前图纸路径">
                {diagramPath.map((diagram, index) => (
                  <span key={diagram.id}>
                    {index ? <span className="breadcrumb-separator">/</span> : null}
                    <button
                      type="button"
                      aria-current={diagram.id === currentDiagram.id ? 'page' : undefined}
                      onClick={() => setCurrentDiagram(diagram.id)}
                    >
                      {diagram.name}
                    </button>
                  </span>
                ))}
              </nav>
              <span className="canvas-metrics">
                {currentElements.length} 个图元 · {currentBusbars.length} 条母线 · {currentConnections.length} 个线路网络
              </span>
            </div>
            <div
              className="canvas-actionbar"
              aria-label={workspaceMode === 'edit' ? '画布编辑命令' : '监控命令'}
            >
              {workspaceMode === 'edit' ? (
                <>
                  <IconButton label="撤销" icon={<Undo2 />} disabled={!commandState.canUndo} onClick={() => editorRef.current?.undo()} />
                  <IconButton label="重做" icon={<Redo2 />} disabled={!commandState.canRedo} onClick={() => editorRef.current?.redo()} />
                  <IconButton label="复制" icon={<Copy />} disabled={!commandState.canCopy} onClick={() => editorRef.current?.copy()} />
                  <IconButton label="粘贴" icon={<ClipboardPaste />} onClick={() => editorRef.current?.paste()} />
                  <IconButton label="删除所选对象" variant="danger-soft" icon={<Trash2 />} disabled={!commandState.hasSelection} onClick={() => editorRef.current?.deleteSelected()} />
                </>
              ) : (
                <IconButton
                  label={animationPlaying ? '暂停流动' : '播放流动'}
                  variant={animationPlaying ? 'primary-solid' : 'neutral-soft'}
                  icon={animationPlaying ? <Pause /> : <Play />}
                  onClick={() => setAnimationPlaying((playing) => !playing)}
                />
              )}
            </div>
            <div className="canvas-zoom-controls" aria-label="画布缩放">
              <IconButton label="缩小画布" icon={<Minus />} onClick={() => editorRef.current?.zoomOut()} />
              <button type="button" className="zoom-readout" aria-label="重置画布缩放" onClick={() => editorRef.current?.zoomReset()}>
                {Math.round(commandState.zoom * 100)}%
              </button>
              <IconButton label="放大画布" icon={<Plus />} onClick={() => editorRef.current?.zoomIn()} />
            </div>
            {currentElements.length === 0 && currentBusbars.length === 0 ? (
              <div className="canvas-empty-guide" aria-hidden="true">
                <strong>{workspaceMode === 'edit' ? '从左侧拖入图元' : '当前图纸暂无监控对象'}</strong>
                <span>{workspaceMode === 'edit' ? '或双击素材插入视口中心' : '切换到编辑模式添加图元与线路'}</span>
              </div>
            ) : null}
            <footer className="status-bar">
              <span>
                网格 {getAdaptiveGridScale(currentDiagram.canvas.gridSize, commandState.zoom).worldStep} px
              </span>
              <span>
                {workspaceMode === 'monitor'
                  ? animationPlaying
                    ? currentLine?.type === 'cooling'
                      ? '正在显示水泵闭合回路运行流向'
                      : '正在显示电力起点 → 终点运行流向'
                    : currentLine?.type === 'cooling'
                      ? '监控模式 · 选择水泵或阀门后在右侧控制运行状态'
                      : '监控模式 · 选择 Switch 后在右侧控制状态'
                  : commandState.wiringType
                  ? `正在接线 · ${commandState.wiringType === 'electrical' ? '电力' : getAnchorTypeLabel(commandState.wiringType)}`
                  : commandState.selectedConnection && commandState.selectedBusbar
                    ? '已选择母线与子线'
                    : commandState.selectedConnection
                      ? '已选择子线'
                    : commandState.selectedBusbar
                      ? '已选择母线'
                    : commandState.selectedJunctionCount
                      ? `已选择 ${commandState.selectedJunctionCount} 个节点`
                    : selectedElements.length
                      ? `已选择 ${selectedElements.length}`
                      : '未选择图元'}
              </span>
              <span className="status-spacer" />
              <span>图纸 ID {currentDiagram.id.slice(0, 12)}</span>
            </footer>
          </div>
        </section>

        {workspaceMode === 'edit' ? <PropertiesPanel
          duplicateDeviceIdentifier={duplicateDeviceIdentifier}
          selectedElements={selectedElements}
          selectedBusbars={selectedBusbars}
          selectedConnection={selectedConnection}
          selectedRouteWaypointCount={commandState.selectedRouteWaypointCount}
          selectedRouteWaypointMaxReferenceCount={
            commandState.selectedRouteWaypointMaxReferenceCount
          }
          selectedJunctionCount={commandState.selectedJunctionCount}
          canvasElements={currentElements}
          canvasBusbars={currentBusbars}
          canvasConnections={currentConnections}
          onOffStates={onOffStates}
          onOnOffStateChange={handleOnOffStateChange}
          onPatch={(elementId, patch) => editorRef.current?.updateElement(elementId, patch)}
          onPatchBusbar={(busbarId, patch) => editorRef.current?.updateBusbar(busbarId, patch)}
          onPatchConnectionEdge={(edgeId, patch) => (
            editorRef.current?.updateConnectionEdge(edgeId, patch)
          )}
          onPatchConnectionEdges={(edgeIds, patch) => (
            editorRef.current?.updateConnectionEdges(edgeIds, patch)
          )}
          onResetConnectionRouting={() => editorRef.current?.resetSelectedConnectionRouting()}
          onColorPreview={(elementId, color, slot) => (
            editorRef.current?.previewElementColor(elementId, color, slot)
          )}
          onSelectionColorPreview={(color) => editorRef.current?.previewSelectionColor(color)}
          onSelectionColorCommit={(color) => editorRef.current?.updateSelectionColor(color)}
          onCanvasColorPreview={(target, color) => (
            editorRef.current?.previewCanvasColor(target, color)
          )}
          onCanvasColorCommit={(target, color) => (
            editorRef.current?.updateCanvasColor(target, color)
          )}
          onDelete={() => editorRef.current?.deleteSelected()}
        /> : <MonitorPropertiesPanel
          selectedElement={selectedMonitorElement}
          asset={selectedMonitorAsset}
          onOff={selectedMonitorElement
            ? onOffStates[selectedMonitorElement.id] ?? false
            : false}
          pumpRunning={selectedMonitorElement
            ? coolingPumpRunningStates[selectedMonitorElement.id] ?? true
            : true}
          pumpOutputPower={selectedMonitorElement
            ? coolingPumpOutputPowerStates[selectedMonitorElement.id] ??
              DEFAULT_COOLING_PUMP_OUTPUT_POWER_PERCENT
            : DEFAULT_COOLING_PUMP_OUTPUT_POWER_PERCENT}
          pumpFlowRate={selectedMonitorElement
            ? coolingFlowTopology.pumpFlowRates[selectedMonitorElement.id] ?? 0
            : 0}
          valveOpen={selectedMonitorElement
            ? coolingValveOpenStates[selectedMonitorElement.id] ?? true
            : true}
          onOnOffChange={(on) => {
            if (selectedMonitorElement) handleOnOffStateChange(selectedMonitorElement.id, on)
          }}
          onPumpRunningChange={(running) => {
            if (selectedMonitorElement) {
              handleCoolingRuntimeStateChange(selectedMonitorElement.id, 'pump', running)
            }
          }}
          onPumpOutputPowerChange={(outputPower) => {
            if (selectedMonitorElement) {
              handleCoolingPumpOutputPowerChange(selectedMonitorElement.id, outputPower)
            }
          }}
          onValveOpenChange={(open) => {
            if (selectedMonitorElement && selectedMonitorAsset?.coolingDeviceRole) {
              handleCoolingRuntimeStateChange(
                selectedMonitorElement.id,
                selectedMonitorAsset.coolingDeviceRole,
                open,
              )
            }
          }}
        />}
      </main>

      {openPanel ? (
        <div className="side-panel-backdrop" role="presentation" onPointerDown={() => setOpenPanel(false)}>
          <aside className="open-project-panel" role="dialog" aria-modal="true" aria-labelledby="open-project-title" onPointerDown={(event) => event.stopPropagation()}>
            <div className="open-project-panel__header">
              <div><small>本地工作区</small><h2 id="open-project-title">打开项目</h2></div>
              <IconButton label="关闭打开项目面板" icon={<X />} variant="neutral-ghost" onClick={() => setOpenPanel(false)} />
            </div>
            <p className="open-project-panel__intro">项目保存在当前浏览器。跨设备使用请导出并导入 JSON。</p>
            <div className="saved-project-list" aria-live="polite">
              {loadingProjects ? <div className="panel-empty">正在读取本地项目…</div> : null}
              {!loadingProjects && !savedProjects.length ? <div className="panel-empty">还没有本地项目，请先保存当前项目。</div> : null}
              {savedProjects.map((summary) => (
                <article className="saved-project" key={summary.id}>
                  <div><strong>{summary.name}</strong><span>保存于 {formatSavedTime(summary.updatedAt)}</span></div>
                  <div>
                    <Button variant="neutral-ghost" onClick={() => void openSavedProject(summary.id)}>打开</Button>
                    <IconButton label={`删除项目 ${summary.name}`} variant="danger-soft" icon={<Trash2 />} onClick={() => deleteSavedProject(summary)} />
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      ) : null}

      {confirmRequest ? <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} /> : null}
      {anchorEditorAssetKey ? (
        <SymbolAnchorEditorDialog
          initialAssetKey={anchorEditorAssetKey}
          assets={document.assets}
          lineSystemType={currentLine?.type ?? 'cooling'}
          onChangeAsset={replaceAssetDefinition}
          onClose={() => setAnchorEditorAssetKey(null)}
        />
      ) : null}
      {toast ? <div className="toast" data-tone={toast.tone} role="status">{toast.message}</div> : null}
    </div>
  )
}
