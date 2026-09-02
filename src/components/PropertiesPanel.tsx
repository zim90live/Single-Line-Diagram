import { RotateCcw, Trash2 } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  EDITOR_GRID_SIZE,
  type AnchorType,
  type Busbar,
  type ConnectionEdge,
  type ConnectionNetwork,
  type DiagramElement,
} from '../domain/project'
import {
  collectCanvasColorGroups,
  type CanvasColorCategory,
  type CanvasColorTarget,
} from '../editor/canvasColors'
import { isCoolingConnectionType } from '../editor/connectionAppearance'
import {
  DEFAULT_BUSBAR_COLOR,
  defaultConnectionColor,
  hexToHsv,
  hsvToHex,
  isHexColor,
  normalizeHexColor,
} from '../editor/objectColors'
import {
  GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY,
  GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR,
  GENERIC_SYMBOL_MIN_HEIGHT,
  GENERIC_SYMBOL_MIN_WIDTH,
  isGenericSymbolKey,
  resolvedGenericSymbolBackgroundColor,
} from '../editor/genericSymbol'
import {
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  symbolSupportsOnOffState,
  getScaledSymbolSize,
  getSymbolScaleStep,
  normalizeSymbolColor,
  resolvedSymbolColorForSlot,
  symbolColorPropertyKey,
  symbolsByKey,
  type SymbolColorSlot,
} from '../editor/symbolCatalog'
import { Button, NumericField, SelectField, TextField } from './ui'
import { MonitorMetricsEditor } from './MonitorMetricsEditor'

interface PropertiesPanelProps {
  selectedElements: DiagramElement[]
  duplicateDeviceIdentifier?: boolean
  selectedBusbars: Busbar[]
  selectedConnection: {
    id: string
    type: AnchorType
    edges: ConnectionEdge[]
    edgeTypes?: Record<string, AnchorType>
    isNetwork?: boolean
  } | null
  selectedRouteWaypointCount?: number
  selectedRouteWaypointMaxReferenceCount?: number
  selectedJunctionCount?: number
  canvasElements?: DiagramElement[]
  canvasBusbars?: Busbar[]
  canvasConnections?: ConnectionNetwork[]
  onPatch: (elementId: string, patch: Partial<DiagramElement>) => void
  onPatchBusbar?: (busbarId: string, patch: Partial<Busbar>) => void
  onPatchConnectionEdge?: (edgeId: string, patch: Partial<ConnectionEdge>) => void
  onPatchConnectionEdges?: (edgeIds: string[], patch: Partial<ConnectionEdge>) => void
  onResetConnectionRouting?: () => void
  onOffStates?: Record<string, boolean>
  onOnOffStateChange?: (elementId: string, on: boolean) => void
  onColorPreview: (
    elementId: string,
    color: string | null,
    slot?: SymbolColorSlot,
  ) => void
  onSelectionColorPreview: (color: string | null) => void
  onSelectionColorCommit: (color: string | null) => void
  onCanvasColorPreview?: (target: CanvasColorTarget, color: string | null) => void
  onCanvasColorCommit?: (target: CanvasColorTarget, color: string) => void
  onDelete: () => void
}

function CommittedTextField({
  label,
  value,
  placeholder,
  hint,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  hint?: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (next !== value) onCommit(next)
  }
  return (
    <TextField
      label={label}
      value={draft}
      placeholder={placeholder}
      hint={hint}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function PropertyToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="property-toggle">
      <div className="property-toggle__copy">
        <span>{label}</span>
        <small>{description}</small>
      </div>
      <button
        type="button"
        className="property-toggle__control"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  )
}

