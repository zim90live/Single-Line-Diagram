import { Redo2, Trash2, Undo2, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import {
  EDITOR_GRID_SIZE,
  type AnchorType,
  type AssetDefinition,
  type CoolingDeviceRole,
  type CoolingFlowRole,
  type LineSystemType,
  type PowerSupplyChannel,
  type SymbolAnchor,
} from '../domain/project'
import {
  ANCHOR_TYPE_OPTIONS,
  constrainAnchorDrag,
  createSymbolAnchor,
  getLegalAnchorPoints,
  getNextAnchorName,
  isAutomaticAnchorName,
  type AnchorPoint,
} from '../editor/anchors'
import { GRID_DOT_SCREEN_RADIUS } from '../scene/gridScale'
import { circuitPaletteStyle, type CircuitPalette } from '../scene/circuitPalette'
import { symbolCatalog, symbolsByKey } from '../scene/symbolCatalog'
import { SymbolBrowser } from './SymbolBrowser'
import { IconButton, SelectField, TextField } from '@aidc/ui'

interface SymbolAnchorEditorDialogProps {
  circuitPalette?: CircuitPalette
  initialAssetKey: string
  assets: AssetDefinition[]
  lineSystemType: LineSystemType
  onChangeAsset: (
    assetKey: string,
    configuration: Pick<AssetDefinition, 'anchors' | 'coolingDeviceRole'>,
  ) => void
  onClose: () => void
}

interface AnchorHistoryEntry {
  assetKey: string
  before: SymbolAnchor[]
  after: SymbolAnchor[]
  roleBefore?: CoolingDeviceRole
  roleAfter?: CoolingDeviceRole
  selectedBefore: string | null
  selectedAfter: string | null
  coalesceKey?: string
}

interface AnchorHistory {
  past: AnchorHistoryEntry[]
  future: AnchorHistoryEntry[]
}

interface DragState {
  pointerId: number
  anchorId: string
  preview: AnchorPoint
}

const HISTORY_LIMIT = 100

function cloneAnchors(anchors: SymbolAnchor[]) {
  return anchors.map((anchor) => ({ ...anchor }))
}

function anchorsEqual(left: SymbolAnchor[], right: SymbolAnchor[]) {
  return left.length === right.length && left.every((anchor, index) => {
    const candidate = right[index]
    return candidate &&
      anchor.id === candidate.id &&
      anchor.name === candidate.name &&
      anchor.x === candidate.x &&
      anchor.y === candidate.y &&
      anchor.direction === candidate.direction &&
      anchor.type === candidate.type &&
      anchor.flowRole === candidate.flowRole &&
      anchor.powerSupplyChannel === candidate.powerSupplyChannel
  })
}

function createAnchorMap(assets: AssetDefinition[]) {
  const documentAssets = new Map(assets.map((asset) => [asset.key, asset]))
  return Object.fromEntries(symbolCatalog.map((symbol) => [
    symbol.key,
    cloneAnchors(documentAssets.get(symbol.key)?.anchors ?? []),
  ])) as Record<string, SymbolAnchor[]>
}

function createCoolingRoleMap(assets: AssetDefinition[]) {
  const documentAssets = new Map(assets.map((asset) => [asset.key, asset]))
  return Object.fromEntries(symbolCatalog.map((symbol) => [
    symbol.key,
    documentAssets.get(symbol.key)?.coolingDeviceRole,
  ])) as Record<string, CoolingDeviceRole | undefined>
}

function clientToWorld(clientX: number, clientY: number, svg: SVGSVGElement) {
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const world = point.matrixTransform(matrix.inverse())
  return { x: world.x, y: world.y }
}

function directionVector(direction: SymbolAnchor['direction']) {
  if (direction === 'top') return { x: 0, y: -1 }
  if (direction === 'right') return { x: 1, y: 0 }
  if (direction === 'bottom') return { x: 0, y: 1 }
  return { x: -1, y: 0 }
}

export function SymbolAnchorEditorDialog({
  initialAssetKey,
  circuitPalette,
  assets,
  lineSystemType,
  onChangeAsset,
  onClose,
}: SymbolAnchorEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const patternId = `anchor-grid-${useId().replace(/:/g, '')}`
  const initialAnchorMap = useMemo(() => createAnchorMap(assets), [])
  const initialCoolingRoleMap = useMemo(() => createCoolingRoleMap(assets), [])
  const anchorsByAssetRef = useRef(initialAnchorMap)
  const coolingRolesByAssetRef = useRef(initialCoolingRoleMap)
  const historyRef = useRef<AnchorHistory>({ past: [], future: [] })
  const [anchorsByAsset, setAnchorsByAsset] = useState(initialAnchorMap)
  const [coolingRolesByAsset, setCoolingRolesByAsset] = useState(initialCoolingRoleMap)
  const [selectedAssetKey, setSelectedAssetKey] = useState(initialAssetKey)
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [message, setMessage] = useState('在图元边缘的网格点单击添加锚点')
  const [, setHistoryVersion] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => returnFocusRef.current?.focus()
  }, [])

  const selectedSymbol = symbolsByKey.get(selectedAssetKey) ?? symbolCatalog[0]
  const isMeasurementPoint = selectedSymbol?.anchorMode === 'measurement-point'
  const selectedAnchors = selectedSymbol
    ? anchorsByAsset[selectedSymbol.key] ?? []
    : []
  const selectedAnchor = selectedAnchors.find((anchor) => anchor.id === selectedAnchorId)
  const legalPoints = useMemo(
    () => selectedSymbol ? getLegalAnchorPoints(selectedSymbol) : [],
    [selectedSymbol],
  )
  const occupiedCoordinates = useMemo(
    () => new Set(selectedAnchors.map((anchor) => `${anchor.x},${anchor.y}`)),
    [selectedAnchors],
  )

  const publishAsset = (
    assetKey: string,
    anchors: SymbolAnchor[],
    coolingDeviceRole?: CoolingDeviceRole,
  ) => {
    const nextAnchors = cloneAnchors(anchors)
    anchorsByAssetRef.current = { ...anchorsByAssetRef.current, [assetKey]: nextAnchors }
    coolingRolesByAssetRef.current = {
      ...coolingRolesByAssetRef.current,
      [assetKey]: coolingDeviceRole,
    }
    setAnchorsByAsset(anchorsByAssetRef.current)
    setCoolingRolesByAsset(coolingRolesByAssetRef.current)
    onChangeAsset(assetKey, { anchors: nextAnchors, coolingDeviceRole })
  }

  const refreshHistory = () => setHistoryVersion((version) => version + 1)

  const commitAsset = (
    assetKey: string,
    nextAnchors: SymbolAnchor[],
    nextRole: CoolingDeviceRole | undefined,
    nextSelectedAnchorId: string | null,
    coalesceKey?: string,
  ) => {
    const before = anchorsByAssetRef.current[assetKey] ?? []
    const roleBefore = coolingRolesByAssetRef.current[assetKey]
    if (anchorsEqual(before, nextAnchors) && roleBefore === nextRole) return

    const history = historyRef.current
    const last = history.past.at(-1)
    if (coalesceKey && last?.coalesceKey === coalesceKey && last.assetKey === assetKey) {
      history.past = [
        ...history.past.slice(0, -1),
        {
          ...last,
          after: cloneAnchors(nextAnchors),
          roleAfter: nextRole,
          selectedAfter: nextSelectedAnchorId,
        },
      ]
    } else {
      history.past = [
        ...history.past.slice(-(HISTORY_LIMIT - 1)),
        {
          assetKey,
          before: cloneAnchors(before),
          after: cloneAnchors(nextAnchors),
          roleBefore,
          roleAfter: nextRole,
          selectedBefore: selectedAnchorId,
          selectedAfter: nextSelectedAnchorId,
          coalesceKey,
        },
      ]
    }
    history.future = []
    publishAsset(assetKey, nextAnchors, nextRole)
    setSelectedAnchorId(nextSelectedAnchorId)
    refreshHistory()
  }

  const commitAnchors = (
    assetKey: string,
    nextAnchors: SymbolAnchor[],
    nextSelectedAnchorId: string | null,
    coalesceKey?: string,
  ) => commitAsset(
    assetKey,
    nextAnchors,
    coolingRolesByAssetRef.current[assetKey],
    nextSelectedAnchorId,
    coalesceKey,
  )

  const undo = () => {
    const entry = historyRef.current.past.at(-1)
    if (!entry) return
    historyRef.current.past = historyRef.current.past.slice(0, -1)
    historyRef.current.future = [entry, ...historyRef.current.future].slice(0, HISTORY_LIMIT)
    publishAsset(entry.assetKey, entry.before, entry.roleBefore)
    setSelectedAssetKey(entry.assetKey)
    setSelectedAnchorId(entry.selectedBefore)
    setMessage('已撤销锚点修改')
    refreshHistory()
  }

  const redo = () => {
    const entry = historyRef.current.future[0]
    if (!entry) return
    historyRef.current.future = historyRef.current.future.slice(1)
    historyRef.current.past = [...historyRef.current.past, entry].slice(-HISTORY_LIMIT)
    publishAsset(entry.assetKey, entry.after, entry.roleAfter)
    setSelectedAssetKey(entry.assetKey)
    setSelectedAnchorId(entry.selectedAfter)
    setMessage('已重做锚点修改')
    refreshHistory()
  }

  const handleSelectAsset = (assetKey: string) => {
    setSelectedAssetKey(assetKey)
    setSelectedAnchorId(null)
    setDragState(null)
    setMessage(symbolsByKey.get(assetKey)?.anchorMode === 'measurement-point'
      ? 'MP 使用固定测量点锚点；旋转图元可改变接线方向'
      : '在图元边缘的网格点单击添加锚点')
  }

  const addAnchor = (point: Pick<AnchorPoint, 'x' | 'y'>) => {
    if (!selectedSymbol) return
    if (isMeasurementPoint) {
      setMessage('MP 只保留一个固定测量点锚点')
      return
    }
    try {
      const anchor = createSymbolAnchor(
        { ...selectedSymbol, anchors: selectedAnchors },
        point,
        lineSystemType,
      )
      commitAnchors(selectedSymbol.key, [...selectedAnchors, anchor], anchor.id)
      setMessage(`已添加“${anchor.name}”`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法在该位置添加锚点。')
    }
  }

  const updateSelectedAnchor = (
    updater: (anchor: SymbolAnchor) => SymbolAnchor,
    coalesceKey?: string,
  ) => {
    if (!selectedSymbol || !selectedAnchor) return
    const next = selectedAnchors.map((anchor) =>
      anchor.id === selectedAnchor.id ? updater(anchor) : anchor,
    )
    commitAnchors(selectedSymbol.key, next, selectedAnchor.id, coalesceKey)
  }

  const normalizeSelectedName = () => {
    if (!selectedAnchor) return
    const trimmed = selectedAnchor.name.trim()
    if (trimmed) {
      if (trimmed !== selectedAnchor.name) {
        updateSelectedAnchor(
          (anchor) => ({ ...anchor, name: trimmed }),
          `${selectedSymbol.key}:${selectedAnchor.id}:name`,
        )
      }
      return
    }
    const peers = selectedAnchors.filter((anchor) => anchor.id !== selectedAnchor.id)
    updateSelectedAnchor(
      (anchor) => ({ ...anchor, name: getNextAnchorName(peers, anchor.type) }),
      `${selectedSymbol.key}:${selectedAnchor.id}:name`,
    )
  }

  const closeEditor = () => {
    normalizeSelectedName()
    onClose()
  }

  const changeSelectedType = (type: AnchorType) => {
    if (!selectedAnchor) return
    if (isMeasurementPoint) {
      setMessage('MP 测量点固定使用通用冷却类型，可连接任意冷却管路')
      return
    }
    const peers = selectedAnchors.filter((anchor) => anchor.id !== selectedAnchor.id)
    const shouldRename = isAutomaticAnchorName(selectedAnchor.name, selectedAnchor.type)
    updateSelectedAnchor((anchor) => {
      const {
        flowRole: _flowRole,
        powerSupplyChannel: _powerSupplyChannel,
        ...withoutRoles
      } = anchor
      return {
        ...withoutRoles,
        type,
        ...(type !== 'electrical' && anchor.flowRole ? { flowRole: anchor.flowRole } : {}),
        ...(type === 'electrical' && anchor.powerSupplyChannel
          ? { powerSupplyChannel: anchor.powerSupplyChannel }
          : {}),
        name: shouldRename ? getNextAnchorName(peers, type) : anchor.name,
      }
    })
    setMessage(`锚点类型已改为${ANCHOR_TYPE_OPTIONS.find((option) => option.value === type)?.label}`)
  }

  const changeCoolingDeviceRole = (role?: CoolingDeviceRole) => {
    if (!selectedSymbol) return
    if (isMeasurementPoint) {
      setMessage('MP 是只读测量传感器，不参与水泵或阀门控制')
      return
    }
    const nextAnchors = role === 'pump' || role === 'check-valve'
      ? selectedAnchors
      : selectedAnchors.map((anchor) => {
          const { flowRole: _flowRole, ...withoutFlowRole } = anchor
          return withoutFlowRole
        })
    commitAsset(selectedSymbol.key, nextAnchors, role, selectedAnchorId)
    setMessage(role === 'pump'
      ? '已设为水泵，请配置唯一入口和出口'
      : role === 'check-valve'
        ? '已设为止回阀，请配置唯一入口和出口；开启后仅允许入口流向出口'
      : role === 'valve'
        ? '已设为阀门，监控模式可切换开关状态'
        : '已设为普通设备')
  }

  const changeSelectedFlowRole = (flowRole?: CoolingFlowRole) => {
    if (!selectedSymbol || !selectedAnchor || selectedAnchor.type === 'electrical') return
    const nextAnchors = selectedAnchors.map((anchor) => {
      const { flowRole: _previousFlowRole, ...withoutFlowRole } = anchor
      if (anchor.id === selectedAnchor.id) {
        return { ...withoutFlowRole, ...(flowRole ? { flowRole } : {}) }
      }
      return anchor.flowRole === flowRole
        ? withoutFlowRole
        : anchor
    })
    commitAnchors(selectedSymbol.key, nextAnchors, selectedAnchor.id)
    setMessage(flowRole ? `已设为${flowRole === 'inlet' ? '入口' : '出口'}` : '已清除端口角色')
  }

  const changeSelectedPowerSupplyChannel = (channel?: PowerSupplyChannel) => {
    if (!selectedSymbol || !selectedAnchor || selectedAnchor.type !== 'electrical') return
    const nextAnchors = selectedAnchors.map((anchor) => {
      const { powerSupplyChannel: _previousChannel, ...withoutChannel } = anchor
      if (anchor.id === selectedAnchor.id) {
        return { ...withoutChannel, ...(channel ? { powerSupplyChannel: channel } : {}) }
      }
      return anchor.powerSupplyChannel === channel ? withoutChannel : anchor
    })
    commitAnchors(selectedSymbol.key, nextAnchors, selectedAnchor.id)
    setMessage(channel ? `已设为 ${channel.toUpperCase()} 路输入` : '已清除供电输入角色')
  }

  const deleteSelectedAnchor = () => {
    if (!selectedSymbol || !selectedAnchor) return
    if (isMeasurementPoint) {
      setMessage('MP 必须保留一个测量点锚点')
      return
    }
    commitAnchors(
      selectedSymbol.key,
      selectedAnchors.filter((anchor) => anchor.id !== selectedAnchor.id),
      null,
    )
    setMessage(`已删除“${selectedAnchor.name}”`)
  }

  const startAnchorDrag = (event: PointerEvent<SVGCircleElement>, anchor: SymbolAnchor) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (isMeasurementPoint) {
      setSelectedAnchorId(anchor.id)
      setMessage('MP 测量点位置固定；旋转图元可改变接线方向')
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedAnchorId(anchor.id)
    setDragState({
      pointerId: event.pointerId,
      anchorId: anchor.id,
      preview: { x: anchor.x, y: anchor.y, direction: anchor.direction },
    })
  }

  const moveAnchorDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId || !selectedSymbol) return
    const world = clientToWorld(event.clientX, event.clientY, event.currentTarget)
    const anchor = selectedAnchors.find((candidate) => candidate.id === dragState.anchorId)
    if (!world || !anchor) return
    setDragState({
      ...dragState,
      preview: constrainAnchorDrag(anchor, world, selectedSymbol),
    })
  }

  const finishAnchorDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId || !selectedSymbol) return
    const anchor = selectedAnchors.find((candidate) => candidate.id === dragState.anchorId)
    const duplicate = selectedAnchors.some((candidate) =>
      candidate.id !== dragState.anchorId &&
      candidate.x === dragState.preview.x &&
      candidate.y === dragState.preview.y,
    )
    if (anchor && duplicate) {
      setMessage('该位置已有锚点。')
    } else if (anchor && (anchor.x !== dragState.preview.x || anchor.y !== dragState.preview.y)) {
      commitAnchors(
        selectedSymbol.key,
        selectedAnchors.map((candidate) => candidate.id === anchor.id
          ? { ...candidate, ...dragState.preview }
          : candidate),
        anchor.id,
      )
      setMessage(`锚点已移动到 ${dragState.preview.x}, ${dragState.preview.y}`)
    }
    setDragState(null)
  }

  const handleCanvasClick = (event: PointerEvent<SVGSVGElement>) => {
    const target = event.target as Element
    if (event.target !== event.currentTarget && !target.classList?.contains('anchor-editor__canvas-background')) return
    const world = clientToWorld(event.clientX, event.clientY, event.currentTarget)
    if (!world || !selectedSymbol) return
    if (isMeasurementPoint) {
      setMessage('MP 只保留一个固定测量点锚点')
      return
    }
    const x = Math.round(world.x / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE
    const y = Math.round(world.y / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE
    const isCorner =
      (x === 0 || x === selectedSymbol.intrinsicWidth) &&
      (y === 0 || y === selectedSymbol.intrinsicHeight)
    setMessage(isCorner ? '角点不能添加锚点。' : '锚点只能位于图元边缘的 8px 网格点。')
  }

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    const target = event.target
    const isField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    const modifier = event.ctrlKey || event.metaKey
    if (!isField && modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    } else if (!isField && modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
    } else if (!isField && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      deleteSelectedAnchor()
    }
  }

  if (!selectedSymbol) return null

  const padding = 64
  const viewBox = [
    -padding,
    -padding,
    selectedSymbol.intrinsicWidth + padding * 2,
    selectedSymbol.intrinsicHeight + padding * 2,
  ].join(' ')
  const displayedAnchors = selectedAnchors.map((anchor) => {
    if (dragState?.anchorId !== anchor.id) return anchor
    return { ...anchor, ...dragState.preview }
  })
  const history = historyRef.current
  const coolingDeviceRole = coolingRolesByAsset[selectedSymbol.key]
  const canConfigureCoolingRole = selectedSymbol.category === '冷却' &&
    selectedSymbol.key !== 'cv' && !isMeasurementPoint
  const requiresDirectedPorts = coolingDeviceRole === 'pump' || coolingDeviceRole === 'check-valve'
  const inletCount = selectedAnchors.filter((anchor) => anchor.flowRole === 'inlet').length
  const outletCount = selectedAnchors.filter((anchor) => anchor.flowRole === 'outlet').length
  const powerSupplyChannelCount = selectedAnchors.filter((anchor) => (
    anchor.powerSupplyChannel
  )).length

  return (
    <dialog
      ref={dialogRef}
      className="anchor-editor-dialog"
      style={circuitPaletteStyle(circuitPalette)}
      aria-labelledby="anchor-editor-title"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        closeEditor()
      }}
      onKeyDown={handleDialogKeyDown}
    >
      <header className="anchor-editor-dialog__header">
        <div>
          <small>图元资产</small>
          <h2 id="anchor-editor-title">接线锚点编辑器</h2>
        </div>
        <IconButton
          label="关闭图元编辑器"
          icon={<X />}
          variant="neutral-ghost"
          onClick={closeEditor}
        />
      </header>

      <div className="anchor-editor-dialog__body">
        <aside className="anchor-editor-dialog__library">
          <SymbolBrowser
            idPrefix="anchor-editor"
            mode="select"
            selectedKey={selectedSymbol.key}
            onSelect={handleSelectAsset}
          />
        </aside>

        <section className="anchor-editor" aria-label={`${selectedSymbol.name}锚点编辑区`}>
          <div className="anchor-editor__toolbar">
            <div className="anchor-editor__identity">
              <strong>{selectedSymbol.name}</strong>
              <span>{selectedSymbol.intrinsicWidth} × {selectedSymbol.intrinsicHeight} · {selectedAnchors.length} 个锚点</span>
            </div>
            <div className="anchor-editor__fields">
              <SelectField
                label="冷却设备角色"
                hideLabel
                containerClassName="anchor-editor__role-field"
                value={coolingDeviceRole ?? ''}
                disabled={!canConfigureCoolingRole}
                onChange={(event) => changeCoolingDeviceRole(
                  event.target.value ? event.target.value as CoolingDeviceRole : undefined,
                )}
              >
                <option value="">普通设备</option>
                <option value="pump">水泵</option>
                <option value="valve">阀门</option>
                <option value="check-valve">止回阀（单向）</option>
              </SelectField>
              <TextField
                label="锚点名称"
                hideLabel
                containerClassName="anchor-editor__name-field"
                value={selectedAnchor?.name ?? ''}
                disabled={!selectedAnchor || isMeasurementPoint}
                placeholder="选择锚点后编辑名称"
                onChange={(event) => {
                  const value = event.target.value
                  if (!selectedAnchor) return
                  updateSelectedAnchor(
                    (anchor) => ({ ...anchor, name: value }),
                    `${selectedSymbol.key}:${selectedAnchor.id}:name`,
                  )
                }}
                onBlur={normalizeSelectedName}
              />
              <SelectField
                label="锚点类型"
                hideLabel
                containerClassName="anchor-editor__type-field"
                value={selectedAnchor?.type ?? 'electrical'}
                disabled={!selectedAnchor}
                onChange={(event) => changeSelectedType(event.target.value as AnchorType)}
              >
                {ANCHOR_TYPE_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </SelectField>
              <SelectField
                label="水流端口角色"
                hideLabel
                containerClassName="anchor-editor__flow-role-field"
                value={selectedAnchor?.flowRole ?? ''}
                disabled={
                  !requiresDirectedPorts ||
                  !selectedAnchor ||
                  selectedAnchor.type === 'electrical'
                }
                onChange={(event) => changeSelectedFlowRole(
                  event.target.value ? event.target.value as CoolingFlowRole : undefined,
                )}
              >
                <option value="">未指定端口</option>
                <option value="inlet">入口</option>
                <option value="outlet">出口</option>
              </SelectField>
              <SelectField
                label="供电输入角色"
                hideLabel
                containerClassName="anchor-editor__power-role-field"
                value={selectedAnchor?.powerSupplyChannel ?? ''}
                disabled={
                  lineSystemType !== 'power' ||
                  !selectedAnchor ||
                  selectedAnchor.type !== 'electrical'
                }
                onChange={(event) => changeSelectedPowerSupplyChannel(
                  event.target.value
                    ? event.target.value as PowerSupplyChannel
                    : undefined,
                )}
              >
                <option value="">普通电力端口</option>
                <option value="a">A 路输入</option>
                <option value="b">B 路输入</option>
              </SelectField>
            </div>
            <div className="anchor-editor__commands" aria-label="锚点编辑命令">
              <IconButton
                label="撤销锚点修改"
                icon={<Undo2 />}
                disabled={!history.past.length}
                onClick={undo}
              />
              <IconButton
                label="重做锚点修改"
                icon={<Redo2 />}
                disabled={!history.future.length}
                onClick={redo}
              />
              <span className="toolbar-divider" />
              <IconButton
                label="删除所选锚点"
                icon={<Trash2 />}
                variant="danger-soft"
                disabled={!selectedAnchor || isMeasurementPoint}
                onClick={deleteSelectedAnchor}
              />
            </div>
          </div>

          <div className="anchor-editor__canvas-frame">
            {isMeasurementPoint ? (
              <div className="anchor-editor__role-diagnostic" role="status">
                MP 是温度、压力与流量测量点，只保留一个通用冷却锚点；从该锚点接到既有管路即可，图元不会形成入口或出口。
              </div>
            ) : null}
            {requiresDirectedPorts && (inletCount !== 1 || outletCount !== 1) ? (
              <div className="anchor-editor__role-diagnostic" role="status">
                {coolingDeviceRole === 'pump'
                  ? '水泵需要配置一个入口和一个出口；配置完成前不会驱动监控动画。'
                  : '止回阀需要配置一个入口和一个出口；配置完成前不会允许水流通过。'}
              </div>
            ) : null}
            {powerSupplyChannelCount === 1 ? (
              <div className="anchor-editor__role-diagnostic" role="status">
                双路受电设备需要各配置一个 A 路输入和 B 路输入；A 路可用时自动优先。
              </div>
            ) : null}
            <svg
              ref={svgRef}
              className="anchor-editor__canvas"
              data-testid="anchor-editor-canvas"
              data-grid-size={EDITOR_GRID_SIZE}
              data-selected-asset={selectedSymbol.key}
              viewBox={viewBox}
              aria-label={`${selectedSymbol.name} 8px 锚点网格`}
              onClick={handleCanvasClick}
              onPointerMove={moveAnchorDrag}
              onPointerUp={finishAnchorDrag}
              onPointerCancel={() => setDragState(null)}
            >
              <defs>
                <pattern
                  id={patternId}
                  width={EDITOR_GRID_SIZE}
                  height={EDITOR_GRID_SIZE}
                  patternUnits="userSpaceOnUse"
                >
                  <circle className="anchor-grid-dot" cx="0" cy="0" r={GRID_DOT_SCREEN_RADIUS} />
                </pattern>
              </defs>
              <rect
                className="anchor-editor__canvas-background"
                x={-padding}
                y={-padding}
                width={selectedSymbol.intrinsicWidth + padding * 2}
                height={selectedSymbol.intrinsicHeight + padding * 2}
                fill={`url(#${patternId})`}
              />
              <image
                className="anchor-editor__symbol-image"
                href={selectedSymbol.url}
                x="0"
                y="0"
                width={selectedSymbol.intrinsicWidth}
                height={selectedSymbol.intrinsicHeight}
                preserveAspectRatio="xMidYMid meet"
              />
              <rect
                className="anchor-editor__symbol-boundary"
                x="0"
                y="0"
                width={selectedSymbol.intrinsicWidth}
                height={selectedSymbol.intrinsicHeight}
              />

              {!isMeasurementPoint && legalPoints.filter((point) => !occupiedCoordinates.has(`${point.x},${point.y}`)).map((point) => (
                <circle
                  className="anchor-candidate"
                  key={`${point.x}-${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r="2.4"
                  role="button"
                  tabIndex={0}
                  aria-label={`在 ${point.x}, ${point.y} 添加锚点`}
                  onClick={(event) => {
                    event.stopPropagation()
                    addAnchor(point)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      addAnchor(point)
                    }
                  }}
                />
              ))}

              {displayedAnchors.map((anchor) => {
                const vector = directionVector(anchor.direction)
                return (
                  <g
                    className="anchor-node"
                    data-anchor-type={anchor.type}
                    data-flow-role={anchor.flowRole}
                    data-power-supply-channel={anchor.powerSupplyChannel}
                    data-selected={anchor.id === selectedAnchorId || undefined}
                    key={anchor.id}
                  >
                    <line
                      className="anchor-node__direction"
                      x1={anchor.x}
                      y1={anchor.y}
                      x2={anchor.x + vector.x * 7}
                      y2={anchor.y + vector.y * 7}
                    />
                    <circle
                      className="anchor-node__point"
                      cx={anchor.x}
                      cy={anchor.y}
                      r="3.6"
                      role="button"
                      tabIndex={0}
                      aria-label={`${anchor.name}，${anchor.x}, ${anchor.y}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedAnchorId(anchor.id)
                        setMessage(`已选择“${anchor.name}”`)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedAnchorId(anchor.id)
                        }
                      }}
                      onPointerDown={(event) => startAnchorDrag(event, anchor)}
                    >
                    {anchor.flowRole || anchor.powerSupplyChannel ? (
                      <title>{anchor.flowRole
                        ? anchor.flowRole === 'inlet' ? '入口' : '出口'
                        : `${anchor.powerSupplyChannel!.toUpperCase()} 路输入`}</title>
                    ) : null}
                    </circle>
                    {anchor.flowRole || anchor.powerSupplyChannel ? (
                      <text
                        className="anchor-node__flow-role"
                        x={anchor.x - vector.x * 12}
                        y={anchor.y - vector.y * 12}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {anchor.flowRole
                          ? anchor.flowRole === 'inlet' ? '入口' : '出口'
                          : anchor.powerSupplyChannel!.toUpperCase()}
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </svg>
            <div className="anchor-editor__canvas-message" aria-live="polite">{message}</div>
          </div>
        </section>
      </div>
    </dialog>
  )
}
