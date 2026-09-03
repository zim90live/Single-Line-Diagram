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
  type MonitorMetric,
} from '../domain/project'
import {
  collectCanvasColorGroups,
  type CanvasColorCategory,
  type CanvasColorTarget,
} from '../editor/canvasColors'
import { DEFAULT_BUSBAR_LABEL_COLOR } from '../editor/busbarLabels'
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
  allowExternalSupplyEntry?: boolean
  allowCoolingFlowSource?: boolean
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
  onPatchElements?: (elementIds: string[], patch: Partial<DiagramElement>) => void
  onPatchElementMetrics?: (elementIds: string[], metrics: MonitorMetric[]) => void
  onPatchBusbar?: (busbarId: string, patch: Partial<Busbar>) => void
  onPatchBusbars?: (busbarIds: string[], patch: Partial<Busbar>) => void
  onBusbarLabelColorPreview?: (busbarId: string, color: string | null) => void
  onPatchConnectionEdge?: (edgeId: string, patch: Partial<ConnectionEdge>) => void
  onPatchConnectionEdges?: (edgeIds: string[], patch: Partial<ConnectionEdge>) => void
  onPatchConnectionMetrics?: (edgeIds: string[], metrics: MonitorMetric[]) => void
  onResetConnectionRouting?: () => void
  onOffStates?: Record<string, boolean>
  onOnOffStateChange?: (elementId: string, on: boolean) => void
  onOnOffStatesChange?: (elementIds: string[], on: boolean) => void
  onColorPreview: (
    elementId: string,
    color: string | null,
    slot?: SymbolColorSlot,
  ) => void
  onSelectionColorPreview: (color: string | null) => void
  onSelectionColorCommit: (color: string | null) => void
  onElementSelectionColorPreview?: (
    elementIds: string[],
    color: string | null,
    slot: SymbolColorSlot,
  ) => void
  onElementSelectionColorCommit?: (
    elementIds: string[],
    color: string | null,
    slot: SymbolColorSlot,
  ) => void
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
  checked: boolean | 'mixed'
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
        onClick={() => onChange(checked === 'mixed' ? true : !checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  )
}

function mixedBoolean(values: boolean[]): boolean | 'mixed' {
  return values.every((value) => value === values[0]) ? values[0] : 'mixed'
}

function monitorMetricTemplateSignature(metrics: MonitorMetric[]) {
  return JSON.stringify(metrics.map((metric) => {
    if (metric.valueType === 'text') {
      const { id: _id, textOptions, ...rest } = metric
      return {
        ...rest,
        textOptions: textOptions.map(({ id: _optionId, ...option }) => option),
      }
    }
    const { id: _id, ...rest } = metric
    return rest
  }))
}

interface BatchMetricSource {
  id: string
  label: string
  metrics: MonitorMetric[]
}