function CommittedColorField({
  selectionKey,
  label,
  value,
  fallback,
  hasCustomColor,
  mixed = false,
  onPreview,
  onCommit,
  onRestore,
  initiallyOpen = false,
  onPickerClose,
}: {
  selectionKey: string
  label: string
  value: string
  fallback: string
  hasCustomColor: boolean
  mixed?: boolean
  onPreview: (color: string | null) => void
  onCommit: (color: string) => void
  onRestore: () => void
  initiallyOpen?: boolean
  onPickerClose?: () => void
}) {
  const [draft, setDraft] = useState(value)
  const [pickerOpen, setPickerOpen] = useState(initiallyOpen)
  const [showMixed, setShowMixed] = useState(mixed)
  const draftRef = useRef(value)
  const committedRef = useRef(value)

  useEffect(() => {
    setDraft(value)
    setPickerOpen(initiallyOpen)
    setShowMixed(mixed)
    draftRef.current = value
    committedRef.current = value
  }, [initiallyOpen, mixed, selectionKey, value])

  useEffect(() => () => onPreview(null), [selectionKey])

  const preview = (rawColor: string) => {
    const color = normalizeHexColor(rawColor, fallback)
    setShowMixed(false)
    draftRef.current = color
    setDraft(color)
    onPreview(color)
    return color
  }

  const commit = (rawColor: string) => {
    const color = preview(rawColor)
    if (color === committedRef.current) {
      onPreview(null)
      return
    }
    committedRef.current = color
    onCommit(color)
  }

  const resetDraft = () => {
    const color = committedRef.current
    draftRef.current = color
    setDraft(color)
    setShowMixed(mixed)
    onPreview(null)
  }

  const closePicker = (confirm: boolean) => {
    if (confirm && !showMixed && isHexColor(draftRef.current)) commit(draftRef.current)
    else resetDraft()
    setPickerOpen(false)
    onPickerClose?.()
  }

  const hsv = hexToHsv(
    isHexColor(draftRef.current) ? draftRef.current : committedRef.current,
    fallback,
  )

  const previewSpectrumPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const saturation = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const brightness = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height))
    preview(hsvToHex({ h: hsv.h, s: saturation, v: brightness }))
  }

  return (
    <div className="property-color-field">
      <div className="property-color-field__heading">
        <span>{label}</span>
        {hasCustomColor ? (
          <Button
            variant="neutral-ghost"
            leadingIcon={<RotateCcw />}
            onClick={() => {
              onPreview(null)
              onRestore()
            }}
          >
            恢复默认
          </Button>
        ) : null}
      </div>
      <div className="property-color-field__control">
        <button
          type="button"
          className="property-color-field__swatch-button"
          aria-label={`打开${label}选择器`}
          aria-expanded={pickerOpen}
          onClick={() => {
            if (pickerOpen) closePicker(true)
            else setPickerOpen(true)
          }}
        >
          <span
            className="property-color-field__swatch"
            style={{ backgroundColor: draft }}
            aria-hidden="true"
          />
        </button>
        <span className="property-color-field__mode">{showMixed ? 'HEX · 多值' : 'HEX'}</span>
        <input
          className="property-color-field__hex"
          aria-label={`${label} HEX`}
          inputMode="text"
          maxLength={7}
          spellCheck={false}
          value={showMixed ? '' : draft}
          placeholder={mixed ? '多种颜色' : '#000000'}
          onChange={(event) => {
            const next = event.currentTarget.value.toUpperCase()
            setShowMixed(false)
            draftRef.current = next
            setDraft(next)
            if (isHexColor(next)) onPreview(normalizeHexColor(next, fallback))
          }}
          onBlur={() => {
            if (isHexColor(draftRef.current)) commit(draftRef.current)
            else {
              draftRef.current = committedRef.current
              setDraft(committedRef.current)
              onPreview(null)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              draftRef.current = committedRef.current
              setDraft(committedRef.current)
              onPreview(null)
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      {pickerOpen ? (
        <div
          className="property-color-picker"
          role="group"
          aria-label={`${label} HEX 选择器`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closePicker(false)
            }
          }}
        >
          <div
            className="property-color-picker__spectrum"
            aria-label={`${label} 饱和度与亮度`}
            role="application"
            style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              previewSpectrumPoint(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                previewSpectrumPoint(event)
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
          >
            <span
              className="property-color-picker__marker"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <label className="property-color-picker__hue">
            <span>色相</span>
            <input
              aria-label={`${label} 色相`}
              type="range"
              min="0"
              max="359"
              value={Math.round(hsv.h)}
              onChange={(event) => preview(hsvToHex({
                ...hsv,
                h: Number(event.currentTarget.value),
              }))}
            />
          </label>
          <label className="property-color-picker__hex-field">
            <span>HEX</span>
            <input
              aria-label={`${label} 选择器 HEX`}
              maxLength={7}
              spellCheck={false}
              value={showMixed ? '' : draft}
              placeholder={mixed ? '多种颜色' : '#000000'}
              onChange={(event) => {
                const next = event.currentTarget.value.toUpperCase()
                setShowMixed(false)
                draftRef.current = next
                setDraft(next)
                if (isHexColor(next)) onPreview(normalizeHexColor(next, fallback))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') closePicker(true)
              }}
            />
          </label>
          <div className="property-color-picker__actions">
            <Button variant="neutral-ghost" onClick={() => closePicker(false)}>取消</Button>
            <Button variant="primary-solid" onClick={() => closePicker(true)}>完成</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const canvasColorSections: Array<{
  category: CanvasColorCategory
  label: string
  emptyLabel: string
  unit: string
}> = [
  { category: 'element', label: '图元', emptyLabel: '无可改色图元', unit: '个' },
  { category: 'busbar', label: '母线', emptyLabel: '无母线', unit: '条' },
  { category: 'connection', label: '子线', emptyLabel: '无子线', unit: '条' },
]

function canvasColorTargetKey(target: CanvasColorTarget) {
  return [
    target.category,
    target.elementAssetKey ?? 'all',
    target.elementColorSlot ?? 'default',
    target.color,
  ].join(':')
}

function CanvasColorOverview({
  elements,
  busbars,
  connections,
  onPreview,
  onCommit,
}: {
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  onPreview: (target: CanvasColorTarget, color: string | null) => void
  onCommit: (target: CanvasColorTarget, color: string) => void
}) {
  const groups = useMemo(
    () => collectCanvasColorGroups(elements, busbars, connections),
    [busbars, connections, elements],
  )
  const [activeKey, setActiveKey] = useState<string | null>(null)

  return (
    <div className="canvas-color-overview">
      <p className="canvas-color-overview__intro">
        点击颜色，替换当前画布中同类同色对象。
      </p>
      {canvasColorSections.map((section) => {
        const colorGroups = groups[section.category]
        return (
          <section
            className="canvas-color-overview__section"
            aria-labelledby={`canvas-color-${section.category}`}
            key={section.category}
          >
            <div className="canvas-color-overview__section-heading">
              <h3 id={`canvas-color-${section.category}`}>{section.label}</h3>
              <span>{colorGroups.length} 种</span>
            </div>
            {colorGroups.length ? (
              <div className="canvas-color-overview__list">
                {colorGroups.map((group) => {
                  const key = canvasColorTargetKey(group)
                  const active = activeKey === key
                  const targetLabel = group.scopeLabel
                    ? `${section.label} ${group.scopeLabel}`
                    : section.label
                  return (
                    <div className="canvas-color-overview__item" key={key}>
                      <button
                        type="button"
                        className="canvas-color-overview__color-button"
                        aria-label={`全局修改${targetLabel}颜色 ${group.color}`}
                        aria-expanded={active}
                        onClick={() => setActiveKey(active ? null : key)}
                      >
                        <span
                          className="canvas-color-overview__swatch"
                          style={{ backgroundColor: group.color }}
                          aria-hidden="true"
                        />
                        <span className="canvas-color-overview__value">
                          {group.scopeLabel ? <small>{group.scopeLabel}</small> : null}
                          <code>{group.color}</code>
                        </span>
                        <span>{group.count} {section.unit}</span>
                      </button>
                      {active ? (
                        <CommittedColorField
                          selectionKey={`canvas:${key}`}
                          label={`全局替换${targetLabel}颜色`}
                          value={group.color}
                          fallback={group.color}
                          hasCustomColor={false}
                          initiallyOpen
                          onPreview={(color) => onPreview(group, color)}
                          onCommit={(color) => {
                            onCommit(group, color)
                            setActiveKey(null)
                          }}
                          onRestore={() => undefined}
                          onPickerClose={() => setActiveKey(null)}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span className="canvas-color-overview__empty">{section.emptyLabel}</span>
            )}
          </section>
        )
      })}
    </div>
  )
}

export function PropertiesPanel({
  selectedElements,
  duplicateDeviceIdentifier = false,
  selectedBusbars,
  selectedConnection,
  selectedRouteWaypointCount = 0,
  selectedRouteWaypointMaxReferenceCount = 0,
  selectedJunctionCount = 0,
  canvasElements = [],
  canvasBusbars = [],
  canvasConnections = [],
  onPatch,
  onPatchBusbar = () => undefined,
  onPatchConnectionEdge = () => undefined,
  onPatchConnectionEdges = () => undefined,
  onResetConnectionRouting = () => undefined,
  onOffStates = {},
  onOnOffStateChange = () => undefined,
  onColorPreview,
  onSelectionColorPreview,
  onSelectionColorCommit,
  onCanvasColorPreview = () => undefined,
  onCanvasColorCommit = () => undefined,
  onDelete,
}: PropertiesPanelProps) {
  if (
    selectedElements.length === 0 &&
    selectedBusbars.length === 0 &&
    selectedConnection === null &&
    selectedRouteWaypointCount === 0 &&
    selectedJunctionCount === 0
  ) {
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>画布颜色</span>
        </div>
        <CanvasColorOverview
          elements={canvasElements}
          busbars={canvasBusbars}
          connections={canvasConnections}
          onPreview={onCanvasColorPreview}
          onCommit={onCanvasColorCommit}
        />
      </aside>
    )
  }

  if (
    selectedConnection === null &&
    selectedJunctionCount > 0 &&
    selectedRouteWaypointCount === 0 &&
    selectedElements.length === 0 &&
    selectedBusbars.length === 0
  ) {
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>{selectedJunctionCount} 个节点</span>
        </div>
        <div className="multi-selection-summary">
          <strong>线路节点</strong>
          <p>双击可继续接线；删除二连节点会恢复局部自动布线，删除三连及以上节点会移除相关连线。</p>
          <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除节点</Button>
        </div>
      </aside>
    )
  }

  if (
    selectedConnection === null &&
    selectedRouteWaypointCount > 0 &&
    selectedElements.length === 0 &&
    selectedBusbars.length === 0
  ) {
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>{selectedRouteWaypointMaxReferenceCount > 1
            ? `共享节点 · ${selectedRouteWaypointMaxReferenceCount} 条子线`
            : `${selectedRouteWaypointCount} 个节点`}</span>
        </div>
        <div className="multi-selection-summary">
          <strong>线路节点</strong>
          <p>双击可继续接线；共享节点的移动或删除会同步作用于所有引用子线。</p>
          <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除节点</Button>
        </div>
      </aside>
    )
  }

  if (
    selectedElements.length === 0 &&
    (selectedBusbars.length > 0 || selectedConnection !== null)
  ) {
    const connectionColors = selectedConnection?.edges.map((edge) => {
      const type = selectedConnection.edgeTypes?.[edge.id] ?? selectedConnection.type
      const fallback = defaultConnectionColor(type)
      return normalizeHexColor(edge.color ?? fallback, fallback)
    }) ?? []
    const busbarColors = selectedBusbars.map((busbar) => (
      normalizeHexColor(busbar.color ?? DEFAULT_BUSBAR_COLOR, DEFAULT_BUSBAR_COLOR)
    ))
    const resolvedColors = [...busbarColors, ...connectionColors]
    const selectionColor = resolvedColors[0] ?? DEFAULT_BUSBAR_COLOR
    const mixed = resolvedColors.some((color) => color !== selectionColor)
    const hasCustomColor = (
      selectedBusbars.some((busbar) => busbar.color !== undefined) ||
      selectedConnection?.edges.some((edge) => edge.color !== undefined) === true
    )
    const busbarCount = selectedBusbars.length
    const connectionCount = selectedConnection?.edges.length ?? 0
    const connectionFlowDirections = selectedConnection?.edges.map((edge) => (
      edge.flowDirection ?? 'bidirectional'
    )) ?? []
    const selectionFlowDirection = connectionFlowDirections[0] ?? 'bidirectional'
    const mixedFlowDirection = connectionFlowDirections.some((direction) => (
      direction !== selectionFlowDirection
    ))
    const connectionCrossingLayers = selectedConnection?.edges.map((edge) => (
      edge.crossingLayer ?? 'auto'
    )) ?? []
    const selectionCrossingLayer = connectionCrossingLayers[0] ?? 'auto'
    const mixedCrossingLayer = connectionCrossingLayers.some((layer) => (
      layer !== selectionCrossingLayer
    ))
    const connectionCoolingLineRoles = selectedConnection?.edges.map((edge) => (
      edge.coolingLineRole ?? 'primary'
    )) ?? []
    const selectionCoolingLineRole = connectionCoolingLineRoles[0] ?? 'primary'
    const mixedCoolingLineRole = connectionCoolingLineRoles.some((role) => (
      role !== selectionCoolingLineRole
    ))
    const allSelectedConnectionsCooling = connectionCount > 0 &&
      selectedConnection!.edges.every((edge) => isCoolingConnectionType(
        selectedConnection!.edgeTypes?.[edge.id] ?? selectedConnection!.type,
      ))
    const combined = busbarCount > 0 && connectionCount > 0
    const isNetworkSelection = selectedConnection?.isNetwork ?? connectionCount > 1
    const selectedLogicalConnectionIds = new Set(selectedConnection?.edges.flatMap((edge) => (
      edge.logicalConnectionId ? [edge.logicalConnectionId] : []
    )) ?? [])
    const resettableLogicalConnectionIds = new Set<string>()
    canvasConnections?.forEach((network) => network.nodes.forEach((node) => {
      if (node.kind !== 'node') return
      const incidentEdges = network.edges.filter((edge) => (
        edge.sourceNodeId === node.id || edge.targetNodeId === node.id
      ))
      const logicalConnectionId = incidentEdges[0]?.logicalConnectionId
      if (
        incidentEdges.length === 2 &&
        logicalConnectionId &&
        incidentEdges[1].logicalConnectionId === logicalConnectionId &&
        selectedLogicalConnectionIds.has(logicalConnectionId)
      ) resettableLogicalConnectionIds.add(logicalConnectionId)
    }))
    const legacyManualRouteEdgeCount = selectedConnection?.edges.filter((edge) => (
      edge.routeNodeIds?.length
    )).length ?? 0
    const manualRouteEdgeCount = legacyManualRouteEdgeCount +
      resettableLogicalConnectionIds.size
    const heading = combined
      ? `${busbarCount} 条母线 · ${connectionCount} 条子线`
      : busbarCount > 0
        ? busbarCount > 1 ? `${busbarCount} 条母线` : '母线'
        : isNetworkSelection
          ? '线路网络'
          : connectionCount > 1 ? `${connectionCount} 条子线` : '子线'
    const colorLabel = combined
      ? '线路颜色'
      : busbarCount > 0 ? '母线颜色' : '子线颜色'
    const selectionKey = [
      ...selectedBusbars.map((busbar) => busbar.id),
      ...(selectedConnection?.edges.map((edge) => edge.id) ?? []),
    ].sort().join(':')
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>{heading}</span>
        </div>
        <div className="property-form" key={selectionKey}>
          {busbarCount === 1 && connectionCount === 0 ? (
            <>
              <CommittedTextField
                label="母线标签"
                value={selectedBusbars[0].label ?? ''}
                placeholder="填写后在母线端点显示"
                onCommit={(label) => onPatchBusbar(selectedBusbars[0].id, {
                  label: label || undefined,
                })}
              />
              <PropertyToggle
                label="显示母线标签"
                description={selectedBusbars[0].label
                  ? '仅控制当前母线'
                  : '填写标签后生效'}
                checked={selectedBusbars[0].labelVisible !== false}
                onChange={(labelVisible) => onPatchBusbar(selectedBusbars[0].id, {
                  labelVisible,
                })}
              />
            </>
          ) : null}
          {connectionCount === 1 && busbarCount === 0 ? (
            <>
              <CommittedTextField
                label="子线标签"
                value={selectedConnection!.edges[0].label ?? ''}
                placeholder="填写后在子线端点显示"
                onCommit={(label) => onPatchConnectionEdge(selectedConnection!.edges[0].id, {
                  label: label || undefined,
                })}
              />
              <PropertyToggle
                label="显示子线标签"
                description={selectedConnection!.edges[0].label
                  ? '仅控制当前子线'
                  : '填写标签后生效'}
                checked={selectedConnection!.edges[0].labelVisible !== false}
                onChange={(labelVisible) => onPatchConnectionEdge(
                  selectedConnection!.edges[0].id,
                  { labelVisible },
                )}
              />
              <PropertyToggle
                label="显示运行数据"
                description={(selectedConnection!.edges[0].monitorMetrics?.length ?? 0) > 0
                  ? '编辑预览 · 监控动态更新'
                  : '添加指标后生效'}
                checked={selectedConnection!.edges[0].monitorDataVisible === true}
                onChange={(monitorDataVisible) => onPatchConnectionEdge(
                  selectedConnection!.edges[0].id,
                  { monitorDataVisible },
                )}
              />
              <PropertyToggle
                label="显示指标名称与单位"
                description={(selectedConnection!.edges[0].monitorMetrics?.length ?? 0) > 0
                  ? '统一控制全部指标'
                  : '添加指标后生效'}
                checked={selectedConnection!.edges[0].monitorMetricLabelsVisible !== false}
                onChange={(monitorMetricLabelsVisible) => onPatchConnectionEdge(
                  selectedConnection!.edges[0].id,
                  { monitorMetricLabelsVisible },
                )}
              />
              <MonitorMetricsEditor
                metrics={selectedConnection!.edges[0].monitorMetrics ?? []}
                onChange={(monitorMetrics) => onPatchConnectionEdge(
                  selectedConnection!.edges[0].id,
                  { monitorMetrics },
                )}
              />
            </>
          ) : null}
          {connectionCount > 0 && busbarCount === 0 ? (
            <SelectField
              label="跨线层级"
              aria-label="跨线层级"
              hint={connectionCount > 1
                ? `同时应用到 ${connectionCount} 条所选子线`
                : '控制整条子线在非连接交叉处上跨或下穿'}
              value={mixedCrossingLayer ? 'mixed' : selectionCrossingLayer}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === 'mixed') return
                const patch: Partial<ConnectionEdge> = {
                  crossingLayer: value === 'auto'
                    ? undefined
                    : value as 'lower' | 'upper',
                }
                const edgeIds = selectedConnection!.edges.map((edge) => edge.id)
                if (edgeIds.length === 1) onPatchConnectionEdge(edgeIds[0], patch)
                else onPatchConnectionEdges(edgeIds, patch)
              }}
            >
              {mixedCrossingLayer ? <option value="mixed" disabled>多种层级</option> : null}
              <option value="lower">下层</option>
              <option value="auto">自动</option>
              <option value="upper">上层</option>
            </SelectField>
          ) : null}
          {connectionCount > 0 && busbarCount === 0 ? (
            allSelectedConnectionsCooling ? (
              <SelectField
                label="管路级别"
                aria-label="管路级别"
                hint={connectionCount > 1
                  ? `同时应用到 ${connectionCount} 条所选冷却子线`
                  : '辅助线路使用更细、更低对比视觉，不代表真实管径或流量能力'}
                value={mixedCoolingLineRole ? 'mixed' : selectionCoolingLineRole}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (value === 'mixed') return
                  const patch: Partial<ConnectionEdge> = {
                    coolingLineRole: value === 'primary' ? undefined : 'auxiliary',
                  }
                  const edgeIds = selectedConnection!.edges.map((edge) => edge.id)
                  if (edgeIds.length === 1) onPatchConnectionEdge(edgeIds[0], patch)
                  else onPatchConnectionEdges(edgeIds, patch)
                }}
              >
                {mixedCoolingLineRole ? <option value="mixed" disabled>多种级别</option> : null}
                <option value="primary">主要线路</option>
                <option value="auxiliary">辅助线路</option>
              </SelectField>
            ) : null
          ) : null}
          {connectionCount > 0 && busbarCount === 0 ? (
            <SelectField
              label="通行方向"
              aria-label="通行方向"
              hint={connectionCount > 1
                ? `同时应用到 ${connectionCount} 条所选子线`
                : '单向时，电流或水流只可沿箭头方向通过'}
              value={mixedFlowDirection ? 'mixed' : selectionFlowDirection}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === 'mixed') return
                const patch: Partial<ConnectionEdge> = {
                  flowDirection: value === 'bidirectional'
                    ? undefined
                    : value as 'forward' | 'reverse',
                }
                const edgeIds = selectedConnection!.edges.map((edge) => edge.id)
                if (edgeIds.length === 1) onPatchConnectionEdge(edgeIds[0], patch)
                else onPatchConnectionEdges(edgeIds, patch)
              }}
            >
              {mixedFlowDirection ? <option value="mixed" disabled>多种方向</option> : null}
              <option value="bidirectional">双向通行</option>
              <option value="forward">起点 → 终点</option>
              <option value="reverse">终点 → 起点</option>
            </SelectField>
          ) : null}
          <CommittedColorField
            selectionKey={selectionKey}
            label={colorLabel}
            value={selectionColor}
            fallback={selectionColor}
            hasCustomColor={hasCustomColor}
            mixed={mixed}
            onPreview={onSelectionColorPreview}
            onCommit={onSelectionColorCommit}
            onRestore={() => onSelectionColorCommit(null)}
          />
          {busbarCount === 1 && connectionCount === 0 ? (
            <>
              <div className="property-meta"><span>方向</span><code>{selectedBusbars[0].orientation === 'horizontal' ? '水平' : '垂直'}</code></div>
              <div className="property-meta"><span>长度</span><code>{selectedBusbars[0].length}px</code></div>
            </>
          ) : (
            <div className="property-meta">
              <span>范围</span>
              <code>
                {combined
                  ? `${busbarCount} 条母线 + ${connectionCount} 条逻辑子线`
                  : busbarCount > 0
                    ? `${busbarCount} 条母线`
                    : `${connectionCount} 条逻辑子线`}
              </code>
            </div>
          )}
          {manualRouteEdgeCount > 0 && busbarCount === 0 ? (
            <Button
              variant="neutral-soft"
              leadingIcon={<RotateCcw />}
              onClick={onResetConnectionRouting}
            >
              恢复自动布线{manualRouteEdgeCount > 1 ? `（${manualRouteEdgeCount} 条）` : ''}
            </Button>
          ) : null}
          <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>
            删除{combined ? '所选线路' : busbarCount > 0 ? '母线' : isNetworkSelection ? '线路网络' : connectionCount > 1 ? '所选子线' : '子线'}
          </Button>
        </div>
      </aside>
    )
  }

  if (
    selectedElements.length > 1 ||
    selectedBusbars.length > 0 ||
    selectedRouteWaypointCount > 0 ||
    selectedJunctionCount > 0
  ) {
    const objectCount = selectedElements.length + selectedBusbars.length +
      selectedRouteWaypointCount + selectedJunctionCount
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>{objectCount} 个对象</span>
        </div>
        <div className="multi-selection-summary">
          <strong>已选择多个对象</strong>
          <p>{selectedRouteWaypointCount > 0 || selectedJunctionCount > 0
            ? '可整体移动或旋转；包含节点的混合选区不能缩放。'
            : '可整体移动、缩放、旋转，或使用复制、删除和撤销命令。'}</p>
          <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除所选</Button>
        </div>
      </aside>
    )
  }

  const element = selectedElements[0]
  const symbol = symbolsByKey.get(element.assetKey)
  const isGeneric = isGenericSymbolKey(element.assetKey)
  const scale = symbol ? element.width / symbol.intrinsicWidth : 1
  const scaleStep = symbol && !isGeneric ? getSymbolScaleStep(symbol, EDITOR_GRID_SIZE) : 1
  const supportsOnOffState = symbolSupportsOnOffState(symbol)
  const stateOn = onOffStates[element.id] ?? false
  const symbolColor = normalizeSymbolColor(element.properties.color)
  const hasCustomColor = typeof element.properties.color === 'string'
  const genericBackgroundColor = resolvedGenericSymbolBackgroundColor(element)
  const hasCustomGenericBackgroundColor = typeof element.properties[
    GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY
  ] === 'string'
  const stateColorProperties = (
    slot: Extract<SymbolColorSlot, 'switch-off' | 'switch-on'>,
    color: string | null,
  ) => {
    const properties = { ...element.properties }
    const legacyColor = properties.color
    if (typeof legacyColor === 'string' && /^#[0-9a-f]{6}$/i.test(legacyColor)) {
      properties.switchOffColor ??= normalizeSymbolColor(legacyColor)
      properties.switchOnColor ??= normalizeSymbolColor(legacyColor)
      delete properties.color
    }
    const property = symbolColorPropertyKey(slot)
    if (color === null) delete properties[property]
    else properties[property] = color
    return properties
  }
  return (
    <aside className="properties-panel" aria-labelledby="properties-title">
      <div className="panel-heading properties-heading">
        <h2 id="properties-title">属性</h2>
        <span>单个图元</span>
      </div>
      <div className="property-form" key={element.id}>
        <CommittedTextField
          label="名称"
          value={element.name}
          onCommit={(name) => onPatch(element.id, { name: name || '未命名图元' })}
        />
        <CommittedTextField
          label="设备标识"
          value={String(element.properties.tag ?? '')}
          placeholder="例如 UPS-01"
          hint={duplicateDeviceIdentifier ? '当前图纸中存在重复的设备标识' : undefined}
          onCommit={(tag) => onPatch(element.id, {
            properties: { ...element.properties, tag: tag || element.name },
          })}
        />
        {!isGeneric ? (
          <PropertyToggle
            label="显示图元标签"
            description="仅控制当前图元"
            checked={element.labelVisible !== false}
            onChange={(labelVisible) => onPatch(element.id, { labelVisible })}
          />
        ) : null}
        {isGeneric ? (
          <PropertyToggle
            label="显示虚线框"
            description="背景与设备标识保留"
            checked={element.properties.genericBorderVisible !== false}
            onChange={(genericBorderVisible) => onPatch(element.id, {
              properties: { ...element.properties, genericBorderVisible },
            })}
          />
        ) : null}
        <PropertyToggle
          label="显示运行数据"
          description={(element.monitorMetrics?.length ?? 0) > 0
            ? '编辑预览 · 监控动态更新'
            : '添加指标后生效'}
          checked={element.monitorDataVisible === true}
          onChange={(monitorDataVisible) => onPatch(element.id, { monitorDataVisible })}
        />
        <PropertyToggle
          label="显示指标名称与单位"
          description={(element.monitorMetrics?.length ?? 0) > 0
            ? '统一控制全部指标'
            : '添加指标后生效'}
          checked={element.monitorMetricLabelsVisible !== false}
          onChange={(monitorMetricLabelsVisible) => onPatch(element.id, {
            monitorMetricLabelsVisible,
          })}
        />
        <MonitorMetricsEditor
          metrics={element.monitorMetrics ?? []}
          onChange={(monitorMetrics) => onPatch(element.id, { monitorMetrics })}
        />
        {supportsOnOffState ? (
          <PropertyToggle
            label={`${symbol.name} 开关状态`}
            description={element.assetKey === 'switch'
              ? stateOn ? '当前闭合 · On' : '当前断开 · Off'
              : stateOn ? '当前开启 · On' : '当前关闭 · Off'}
            checked={stateOn}
            onChange={(on) => onOnOffStateChange(element.id, on)}
          />
        ) : null}
        {supportsOnOffState ? (
          <>
            <CommittedColorField
              selectionKey={`${element.id}:switch-off`}
              label={`${symbol.name} 关状态颜色`}
              value={resolvedSymbolColorForSlot(element, 'switch-off')}
              fallback={DEFAULT_CONFIGURABLE_SYMBOL_COLOR}
              hasCustomColor={typeof element.properties.switchOffColor === 'string'}
              onPreview={(color) => onColorPreview(element.id, color, 'switch-off')}
              onCommit={(color) => onPatch(element.id, {
                properties: stateColorProperties('switch-off', color),
              })}
              onRestore={() => onPatch(element.id, {
                properties: stateColorProperties('switch-off', null),
              })}
            />
            <CommittedColorField
              selectionKey={`${element.id}:switch-on`}
              label={`${symbol.name} 开状态颜色`}
              value={resolvedSymbolColorForSlot(element, 'switch-on')}
              fallback={DEFAULT_CONFIGURABLE_SYMBOL_COLOR}
              hasCustomColor={typeof element.properties.switchOnColor === 'string'}
              onPreview={(color) => onColorPreview(element.id, color, 'switch-on')}
              onCommit={(color) => onPatch(element.id, {
                properties: stateColorProperties('switch-on', color),
              })}
              onRestore={() => onPatch(element.id, {
                properties: stateColorProperties('switch-on', null),
              })}
            />
          </>
        ) : symbol?.configurableColor ? (
          <CommittedColorField
            selectionKey={element.id}
            label={isGeneric ? '虚线框颜色' : '图元颜色'}
            value={symbolColor}
            fallback={DEFAULT_CONFIGURABLE_SYMBOL_COLOR}
            hasCustomColor={hasCustomColor}
            onPreview={(color) => onColorPreview(element.id, color)}
            onCommit={(color) => onPatch(element.id, {
              properties: { ...element.properties, color },
            })}
            onRestore={() => {
              const properties = { ...element.properties }
              delete properties.color
              onPatch(element.id, { properties })
            }}
          />
        ) : null}
        {isGeneric ? (
          <CommittedColorField
            selectionKey={`${element.id}:generic-background`}
            label="背景颜色"
            value={genericBackgroundColor}
            fallback={GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR}
            hasCustomColor={hasCustomGenericBackgroundColor}
            onPreview={(color) => onColorPreview(element.id, color, 'generic-background')}
            onCommit={(genericBackgroundColor) => onPatch(element.id, {
              properties: { ...element.properties, genericBackgroundColor },
            })}
            onRestore={() => {
              const properties = { ...element.properties }
              delete properties[GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY]
              onPatch(element.id, { properties })
            }}
          />
        ) : null}
        <div className="property-grid">
          <NumericField label="X" value={element.x} step={EDITOR_GRID_SIZE} onCommit={(x) => onPatch(element.id, { x })} />
          <NumericField label="Y" value={element.y} step={EDITOR_GRID_SIZE} onCommit={(y) => onPatch(element.id, { y })} />
          {isGeneric ? (
            <>
              <NumericField
                label="宽度"
                value={element.width}
                min={GENERIC_SYMBOL_MIN_WIDTH}
                step={EDITOR_GRID_SIZE}
                onCommit={(width) => onPatch(element.id, { width })}
              />
              <NumericField
                label="高度"
                value={element.height}
                min={GENERIC_SYMBOL_MIN_HEIGHT}
                step={EDITOR_GRID_SIZE}
                onCommit={(height) => onPatch(element.id, { height })}
              />
            </>
          ) : symbol ? (
            <NumericField
              label="缩放"
              value={scale * 100}
              min={scaleStep * 100}
              step={scaleStep * 100}
              unit="%"
              onCommit={(percentage) => {
                const size = getScaledSymbolSize(symbol, percentage / 100, EDITOR_GRID_SIZE)
                onPatch(element.id, { width: size.width, height: size.height })
              }}
            />
          ) : null}
          <NumericField
            label="角度"
            value={element.rotation}
            min={-3600}
            max={3600}
            step={90}
            unit="°"
            onCommit={(rotation) => onPatch(element.id, { rotation })}
          />
        </div>
        <div className="property-meta">
          <span>尺寸</span>
          <code>{element.width} × {element.height}</code>
        </div>
        <div className="property-meta">
          <span>素材键</span><code>{element.assetKey}</code>
        </div>
        <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除图元</Button>
      </div>
    </aside>
  )
}