function BatchMonitorMetricsEditor({
  sources,
  onApply,
}: {
  sources: BatchMetricSource[]
  onApply: (metrics: MonitorMetric[]) => void
}) {
  const firstMetrics = sources[0]?.metrics ?? []
  const firstSignature = monitorMetricTemplateSignature(firstMetrics)
  const sameTemplate = sources.every((source) => (
    monitorMetricTemplateSignature(source.metrics) === firstSignature
  ))
  const [sourceId, setSourceId] = useState(sameTemplate ? '__shared__' : '')
  const [draft, setDraft] = useState<MonitorMetric[]>(() => (
    sameTemplate ? structuredClone(firstMetrics) : []
  ))
  const ready = sourceId !== ''

  return (
    <section className="batch-monitor-metrics" aria-label="批量运行指标配置">
      {!sameTemplate ? (
        <SelectField
          label="指标模板"
          aria-label="指标模板"
          hint="先选择一个对象的整套配置，或从空白开始；不会自动合并不同指标。"
          value={sourceId}
          onChange={(event) => {
            const nextSourceId = event.currentTarget.value
            setSourceId(nextSourceId)
            if (nextSourceId === '__blank__') {
              setDraft([])
              return
            }
            const source = sources.find((candidate) => candidate.id === nextSourceId)
            setDraft(structuredClone(source?.metrics ?? []))
          }}
        >
          <option value="" disabled>选择模板来源</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>{source.label}</option>
          ))}
          <option value="__blank__">创建空白配置</option>
        </SelectField>
      ) : null}
      {ready ? (
        <>
          <MonitorMetricsEditor metrics={draft} onChange={setDraft} />
          <Button
            variant="neutral-soft"
            onClick={() => onApply(draft)}
          >
            应用到 {sources.length} 个对象
          </Button>
          <p className="batch-monitor-metrics__note">
            整套覆盖现有指标，并为每个对象创建独立指标 ID；可一次撤销。
          </p>
        </>
      ) : (
        <p className="batch-monitor-metrics__note">当前选择包含多种指标配置，尚未选择覆盖模板。</p>
      )}
    </section>
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
  allowExternalSupplyEntry = false,
  allowCoolingFlowSource = false,
  selectedBusbars,
  selectedConnection,
  selectedRouteWaypointCount = 0,
  selectedRouteWaypointMaxReferenceCount = 0,
  selectedJunctionCount = 0,
  canvasElements = [],
  canvasBusbars = [],
  canvasConnections = [],
  onPatch,
  onPatchElements = () => undefined,
  onPatchElementMetrics = () => undefined,
  onPatchBusbar = () => undefined,
  onPatchBusbars = () => undefined,
  onBusbarLabelColorPreview = () => undefined,
  onPatchConnectionEdge = () => undefined,
  onPatchConnectionEdges = () => undefined,
  onPatchConnectionMetrics = () => undefined,
  onResetConnectionRouting = () => undefined,
  onOffStates = {},
  onOnOffStateChange = () => undefined,
  onOnOffStatesChange = () => undefined,
  onColorPreview,
  onSelectionColorPreview,
  onSelectionColorCommit,
  onElementSelectionColorPreview = () => undefined,
  onElementSelectionColorCommit = () => undefined,
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
    const busbarMonitorFlowDirections = selectedBusbars.map((busbar) => (
      busbar.monitorFlowDirection ?? 'auto'
    ))
    const selectionBusbarMonitorFlowDirection = busbarMonitorFlowDirections[0] ?? 'auto'
    const mixedBusbarMonitorFlowDirection = busbarMonitorFlowDirections.some((direction) => (
      direction !== selectionBusbarMonitorFlowDirection
    ))
    const connectionFlowDirections = selectedConnection?.edges.map((edge) => (
      edge.flowDirection ?? 'bidirectional'
    )) ?? []
    const selectionFlowDirection = connectionFlowDirections[0] ?? 'bidirectional'
    const mixedFlowDirection = connectionFlowDirections.some((direction) => (
      direction !== selectionFlowDirection
    ))
    const connectionExternalSupplyEndpoints = selectedConnection?.edges.map((edge) => (
      edge.externalSupplyEndpoint ?? 'none'
    )) ?? []
    const selectionExternalSupplyEndpoint = connectionExternalSupplyEndpoints[0] ?? 'none'
    const mixedExternalSupplyEndpoint = connectionExternalSupplyEndpoints.some((endpoint) => (
      endpoint !== selectionExternalSupplyEndpoint
    ))
    const externalSupplyDirectionConflict = selectedConnection?.edges.some((edge) => (
      (edge.externalSupplyEndpoint === 'source' && edge.flowDirection === 'reverse') ||
      (edge.externalSupplyEndpoint === 'target' && edge.flowDirection === 'forward')
    )) === true
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
          {busbarCount > 1 && connectionCount === 0 ? (
            <PropertyToggle
              label="显示母线标签"
              description={`同时应用到 ${busbarCount} 条所选母线`}
              checked={mixedBoolean(selectedBusbars.map((busbar) => busbar.labelVisible !== false))}
              onChange={(labelVisible) => onPatchBusbars(
                selectedBusbars.map((busbar) => busbar.id),
                { labelVisible },
              )}
            />
          ) : null}
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
              <CommittedColorField
                selectionKey={`${selectedBusbars[0].id}:label-color`}
                label="标签颜色"
                value={selectedBusbars[0].labelColor ?? DEFAULT_BUSBAR_LABEL_COLOR}
                fallback={DEFAULT_BUSBAR_LABEL_COLOR}
                hasCustomColor={selectedBusbars[0].labelColor !== undefined}
                onPreview={(color) => onBusbarLabelColorPreview(
                  selectedBusbars[0].id,
                  color,
                )}
                onCommit={(labelColor) => onPatchBusbar(selectedBusbars[0].id, {
                  labelColor,
                })}
                onRestore={() => {
                  onBusbarLabelColorPreview(selectedBusbars[0].id, null)
                  onPatchBusbar(selectedBusbars[0].id, { labelColor: undefined })
                }}
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
          {connectionCount > 1 && busbarCount === 0 ? (
            <>
              <PropertyToggle
                label="显示子线标签"
                description={`同时应用到 ${connectionCount} 条所选子线`}
                checked={mixedBoolean(selectedConnection!.edges.map((edge) => (
                  edge.labelVisible !== false
                )))}
                onChange={(labelVisible) => onPatchConnectionEdges(
                  selectedConnection!.edges.map((edge) => edge.id),
                  { labelVisible },
                )}
              />
              <PropertyToggle
                label="显示运行数据"
                description={`同时应用到 ${connectionCount} 条所选子线`}
                checked={mixedBoolean(selectedConnection!.edges.map((edge) => (
                  edge.monitorDataVisible === true
                )))}
                onChange={(monitorDataVisible) => onPatchConnectionEdges(
                  selectedConnection!.edges.map((edge) => edge.id),
                  { monitorDataVisible },
                )}
              />
              <PropertyToggle
                label="显示指标名称与单位"
                description={`同时应用到 ${connectionCount} 条所选子线`}
                checked={mixedBoolean(selectedConnection!.edges.map((edge) => (
                  edge.monitorMetricLabelsVisible !== false
                )))}
                onChange={(monitorMetricLabelsVisible) => onPatchConnectionEdges(
                  selectedConnection!.edges.map((edge) => edge.id),
                  { monitorMetricLabelsVisible },
                )}
              />
              <BatchMonitorMetricsEditor
                sources={selectedConnection!.edges.map((edge, index) => ({
                  id: edge.id,
                  label: edge.label?.trim() || `子线 ${index + 1}`,
                  metrics: edge.monitorMetrics ?? [],
                }))}
                onApply={(monitorMetrics) => onPatchConnectionMetrics(
                  selectedConnection!.edges.map((edge) => edge.id),
                  monitorMetrics,
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
          {(allowExternalSupplyEntry || allowCoolingFlowSource) &&
          connectionCount > 0 && busbarCount === 0 ? (
            <SelectField
              label={allowCoolingFlowSource ? '水流源头' : '外部供电入口'}
              aria-label={allowCoolingFlowSource ? '水流源头' : '外部供电入口'}
              hint={externalSupplyDirectionConflict
                ? allowCoolingFlowSource
                  ? '当前通行方向阻断了所选源头，监控模式不会产生水流'
                  : '当前通行方向阻断了所选入口，监控模式不会产生电流'
                : connectionCount > 1
                  ? allowCoolingFlowSource
                    ? `同时应用到 ${connectionCount} 条所选管路；模拟水流从源头流向其他开放端`
                    : `同时应用到 ${connectionCount} 条所选子线；显式入口会停用当前子图的自动母线供电`
                  : allowCoolingFlowSource
                    ? '从所选端点注入模拟流量；仍受管路方向和泵阀状态约束'
                    : '父图带电时从所选端点注入；仍受子线通行方向约束'}
              value={mixedExternalSupplyEndpoint ? 'mixed' : selectionExternalSupplyEndpoint}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === 'mixed') return
                const patch: Partial<ConnectionEdge> = {
                  externalSupplyEndpoint: value === 'none'
                    ? undefined
                    : value as 'source' | 'target',
                }
                const edgeIds = selectedConnection!.edges.map((edge) => edge.id)
                if (edgeIds.length === 1) onPatchConnectionEdge(edgeIds[0], patch)
                else onPatchConnectionEdges(edgeIds, patch)
              }}
            >
              {mixedExternalSupplyEndpoint
                ? <option value="mixed" disabled>
                    {allowCoolingFlowSource ? '多种源头' : '多种入口'}
                  </option>
                : null}
              <option value="none">
                {allowCoolingFlowSource ? '不作为源头' : '不作为入口'}
              </option>
              <option value="source">起点端</option>
              <option value="target">终点端</option>
            </SelectField>
          ) : null}
          {busbarCount > 0 && connectionCount === 0 ? (
            <SelectField
              label="监控电流方向"
              aria-label="监控电流方向"
              hint={busbarCount > 1
                ? `同时应用到 ${busbarCount} 条所选母线；仅在母线实际带电时生效`
                : '人工方向覆盖整条母线，但不会凭空产生电源'}
              value={mixedBusbarMonitorFlowDirection
                ? 'mixed'
                : selectionBusbarMonitorFlowDirection}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === 'mixed') return
                const patch: Partial<Busbar> = {
                  monitorFlowDirection: value === 'auto'
                    ? undefined
                    : value as 'start-to-end' | 'end-to-start',
                }
                const busbarIds = selectedBusbars.map((busbar) => busbar.id)
                if (busbarIds.length === 1) onPatchBusbar(busbarIds[0], patch)
                else onPatchBusbars(busbarIds, patch)
              }}
            >
              {mixedBusbarMonitorFlowDirection
                ? <option value="mixed" disabled>多种方向</option>
                : null}
              <option value="auto">自动判定</option>
              <option value="start-to-end">
                {busbarCount === 1
                  ? selectedBusbars[0].orientation === 'horizontal'
                    ? '左端 → 右端'
                    : '上端 → 下端'
                  : '各自起点 → 终点'}
              </option>
              <option value="end-to-start">
                {busbarCount === 1
                  ? selectedBusbars[0].orientation === 'horizontal'
                    ? '右端 → 左端'
                    : '下端 → 上端'
                  : '各自终点 → 起点'}
              </option>
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
    selectedElements.length > 1 &&
    selectedBusbars.length === 0 &&
    selectedConnection === null &&
    selectedRouteWaypointCount === 0 &&
    selectedJunctionCount === 0
  ) {
    const elementIds = selectedElements.map((element) => element.id)
    const selectionKey = elementIds.slice().sort().join(':')
    const selectedSymbols = selectedElements.map((element) => symbolsByKey.get(element.assetKey))
    const sameAssetType = selectedElements.every((element) => (
      element.assetKey === selectedElements[0].assetKey
    ))
    const allGeneric = selectedElements.every((element) => isGenericSymbolKey(element.assetKey))
    const allUseExternalLabel = selectedElements.every((element) => (
      !isGenericSymbolKey(element.assetKey)
    ))
    const allSupportOnOff = selectedSymbols.every((symbol) => symbolSupportsOnOffState(symbol))
    const allConfigurableColor = selectedSymbols.every((symbol) => symbol?.configurableColor === true)
    const stateValues = selectedElements.map((element) => onOffStates[element.id] ?? false)
    const stateValue = mixedBoolean(stateValues)
    const heading = sameAssetType
      ? `${selectedElements.length} 个 ${selectedSymbols[0]?.name ?? selectedElements[0].name}`
      : `${selectedElements.length} 个图元 · ${new Set(selectedElements.map((element) => element.assetKey)).size} 种类型`
    const metricSources = selectedElements.map((element, index) => ({
      id: element.id,
      label: String(element.properties.tag ?? '').trim() || `${element.name} ${index + 1}`,
      metrics: element.monitorMetrics ?? [],
    }))
    const renderColorField = (
      slot: SymbolColorSlot,
      label: string,
      fallback: string,
    ) => {
      const values = selectedElements.map((element) => (
        slot === 'generic-background'
          ? resolvedGenericSymbolBackgroundColor(element)
          : resolvedSymbolColorForSlot(element, slot)
      ))
      const value = values[0] ?? fallback
      const mixed = values.some((color) => color !== value)
      const property = slot === 'generic-background'
        ? GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY
        : symbolColorPropertyKey(slot)
      const hasCustomColor = selectedElements.some((element) => (
        typeof element.properties[property] === 'string' || (
          (slot === 'switch-off' || slot === 'switch-on') &&
          typeof element.properties.color === 'string'
        )
      ))
      return (
        <CommittedColorField
          selectionKey={`${selectionKey}:${slot}`}
          label={label}
          value={value}
          fallback={fallback}
          hasCustomColor={hasCustomColor}
          mixed={mixed}
          onPreview={(color) => onElementSelectionColorPreview(elementIds, color, slot)}
          onCommit={(color) => onElementSelectionColorCommit(elementIds, color, slot)}
          onRestore={() => onElementSelectionColorCommit(elementIds, null, slot)}
        />
      )
    }
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>{heading}</span>
        </div>
        <div className="property-form" key={selectionKey}>
          {allUseExternalLabel ? (
            <PropertyToggle
              label="显示图元标签"
              description={`同时应用到 ${selectedElements.length} 个所选图元`}
              checked={mixedBoolean(selectedElements.map((element) => element.labelVisible !== false))}
              onChange={(labelVisible) => onPatchElements(elementIds, { labelVisible })}
            />
          ) : null}
          <PropertyToggle
            label="显示运行数据"
            description={`同时应用到 ${selectedElements.length} 个所选图元`}
            checked={mixedBoolean(selectedElements.map((element) => (
              element.monitorDataVisible === true
            )))}
            onChange={(monitorDataVisible) => onPatchElements(elementIds, {
              monitorDataVisible,
            })}
          />
          <PropertyToggle
            label="显示指标名称与单位"
            description={`同时应用到 ${selectedElements.length} 个所选图元`}
            checked={mixedBoolean(selectedElements.map((element) => (
              element.monitorMetricLabelsVisible !== false
            )))}
            onChange={(monitorMetricLabelsVisible) => onPatchElements(elementIds, {
              monitorMetricLabelsVisible,
            })}
          />
          <BatchMonitorMetricsEditor
            sources={metricSources}
            onApply={(monitorMetrics) => onPatchElementMetrics(elementIds, monitorMetrics)}
          />
          {allSupportOnOff ? (
            <PropertyToggle
              label="运行状态"
              description={stateValue === 'mixed'
                ? '所选设备包含开启与关闭两种状态'
                : stateValue ? '所选设备当前均为 On' : '所选设备当前均为 Off'}
              checked={stateValue}
              onChange={(on) => onOnOffStatesChange(elementIds, on)}
            />
          ) : null}
          {allSupportOnOff ? (
            <>
              {renderColorField('switch-off', '关状态颜色', DEFAULT_CONFIGURABLE_SYMBOL_COLOR)}
              {renderColorField('switch-on', '开状态颜色', DEFAULT_CONFIGURABLE_SYMBOL_COLOR)}
            </>
          ) : sameAssetType && allConfigurableColor ? (
            renderColorField('default', allGeneric ? '虚线框颜色' : '图元颜色', DEFAULT_CONFIGURABLE_SYMBOL_COLOR)
          ) : null}
          {allGeneric ? renderColorField(
            'generic-background',
            '背景颜色',
            GENERIC_SYMBOL_DEFAULT_BACKGROUND_COLOR,
          ) : null}
          <div className="property-meta">
            <span>范围</span>
            <code>{selectedElements.length} 个手动选择的图元</code>
          </div>
          <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除所选</Button>
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
