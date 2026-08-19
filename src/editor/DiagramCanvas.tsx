import { Canvas } from '@react-three/fiber'
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'

import type {
  AnchorType,
  AssetDefinition,
  Busbar,
  ConnectionEdge,
  ConnectionNetwork,
  DiagramElement,
  DiagramViewport,
  LineSystemType,
} from '../domain/project'
import { BUSBAR_MIN_LENGTH } from '../domain/project'
import {
  FLOW_BUSBAR_SCREEN_WIDTH,
  FlowAnimationLayer,
  type MonitorFlowPath,
} from '../monitoring/FlowAnimationLayer'
import { derivePowerFlowTopology } from '../monitoring/flowTopology'
import { useMonitorMetricReadings } from '../monitoring/useMonitorMetricReadings'
import {
  compressBusbarTapOffsets,
  minimumBusbarLengthForConnections,
} from './busbars'
import {
  busbarLabelEndpointForPointer,
  layoutBusbarLabels,
  type BusbarLabelLayout,
} from './busbarLabels'
import {
  replaceCanvasColor,
  resolvedBusbarColor,
  resolvedConnectionColor,
  resolvedElementColor,
  type CanvasColorTarget,
} from './canvasColors'
import {
  connectionLabelPlacementForPointer,
  layoutConnectionLabels,
  type ConnectionLabelLayout,
  type ConnectionLabelPlacement,
} from './connectionLabels'
import {
  busbarEndPoint,
  busbarPoint,
  bridgedPathData,
  bridgedPolylinePoints,
  connectTerminals,
  connectionTypesCompatible,
  crossingPointKeys,
  indexConnectionCrossings,
  nearestPointOnBusbar,
  normalizeConnectionNetworks,
  occupiedAnchorKeys,
  pathData,
  prepareConnectionPreview,
  previewConnectionRoutesForDiagram,
  resolveElementAnchor,
  routeConnectionPreviewWithContext,
  type ConnectionTerminal,
  type RoutedConnectionEdge,
} from './connections'
import { createLatestFrameScheduler, createTrailingScheduler } from './frameScheduler'
import {
  busbarInsideRect,
  clampZoom,
  diagramObjectsBounds,
  elementInsideRect,
  elementsBounds,
  elementsEqual,
  normalizedRect,
  rotatePoint,
  screenToWorld,
  snap,
  worldDeltaToLocal,
  zoomAroundPoint,
  type Point,
  type Rect,
} from './geometry'
import { GridSurface, type GridRenderState } from './GridSurface'
import { GRID_PRESENTATION, getAdaptiveGridScale } from './gridScale'
import {
  labelPlacementForPointer,
  layoutElementLabels,
  nextDeviceIdentifier,
  type ElementLabelLayout,
} from './elementLabels'
import { DEFAULT_BUSBAR_COLOR, defaultConnectionColor, normalizeHexColor } from './objectColors'
import { Rulers } from './Rulers'
import { useRoutedConnections } from './useRoutedConnections'
import {
  clipboardCanPasteInto,
  centeredSelectionOffset,
  copyConnectionsWithinSelection,
  createEmptySelectionClipboard,
  instantiateCopiedElement,
  instantiateCopiedConnections,
  type DiagramClipboardOperation,
  type DiagramSelectionClipboard,
} from './selectionClipboard'
import {
  getSymbolStateUrl,
  getScaledSymbolSize,
  normalizeSymbolColor,
  resolvedSymbolColor,
  resolvedSymbolColorForSlot,
  symbolColorSlotForElement,
  symbolsByKey,
  type SymbolColorSlot,
  type SymbolDefinition,
  type SymbolVisualState,
} from './symbolCatalog'

export type CanvasMode = 'edit' | 'monitor'

export interface EditorCommandState {
  canUndo: boolean
  canRedo: boolean
  canCopy: boolean
  hasSelection: boolean
  zoom: number
  selectedConnection: boolean
  selectedBusbar: boolean
  selectedConnectionId: string | null
  selectedConnectionEdgeIds: string[]
  selectedBusbarIds: string[]
  wiringType: AnchorType | null
}

export interface PointerPosition {
  x: number
  y: number
}

export interface DiagramCanvasHandle {
  undo: () => void
  redo: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  duplicate: () => void
  deleteSelected: () => void
  selectAll: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  insertSymbol: (symbolKey: string) => void
  insertBusbar: () => void
  previewElementColor: (
    elementId: string,
    color: string | null,
    slot?: SymbolColorSlot,
  ) => void
  previewSelectionColor: (color: string | null) => void
  updateSelectionColor: (color: string | null) => void
  previewCanvasColor: (target: CanvasColorTarget, color: string | null) => void
  updateCanvasColor: (target: CanvasColorTarget, color: string) => void
  updateElement: (elementId: string, patch: Partial<DiagramElement>) => void
  updateBusbar: (busbarId: string, patch: Partial<Busbar>) => void
  updateConnectionEdge: (edgeId: string, patch: Partial<ConnectionEdge>) => void
}

interface DiagramCanvasProps {
  mode: CanvasMode
  animationPlaying: boolean
  switchStates: Record<string, boolean>
  diagramId: string
  lineSystemType: LineSystemType
  documentEpoch: number
  gridSize: number
  viewport: DiagramViewport
  assets: AssetDefinition[]
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  onDiagramChange: (
    elements: DiagramElement[],
    busbars: Busbar[],
    connections: ConnectionNetwork[],
  ) => void
  onSelectionChange: (ids: string[]) => void
  onCommandStateChange: (state: EditorCommandState) => void
  onPointerChange: (position: PointerPosition | null) => void
  onSwitchStateChange: (elementId: string, on: boolean) => void
  onActionMessage: (message: string, tone: 'success' | 'danger') => void
}

interface EditorSnapshot {
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
}

interface HistoryState {
  past: EditorSnapshot[]
  future: EditorSnapshot[]
}

interface WiringState {
  source: ConnectionTerminal
  pointer: Point
}

interface BusbarCandidate {
  busbar: Busbar
  point: Point
  offset: number
}

interface ProvisionalConnectionRoute {
  scopeKey: string
  route: RoutedConnectionEdge
}

interface HandlerRef<Handler> {
  current: Handler
}

interface ElementLabelItemProps {
  layout: ElementLabelLayout
  interactive: boolean
  selected: boolean
  startDrag: HandlerRef<(
    event: PointerEvent<SVGRectElement>,
    elementId: string,
  ) => void>
}

const ElementLabelItem = memo(function ElementLabelItem({
  layout,
  interactive,
  selected,
  startDrag,
}: ElementLabelItemProps) {
  return (
    <g
      className="element-label"
      data-element-id={layout.elementId}
      data-placement={layout.placement}
      data-interactive={interactive || undefined}
      data-selected={selected || undefined}
    >
      <rect
        className="element-label__hit"
        x={layout.bounds.x}
        y={layout.bounds.y}
        width={layout.bounds.width}
        height={layout.bounds.height}
        onPointerDown={interactive
          ? (event) => startDrag.current(event, layout.elementId)
          : undefined}
      />
      {layout.nameText ? (
        <text
          className="element-label__text"
          x={layout.textX}
          y={layout.textY}
        >
          {layout.nameText}
        </text>
      ) : null}
      {layout.metricRows.map((row) => (
        <g className="element-metric-row" key={row.metricId}>
          <text
            className="element-metric-row__label"
            x={row.labelX}
            y={row.textY}
          >
            {row.labelText}
          </text>
          <text
            className="element-metric-row__reading"
            x={row.valueX}
            y={row.textY}
            textAnchor="end"
            aria-label={row.ariaLabel}
          >
            <tspan
              className="element-metric-row__value"
              data-severity={row.severity}
            >
              {row.valueText}
            </tspan>
          </text>
        </g>
      ))}
    </g>
  )
})

interface BusbarLabelItemProps {
  layout: BusbarLabelLayout
  interactive: boolean
  selected: boolean
  startDrag: HandlerRef<(
    event: PointerEvent<SVGRectElement>,
    busbarId: string,
  ) => void>
}

const BusbarLabelItem = memo(function BusbarLabelItem({
  layout,
  interactive,
  selected,
  startDrag,
}: BusbarLabelItemProps) {
  return (
    <g
      className="element-label busbar-label"
      data-busbar-id={layout.busbarId}
      data-endpoint={layout.endpoint}
      data-interactive={interactive || undefined}
      data-selected={selected || undefined}
    >
      <rect
        className="element-label__hit"
        x={layout.bounds.x}
        y={layout.bounds.y}
        width={layout.bounds.width}
        height={layout.bounds.height}
        onPointerDown={interactive
          ? (event) => startDrag.current(event, layout.busbarId)
          : undefined}
      />
      <text
        className="element-label__text"
        x={layout.textX}
        y={layout.textY}
      >
        {layout.text}
      </text>
    </g>
  )
})

interface ConnectionLabelItemProps {
  layout: ConnectionLabelLayout
  interactive: boolean
  selected: boolean
  startDrag: HandlerRef<(
    event: PointerEvent<SVGRectElement>,
    edgeId: string,
  ) => void>
}

const ConnectionLabelItem = memo(function ConnectionLabelItem({
  layout,
  interactive,
  selected,
  startDrag,
}: ConnectionLabelItemProps) {
  return (
    <g
      className="element-label connection-label"
      data-edge-id={layout.edgeId}
      data-endpoint={layout.endpoint}
      data-side={layout.side}
      data-orientation={layout.orientation}
      data-axis-alignment={layout.axisAlignment}
      data-interactive={interactive || undefined}
      data-selected={selected || undefined}
    >
      <rect
        className="element-label__hit"
        x={layout.bounds.x}
        y={layout.bounds.y}
        width={layout.bounds.width}
        height={layout.bounds.height}
        onPointerDown={interactive
          ? (event) => startDrag.current(event, layout.edgeId)
          : undefined}
      />
      <text
        className="element-label__text"
        x={layout.textX}
        y={layout.textY}
        textAnchor={layout.textAnchor}
      >
        {layout.text}
      </text>
    </g>
  )
})

interface DiagramElementItemProps {
  mode: CanvasMode
  element: DiagramElement
  asset?: AssetDefinition
  symbol?: SymbolDefinition
  symbolColor?: string
  selected: boolean
  anchorsVisible: boolean
  wiringType: AnchorType | null
  lineSystemType: LineSystemType
  occupiedAnchors: Set<string>
  zoom: number
  visualState: SymbolVisualState
  elementNodes: HandlerRef<Map<string, SVGGElement>>
  startMove: HandlerRef<(event: PointerEvent<SVGImageElement>, elementId: string) => void>
  enterAnchor: HandlerRef<(elementId: string, anchorId: string, type: AnchorType) => void>
  leaveAnchor: HandlerRef<(elementId: string, anchorId: string) => void>
  pressAnchor: HandlerRef<(
    event: PointerEvent<SVGCircleElement>,
    elementId: string,
    anchorId: string,
    type: AnchorType,
  ) => void>
  toggleSwitch: HandlerRef<(elementId: string, on: boolean) => void>
  hoverElement: HandlerRef<(elementId: string | null) => void>
}

const DiagramElementItem = memo(function DiagramElementItem({
  mode,
  element,
  asset,
  symbol,
  symbolColor,
  selected,
  anchorsVisible,
  wiringType,
  lineSystemType,
  occupiedAnchors,
  zoom,
  visualState,
  elementNodes,
  startMove,
  enterAnchor,
  leaveAnchor,
  pressAnchor,
  toggleSwitch,
  hoverElement,
}: DiagramElementItemProps) {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const colorFilterId = symbolColor ? symbolColorFilterId(symbolColor) : undefined
  return (
    <g
      ref={(node) => {
        if (node) elementNodes.current.set(element.id, node)
        else elementNodes.current.delete(element.id)
      }}
      className="diagram-element"
      data-element-id={element.id}
      data-asset-key={element.assetKey}
      data-selected={selected || undefined}
      data-monitor-switch={mode === 'monitor' && element.assetKey === 'switch' || undefined}
      transform={`rotate(${element.rotation} ${centerX} ${centerY})`}
      onPointerEnter={() => hoverElement.current(element.id)}
      onPointerLeave={() => hoverElement.current(null)}
    >
      {symbol ? (
        <>
          <image
            className="diagram-element__image"
            data-symbol-color={symbolColor}
            data-symbol-state={visualState}
            filter={symbolColor ? `url(#${colorFilterId})` : undefined}
            href={getSymbolStateUrl(symbol, visualState)}
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={(event) => {
              if (mode === 'monitor') {
                if (element.assetKey !== 'switch' || event.button !== 0) return
                event.preventDefault()
                event.stopPropagation()
                toggleSwitch.current(element.id, visualState !== 'on')
                return
              }
              startMove.current(event, element.id)
            }}
          />
          {mode === 'edit' && anchorsVisible ? asset?.anchors.map((anchor) => {
            const resolved = resolveElementAnchor(element, asset, anchor)
            const compatible = wiringType
              ? connectionTypesCompatible(wiringType, anchor.type)
              : lineSystemType === 'power'
                ? anchor.type === 'electrical'
                : anchor.type !== 'electrical'
            const localX = element.x + (anchor.x / asset.intrinsicWidth) * element.width
            const localY = element.y + (anchor.y / asset.intrinsicHeight) * element.height
            return (
              <circle
                key={anchor.id}
                className="connection-anchor"
                data-anchor-id={anchor.id}
                data-anchor-type={anchor.type}
                data-compatible={compatible || undefined}
                data-occupied={occupiedAnchors.has(`${element.id}::${anchor.id}`) || undefined}
                data-world-x={resolved.point.x}
                data-world-y={resolved.point.y}
                cx={localX}
                cy={localY}
                r={5 / zoom}
                onPointerEnter={() => enterAnchor.current(element.id, anchor.id, anchor.type)}
                onPointerLeave={() => leaveAnchor.current(element.id, anchor.id)}
                onPointerDown={compatible
                  ? (event) => pressAnchor.current(event, element.id, anchor.id, anchor.type)
                  : undefined}
              />
            )
          }) : null}
        </>
      ) : null}
    </g>
  )
})

interface ConnectionEdgeItemProps {
  edgeId: string
  networkId: string
  type: AnchorType
  color?: string
  selected: boolean
  interactive: boolean
  linePath: string
  bridgeCasingPath: string
  pressEdge: HandlerRef<(event: PointerEvent<SVGPathElement>, edgeId: string) => void>
  edgeNodes: HandlerRef<Map<string, SVGGElement>>
}

const ConnectionEdgeItem = memo(function ConnectionEdgeItem({
  edgeId,
  networkId,
  type,
  color,
  selected,
  interactive,
  linePath,
  bridgeCasingPath,
  pressEdge,
  edgeNodes,
}: ConnectionEdgeItemProps) {
  return (
    <g
      ref={(node) => {
        if (node) edgeNodes.current.set(edgeId, node)
        else edgeNodes.current.delete(edgeId)
      }}
      className="connection-edge"
      data-edge-id={edgeId}
      data-network-id={networkId}
      data-connection-type={type}
      data-selected={selected || undefined}
      data-interactive={interactive || undefined}
      style={color ? { '--connection-color': color } as CSSProperties : undefined}
    >
      {bridgeCasingPath ? (
        <path className="connection-edge__bridge-casing" d={bridgeCasingPath} />
      ) : null}
      <path className="connection-edge__line" d={linePath} />
      <path
        className="connection-edge__hit"
        d={linePath}
        onPointerDown={interactive
          ? (event) => pressEdge.current(event, edgeId)
          : undefined}
      />
    </g>
  )
})

interface AlignmentTarget {
  id: string
  center: Point
  width: number
  height: number
}

interface DiagramPreviewFrame {
  elements: DiagramElement[] | null
  busbars: Busbar[] | null
  connections: ConnectionNetwork[] | null
}

type Interaction =
  | {
      kind: 'pan'
      pointerId: number
      startClient: Point
      startViewport: DiagramViewport
    }
  | {
      kind: 'marquee'
      pointerId: number
      startWorld: Point
      currentWorld: Point
      additive: boolean
      baseSelection: string[]
      baseBusbarSelection: string[]
    }
  | {
      kind: 'move'
      pointerId: number
      startWorld: Point
      baseElements: DiagramElement[]
      baseBusbars: Busbar[]
      selectedIds: string[]
      selectedBusbarIds: string[]
      hasMoved: boolean
    }
  | {
      kind: 'label'
      pointerId: number
      elementId: string
      baseElements: DiagramElement[]
    }
  | {
      kind: 'busbar-label'
      pointerId: number
      busbarId: string
      baseBusbars: Busbar[]
    }
  | {
      kind: 'connection-label'
      pointerId: number
      edgeId: string
      route: RoutedConnectionEdge
      baseConnections: ConnectionNetwork[]
    }
  | {
      kind: 'resize'
      pointerId: number
      startWorld: Point
      baseElements: DiagramElement[]
      selectedIds: string[]
      bounds: Rect
    }
  | {
      kind: 'rotate'
      pointerId: number
      center: Point
      startAngle: number
      baseElements: DiagramElement[]
      baseBusbars: Busbar[]
      selectedIds: string[]
      selectedBusbarIds: string[]
    }
  | {
      kind: 'resize-busbar'
      pointerId: number
      endpoint: 'start' | 'end'
      baseBusbars: Busbar[]
      baseConnections: ConnectionNetwork[]
      busbar: Busbar
      minimumLength: number
    }
  | {
      kind: 'rotate-busbar'
      pointerId: number
      center: Point
      startAngle: number
      baseBusbars: Busbar[]
      busbar: Busbar
    }

const HISTORY_LIMIT = 100
const SYMBOL_DRAG_TYPE_PREFIX = 'application/x-aidc-symbol-key--'
const BUSBAR_DRAG_TYPE = 'application/x-aidc-busbar'
const DEFAULT_BUSBAR_LENGTH = 160
const NETWORK_SELECTION_PREFIX = 'network:'
const MULTI_CONNECTION_SELECTION_PREFIX = 'edges:'
const NUDGE_COMMIT_DELAY_MS = 120
const RENDER_CULLING_OBJECT_THRESHOLD = 180
const RENDER_OVERSCAN_SCREEN_PX = 160
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

const symbolColorFilterId = (color: string) => (
  `symbol-color-filter-${normalizeSymbolColor(color).slice(1).toLowerCase()}`
)

function rectsIntersect(left: Rect, right: Rect) {
  return left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
}

function pointInsideRect(point: Point, rect: Rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}

function segmentIntersectsViewport(start: Point, end: Point, rect: Rect) {
  if (pointInsideRect(start, rect) || pointInsideRect(end, rect)) return true
  if (start.y === end.y) {
    return start.y >= rect.y && start.y <= rect.y + rect.height &&
      Math.max(Math.min(start.x, end.x), rect.x) <=
        Math.min(Math.max(start.x, end.x), rect.x + rect.width)
  }
  if (start.x === end.x) {
    return start.x >= rect.x && start.x <= rect.x + rect.width &&
      Math.max(Math.min(start.y, end.y), rect.y) <=
        Math.min(Math.max(start.y, end.y), rect.y + rect.height)
  }
  return false
}

function polylineIntersectsViewport(points: Point[], rect: Rect) {
  if (points.some((point) => pointInsideRect(point, rect))) return true
  for (let index = 1; index < points.length; index += 1) {
    if (segmentIntersectsViewport(points[index - 1], points[index], rect)) return true
  }
  return false
}

function networkSelectionToken(networkId: string) {
  return `${NETWORK_SELECTION_PREFIX}${networkId}`
}

function selectedNetworkId(selection: string | null) {
  return selection?.startsWith(NETWORK_SELECTION_PREFIX)
    ? selection.slice(NETWORK_SELECTION_PREFIX.length)
    : null
}

function selectedConnectionEdges(
  selection: string | null,
  networks: ConnectionNetwork[],
) {
  if (!selection) return []
  const networkId = selectedNetworkId(selection)
  if (networkId) return networks.find((network) => network.id === networkId)?.edges ?? []
  const selectedEdgeIds = selection.startsWith(MULTI_CONNECTION_SELECTION_PREFIX)
    ? new Set(selection.slice(MULTI_CONNECTION_SELECTION_PREFIX.length).split(',').filter(Boolean))
    : new Set([selection])
  return networks.flatMap((network) => (
    network.edges.filter((edge) => selectedEdgeIds.has(edge.id))
  ))
}

function connectionSelectionToken(edgeIds: string[]) {
  const uniqueIds = [...new Set(edgeIds)]
  if (uniqueIds.length === 0) return null
  if (uniqueIds.length === 1) return uniqueIds[0]
  return `${MULTI_CONNECTION_SELECTION_PREFIX}${uniqueIds.join(',')}`
}

function connectionSelectionExists(
  selection: string,
  networks: ConnectionNetwork[],
) {
  const networkId = selectedNetworkId(selection)
  return networkId
    ? networks.some((network) => network.id === networkId)
    : selectedConnectionEdges(selection, networks).length > 0
}

function routeContainsGridPoint(
  route: RoutedConnectionEdge,
  point: Point,
  gridSize: number,
) {
  const candidate = { x: snap(point.x, gridSize), y: snap(point.y, gridSize) }
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1]
    const end = route.points[index]
    if (
      (start.y === end.y && candidate.y === start.y &&
        candidate.x >= Math.min(start.x, end.x) && candidate.x <= Math.max(start.x, end.x)) ||
      (start.x === end.x && candidate.x === start.x &&
        candidate.y >= Math.min(start.y, end.y) && candidate.y <= Math.max(start.y, end.y))
    ) return true
  }
  return false
}

function cloneElement(element: DiagramElement): DiagramElement {
  return {
    ...element,
    monitorMetrics: element.monitorMetrics
      ? structuredClone(element.monitorMetrics)
      : undefined,
    properties: structuredClone(element.properties),
    extensions: structuredClone(element.extensions),
  }
}

function cloneBusbar(busbar: Busbar): Busbar {
  return { ...busbar }
}

function copiedSelectionOffset(
  elements: DiagramElement[],
  busbars: Busbar[],
  hasInternalConnections: boolean,
  gridSize: number,
  copyIndex = 1,
): Point {
  const baseOffset = gridSize * 2
  if (!hasInternalConnections) {
    return { x: baseOffset * copyIndex, y: baseOffset * copyIndex }
  }
  const bounds = diagramObjectsBounds(elements, busbars)
  if (!bounds) return { x: baseOffset * copyIndex, y: baseOffset * copyIndex }
  const clearX = Math.ceil((bounds.width + baseOffset) / gridSize) * gridSize
  const clearY = Math.ceil((bounds.height + baseOffset) / gridSize) * gridSize
  return clearX <= clearY
    ? { x: clearX * copyIndex, y: baseOffset * copyIndex }
    : { x: baseOffset * copyIndex, y: clearY * copyIndex }
}

function createElement(
  symbol: SymbolDefinition,
  diagramId: string,
  center: Point,
  gridSize: number,
  elements: DiagramElement[],
): DiagramElement {
  return {
    id: crypto.randomUUID(),
    diagramId,
    assetKey: symbol.key,
    name: symbol.name,
    x: snap(center.x - symbol.intrinsicWidth / 2, gridSize),
    y: snap(center.y - symbol.intrinsicHeight / 2, gridSize),
    width: symbol.intrinsicWidth,
    height: symbol.intrinsicHeight,
    rotation: 0,
    monitorDataVisible: false,
    monitorMetrics: [],
    properties: {
      tag: nextDeviceIdentifier(symbol.name, diagramId, elements),
    },
    extensions: {},
  }
}

function createBusbar(diagramId: string, center: Point, gridSize: number): Busbar {
  const length = snap(DEFAULT_BUSBAR_LENGTH, gridSize)
  return {
    id: crypto.randomUUID(),
    diagramId,
    type: 'electrical',
    orientation: 'horizontal',
    x: snap(center.x - length / 2, gridSize),
    y: snap(center.y, gridSize),
    length,
  }
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360
}

function displayedElementSize(element: DiagramElement) {
  const rotation = normalizeDegrees(element.rotation)
  const swapsDimensions = rotation === 90 || rotation === 270
  return {
    width: swapsDimensions ? element.height : element.width,
    height: swapsDimensions ? element.width : element.height,
  }
}

function scaleSelectedElements(
  elements: DiagramElement[],
  selectedIds: Set<string>,
  bounds: Rect,
  scale: number,
  gridSize: number,
) {
  return elements.map((element) => {
    if (!selectedIds.has(element.id)) return element
    const symbol = symbolsByKey.get(element.assetKey)
    if (!symbol) return element
    const baseScale = element.width / symbol.intrinsicWidth
    const size = getScaledSymbolSize(symbol, baseScale * scale, gridSize)
    const center = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    }
    const nextCenter = {
      x: bounds.x + (center.x - bounds.x) * scale,
      y: bounds.y + (center.y - bounds.y) * scale,
    }
    return {
      ...element,
      x: snap(nextCenter.x - size.width / 2, gridSize),
      y: snap(nextCenter.y - size.height / 2, gridSize),
      width: size.width,
      height: size.height,
    }
  })
}

function rotateSelectedElements(
  elements: DiagramElement[],
  selectedIds: Set<string>,
  center: Point,
  rotationDelta: number,
  gridSize: number,
) {
  return elements.map((element) => {
    if (!selectedIds.has(element.id)) return element
    const elementCenter = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    }
    const nextCenter = rotatePoint(elementCenter, center, rotationDelta)
    return {
      ...element,
      x: snap(nextCenter.x - element.width / 2, gridSize),
      y: snap(nextCenter.y - element.height / 2, gridSize),
      rotation: normalizeDegrees(element.rotation + rotationDelta),
    }
  })
}

function rotateSelectedBusbars(
  busbars: Busbar[],
  selectedIds: Set<string>,
  center: Point,
  rotationDelta: number,
  gridSize: number,
) {
  const swapsOrientation = Math.abs(Math.round(rotationDelta / 90)) % 2 === 1
  return busbars.map((busbar) => {
    if (!selectedIds.has(busbar.id)) return busbar
    const end = busbarEndPoint(busbar)
    const midpoint = rotatePoint({
      x: (busbar.x + end.x) / 2,
      y: (busbar.y + end.y) / 2,
    }, center, rotationDelta)
    const orientation = swapsOrientation
      ? busbar.orientation === 'horizontal' ? 'vertical' : 'horizontal'
      : busbar.orientation
    return orientation === 'horizontal'
      ? {
          ...busbar,
          orientation,
          x: snap(midpoint.x - busbar.length / 2, gridSize),
          y: snap(midpoint.y, gridSize),
        }
      : {
          ...busbar,
          orientation,
          x: snap(midpoint.x, gridSize),
          y: snap(midpoint.y - busbar.length / 2, gridSize),
        }
  })
}

function busbarsEqual(left: Busbar[], right: Busbar[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((busbar, index) => {
    const candidate = right[index]
    return busbar.id === candidate.id &&
      busbar.x === candidate.x &&
      busbar.y === candidate.y &&
      busbar.length === candidate.length &&
      busbar.orientation === candidate.orientation &&
      busbar.color === candidate.color &&
      busbar.label === candidate.label &&
      busbar.labelEndpoint === candidate.labelEndpoint
  })
}

function useElementSize(elementRef: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 1, height: 1 })

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const update = () => {
      const rect = element.getBoundingClientRect()
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef])

  return size
}

export const DiagramCanvas = memo(forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(
  function DiagramCanvas(
    {
      mode,
      animationPlaying,
      switchStates,
      diagramId,
      lineSystemType,
      documentEpoch,
      gridSize,
      viewport,
      assets,
      elements,
      busbars,
      connections,
      onDiagramChange,
      onSelectionChange,
      onCommandStateChange,
      onPointerChange,
      onSwitchStateChange,
      onActionMessage,
    },
    ref,
  ) {
    const monitorMetricReadings = useMonitorMetricReadings(mode === 'monitor', elements)
    const viewportElementRef = useRef<HTMLDivElement>(null)
    const callbacksRef = useRef({
      onDiagramChange,
      onSelectionChange,
      onCommandStateChange,
      onPointerChange,
      onSwitchStateChange,
      onActionMessage,
    })
    const committedElementsRef = useRef(elements)
    const committedBusbarsRef = useRef(busbars)
    const committedConnectionsRef = useRef(connections)
    const viewportValueRef = useRef(viewport)
    const selectedIdsRef = useRef<string[]>([])
    const selectedConnectionIdRef = useRef<string | null>(null)
    const selectedBusbarIdsRef = useRef<string[]>([])
    const wiringRef = useRef<WiringState | null>(null)
    const hoveredWiringTargetRef = useRef<ConnectionTerminal | null>(null)
    const historyRef = useRef<HistoryState>({ past: [], future: [] })
    const clipboardRef = useRef<DiagramSelectionClipboard>(createEmptySelectionClipboard())
    const pasteCountRef = useRef(0)
    const interactionRef = useRef<Interaction | null>(null)
    const previewElementsRef = useRef<DiagramElement[] | null>(null)
    const previewBusbarsRef = useRef<Busbar[] | null>(null)
    const previewConnectionsRef = useRef<ConnectionNetwork[] | null>(null)
    const connectionLabelPlacementPreviewRef = useRef<ConnectionLabelPlacement | null>(null)
    const nudgeSessionActiveRef = useRef(false)
    const nudgeCommitRef = useRef<() => void>(() => undefined)
    const symbolColorDefsRef = useRef<SVGDefsElement | null>(null)
    const elementNodeRefs = useRef(new Map<string, SVGGElement>())
    const elementLabelLayoutCacheRef = useRef(new Map<string, ElementLabelLayout>())
    const busbarNodeRefs = useRef(new Map<string, SVGGElement>())
    const busbarTapNodeRefs = useRef(new Map<string, SVGCircleElement>())
    const busbarCandidateNodeRef = useRef<SVGCircleElement | null>(null)
    const connectionEdgeNodeRefs = useRef(new Map<string, SVGGElement>())
    const renderedConnectionPathCacheRef = useRef(new Map<string, {
      route: RoutedConnectionEdge
      crossingKey: string
      gridSize: number
      rendered: ReturnType<typeof bridgedPathData>
    }>())
    const startElementMoveRef = useRef<
      (event: PointerEvent<SVGImageElement>, elementId: string) => void
    >(() => undefined)
    const startLabelDragRef = useRef<
      (event: PointerEvent<SVGRectElement>, elementId: string) => void
    >(() => undefined)
    const startBusbarLabelDragRef = useRef<
      (event: PointerEvent<SVGRectElement>, busbarId: string) => void
    >(() => undefined)
    const startConnectionLabelDragRef = useRef<
      (event: PointerEvent<SVGRectElement>, edgeId: string) => void
    >(() => undefined)
    const enterAnchorRef = useRef<
      (elementId: string, anchorId: string, type: AnchorType) => void
    >(() => undefined)
    const leaveAnchorRef = useRef<
      (elementId: string, anchorId: string) => void
    >(() => undefined)
    const pressAnchorRef = useRef<(
      event: PointerEvent<SVGCircleElement>,
      elementId: string,
      anchorId: string,
      type: AnchorType,
    ) => void>(() => undefined)
    const pressConnectionEdgeRef = useRef<
      (event: PointerEvent<SVGPathElement>, edgeId: string) => void
    >(() => undefined)
    const toggleSwitchRef = useRef<(elementId: string, on: boolean) => void>(() => undefined)
    const hoverElementRef = useRef<(elementId: string | null) => void>(() => undefined)
    const previewElementColorsRef = useRef(new Map<
      string,
      { slot: SymbolColorSlot; color: string }
    >())
    const [viewportValue, setViewportValue] = useState(viewport)
    const [selectedIds, setSelectedIdsState] = useState<string[]>([])
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
    const [selectedBusbarIds, setSelectedBusbarIdsState] = useState<string[]>([])
    const [selectedLabelElementId, setSelectedLabelElementId] = useState<string | null>(null)
    const [selectedLabelBusbarId, setSelectedLabelBusbarId] = useState<string | null>(null)
    const [selectedLabelConnectionEdgeId, setSelectedLabelConnectionEdgeId] = useState<string | null>(null)
    const [wiring, setWiringState] = useState<WiringState | null>(null)
    const [hoveredWiringTarget, setHoveredWiringTarget] = useState<ConnectionTerminal | null>(null)
    const [busbarCandidate, setBusbarCandidate] = useState<BusbarCandidate | null>(null)
    const [previewElements, setPreviewElements] = useState<DiagramElement[] | null>(null)
    const [previewBusbars, setPreviewBusbars] = useState<Busbar[] | null>(null)
    const [previewConnections, setPreviewConnections] = useState<ConnectionNetwork[] | null>(null)
    const [connectionLabelPlacementPreview, setConnectionLabelPlacementPreviewState] = useState<
      ConnectionLabelPlacement | null
    >(null)
    const [provisionalConnectionRoutes, setProvisionalConnectionRoutes] = useState<
      ProvisionalConnectionRoute[]
    >([])
    const [marquee, setMarquee] = useState<Rect | null>(null)
    const [activeMoveElementIds, setActiveMoveElementIds] = useState<string[]>([])
    const [hoveredElementId, setHoveredElementId] = useState<string | null>(null)
    const [libraryDragTarget, setLibraryDragTarget] = useState<AlignmentTarget | null>(null)
    const lastPointerPositionRef = useRef<PointerPosition | null>(null)

    const diagramPreviewScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      (frame: DiagramPreviewFrame) => {
        setPreviewElements(frame.elements)
        setPreviewBusbars(frame.busbars)
        setPreviewConnections(frame.connections)
      },
    ), [])
    const wiringPointerScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      setWiringState,
    ), [])
    const pointerPositionScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      (position: PointerPosition) => callbacksRef.current.onPointerChange(position),
    ), [])
    const viewportFrameScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      (nextViewport: DiagramViewport) => {
        setViewportValue(nextViewport)
        queueMicrotask(emitCommandState)
      },
    ), [])
    const nudgeCommitScheduler = useMemo(() => createTrailingScheduler(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle),
      NUDGE_COMMIT_DELAY_MS,
      () => nudgeCommitRef.current(),
    ), [])
    const canvasSize = useElementSize(viewportElementRef)
    const gridScale = getAdaptiveGridScale(gridSize, viewportValue.zoom)
    const gridRenderStateRef = useRef<GridRenderState>({
      viewport: viewportValue,
      worldStep: gridScale.worldStep,
    })
    const gridInvalidateRef = useRef<(() => void) | null>(null)

    useLayoutEffect(() => {
      gridRenderStateRef.current = {
        viewport: viewportValue,
        worldStep: gridScale.worldStep,
      }
      gridInvalidateRef.current?.()
    }, [
      gridScale.worldStep,
      viewportValue.tx,
      viewportValue.ty,
      viewportValue.zoom,
    ])

    callbacksRef.current = {
      onDiagramChange,
      onSelectionChange,
      onCommandStateChange,
      onPointerChange,
      onSwitchStateChange,
      onActionMessage,
    }
    toggleSwitchRef.current = (elementId, on) => {
      if (mode === 'monitor') callbacksRef.current.onSwitchStateChange(elementId, on)
    }
    hoverElementRef.current = setHoveredElementId

    const emitCommandState = () => {
      callbacksRef.current.onCommandStateChange({
        canUndo: historyRef.current.past.length > 0,
        canRedo: historyRef.current.future.length > 0,
        canCopy:
          selectedIdsRef.current.length > 0 ||
          selectedBusbarIdsRef.current.length > 0,
        hasSelection:
          selectedIdsRef.current.length > 0 ||
          selectedConnectionIdRef.current !== null ||
          selectedBusbarIdsRef.current.length > 0,
        zoom: viewportValueRef.current.zoom,
        selectedConnection: selectedConnectionIdRef.current !== null,
        selectedBusbar: selectedBusbarIdsRef.current.length > 0,
        selectedConnectionId: selectedConnectionIdRef.current,
        selectedConnectionEdgeIds: selectedConnectionEdges(
          selectedConnectionIdRef.current,
          committedConnectionsRef.current,
        ).map((edge) => edge.id),
        selectedBusbarIds: [...selectedBusbarIdsRef.current],
        wiringType: wiringRef.current?.source.type ?? null,
      })
    }

    const setObjectSelection = (
      elementIds: string[],
      busbarIds: string[],
      preserveConnections = false,
    ) => {
      const uniqueElementIds = [...new Set(elementIds)]
      const uniqueBusbarIds = [...new Set(busbarIds)]
      const selectionUnchanged =
        uniqueElementIds.length === selectedIdsRef.current.length &&
        uniqueElementIds.every((id, index) => id === selectedIdsRef.current[index]) &&
        uniqueBusbarIds.length === selectedBusbarIdsRef.current.length &&
        uniqueBusbarIds.every((id, index) => id === selectedBusbarIdsRef.current[index])
      if (
        uniqueElementIds.length !== 1 ||
        uniqueBusbarIds.length !== 0 ||
        uniqueElementIds[0] !== selectedIdsRef.current[0]
      ) setSelectedLabelElementId(null)
      if (
        uniqueBusbarIds.length !== 1 ||
        uniqueElementIds.length !== 0 ||
        uniqueBusbarIds[0] !== selectedBusbarIdsRef.current[0]
      ) setSelectedLabelBusbarId(null)
      if (uniqueElementIds.length > 0 || uniqueBusbarIds.length > 0) {
        setSelectedLabelConnectionEdgeId(null)
        setConnectionLabelPlacementPreview(null)
      }
      if (
        selectionUnchanged &&
        (preserveConnections || selectedConnectionIdRef.current === null)
      ) {
        if (busbarCandidate) setBusbarCandidate(null)
        return
      }
      if (
        uniqueElementIds.length ||
        (uniqueBusbarIds.length && !preserveConnections)
      ) {
        selectedConnectionIdRef.current = null
        setSelectedConnectionId(null)
      }
      selectedIdsRef.current = uniqueElementIds
      selectedBusbarIdsRef.current = uniqueBusbarIds
      setSelectedIdsState(uniqueElementIds)
      setSelectedBusbarIdsState(uniqueBusbarIds)
      setBusbarCandidate(null)
      callbacksRef.current.onSelectionChange(uniqueElementIds)
      queueMicrotask(emitCommandState)
    }

    const setSelection = (ids: string[], preserveBusbars = false) => {
      setObjectSelection(ids, preserveBusbars ? selectedBusbarIdsRef.current : [])
    }

    const selectConnection = (
      selection: string | null,
      preserveBusbars = false,
    ) => {
      setSelectedLabelConnectionEdgeId(null)
      setConnectionLabelPlacementPreview(null)
      selectedConnectionIdRef.current = selection
      setSelectedConnectionId(selection)
      if (selection) {
        setSelectedLabelElementId(null)
        setSelectedLabelBusbarId(null)
        selectedIdsRef.current = []
        setSelectedIdsState([])
        if (!preserveBusbars) {
          selectedBusbarIdsRef.current = []
          setSelectedBusbarIdsState([])
        }
        callbacksRef.current.onSelectionChange([])
      }
      queueMicrotask(emitCommandState)
    }

    const selectBusbar = (busbarId: string | null, preserveElements = false) => {
      setObjectSelection(
        preserveElements ? selectedIdsRef.current : [],
        busbarId ? [busbarId] : [],
      )
    }

    const setWiring = (next: WiringState | null) => {
      wiringPointerScheduler.cancel()
      const previousType = wiringRef.current?.source.type ?? null
      const nextType = next?.source.type ?? null
      wiringRef.current = next
      setWiringState(next)
      if (!next) {
        setBusbarCandidate(null)
        hoveredWiringTargetRef.current = null
        setHoveredWiringTarget(null)
      }
      if (previousType !== nextType) queueMicrotask(emitCommandState)
    }

    const setPreview = (next: DiagramElement[] | null) => {
      diagramPreviewScheduler.cancel()
      previewElementsRef.current = next
      setPreviewElements(next)
    }

    const schedulePreview = (next: DiagramElement[]) => {
      const current = previewElementsRef.current ?? committedElementsRef.current
      if (elementsEqual(current, next)) return
      previewElementsRef.current = next
      diagramPreviewScheduler.schedule({
        elements: next,
        busbars: previewBusbarsRef.current,
        connections: previewConnectionsRef.current,
      })
    }

    const scheduleDiagramPreview = (
      nextElements: DiagramElement[] | null,
      nextBusbars: Busbar[] | null,
      nextConnections: ConnectionNetwork[] | null,
    ) => {
      const currentElements = previewElementsRef.current ?? committedElementsRef.current
      const currentBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
      const elementsUnchanged = nextElements === null || elementsEqual(currentElements, nextElements)
      const busbarsUnchanged = nextBusbars === null || busbarsEqual(currentBusbars, nextBusbars)
      if (elementsUnchanged && busbarsUnchanged) return
      previewElementsRef.current = nextElements
      previewBusbarsRef.current = nextBusbars
      previewConnectionsRef.current = nextConnections
      diagramPreviewScheduler.schedule({
        elements: nextElements,
        busbars: nextBusbars,
        connections: nextConnections,
      })
    }

    const scheduleWiringPointer = (point: Point) => {
      const current = wiringRef.current
      if (!current || hoveredWiringTargetRef.current) return
      const pointer = {
        x: snap(point.x, gridSize),
        y: snap(point.y, gridSize),
      }
      if (current.pointer.x === pointer.x && current.pointer.y === pointer.y) return
      const next = { ...current, pointer }
      wiringRef.current = next
      wiringPointerScheduler.schedule(next)
    }

    const schedulePointerPosition = (point: Point) => {
      const position = { x: Math.round(point.x), y: Math.round(point.y) }
      const previous = lastPointerPositionRef.current
      if (previous?.x === position.x && previous.y === position.y) return
      lastPointerPositionRef.current = position
      pointerPositionScheduler.schedule(position)
    }

    const setBusbarPreview = (next: Busbar[] | null) => {
      diagramPreviewScheduler.cancel()
      previewBusbarsRef.current = next
      setPreviewBusbars(next)
    }

    const setConnectionPreview = (next: ConnectionNetwork[] | null) => {
      diagramPreviewScheduler.cancel()
      previewConnectionsRef.current = next
      setPreviewConnections(next)
    }

    const setConnectionLabelPlacementPreview = (next: ConnectionLabelPlacement | null) => {
      connectionLabelPlacementPreviewRef.current = next
      setConnectionLabelPlacementPreviewState((current) => (
        current?.edgeId === next?.edgeId &&
        current?.endpoint === next?.endpoint &&
        current?.side === next?.side
          ? current
          : next
      ))
    }

    const commitDiagram = (
      nextElements: DiagramElement[],
      nextBusbars: Busbar[],
      nextConnections: ConnectionNetwork[],
    ) => {
      if (mode !== 'edit') return false
      const current: EditorSnapshot = {
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
      }
      if (
        elementsEqual(current.elements, nextElements) &&
        JSON.stringify(current.busbars) === JSON.stringify(nextBusbars) &&
        JSON.stringify(current.connections) === JSON.stringify(nextConnections)
      ) {
        setPreview(null)
        setBusbarPreview(null)
        setConnectionPreview(null)
        return false
      }
      historyRef.current.past = [...historyRef.current.past.slice(-(HISTORY_LIMIT - 1)), current]
      historyRef.current.future = []
      committedElementsRef.current = nextElements
      committedBusbarsRef.current = nextBusbars
      committedConnectionsRef.current = nextConnections
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      callbacksRef.current.onDiagramChange(nextElements, nextBusbars, nextConnections)
      queueMicrotask(emitCommandState)
      return true
    }

    const commitElements = (nextElements: DiagramElement[]) => commitDiagram(
      nextElements,
      committedBusbarsRef.current,
      committedConnectionsRef.current,
    )

    const commitBusbars = (nextBusbars: Busbar[]) => commitDiagram(
      committedElementsRef.current,
      nextBusbars,
      committedConnectionsRef.current,
    )

    const commitConnections = (nextConnections: ConnectionNetwork[]) => commitDiagram(
      committedElementsRef.current,
      committedBusbarsRef.current,
      nextConnections,
    )

    const commitPendingNudge = () => {
      if (!nudgeSessionActiveRef.current) return false
      nudgeSessionActiveRef.current = false
      return commitDiagram(
        previewElementsRef.current ?? committedElementsRef.current,
        previewBusbarsRef.current ?? committedBusbarsRef.current,
        previewConnectionsRef.current ?? committedConnectionsRef.current,
      )
    }
    nudgeCommitRef.current = commitPendingNudge

    const flushPendingNudge = () => {
      nudgeCommitScheduler.cancel()
      commitPendingNudge()
    }

    const applyViewport = (nextViewport: DiagramViewport) => {
      viewportValueRef.current = nextViewport
      viewportFrameScheduler.schedule(nextViewport)
    }

    const clientPoint = (clientX: number, clientY: number): Point => {
      const rect = viewportElementRef.current?.getBoundingClientRect()
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
    }

    const worldPoint = (clientX: number, clientY: number) =>
      screenToWorld(clientPoint(clientX, clientY), viewportValueRef.current)

    const displayedElements = previewElements ?? elements
    const displayedBusbars = previewBusbars ?? busbars
    const displayedConnections = previewConnections ?? connections
    const displayedBusbarsById = useMemo(
      () => new Map(displayedBusbars.map((busbar) => [busbar.id, busbar])),
      [displayedBusbars],
    )
    const selectedConnectionEdgeIdSet = useMemo(() => new Set(
      selectedConnectionEdges(selectedConnectionId, displayedConnections).map((edge) => edge.id),
    ), [displayedConnections, selectedConnectionId])
    const displayedConnectionEdgesById = useMemo(() => new Map(
      displayedConnections.flatMap((network) => network.edges.map((edge) => [edge.id, edge] as const)),
    ), [displayedConnections])
    const routeInput = useMemo(() => ({
      scopeKey: `${documentEpoch}:${diagramId}`,
      networks: connections,
      elements,
      assets,
      gridSize,
      busbars,
    }), [assets, busbars, connections, diagramId, documentEpoch, elements, gridSize])
    const {
      routed: computedRoutedConnections,
      isRouting,
      routeStats,
    } = useRoutedConnections(routeInput)
    const committedRoutedConnections = useMemo(() => {
      const computedEdgeIds = new Set(
        computedRoutedConnections.edges.map((edge) => edge.edgeId),
      )
      const currentEdges = new Map(connections.flatMap((network) => (
        network.edges.map((edge) => [edge.id, { network, edge }] as const)
      )))
      const pending = provisionalConnectionRoutes.flatMap((provisional) => {
        if (
          provisional.scopeKey !== routeInput.scopeKey ||
          computedEdgeIds.has(provisional.route.edgeId)
        ) return []
        const current = currentEdges.get(provisional.route.edgeId)
        return current ? [{
          ...provisional.route,
          networkId: current.network.id,
          type: current.network.type,
          sourceNodeId: current.edge.sourceNodeId,
          targetNodeId: current.edge.targetNodeId,
          order: computedRoutedConnections.edges.length + provisional.route.order,
        }] : []
      })
      return pending.length ? {
        ...computedRoutedConnections,
        edges: [...computedRoutedConnections.edges, ...pending],
      } : computedRoutedConnections
    }, [computedRoutedConnections, connections, provisionalConnectionRoutes, routeInput.scopeKey])
    useEffect(() => {
      const computedEdgeIds = new Set(
        computedRoutedConnections.edges.map((edge) => edge.edgeId),
      )
      const currentEdgeIds = new Set(
        connections.flatMap((network) => network.edges.map((edge) => edge.id)),
      )
      setProvisionalConnectionRoutes((current) => {
        const next = current.filter((provisional) => (
          provisional.scopeKey === routeInput.scopeKey &&
          currentEdgeIds.has(provisional.route.edgeId) &&
          !computedEdgeIds.has(provisional.route.edgeId)
        ))
        return next.length === current.length ? current : next
      })
    }, [computedRoutedConnections.edges, connections, routeInput.scopeKey])
    const routedConnections = useMemo(() => {
      if (previewElements || previewBusbars || previewConnections) {
        return previewConnectionRoutesForDiagram(
          committedRoutedConnections,
          connections,
          displayedConnections,
          elements,
          displayedElements,
          assets,
          gridSize,
          busbars,
          displayedBusbars,
        )
      }
      return committedRoutedConnections
    }, [
      assets,
      busbars,
      committedRoutedConnections,
      connections,
      displayedBusbars,
      displayedConnections,
      displayedElements,
      elements,
      gridSize,
      previewBusbars,
      previewConnections,
      previewElements,
    ])
    const renderWorldRect = useMemo(() => {
      const overscan = RENDER_OVERSCAN_SCREEN_PX / viewportValue.zoom
      return {
        x: -viewportValue.tx / viewportValue.zoom - overscan,
        y: -viewportValue.ty / viewportValue.zoom - overscan,
        width: canvasSize.width / viewportValue.zoom + overscan * 2,
        height: canvasSize.height / viewportValue.zoom + overscan * 2,
      }
    }, [canvasSize.height, canvasSize.width, viewportValue])
    const cullingEnabled = displayedElements.length + displayedBusbars.length +
      routedConnections.edges.length > RENDER_CULLING_OBJECT_THRESHOLD
    const visibleElements = useMemo(() => {
      if (!cullingEnabled) return displayedElements
      const retainedIds = new Set([
        ...selectedIds,
        ...activeMoveElementIds,
        ...(hoveredElementId ? [hoveredElementId] : []),
        ...(wiring?.source.kind === 'anchor' ? [wiring.source.elementId] : []),
      ])
      return displayedElements.filter((element) => {
        if (retainedIds.has(element.id)) return true
        const bounds = elementsBounds([element])
        return bounds ? rectsIntersect(bounds, renderWorldRect) : false
      })
    }, [
      activeMoveElementIds,
      cullingEnabled,
      displayedElements,
      hoveredElementId,
      renderWorldRect,
      selectedIds,
      wiring,
    ])
    const visibleBusbars = useMemo(() => {
      if (!cullingEnabled) return displayedBusbars
      const retainedIds = new Set([
        ...selectedBusbarIds,
        ...(wiring?.source.kind === 'busbar' ? [wiring.source.busbarId] : []),
      ])
      return displayedBusbars.filter((busbar) => (
        retainedIds.has(busbar.id) ||
        segmentIntersectsViewport(busbar, busbarEndPoint(busbar), renderWorldRect)
      ))
    }, [cullingEnabled, displayedBusbars, renderWorldRect, selectedBusbarIds, wiring])
    const visibleRoutes = useMemo(() => {
      if (!cullingEnabled) return routedConnections.edges
      return routedConnections.edges.filter((route) => (
        selectedConnectionEdgeIdSet.has(route.edgeId) ||
        polylineIntersectsViewport(route.points, renderWorldRect)
      ))
    }, [
      cullingEnabled,
      renderWorldRect,
      routedConnections.edges,
      selectedConnectionEdgeIdSet,
    ])
    const occupiedAnchors = useMemo(
      () => occupiedAnchorKeys(displayedConnections),
      [displayedConnections],
    )
    const forbiddenCrossings = useMemo(
      () => crossingPointKeys(routedConnections.crossings),
      [routedConnections.crossings],
    )
    const crossingsByEdgeId = useMemo(
      () => indexConnectionCrossings(routedConnections.crossings),
      [routedConnections.crossings],
    )
    const renderedConnectionPaths = useMemo(() => {
      const cache = renderedConnectionPathCacheRef.current
      const activeEdgeIds = new Set(routedConnections.edges.map((route) => route.edgeId))
      cache.forEach((_, edgeId) => {
        if (!activeEdgeIds.has(edgeId)) cache.delete(edgeId)
      })
      return new Map(visibleRoutes.map((route) => {
        const edgeCrossings = crossingsByEdgeId.get(route.edgeId) ?? []
        const crossingKey = edgeCrossings.map((crossing) => (
          `${crossing.x},${crossing.y}:${crossing.underEdgeId}`
        )).join('|')
        const cached = cache.get(route.edgeId)
        if (
          cached?.route === route &&
          cached.gridSize === gridSize &&
          cached.crossingKey === crossingKey
        ) return [route.edgeId, cached.rendered] as const
        const rendered = bridgedPathData(route, crossingsByEdgeId, gridSize)
        cache.set(route.edgeId, { route, crossingKey, gridSize, rendered })
        return [route.edgeId, rendered] as const
      }))
    }, [crossingsByEdgeId, gridSize, routedConnections.edges, visibleRoutes])
    const powerFlowTopology = useMemo(() => lineSystemType === 'power'
      ? derivePowerFlowTopology({
          elements: displayedElements,
          busbars: displayedBusbars,
          networks: displayedConnections,
          switchStates,
          resolvedBusbarTapOffsets: routedConnections.resolvedBusbarTapOffsets,
        })
      : { edges: [], busbarSegments: [], energizedElementIds: new Set<string>() }, [
        displayedBusbars,
        displayedConnections,
        displayedElements,
        lineSystemType,
        routedConnections.resolvedBusbarTapOffsets,
        switchStates,
      ])
    const monitorFlowPaths = useMemo<MonitorFlowPath[]>(() => {
      if (mode !== 'monitor' || !animationPlaying) return []
      const directionByEdgeId = new Map(
        powerFlowTopology.edges.map((edge) => [edge.edgeId, edge.direction]),
      )
      const edgePaths = visibleRoutes.flatMap((route) => {
        const direction = directionByEdgeId.get(route.edgeId)
        if (!direction) return []
        const points = bridgedPolylinePoints(
          route,
          crossingsByEdgeId,
          gridSize,
        )
        return points.length > 1 ? [{
          id: `edge-flow:${route.edgeId}`,
          points: direction === 'forward' ? points : [...points].reverse(),
        }] : []
      })
      return [
        ...edgePaths,
        ...powerFlowTopology.busbarSegments.flatMap((segment) => (
          !cullingEnabled || segmentIntersectsViewport(segment.start, segment.end, renderWorldRect)
            ? [{
                id: segment.id,
                points: [segment.start, segment.end],
                screenWidth: FLOW_BUSBAR_SCREEN_WIDTH,
              }]
            : []
        )),
      ]
    }, [
      animationPlaying,
      cullingEnabled,
      crossingsByEdgeId,
      gridSize,
      mode,
      powerFlowTopology.busbarSegments,
      powerFlowTopology.edges,
      renderWorldRect,
      visibleRoutes,
    ])
    const assetsByKey = useMemo(
      () => new Map(assets.map((asset) => [asset.key, asset])),
      [assets],
    )
    const elementLabelLayouts = useMemo(() => {
      const nextCache = new Map<string, ElementLabelLayout>()
      const layouts = layoutElementLabels(visibleElements, assetsByKey, {
        readings: monitorMetricReadings,
      }).map((layout) => {
        const previous = elementLabelLayoutCacheRef.current.get(layout.elementId)
        const stable = previous &&
          previous.text === layout.text &&
          previous.placement === layout.placement &&
          previous.bounds.x === layout.bounds.x &&
          previous.bounds.y === layout.bounds.y &&
          previous.bounds.width === layout.bounds.width &&
          previous.bounds.height === layout.bounds.height
          ? previous
          : layout
        nextCache.set(layout.elementId, stable)
        return stable
      })
      elementLabelLayoutCacheRef.current = nextCache
      return layouts
    }, [assetsByKey, monitorMetricReadings, visibleElements])
    const busbarLabelLayouts = useMemo(
      () => layoutBusbarLabels(visibleBusbars),
      [visibleBusbars],
    )
    const connectionLabelLayouts = useMemo(
      () => layoutConnectionLabels(
        visibleRoutes,
        displayedConnections,
        connectionLabelPlacementPreview,
      ),
      [connectionLabelPlacementPreview, displayedConnections, visibleRoutes],
    )
    const wiringPreviewContext = useMemo(() => wiring
      ? prepareConnectionPreview(
          wiring.source,
          displayedConnections,
          displayedElements,
          assets,
          gridSize,
          displayedBusbars,
          routedConnections,
        )
      : null, [
        assets,
        displayedBusbars,
        displayedConnections,
        displayedElements,
        gridSize,
        routedConnections,
        wiring?.source,
      ])
    const wiringPreview = useMemo(() => wiring && wiringPreviewContext
      ? routeConnectionPreviewWithContext(
          wiringPreviewContext,
          busbarCandidate?.point ?? wiring.pointer,
          hoveredWiringTarget,
        )
      : null, [busbarCandidate, hoveredWiringTarget, wiring, wiringPreviewContext])

    const anchorAllowedOnDiagram = (type: AnchorType) => (
      lineSystemType === 'power' ? type === 'electrical' : type !== 'electrical'
    )

    const finishWiring = (target: ConnectionTerminal) => {
      const active = wiringRef.current
      if (!active || !connectionTypesCompatible(active.source.type, target.type)) return false
      if (
        active.source.kind === 'anchor' &&
        target.kind === 'anchor' &&
        active.source.elementId === target.elementId &&
        active.source.anchorId === target.anchorId
      ) return false
      const next = connectTerminals(
        committedConnectionsRef.current,
        diagramId,
        active.source,
        target,
      )
      if (!next) return false
      const targetPoint = target.kind === 'anchor'
        ? resolveAnchorByReferencePoint(target.elementId, target.anchorId)
        : target.point
      const route = targetPoint && wiringPreviewContext
        ? routeConnectionPreviewWithContext(
        wiringPreviewContext,
        targetPoint,
        target,
      ) : null
      if (!route) return false
      const existingEdgeIds = new Set(committedConnectionsRef.current.flatMap((network) => (
        network.edges.map((edge) => edge.id)
      )))
      const added = next.flatMap((network) => network.edges.flatMap((edge) => (
        existingEdgeIds.has(edge.id) ? [] : [{ network, edge }]
      )))[0]
      if (added) {
        const provisional: ProvisionalConnectionRoute = {
          scopeKey: routeInput.scopeKey,
          route: {
            networkId: added.network.id,
            edgeId: added.edge.id,
            type: added.network.type,
            sourceNodeId: added.edge.sourceNodeId,
            targetNodeId: added.edge.targetNodeId,
            points: route,
            order: committedRoutedConnections.edges.length,
          },
        }
        setProvisionalConnectionRoutes((current) => [
          ...current.filter((candidate) => candidate.route.edgeId !== provisional.route.edgeId),
          provisional,
        ])
      }
      commitConnections(next)
      setWiring(null)
      selectConnection(null)
      selectBusbar(null)
      return true
    }

    const handleAnchorPointerDown = (
      event: PointerEvent<SVGCircleElement>,
      elementId: string,
      anchorId: string,
      type: AnchorType,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      const terminal: ConnectionTerminal = { kind: 'anchor', elementId, anchorId, type }
      if (wiringRef.current) {
        finishWiring(terminal)
        return
      }
      if (!anchorAllowedOnDiagram(type)) return
      setSelection([])
      selectConnection(null)
      selectBusbar(null)
      setWiring({
        source: terminal,
        pointer: resolveAnchorByReferencePoint(elementId, anchorId) ?? { x: 0, y: 0 },
      })
    }

    const handleAnchorPointerEnter = (
      elementId: string,
      anchorId: string,
      type: AnchorType,
    ) => {
      const active = wiringRef.current
      if (!active || !connectionTypesCompatible(active.source.type, type)) return
      if (
        active.source.kind === 'anchor' &&
        active.source.elementId === elementId &&
        active.source.anchorId === anchorId
      ) return
      const target: ConnectionTerminal = { kind: 'anchor', elementId, anchorId, type }
      hoveredWiringTargetRef.current = target
      setHoveredWiringTarget(target)
    }

    const handleAnchorPointerLeave = (elementId: string, anchorId: string) => {
      const current = hoveredWiringTargetRef.current
      if (
        current?.kind !== 'anchor' ||
        current.elementId !== elementId ||
        current.anchorId !== anchorId
      ) return
      hoveredWiringTargetRef.current = null
      setHoveredWiringTarget(null)
    }

    const resolveAnchorByReferencePoint = (elementId: string, anchorId: string) => {
      const element = displayedElements.find((candidate) => candidate.id === elementId)
      const asset = element ? assetsByKey.get(element.assetKey) : undefined
      const anchor = asset?.anchors.find((candidate) => candidate.id === anchorId)
      return element && asset && anchor ? resolveElementAnchor(element, asset, anchor).point : null
    }

    const handleConnectionPointerDown = (
      event: PointerEvent<SVGPathElement>,
      route: RoutedConnectionEdge,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      if (wiringRef.current) return
      const point = worldPoint(event.clientX, event.clientY)
      const sharedRouteCount = routedConnections.edges.filter((candidate) => (
        candidate.networkId === route.networkId &&
        routeContainsGridPoint(candidate, point, gridSize)
      )).length
      const clickedSelection = sharedRouteCount > 1
        ? networkSelectionToken(route.networkId)
        : route.edgeId
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      if (!additive) {
        selectConnection(clickedSelection)
        return
      }
      const currentEdgeIds = selectedConnectionEdges(
        selectedConnectionIdRef.current,
        committedConnectionsRef.current,
      ).map((edge) => edge.id)
      const clickedEdgeIds = selectedConnectionEdges(
        clickedSelection,
        committedConnectionsRef.current,
      ).map((edge) => edge.id)
      const clickedSet = new Set(clickedEdgeIds)
      const currentSet = new Set(currentEdgeIds)
      const allClickedSelected = clickedEdgeIds.every((edgeId) => currentSet.has(edgeId))
      const nextEdgeIds = allClickedSelected
        ? currentEdgeIds.filter((edgeId) => !clickedSet.has(edgeId))
        : [...currentEdgeIds, ...clickedEdgeIds.filter((edgeId) => !currentSet.has(edgeId))]
      selectConnection(connectionSelectionToken(nextEdgeIds), true)
    }

    const candidateForBusbar = (busbar: Busbar, point: Point) => {
      const activeWiring = wiringRef.current
      if (activeWiring) {
        if (activeWiring.source.type !== 'electrical') return null
        if (activeWiring.source.kind === 'busbar' && activeWiring.source.busbarId === busbar.id) {
          return null
        }
      } else if (
        selectedBusbarIdsRef.current.length !== 1 ||
        selectedBusbarIdsRef.current[0] !== busbar.id ||
        selectedIdsRef.current.length > 0 ||
        selectedConnectionIdRef.current !== null ||
        interactionRef.current !== null
      ) {
        return null
      }
      const candidate = nearestPointOnBusbar(busbar, point, gridSize)
      return forbiddenCrossings.has(`${candidate.point.x},${candidate.point.y}`)
        ? null
        : candidate
    }

    const handleBusbarPointerMove = (
      event: PointerEvent<SVGPathElement>,
      busbar: Busbar,
    ) => {
      const candidate = candidateForBusbar(busbar, worldPoint(event.clientX, event.clientY))
      setBusbarCandidate((current) => {
        if (!candidate) return null
        if (current?.busbar.id === busbar.id && current.offset === candidate.offset) return current
        return { busbar, ...candidate }
      })
    }

    const handleBusbarCandidatePointerDown = (event: PointerEvent<SVGCircleElement>) => {
      if (mode !== 'edit' || event.button !== 0 || !busbarCandidate) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      const terminal: ConnectionTerminal = {
        kind: 'busbar',
        busbarId: busbarCandidate.busbar.id,
        offset: busbarCandidate.offset,
        point: busbarCandidate.point,
        type: 'electrical',
      }
      if (wiringRef.current) {
        finishWiring(terminal)
        return
      }
      setWiring({ source: terminal, pointer: terminal.point })
      setBusbarCandidate(null)
    }

    const handleBusbarPointerDown = (
      event: PointerEvent<SVGPathElement>,
      busbar: Busbar,
    ) => {
      if (mode !== 'edit' || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      if (wiringRef.current) {
        const candidate = candidateForBusbar(busbar, worldPoint(event.clientX, event.clientY))
        if (candidate) finishWiring({
          kind: 'busbar',
          busbarId: busbar.id,
          offset: candidate.offset,
          point: candidate.point,
          type: 'electrical',
        })
        return
      }
      setSelectedLabelElementId(null)
      setSelectedLabelBusbarId(null)
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const alreadySelected = selectedBusbarIdsRef.current.includes(busbar.id)
      if (additive && alreadySelected) {
        setObjectSelection(
          selectedIdsRef.current,
          selectedBusbarIdsRef.current.filter((id) => id !== busbar.id),
          true,
        )
        return
      }
      const nextElementSelection = additive || alreadySelected ? selectedIdsRef.current : []
      const nextBusbarSelection = additive
        ? [...selectedBusbarIdsRef.current, busbar.id]
        : alreadySelected
          ? selectedBusbarIdsRef.current
          : [busbar.id]
      setObjectSelection(
        nextElementSelection,
        nextBusbarSelection,
        additive && nextElementSelection.length === 0,
      )
      interactionRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        baseElements: committedElementsRef.current,
        baseBusbars: committedBusbarsRef.current,
        selectedIds: nextElementSelection,
        selectedBusbarIds: nextBusbarSelection,
        hasMoved: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const deleteSelected = () => {
      const selectedConnectionEdgeIds = new Set(selectedConnectionEdges(
        selectedConnectionIdRef.current,
        committedConnectionsRef.current,
      ).map((edge) => edge.id))
      if (selectedConnectionEdgeIds.size > 0) {
        const selectedBusbars = new Set(selectedBusbarIdsRef.current)
        const nextBusbars = committedBusbarsRef.current.filter((busbar) => (
          !selectedBusbars.has(busbar.id)
        ))
        const nextConnections = normalizeConnectionNetworks(
          committedConnectionsRef.current.map((network) => ({
            ...network,
            edges: network.edges.filter((edge) => !selectedConnectionEdgeIds.has(edge.id)),
          })),
          committedElementsRef.current,
          assets,
          nextBusbars,
        )
        if (commitDiagram(
          committedElementsRef.current,
          nextBusbars,
          nextConnections,
        )) {
          selectConnection(null)
          setObjectSelection([], [])
        }
        return
      }
      const selectedElements = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      if (!selectedElements.size && !selectedBusbars.size) return
      const next = committedElementsRef.current.filter((element) => !selectedElements.has(element.id))
      const nextBusbars = committedBusbarsRef.current.filter((busbar) => !selectedBusbars.has(busbar.id))
      const nextConnections = normalizeConnectionNetworks(
        committedConnectionsRef.current,
        next,
        assets,
        nextBusbars,
      )
      if (commitDiagram(next, nextBusbars, nextConnections)) setObjectSelection([], [])
    }

    const copySelected = (operation: DiagramClipboardOperation = 'copy') => {
      const selectedElements = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      if (!selectedElements.size && !selectedBusbars.size) return false
      clipboardRef.current = {
        operation,
        sourceDiagramId: diagramId,
        sourceLineSystemType: lineSystemType,
        elements: committedElementsRef.current
          .filter((element) => selectedElements.has(element.id))
          .map(cloneElement),
        busbars: committedBusbarsRef.current
          .filter((busbar) => selectedBusbars.has(busbar.id))
          .map(cloneBusbar),
        connections: copyConnectionsWithinSelection(
          committedConnectionsRef.current,
          selectedElements,
          selectedBusbars,
        ),
      }
      pasteCountRef.current = 0
      return true
    }

    const cutSelected = () => {
      if (!copySelected('cut')) return
      deleteSelected()
    }

    const paste = () => {
      const clipboard = clipboardRef.current
      if (!clipboard.elements.length && !clipboard.busbars.length) return
      if (!clipboardCanPasteInto(clipboard, lineSystemType)) {
        callbacksRef.current.onActionMessage('只能粘贴到相同线路系统的图纸。', 'danger')
        return
      }
      const crossDiagram = clipboard.sourceDiagramId !== diagramId
      if (!crossDiagram) pasteCountRef.current += 1
      const offset = crossDiagram
        ? centeredSelectionOffset(
            clipboard.elements,
            clipboard.busbars,
            screenToWorld(
              { x: canvasSize.width / 2, y: canvasSize.height / 2 },
              viewportValueRef.current,
            ),
            gridSize,
          )
        : copiedSelectionOffset(
            clipboard.elements,
            clipboard.busbars,
            clipboard.connections.length > 0,
            gridSize,
            pasteCountRef.current,
          )
      const elementIdMap = new Map<string, string>()
      const busbarIdMap = new Map<string, string>()
      const pastedElements = clipboard.elements.map((element) => {
        const id = crypto.randomUUID()
        elementIdMap.set(element.id, id)
        return instantiateCopiedElement(element, {
          id,
          diagramId,
          x: snap(element.x + offset.x, gridSize),
          y: snap(element.y + offset.y, gridSize),
        })
      })
      const pastedBusbars = clipboard.busbars.map((busbar) => {
        const id = crypto.randomUUID()
        busbarIdMap.set(busbar.id, id)
        return {
          ...cloneBusbar(busbar),
          id,
          diagramId,
          x: snap(busbar.x + offset.x, gridSize),
          y: snap(busbar.y + offset.y, gridSize),
        }
      })
      const nextElements = [...committedElementsRef.current, ...pastedElements]
      const nextBusbars = [...committedBusbarsRef.current, ...pastedBusbars]
      const pastedConnections = instantiateCopiedConnections(
        clipboard.connections,
        diagramId,
        elementIdMap,
        busbarIdMap,
      )
      const nextConnections = normalizeConnectionNetworks(
        [...committedConnectionsRef.current, ...pastedConnections],
        nextElements,
        assets,
        nextBusbars,
      )
      if (commitDiagram(
        nextElements,
        nextBusbars,
        nextConnections,
      )) {
        if (crossDiagram) {
          clipboardRef.current = {
            operation: 'copy',
            sourceDiagramId: diagramId,
            sourceLineSystemType: lineSystemType,
            elements: pastedElements.map(cloneElement),
            busbars: pastedBusbars.map(cloneBusbar),
            connections: pastedConnections,
          }
          pasteCountRef.current = 0
        } else if (clipboard.operation === 'cut') {
          clipboardRef.current = { ...clipboard, operation: 'copy' }
        }
        setObjectSelection(
          pastedElements.map((element) => element.id),
          pastedBusbars.map((busbar) => busbar.id),
        )
      }
    }

    const duplicateSelected = () => {
      const selectedElements = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      if (!selectedElements.size && !selectedBusbars.size) return
      const duplicatedTopology = copyConnectionsWithinSelection(
        committedConnectionsRef.current,
        selectedElements,
        selectedBusbars,
      )
      const sourceElements = committedElementsRef.current.filter((element) => (
        selectedElements.has(element.id)
      ))
      const sourceBusbars = committedBusbarsRef.current.filter((busbar) => (
        selectedBusbars.has(busbar.id)
      ))
      const offset = copiedSelectionOffset(
        sourceElements,
        sourceBusbars,
        duplicatedTopology.length > 0,
        gridSize,
      )
      const elementIdMap = new Map<string, string>()
      const busbarIdMap = new Map<string, string>()
      const duplicatedElements = committedElementsRef.current.flatMap((element) => {
        if (!selectedElements.has(element.id)) return []
        const id = crypto.randomUUID()
        elementIdMap.set(element.id, id)
        return [instantiateCopiedElement(element, {
          id,
          diagramId,
          x: snap(element.x + offset.x, gridSize),
          y: snap(element.y + offset.y, gridSize),
        })]
      })
      const duplicatedBusbars = committedBusbarsRef.current.flatMap((busbar) => {
        if (!selectedBusbars.has(busbar.id)) return []
        const id = crypto.randomUUID()
        busbarIdMap.set(busbar.id, id)
        return [{
          ...cloneBusbar(busbar),
          id,
          x: snap(busbar.x + offset.x, gridSize),
          y: snap(busbar.y + offset.y, gridSize),
        }]
      })
      const duplicatedConnections = instantiateCopiedConnections(
        duplicatedTopology,
        diagramId,
        elementIdMap,
        busbarIdMap,
      )
      const nextElements = [...committedElementsRef.current, ...duplicatedElements]
      const nextBusbars = [...committedBusbarsRef.current, ...duplicatedBusbars]
      const nextConnections = normalizeConnectionNetworks(
        [...committedConnectionsRef.current, ...duplicatedConnections],
        nextElements,
        assets,
        nextBusbars,
      )
      if (commitDiagram(
        nextElements,
        nextBusbars,
        nextConnections,
      )) {
        setObjectSelection(
          duplicatedElements.map((element) => element.id),
          duplicatedBusbars.map((busbar) => busbar.id),
        )
      }
    }

    const undo = () => {
      if (mode !== 'edit') return
      const previous = historyRef.current.past.at(-1)
      if (!previous) return
      const current: EditorSnapshot = {
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
      }
      historyRef.current.past = historyRef.current.past.slice(0, -1)
      historyRef.current.future = [current, ...historyRef.current.future].slice(0, HISTORY_LIMIT)
      committedElementsRef.current = previous.elements
      committedBusbarsRef.current = previous.busbars
      committedConnectionsRef.current = previous.connections
      callbacksRef.current.onDiagramChange(
        previous.elements,
        previous.busbars,
        previous.connections,
      )
      setObjectSelection(
        selectedIdsRef.current.filter((id) => previous.elements.some((element) => element.id === id)),
        selectedBusbarIdsRef.current.filter((id) => previous.busbars.some((busbar) => busbar.id === id)),
        true,
      )
      if (
        selectedConnectionIdRef.current &&
        !connectionSelectionExists(selectedConnectionIdRef.current, previous.connections)
      ) selectConnection(null)
      emitCommandState()
    }

    const redo = () => {
      if (mode !== 'edit') return
      const next = historyRef.current.future[0]
      if (!next) return
      const current: EditorSnapshot = {
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
      }
      historyRef.current.future = historyRef.current.future.slice(1)
      historyRef.current.past = [...historyRef.current.past, current].slice(-HISTORY_LIMIT)
      committedElementsRef.current = next.elements
      committedBusbarsRef.current = next.busbars
      committedConnectionsRef.current = next.connections
      callbacksRef.current.onDiagramChange(next.elements, next.busbars, next.connections)
      setObjectSelection(
        selectedIdsRef.current.filter((id) => next.elements.some((element) => element.id === id)),
        selectedBusbarIdsRef.current.filter((id) => next.busbars.some((busbar) => busbar.id === id)),
        true,
      )
      if (
        selectedConnectionIdRef.current &&
        !connectionSelectionExists(selectedConnectionIdRef.current, next.connections)
      ) selectConnection(null)
      emitCommandState()
    }

    const zoomBy = (factor: number) => {
      const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
      applyViewport(
        zoomAroundPoint(viewportValueRef.current, center, viewportValueRef.current.zoom * factor),
      )
    }

    const insertSymbol = (symbolKey: string, center?: Point) => {
      const symbol = symbolsByKey.get(symbolKey)
      if (!symbol) return
      const worldCenter = center ?? screenToWorld(
        { x: canvasSize.width / 2, y: canvasSize.height / 2 },
        viewportValueRef.current,
      )
      const element = createElement(
        symbol,
        diagramId,
        worldCenter,
        gridSize,
        committedElementsRef.current,
      )
      if (commitElements([...committedElementsRef.current, element])) setSelection([element.id])
    }

    const insertBusbar = (center?: Point) => {
      if (lineSystemType !== 'power') return
      const worldCenter = center ?? screenToWorld(
        { x: canvasSize.width / 2, y: canvasSize.height / 2 },
        viewportValueRef.current,
      )
      const busbar = createBusbar(diagramId, worldCenter, gridSize)
      if (commitBusbars([...committedBusbarsRef.current, busbar])) selectBusbar(busbar.id)
    }

    const paintElementColor = (elementId: string, color: string) => {
      const elementNode = elementNodeRefs.current.get(elementId)
      const image = elementNode?.querySelector<SVGImageElement>('.diagram-element__image')
      if (!image) return
      const normalizedColor = normalizeSymbolColor(color)
      const filterId = symbolColorFilterId(normalizedColor)
      const defs = symbolColorDefsRef.current
      if (defs && !defs.querySelector(`#${filterId}`)) {
        const filter = document.createElementNS(SVG_NAMESPACE, 'filter')
        filter.id = filterId
        filter.setAttribute('x', '-5%')
        filter.setAttribute('y', '-5%')
        filter.setAttribute('width', '110%')
        filter.setAttribute('height', '110%')
        filter.setAttribute('color-interpolation-filters', 'sRGB')
        const flood = document.createElementNS(SVG_NAMESPACE, 'feFlood')
        flood.setAttribute('flood-color', normalizedColor)
        flood.setAttribute('result', 'symbol-color')
        const composite = document.createElementNS(SVG_NAMESPACE, 'feComposite')
        composite.setAttribute('in', 'symbol-color')
        composite.setAttribute('in2', 'SourceAlpha')
        composite.setAttribute('operator', 'in')
        filter.append(flood, composite)
        defs.append(filter)
      }
      image.dataset.symbolColor = normalizedColor
      image.setAttribute('filter', `url(#${filterId})`)
    }

    const previewElementColor = (
      elementId: string,
      color: string | null,
      requestedSlot?: SymbolColorSlot,
    ) => {
      const element = committedElementsRef.current.find((candidate) => candidate.id === elementId)
      if (!element) return
      const visualState: SymbolVisualState = element.assetKey === 'switch' && switchStates[elementId]
        ? 'on'
        : 'off'
      const activeSlot = symbolColorSlotForElement(element, visualState)
      const slot = requestedSlot ?? activeSlot
      if (color === null) {
        previewElementColorsRef.current.delete(elementId)
        paintElementColor(elementId, resolvedSymbolColor(element, visualState))
        return
      }
      const normalizedColor = normalizeSymbolColor(color)
      previewElementColorsRef.current.set(elementId, { slot, color: normalizedColor })
      if (slot === activeSlot) paintElementColor(elementId, normalizedColor)
    }

    const updateElement = (elementId: string, patch: Partial<DiagramElement>) => {
      previewElementColorsRef.current.delete(elementId)
      const next = committedElementsRef.current.map((element) => {
        if (element.id !== elementId) return element
        const symbol = symbolsByKey.get(element.assetKey)
        const normalizedPatch = { ...patch }
        if (normalizedPatch.x !== undefined) normalizedPatch.x = snap(normalizedPatch.x, gridSize)
        if (normalizedPatch.y !== undefined) normalizedPatch.y = snap(normalizedPatch.y, gridSize)
        if (normalizedPatch.rotation !== undefined) {
          normalizedPatch.rotation = normalizeDegrees(Math.round(normalizedPatch.rotation / 90) * 90)
          if (!element.labelPlacement) {
            normalizedPatch.labelPlacement = elementLabelLayouts.find((layout) => (
              layout.elementId === element.id
            ))?.placement
          }
        }
        if (symbol && (normalizedPatch.width !== undefined || normalizedPatch.height !== undefined)) {
          const requestedScale = normalizedPatch.width !== undefined
            ? normalizedPatch.width / symbol.intrinsicWidth
            : (normalizedPatch.height ?? element.height) / symbol.intrinsicHeight
          const size = getScaledSymbolSize(symbol, requestedScale, gridSize)
          normalizedPatch.width = size.width
          normalizedPatch.height = size.height
        }
        return { ...element, ...normalizedPatch }
      })
      if (patch.labelVisible === false) setSelectedLabelElementId(null)
      commitElements(next)
    }

    const updateBusbar = (busbarId: string, patch: Partial<Busbar>) => {
      const patchesLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
      const next = committedBusbarsRef.current.map((busbar) => {
        if (busbar.id !== busbarId) return busbar
        const updated: Busbar = { ...busbar, ...patch }
        if (!patchesLabel) return updated
        const label = patch.label?.trim()
        if (label) return { ...updated, label }
        const { label: _label, ...withoutLabel } = updated
        return withoutLabel
      })
      if (
        (patchesLabel && !patch.label?.trim()) ||
        patch.labelVisible === false
      ) setSelectedLabelBusbarId(null)
      commitBusbars(next)
    }

    const updateConnectionEdge = (edgeId: string, patch: Partial<ConnectionEdge>) => {
      const patchesLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
      const next = committedConnectionsRef.current.map((network) => ({
        ...network,
        edges: network.edges.map((edge) => {
          if (edge.id !== edgeId) return edge
          const updated: ConnectionEdge = { ...edge, ...patch }
          if (!patchesLabel) return updated
          const label = patch.label?.trim()
          if (label) return { ...updated, label }
          const { label: _label, ...withoutLabel } = updated
          return withoutLabel
        }),
      }))
      if (
        (patchesLabel && !patch.label?.trim()) ||
        patch.labelVisible === false
      ) {
        setSelectedLabelConnectionEdgeId(null)
        setConnectionLabelPlacementPreview(null)
      }
      commitConnections(next)
    }

    const paintBusbarColor = (busbarId: string, color: string | null) => {
      const busbarNode = busbarNodeRefs.current.get(busbarId)
      if (color) busbarNode?.style.setProperty('--busbar-color', color)
      else busbarNode?.style.removeProperty('--busbar-color')
      for (const tapNode of busbarTapNodeRefs.current.values()) {
        if (tapNode.dataset.busbarId === busbarId) {
          if (color) tapNode.style.setProperty('--busbar-color', color)
          else tapNode.style.removeProperty('--busbar-color')
        }
      }
      const candidateNode = busbarCandidateNodeRef.current
      if (candidateNode?.dataset.busbarId === busbarId) {
        if (color) candidateNode.style.setProperty('--busbar-color', color)
        else candidateNode.style.removeProperty('--busbar-color')
      }
    }

    const paintSelectionColor = (color: string | null) => {
      for (const busbarId of selectedBusbarIdsRef.current) {
        const busbar = committedBusbarsRef.current.find((candidate) => candidate.id === busbarId)
        if (!busbar) continue
        const nextColor = color === null
          ? busbar.color ?? null
          : normalizeHexColor(color, DEFAULT_BUSBAR_COLOR)
        paintBusbarColor(busbarId, nextColor)
      }
      const selectedEdgeIds = new Set(selectedConnectionEdges(
        selectedConnectionIdRef.current,
        committedConnectionsRef.current,
      ).map((edge) => edge.id))
      for (const network of committedConnectionsRef.current) {
        const fallback = defaultConnectionColor(network.type)
        for (const edge of network.edges) {
          if (!selectedEdgeIds.has(edge.id)) continue
          const node = connectionEdgeNodeRefs.current.get(edge.id)
          const nextColor = color === null
            ? edge.color
            : normalizeHexColor(color, fallback)
          if (nextColor) node?.style.setProperty('--connection-color', nextColor)
          else node?.style.removeProperty('--connection-color')
        }
      }
    }

    const previewCanvasColor = (target: CanvasColorTarget, color: string | null) => {
      const previewColor = color === null
        ? null
        : normalizeHexColor(color, target.color)

      if (target.category === 'element') {
        const slot = target.elementColorSlot ?? 'default'
        for (const element of committedElementsRef.current) {
          const currentColor = resolvedElementColor(element, slot)
          if (currentColor !== target.color) continue
          if (previewColor === null) previewElementColorsRef.current.delete(element.id)
          else previewElementColorsRef.current.set(element.id, { slot, color: previewColor })
          const visualState: SymbolVisualState = element.assetKey === 'switch' && switchStates[element.id]
            ? 'on'
            : 'off'
          if (slot === symbolColorSlotForElement(element, visualState)) {
            paintElementColor(
              element.id,
              previewColor ?? resolvedSymbolColorForSlot(element, slot),
            )
          }
        }
        return
      }

      if (target.category === 'busbar') {
        for (const busbar of committedBusbarsRef.current) {
          const currentColor = resolvedBusbarColor(busbar)
          if (currentColor !== target.color) continue
          paintBusbarColor(busbar.id, previewColor ?? busbar.color ?? null)
        }
        return
      }

      for (const network of committedConnectionsRef.current) {
        for (const edge of network.edges) {
          const currentColor = resolvedConnectionColor(network, edge)
          if (currentColor !== target.color) continue
          const node = connectionEdgeNodeRefs.current.get(edge.id)
          const nextColor = previewColor ?? edge.color ?? null
          if (nextColor) node?.style.setProperty('--connection-color', nextColor)
          else node?.style.removeProperty('--connection-color')
        }
      }
    }

    const updateCanvasColor = (target: CanvasColorTarget, color: string) => {
      previewCanvasColor(target, null)
      const next = replaceCanvasColor({
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
      }, target, color)
      commitDiagram(next.elements, next.busbars, next.connections)
    }

    const updateSelectionColor = (color: string | null) => {
      paintSelectionColor(null)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      const selectedEdgeIds = new Set(selectedConnectionEdges(
        selectedConnectionIdRef.current,
        committedConnectionsRef.current,
      ).map((edge) => edge.id))
      if (selectedBusbars.size === 0 && selectedEdgeIds.size === 0) return
      const normalizedBusbarColor = color === null
        ? null
        : normalizeHexColor(color, DEFAULT_BUSBAR_COLOR)
      const nextBusbars = committedBusbarsRef.current.map((busbar) => {
        if (!selectedBusbars.has(busbar.id)) return busbar
        if (normalizedBusbarColor) return { ...busbar, color: normalizedBusbarColor }
        const { color: _color, ...rest } = busbar
        return rest
      })
      const normalizedByType = new Map<AnchorType, string>()
      const nextConnections = committedConnectionsRef.current.map((network) => {
        return {
          ...network,
          edges: network.edges.map((edge) => {
            if (!selectedEdgeIds.has(edge.id)) return edge
            if (color === null) {
              const { color: _color, ...rest } = edge
              return rest
            }
            let normalized = normalizedByType.get(network.type)
            if (!normalized) {
              normalized = normalizeHexColor(color, defaultConnectionColor(network.type))
              normalizedByType.set(network.type, normalized)
            }
            return { ...edge, color: normalized }
          }),
        }
      })
      commitDiagram(committedElementsRef.current, nextBusbars, nextConnections)
    }

    useImperativeHandle(ref, () => ({
      undo,
      redo,
      copy: () => { copySelected() },
      cut: cutSelected,
      paste,
      duplicate: duplicateSelected,
      deleteSelected,
      selectAll: () => setObjectSelection(
        committedElementsRef.current.map((element) => element.id),
        committedBusbarsRef.current.map((busbar) => busbar.id),
      ),
      zoomIn: () => zoomBy(1.2),
      zoomOut: () => zoomBy(1 / 1.2),
      zoomReset: () => {
        const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
        applyViewport(zoomAroundPoint(viewportValueRef.current, center, 1))
      },
      insertSymbol,
      insertBusbar,
      previewElementColor,
      previewSelectionColor: paintSelectionColor,
      updateSelectionColor,
      previewCanvasColor,
      updateCanvasColor,
      updateElement,
      updateBusbar,
      updateConnectionEdge,
    }))

    useEffect(() => {
      if (!interactionRef.current) {
        committedElementsRef.current = elements
        committedBusbarsRef.current = busbars
        committedConnectionsRef.current = connections
      }
    }, [busbars, connections, elements])

    useEffect(() => {
      viewportFrameScheduler.cancel()
      viewportValueRef.current = viewport
      setViewportValue(viewport)
    }, [viewport, viewportFrameScheduler])

    useEffect(() => {
      committedElementsRef.current = elements
      committedBusbarsRef.current = busbars
      committedConnectionsRef.current = connections
      historyRef.current = { past: [], future: [] }
      pasteCountRef.current = 0
      previewElementColorsRef.current.clear()
      elementLabelLayoutCacheRef.current.clear()
      busbarNodeRefs.current.clear()
      busbarTapNodeRefs.current.clear()
      busbarCandidateNodeRef.current = null
      connectionEdgeNodeRefs.current.clear()
      renderedConnectionPathCacheRef.current.clear()
      interactionRef.current = null
      nudgeCommitScheduler.cancel()
      nudgeSessionActiveRef.current = false
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setMarquee(null)
      setActiveMoveElementIds([])
      setHoveredElementId(null)
      setLibraryDragTarget(null)
      setSelectedLabelElementId(null)
      setSelectedLabelBusbarId(null)
      setSelectedLabelConnectionEdgeId(null)
      setConnectionLabelPlacementPreview(null)
      selectConnection(null)
      selectBusbar(null)
      setWiring(null)
      setSelection([])
      emitCommandState()
    }, [diagramId, documentEpoch])

    useEffect(() => {
      clipboardRef.current = createEmptySelectionClipboard()
      pasteCountRef.current = 0
    }, [documentEpoch])

    useEffect(() => {
      if (mode !== 'monitor') return
      interactionRef.current = null
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setMarquee(null)
      setActiveMoveElementIds([])
      setHoveredElementId(null)
      setLibraryDragTarget(null)
      setWiring(null)
      selectConnection(null)
      setObjectSelection([], [])
    }, [mode])

    useEffect(() => () => {
      diagramPreviewScheduler.cancel()
      wiringPointerScheduler.cancel()
      pointerPositionScheduler.cancel()
      nudgeCommitScheduler.cancel()
      viewportFrameScheduler.cancel()
    }, [
      diagramPreviewScheduler,
      nudgeCommitScheduler,
      pointerPositionScheduler,
      viewportFrameScheduler,
      wiringPointerScheduler,
    ])

    const startElementMove = (event: PointerEvent<SVGImageElement>, elementId: string) => {
      if (mode !== 'edit' || event.button !== 0) return
      event.stopPropagation()
      viewportElementRef.current?.focus()
      setSelectedLabelElementId(null)
      setSelectedLabelBusbarId(null)
      setSelectedLabelConnectionEdgeId(null)
      setConnectionLabelPlacementPreview(null)
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const alreadySelected = selectedIdsRef.current.includes(elementId)

      if (additive && alreadySelected) {
        setObjectSelection(
          selectedIdsRef.current.filter((id) => id !== elementId),
          selectedBusbarIdsRef.current,
        )
        return
      }

      const nextSelection = additive
        ? [...selectedIdsRef.current, elementId]
        : alreadySelected
          ? selectedIdsRef.current
          : [elementId]
      const nextBusbarSelection = additive || alreadySelected
        ? selectedBusbarIdsRef.current
        : []
      setObjectSelection(nextSelection, nextBusbarSelection)
      interactionRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        baseElements: committedElementsRef.current,
        baseBusbars: committedBusbarsRef.current,
        selectedIds: nextSelection,
        selectedBusbarIds: nextBusbarSelection,
        hasMoved: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    startElementMoveRef.current = startElementMove
    const startLabelDrag = (
      event: PointerEvent<SVGRectElement>,
      elementId: string,
    ) => {
      if (
        event.button !== 0 ||
        selectedIdsRef.current.length !== 1 ||
        selectedIdsRef.current[0] !== elementId ||
        selectedBusbarIdsRef.current.length > 0 ||
        selectedConnectionIdRef.current !== null
      ) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      setSelectedLabelElementId(elementId)
      setSelectedLabelConnectionEdgeId(null)
      interactionRef.current = {
        kind: 'label',
        pointerId: event.pointerId,
        elementId,
        baseElements: committedElementsRef.current,
      }
      viewportElementRef.current?.setPointerCapture(event.pointerId)
    }
    startLabelDragRef.current = startLabelDrag
    const startBusbarLabelDrag = (
      event: PointerEvent<SVGRectElement>,
      busbarId: string,
    ) => {
      if (
        event.button !== 0 ||
        selectedBusbarIdsRef.current.length !== 1 ||
        selectedBusbarIdsRef.current[0] !== busbarId ||
        selectedIdsRef.current.length > 0 ||
        selectedConnectionIdRef.current !== null
      ) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      setSelectedLabelElementId(null)
      setSelectedLabelBusbarId(busbarId)
      setSelectedLabelConnectionEdgeId(null)
      setConnectionLabelPlacementPreview(null)
      interactionRef.current = {
        kind: 'busbar-label',
        pointerId: event.pointerId,
        busbarId,
        baseBusbars: committedBusbarsRef.current,
      }
      viewportElementRef.current?.setPointerCapture(event.pointerId)
    }
    startBusbarLabelDragRef.current = startBusbarLabelDrag
    const startConnectionLabelDrag = (
      event: PointerEvent<SVGRectElement>,
      edgeId: string,
    ) => {
      const selectedEdges = selectedConnectionEdges(
        selectedConnectionIdRef.current,
        committedConnectionsRef.current,
      )
      const route = routedConnections.edges.find((candidate) => candidate.edgeId === edgeId)
      if (
        event.button !== 0 ||
        selectedEdges.length !== 1 ||
        selectedEdges[0].id !== edgeId ||
        selectedIdsRef.current.length > 0 ||
        selectedBusbarIdsRef.current.length > 0 ||
        !route
      ) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      setSelectedLabelElementId(null)
      setSelectedLabelBusbarId(null)
      setSelectedLabelConnectionEdgeId(edgeId)
      setConnectionLabelPlacementPreview(null)
      interactionRef.current = {
        kind: 'connection-label',
        pointerId: event.pointerId,
        edgeId,
        route,
        baseConnections: committedConnectionsRef.current,
      }
      viewportElementRef.current?.setPointerCapture(event.pointerId)
    }
    startConnectionLabelDragRef.current = startConnectionLabelDrag
    enterAnchorRef.current = handleAnchorPointerEnter
    leaveAnchorRef.current = handleAnchorPointerLeave
    pressAnchorRef.current = handleAnchorPointerDown
    pressConnectionEdgeRef.current = (event, edgeId) => {
      const route = routedConnections.edges.find((candidate) => candidate.edgeId === edgeId)
      if (route) handleConnectionPointerDown(event, route)
    }

    const startResize = (event: PointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      if (selectedBusbarIdsRef.current.length) return
      const selectedIds = selectedIdsRef.current
      const selected = committedElementsRef.current.filter((element) => (
        selectedIds.includes(element.id)
      ))
      const bounds = elementsBounds(selected)
      if (!bounds) return
      interactionRef.current = {
        kind: 'resize',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        baseElements: committedElementsRef.current,
        selectedIds,
        bounds,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const startRotate = (event: PointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      const selectedIds = selectedIdsRef.current
      const selectedBusbarIds = selectedBusbarIdsRef.current
      const selected = committedElementsRef.current.filter((element) => (
        selectedIds.includes(element.id)
      ))
      const selectedBusbars = committedBusbarsRef.current.filter((busbar) => (
        selectedBusbarIds.includes(busbar.id)
      ))
      const bounds = diagramObjectsBounds(selected, selectedBusbars)
      if (!bounds) return
      const selectedSet = new Set(selectedIds)
      const currentLabelPlacements = new Map(elementLabelLayouts.map((layout) => (
        [layout.elementId, layout.placement] as const
      )))
      const baseElements = committedElementsRef.current.map((element) => {
        if (!selectedSet.has(element.id) || element.labelPlacement) return element
        const labelPlacement = currentLabelPlacements.get(element.id)
        return labelPlacement ? { ...element, labelPlacement } : element
      })
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const point = worldPoint(event.clientX, event.clientY)
      interactionRef.current = {
        kind: 'rotate',
        pointerId: event.pointerId,
        center,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
        baseElements,
        baseBusbars: committedBusbarsRef.current,
        selectedIds,
        selectedBusbarIds,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const startBusbarResize = (
      event: PointerEvent<SVGCircleElement>,
      busbar: Busbar,
      endpoint: 'start' | 'end',
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      selectBusbar(busbar.id)
      interactionRef.current = {
        kind: 'resize-busbar',
        pointerId: event.pointerId,
        endpoint,
        baseBusbars: committedBusbarsRef.current,
        baseConnections: committedConnectionsRef.current,
        busbar,
        minimumLength: Math.max(
          BUSBAR_MIN_LENGTH,
          minimumBusbarLengthForConnections(
            committedConnectionsRef.current,
            busbar.id,
            gridSize,
          ),
        ),
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const startBusbarRotate = (
      event: PointerEvent<SVGCircleElement>,
      busbar: Busbar,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const end = busbarEndPoint(busbar)
      const center = { x: (busbar.x + end.x) / 2, y: (busbar.y + end.y) / 2 }
      const point = worldPoint(event.clientX, event.clientY)
      selectBusbar(busbar.id)
      interactionRef.current = {
        kind: 'rotate-busbar',
        pointerId: event.pointerId,
        center,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
        baseBusbars: committedBusbarsRef.current,
        busbar,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
      viewportElementRef.current?.focus()
      if (event.button === 1) {
        event.preventDefault()
        interactionRef.current = {
          kind: 'pan',
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          startViewport: viewportValueRef.current,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.dataset.panning = 'true'
        return
      }
      if (mode !== 'edit') return
      if (wiringRef.current) return
      if (event.button !== 0) return
      const startWorld = worldPoint(event.clientX, event.clientY)
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      if (!additive) {
        selectConnection(null)
      }
      interactionRef.current = {
        kind: 'marquee',
        pointerId: event.pointerId,
        startWorld,
        currentWorld: startWorld,
        additive,
        baseSelection: selectedIdsRef.current,
        baseBusbarSelection: selectedBusbarIdsRef.current,
      }
      setMarquee({ x: startWorld.x, y: startWorld.y, width: 0, height: 0 })
      if (!additive) setObjectSelection([], [])
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      const world = worldPoint(event.clientX, event.clientY)
      schedulePointerPosition(world)
      if (wiringRef.current) {
        scheduleWiringPointer(world)
      }
      if (
        busbarCandidate &&
        event.target instanceof Element &&
        !event.target.closest('.busbar__hit, .busbar-tap-candidate')
      ) {
        setBusbarCandidate(null)
      }
      const interaction = interactionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return

      if (interaction.kind === 'pan') {
        applyViewport(
          {
            ...interaction.startViewport,
            tx: interaction.startViewport.tx + event.clientX - interaction.startClient.x,
            ty: interaction.startViewport.ty + event.clientY - interaction.startClient.y,
          },
        )
        return
      }

      if (interaction.kind === 'marquee') {
        interaction.currentWorld = world
        setMarquee(normalizedRect(interaction.startWorld, world))
        return
      }

      if (interaction.kind === 'label') {
        const selected = interaction.baseElements.find((element) => (
          element.id === interaction.elementId
        ))
        if (!selected) return
        const labelPlacement = labelPlacementForPointer(selected, world)
        schedulePreview(interaction.baseElements.map((element) => (
          element.id === selected.id && element.labelPlacement !== labelPlacement
            ? { ...element, labelPlacement }
            : element
        )))
        return
      }

      if (interaction.kind === 'busbar-label') {
        const selected = interaction.baseBusbars.find((busbar) => (
          busbar.id === interaction.busbarId
        ))
        if (!selected) return
        const labelEndpoint = busbarLabelEndpointForPointer(selected, world)
        scheduleDiagramPreview(null, interaction.baseBusbars.map((busbar) => (
          busbar.id === selected.id && busbar.labelEndpoint !== labelEndpoint
            ? { ...busbar, labelEndpoint }
            : busbar
        )), null)
        return
      }

      if (interaction.kind === 'connection-label') {
        const placement = connectionLabelPlacementForPointer(interaction.route, world)
        if (!placement) return
        setConnectionLabelPlacementPreview({
          edgeId: interaction.edgeId,
          ...placement,
        })
        return
      }

      if (interaction.kind === 'resize-busbar') {
        const base = interaction.busbar
        let next: Busbar
        if (base.orientation === 'horizontal') {
          const fixedEnd = base.x + base.length
          if (interaction.endpoint === 'start') {
            const x = Math.min(snap(world.x, gridSize), fixedEnd - interaction.minimumLength)
            next = { ...base, x, length: fixedEnd - x }
          } else {
            const end = Math.max(snap(world.x, gridSize), base.x + interaction.minimumLength)
            next = { ...base, length: end - base.x }
          }
        } else {
          const fixedEnd = base.y + base.length
          if (interaction.endpoint === 'start') {
            const y = Math.min(snap(world.y, gridSize), fixedEnd - interaction.minimumLength)
            next = { ...base, y, length: fixedEnd - y }
          } else {
            const end = Math.max(snap(world.y, gridSize), base.y + interaction.minimumLength)
            next = { ...base, length: end - base.y }
          }
        }
        const nextBusbars = interaction.baseBusbars.map((candidate) => (
          candidate.id === base.id ? next : candidate
        ))
        if (busbarsEqual(
          previewBusbarsRef.current ?? interaction.baseBusbars,
          nextBusbars,
        )) return
        const nextConnections = compressBusbarTapOffsets(
          interaction.baseConnections,
          base.id,
          base.length,
          next.length,
          gridSize,
        )
        scheduleDiagramPreview(null, nextBusbars, nextConnections)
        return
      }

      if (interaction.kind === 'rotate-busbar') {
        const angle = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x)
        const turns = Math.round((((angle - interaction.startAngle) * 180) / Math.PI) / 90)
        const swapsOrientation = Math.abs(turns) % 2 === 1
        const orientation = swapsOrientation
          ? interaction.busbar.orientation === 'horizontal' ? 'vertical' : 'horizontal'
          : interaction.busbar.orientation
        const next = orientation === 'horizontal'
          ? {
              ...interaction.busbar,
              orientation,
              x: snap(interaction.center.x - interaction.busbar.length / 2, gridSize),
              y: snap(interaction.center.y, gridSize),
            }
          : {
              ...interaction.busbar,
              orientation,
              x: snap(interaction.center.x, gridSize),
              y: snap(interaction.center.y - interaction.busbar.length / 2, gridSize),
            }
        scheduleDiagramPreview(null, interaction.baseBusbars.map((candidate) => (
          candidate.id === interaction.busbar.id ? next : candidate
        )), null)
        return
      }

      if (interaction.kind === 'move') {
        const rawDx = world.x - interaction.startWorld.x
        const rawDy = world.y - interaction.startWorld.y
        const dx = snap(rawDx, gridSize)
        const dy = snap(rawDy, gridSize)
        const hasMoved = dx !== 0 || dy !== 0
        if (hasMoved !== interaction.hasMoved) {
          interaction.hasMoved = hasMoved
          setActiveMoveElementIds(hasMoved ? interaction.selectedIds : [])
        }
        const selected = new Set(interaction.selectedIds)
        const selectedBusbars = new Set(interaction.selectedBusbarIds)
        scheduleDiagramPreview(
          interaction.baseElements.map((element) => selected.has(element.id)
            ? { ...element, x: element.x + dx, y: element.y + dy }
            : element),
          interaction.baseBusbars.map((busbar) => selectedBusbars.has(busbar.id)
            ? { ...busbar, x: busbar.x + dx, y: busbar.y + dy }
            : busbar),
          null,
        )
        return
      }

      if (interaction.kind === 'resize') {
        if (interaction.selectedIds.length === 1) {
          const base = interaction.baseElements.find((element) => (
            element.id === interaction.selectedIds[0]
          ))
          const symbol = base ? symbolsByKey.get(base.assetKey) : undefined
          if (!base || !symbol) return
          const localDelta = worldDeltaToLocal(
            {
              x: world.x - interaction.startWorld.x,
              y: world.y - interaction.startWorld.y,
            },
            base.rotation,
          )
          const scaleDelta =
            (localDelta.x * symbol.intrinsicWidth + localDelta.y * symbol.intrinsicHeight) /
            (symbol.intrinsicWidth ** 2 + symbol.intrinsicHeight ** 2)
          const baseScale = base.width / symbol.intrinsicWidth
          const size = getScaledSymbolSize(symbol, baseScale + scaleDelta, gridSize)
          schedulePreview(interaction.baseElements.map((element) => (
            element.id === base.id ? { ...element, width: size.width, height: size.height } : element
          )))
          return
        }
        const diagonal = {
          x: interaction.bounds.width,
          y: interaction.bounds.height,
        }
        const delta = {
          x: world.x - interaction.startWorld.x,
          y: world.y - interaction.startWorld.y,
        }
        const denominator = diagonal.x ** 2 + diagonal.y ** 2
        const requestedScale = Math.max(
          0,
          1 + (delta.x * diagonal.x + delta.y * diagonal.y) / Math.max(1, denominator),
        )
        schedulePreview(scaleSelectedElements(
          interaction.baseElements,
          new Set(interaction.selectedIds),
          interaction.bounds,
          requestedScale,
          gridSize,
        ))
        return
      }

      const angle = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x)
      const degrees = ((angle - interaction.startAngle) * 180) / Math.PI
      const rotationDelta = Math.round(degrees / 90) * 90
      scheduleDiagramPreview(
        rotateSelectedElements(
          interaction.baseElements,
          new Set(interaction.selectedIds),
          interaction.center,
          rotationDelta,
          gridSize,
        ),
        rotateSelectedBusbars(
          interaction.baseBusbars,
          new Set(interaction.selectedBusbarIds),
          interaction.center,
          rotationDelta,
          gridSize,
        ),
        null,
      )
    }

    const finishInteraction = (event: PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return
      if (interaction.kind === 'pan') {
        delete event.currentTarget.dataset.panning
      } else if (interaction.kind === 'marquee') {
        const rect = normalizedRect(interaction.startWorld, interaction.currentWorld)
        const matches = committedElementsRef.current
          .filter((element) => elementInsideRect(element, rect))
          .map((element) => element.id)
        const busbarMatches = committedBusbarsRef.current
          .filter((busbar) => busbarInsideRect(busbar, rect))
          .map((busbar) => busbar.id)
        setObjectSelection(
          interaction.additive ? [...interaction.baseSelection, ...matches] : matches,
          interaction.additive
            ? [...interaction.baseBusbarSelection, ...busbarMatches]
            : busbarMatches,
        )
        setMarquee(null)
      } else if (interaction.kind === 'connection-label') {
        const placement = connectionLabelPlacementPreviewRef.current
        if (placement?.edgeId === interaction.edgeId) {
          commitConnections(interaction.baseConnections.map((network) => ({
            ...network,
            edges: network.edges.map((edge) => edge.id === interaction.edgeId
              ? {
                  ...edge,
                  labelEndpoint: placement.endpoint,
                  labelSide: placement.side,
                }
              : edge),
          })))
        }
        setConnectionLabelPlacementPreview(null)
      } else if (previewElementsRef.current || previewBusbarsRef.current) {
        commitDiagram(
          previewElementsRef.current ?? committedElementsRef.current,
          previewBusbarsRef.current ?? committedBusbarsRef.current,
          previewConnectionsRef.current ?? committedConnectionsRef.current,
        )
      }
      if (interaction.kind === 'move') setActiveMoveElementIds([])
      interactionRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }

    const cancelInteraction = (event: PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return
      if (interaction.kind === 'pan') applyViewport(interaction.startViewport)
      delete event.currentTarget.dataset.panning
      interactionRef.current = null
      if (interaction.kind === 'move') setActiveMoveElementIds([])
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setConnectionLabelPlacementPreview(null)
      setMarquee(null)
    }

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      const direction = event.deltaY < 0 ? 1.12 : 1 / 1.12
      const nextZoom = clampZoom(viewportValueRef.current.zoom * direction)
      applyViewport(
        zoomAroundPoint(viewportValueRef.current, clientPoint(event.clientX, event.clientY), nextZoom),
      )
    }

    const nudgeSelection = (x: number, y: number) => {
      const selected = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      if ((!selected.size && !selectedBusbars.size) || interactionRef.current) return false
      const currentElements = previewElementsRef.current ?? committedElementsRef.current
      const currentBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
      nudgeSessionActiveRef.current = true
      scheduleDiagramPreview(
        currentElements.map((element) => selected.has(element.id)
          ? { ...element, x: snap(element.x + x, gridSize), y: snap(element.y + y, gridSize) }
          : element),
        currentBusbars.map((busbar) => selectedBusbars.has(busbar.id)
          ? { ...busbar, x: snap(busbar.x + x, gridSize), y: snap(busbar.y + y, gridSize) }
          : busbar),
        null,
      )
      return true
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (mode !== 'edit') {
        if (event.key === 'Escape') {
          event.preventDefault()
          setWiring(null)
          setSelection([])
          selectConnection(null)
          selectBusbar(null)
        }
        return
      }
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const isArrowKey = event.key.startsWith('Arrow')
      if (isArrowKey) nudgeCommitScheduler.cancel()
      else flushPendingNudge()
      if (event.key === 'Escape') {
        event.preventDefault()
        setWiring(null)
        setSelection([])
        selectConnection(null)
        selectBusbar(null)
      } else if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (modifier && key === 'y') {
        event.preventDefault()
        redo()
      } else if (modifier && key === 'c') {
        event.preventDefault()
        copySelected()
      } else if (modifier && key === 'x') {
        event.preventDefault()
        cutSelected()
      } else if (modifier && key === 'v') {
        event.preventDefault()
        paste()
      } else if (modifier && key === 'd') {
        event.preventDefault()
        duplicateSelected()
      } else if (modifier && key === 'a') {
        event.preventDefault()
        setObjectSelection(
          committedElementsRef.current.map((element) => element.id),
          committedBusbarsRef.current.map((busbar) => busbar.id),
        )
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
      } else if (isArrowKey) {
        event.preventDefault()
        const distance = gridSize
        if (event.key === 'ArrowLeft') nudgeSelection(-distance, 0)
        if (event.key === 'ArrowRight') nudgeSelection(distance, 0)
        if (event.key === 'ArrowUp') nudgeSelection(0, -distance)
        if (event.key === 'ArrowDown') nudgeSelection(0, distance)
      }
    }

    const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
      if (mode !== 'edit') return
      if (!event.key.startsWith('Arrow') || !nudgeSessionActiveRef.current) return
      event.preventDefault()
      nudgeCommitScheduler.schedule()
    }

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
      if (mode !== 'edit') return
      event.preventDefault()
      setLibraryDragTarget(null)
      const symbolKey = event.dataTransfer.getData('application/x-aidc-symbol')
      if (symbolKey) insertSymbol(symbolKey, worldPoint(event.clientX, event.clientY))
      if (event.dataTransfer.getData(BUSBAR_DRAG_TYPE) && lineSystemType === 'power') {
        insertBusbar(worldPoint(event.clientX, event.clientY))
      }
    }

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
      if (mode !== 'edit') return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      if (event.dataTransfer.types.includes(BUSBAR_DRAG_TYPE)) {
        if (lineSystemType !== 'power') return
        const point = worldPoint(event.clientX, event.clientY)
        const x = snap(point.x - DEFAULT_BUSBAR_LENGTH / 2, gridSize)
        const y = snap(point.y, gridSize)
        setLibraryDragTarget({
          id: 'busbar',
          center: { x: x + DEFAULT_BUSBAR_LENGTH / 2, y },
          width: DEFAULT_BUSBAR_LENGTH,
          height: gridSize,
        })
        return
      }
      if (!event.dataTransfer.types.includes('application/x-aidc-symbol')) return
      const symbolKeyType = event.dataTransfer.types.find((type) => (
        type.startsWith(SYMBOL_DRAG_TYPE_PREFIX)
      ))
      const symbol = symbolKeyType
        ? symbolsByKey.get(symbolKeyType.slice(SYMBOL_DRAG_TYPE_PREFIX.length))
        : undefined
      if (!symbol) return
      const point = worldPoint(event.clientX, event.clientY)
      const x = snap(point.x - symbol.intrinsicWidth / 2, gridSize)
      const y = snap(point.y - symbol.intrinsicHeight / 2, gridSize)
      setLibraryDragTarget({
        id: symbol.key,
        center: {
          x: x + symbol.intrinsicWidth / 2,
          y: y + symbol.intrinsicHeight / 2,
        },
        width: symbol.intrinsicWidth,
        height: symbol.intrinsicHeight,
      })
    }

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget
      if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
        setLibraryDragTarget(null)
      }
    }

    const activeMoveIdSet = new Set(activeMoveElementIds)
    const activeMoveElements = displayedElements.filter((element) => activeMoveIdSet.has(element.id))
    const alignmentTargets: AlignmentTarget[] = activeMoveElements.length
      ? activeMoveElements.map((element) => {
          const size = displayedElementSize(element)
          return {
            id: element.id,
            center: {
              x: element.x + element.width / 2,
              y: element.y + element.height / 2,
            },
            width: size.width,
            height: size.height,
          }
        })
      : libraryDragTarget
        ? [libraryDragTarget]
        : []
    const selectedIdSet = new Set(selectedIds)
    const selectedBusbarIdSet = new Set(selectedBusbarIds)
    const selectedElements = displayedElements.filter((element) => selectedIdSet.has(element.id))
    const selectedBusbars = displayedBusbars.filter((busbar) => selectedBusbarIdSet.has(busbar.id))
    const selectedObjectCount = selectedElements.length + selectedBusbars.length
    const selectedConnectionLabelEdgeId =
      selectedObjectCount === 0 && selectedConnectionEdgeIdSet.size === 1
        ? selectedConnectionEdgeIdSet.values().next().value as string
        : null
    const selectionBounds = diagramObjectsBounds(selectedElements, selectedBusbars)
    const selectedElement = selectedObjectCount === 1 ? selectedElements[0] : undefined
    const selectedBusbar = selectedObjectCount === 1 ? selectedBusbars[0] : undefined
    const selectedBusbarEnd = selectedBusbar ? busbarEndPoint(selectedBusbar) : null
    const selectedBusbarCenter = selectedBusbar && selectedBusbarEnd ? {
      x: (selectedBusbar.x + selectedBusbarEnd.x) / 2,
      y: (selectedBusbar.y + selectedBusbarEnd.y) / 2,
    } : null
    const selectedBusbarRotatePoint = selectedBusbar && selectedBusbarCenter
      ? selectedBusbar.orientation === 'horizontal'
        ? { x: selectedBusbarCenter.x, y: selectedBusbarCenter.y - 24 / viewportValue.zoom }
        : { x: selectedBusbarCenter.x + 24 / viewportValue.zoom, y: selectedBusbarCenter.y }
      : null
    const alignmentViewport = alignmentTargets.length ? {
      x: -viewportValue.tx / viewportValue.zoom,
      y: -viewportValue.ty / viewportValue.zoom,
      width: canvasSize.width / viewportValue.zoom,
      height: canvasSize.height / viewportValue.zoom,
    } : null
    const fallbackGridStyle = {
      '--grid-origin-x': `${viewportValue.tx}px`,
      '--grid-origin-y': `${viewportValue.ty}px`,
      '--grid-screen-step': `${gridScale.screenStep}px`,
      '--grid-dot-radius': `${gridScale.dotScreenRadius}px`,
    } as CSSProperties
    const visibleElementPresentations = visibleElements.map((element) => {
      const symbol = symbolsByKey.get(element.assetKey)
      const visualState: SymbolVisualState = element.assetKey === 'switch' && switchStates[element.id]
        ? 'on'
        : 'off'
      const activeColorSlot = symbolColorSlotForElement(element, visualState)
      const colorPreview = previewElementColorsRef.current.get(element.id)
      const symbolColor = symbol?.configurableColor
        ? colorPreview?.slot === activeColorSlot
          ? colorPreview.color
          : resolvedSymbolColor(element, visualState)
        : undefined
      return { element, symbol, visualState, symbolColor }
    })
    const visibleSymbolColors = [...new Set(visibleElementPresentations.flatMap(({ symbolColor }) => (
      symbolColor ? [symbolColor] : []
    )))]

    return (
      <div
        className="canvas-stage"
        data-testid="diagram-canvas"
        data-grid-presentation={GRID_PRESENTATION}
        data-grid-size={gridSize}
        data-grid-zoom={viewportValue.zoom}
        data-grid-translation-x={viewportValue.tx}
        data-grid-translation-y={viewportValue.ty}
        data-grid-density={gridScale.density}
        data-grid-visible-step={gridScale.worldStep}
        data-grid-screen-step={gridScale.screenStep}
        data-grid-screen-dot-radius={gridScale.dotScreenRadius}
        data-routing-pending={isRouting || undefined}
        data-route-mode={routeStats?.mode}
        data-route-duration-ms={routeStats ? routeStats.durationMs.toFixed(2) : undefined}
        data-route-dirty-networks={routeStats?.dirtyNetworkCount}
        data-route-reused-edges={routeStats?.reusedEdgeCount}
        data-render-culling={cullingEnabled || undefined}
        data-rendered-elements={visibleElements.length}
        data-rendered-busbars={visibleBusbars.length}
        data-rendered-routes={visibleRoutes.length}
        data-mode={mode}
      >
        <Rulers viewport={viewportValue} width={canvasSize.width} height={canvasSize.height} gridSize={gridSize} />
        <div
          ref={viewportElementRef}
          className="diagram-viewport"
          tabIndex={0}
          aria-label={mode === 'edit' ? '一次接线图编辑画布' : '一次接线图监控画布'}
          onAuxClick={(event) => { if (event.button === 1) event.preventDefault() }}
          onContextMenu={(event) => {
            event.preventDefault()
            if (wiringRef.current) setWiring(null)
          }}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) flushPendingNudge()
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPointerCancel={cancelInteraction}
          onPointerDown={handlePointerDown}
          onPointerDownCapture={flushPendingNudge}
          onPointerLeave={() => {
            if (!interactionRef.current) {
              pointerPositionScheduler.cancel()
              lastPointerPositionRef.current = null
              callbacksRef.current.onPointerChange(null)
            }
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
          onWheel={handleWheel}
        >
          <Canvas
            className="grid-webgl"
            orthographic
            frameloop="demand"
            dpr={[1, 1.75]}
            camera={{ position: [0, 0, 1] }}
            gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
            onCreated={({ gl, invalidate }) => {
              gl.domElement.setAttribute('aria-hidden', 'true')
              gridInvalidateRef.current = invalidate
              invalidate()
            }}
            fallback={(
              <div
                className="grid-fallback"
                aria-hidden="true"
                style={fallbackGridStyle}
              />
            )}
          >
            <GridSurface renderStateRef={gridRenderStateRef} />
          </Canvas>
          <svg
            className="editor-overlay"
            data-testid="editor-overlay"
            data-wiring={wiring ? 'true' : undefined}
            aria-hidden="true"
          >
            <defs ref={symbolColorDefsRef}>
              {visibleSymbolColors.map((color) => (
                <filter
                  key={color}
                  id={symbolColorFilterId(color)}
                  x="-5%"
                  y="-5%"
                  width="110%"
                  height="110%"
                  colorInterpolationFilters="sRGB"
                >
                  <feFlood floodColor={color} result="symbol-color" />
                  <feComposite in="symbol-color" in2="SourceAlpha" operator="in" />
                </filter>
              ))}
            </defs>
            <g transform={`translate(${viewportValue.tx} ${viewportValue.ty}) scale(${viewportValue.zoom})`}>
              <g className="busbar-layer" data-testid="busbar-layer">
                {visibleBusbars.map((busbar) => {
                  const end = busbarEndPoint(busbar)
                  const data = `M ${busbar.x} ${busbar.y} L ${end.x} ${end.y}`
                  return (
                    <g
                      key={busbar.id}
                      ref={(node) => {
                        if (node) busbarNodeRefs.current.set(busbar.id, node)
                        else busbarNodeRefs.current.delete(busbar.id)
                      }}
                      className="busbar"
                      data-busbar-id={busbar.id}
                      data-orientation={busbar.orientation}
                      data-selected={selectedBusbarIdSet.has(busbar.id) || undefined}
                      style={busbar.color
                        ? { '--busbar-color': busbar.color } as CSSProperties
                        : undefined}
                    >
                      <path className="busbar__line" d={data} />
                      <path
                      className="busbar__hit"
                      d={data}
                      onPointerDown={mode === 'edit'
                        ? (event) => handleBusbarPointerDown(event, busbar)
                        : undefined}
                      onPointerMove={mode === 'edit'
                        ? (event) => handleBusbarPointerMove(event, busbar)
                        : undefined}
                      />
                    </g>
                  )
                })}
              </g>
              <g className="connection-layer" data-testid="connection-layer">
                {visibleRoutes.map((route) => {
                  const renderedPath = renderedConnectionPaths.get(route.edgeId)
                  const linePath = renderedPath?.linePath ?? pathData(route.points)
                  return (
                    <ConnectionEdgeItem
                      key={route.edgeId}
                      edgeId={route.edgeId}
                      networkId={route.networkId}
                      type={route.type}
                      color={displayedConnectionEdgesById.get(route.edgeId)?.color}
                      selected={mode === 'edit' && selectedConnectionEdgeIdSet.has(route.edgeId)}
                      interactive={mode === 'edit'}
                      linePath={linePath}
                      bridgeCasingPath={renderedPath?.bridgeCasingPath ?? ''}
                      pressEdge={pressConnectionEdgeRef}
                      edgeNodes={connectionEdgeNodeRefs}
                    />
                  )
                })}
                {displayedConnections.flatMap((network) => network.nodes.flatMap((node) => {
                  if (node.kind === 'busbar-tap') {
                    const busbar = displayedBusbarsById.get(node.busbarId)
                    if (!busbar) return []
                    const resolvedOffset = routedConnections.resolvedBusbarTapOffsets[node.id] ?? node.offset
                    const point = busbarPoint(busbar, resolvedOffset)
                    if (cullingEnabled && !pointInsideRect(point, renderWorldRect)) return []
                    return [(
                      <circle
                        key={node.id}
                        ref={(circle) => {
                          if (circle) busbarTapNodeRefs.current.set(node.id, circle)
                          else busbarTapNodeRefs.current.delete(node.id)
                        }}
                        className="busbar-tap"
                        data-connection-type="electrical"
                        data-busbar-id={node.busbarId}
                        data-busbar-offset={resolvedOffset}
                        style={busbar.color
                          ? { '--busbar-color': busbar.color } as CSSProperties
                          : undefined}
                        cx={point.x}
                        cy={point.y}
                        r={2.5 / viewportValue.zoom}
                      />
                    )]
                  }
                  return []
                }))}
                {mode === 'edit' && wiringPreview ? (
                  <path
                    className="connection-preview"
                    data-connection-type={wiring?.source.type}
                    data-testid="connection-preview"
                    d={pathData(wiringPreview)}
                  />
                ) : null}
                {mode === 'edit' && busbarCandidate ? (
                  <circle
                    ref={busbarCandidateNodeRef}
                    className="busbar-tap-candidate"
                    data-connection-type="electrical"
                    data-busbar-id={busbarCandidate.busbar.id}
                    data-mode={wiring ? 'target' : 'source'}
                    data-testid="busbar-tap-candidate"
                    style={busbarCandidate.busbar.color
                      ? { '--busbar-color': busbarCandidate.busbar.color } as CSSProperties
                      : undefined}
                    cx={busbarCandidate.point.x}
                    cy={busbarCandidate.point.y}
                    r={5 / viewportValue.zoom}
                    onPointerDown={handleBusbarCandidatePointerDown}
                  />
                ) : null}
              </g>

              {mode === 'edit' && alignmentViewport ? (
                <g
                  className="alignment-cross"
                  data-testid="alignment-cross"
                  data-source={activeMoveElements.length ? 'canvas-element' : 'symbol-library'}
                  data-target-count={alignmentTargets.length}
                  data-center-x={alignmentTargets.length === 1 ? alignmentTargets[0].center.x : undefined}
                  data-center-y={alignmentTargets.length === 1 ? alignmentTargets[0].center.y : undefined}
                  data-band-width={alignmentTargets.length === 1 ? alignmentTargets[0].width : undefined}
                  data-band-height={alignmentTargets.length === 1 ? alignmentTargets[0].height : undefined}
                >
                  <defs>
                    <clipPath id="alignment-cross-union">
                      {alignmentTargets.flatMap((target) => [
                        <rect
                          key={`${target.id}-vertical`}
                          className="alignment-cross__band alignment-cross__band--vertical"
                          x={target.center.x - target.width / 2}
                          y={alignmentViewport.y}
                          width={target.width}
                          height={alignmentViewport.height}
                        />,
                        <rect
                          key={`${target.id}-horizontal`}
                          className="alignment-cross__band alignment-cross__band--horizontal"
                          x={alignmentViewport.x}
                          y={target.center.y - target.height / 2}
                          width={alignmentViewport.width}
                          height={target.height}
                        />,
                      ])}
                    </clipPath>
                  </defs>
                  <rect
                    className="alignment-cross__surface"
                    x={alignmentViewport.x}
                    y={alignmentViewport.y}
                    width={alignmentViewport.width}
                    height={alignmentViewport.height}
                    clipPath="url(#alignment-cross-union)"
                  />
                </g>
              ) : null}

              {visibleElementPresentations.map(({ element, symbol, visualState, symbolColor }) => {
                return (
                  <DiagramElementItem
                    key={element.id}
                    mode={mode}
                    element={element}
                    asset={assetsByKey.get(element.assetKey)}
                    symbol={symbol}
                    symbolColor={symbolColor}
                    selected={mode === 'edit' && selectedIdSet.has(element.id)}
                    anchorsVisible={wiring !== null || hoveredElementId === element.id}
                    wiringType={wiring?.source.type ?? null}
                    lineSystemType={lineSystemType}
                    occupiedAnchors={occupiedAnchors}
                    zoom={viewportValue.zoom}
                    visualState={visualState}
                    elementNodes={elementNodeRefs}
                    startMove={startElementMoveRef}
                    enterAnchor={enterAnchorRef}
                    leaveAnchor={leaveAnchorRef}
                    pressAnchor={pressAnchorRef}
                    toggleSwitch={toggleSwitchRef}
                    hoverElement={hoverElementRef}
                  />
                )
              })}

              <g className="element-label-layer" data-testid="element-label-layer">
                {elementLabelLayouts.map((layout) => (
                  <ElementLabelItem
                    key={layout.elementId}
                    layout={layout}
                    interactive={mode === 'edit' && selectedElement?.id === layout.elementId}
                    selected={selectedLabelElementId === layout.elementId}
                    startDrag={startLabelDragRef}
                  />
                ))}
                {busbarLabelLayouts.map((layout) => (
                  <BusbarLabelItem
                    key={layout.busbarId}
                    layout={layout}
                    interactive={mode === 'edit' && (
                      selectedBusbar?.id === layout.busbarId &&
                      selectedConnectionId === null
                    )}
                    selected={selectedLabelBusbarId === layout.busbarId}
                    startDrag={startBusbarLabelDragRef}
                  />
                ))}
                {connectionLabelLayouts.map((layout) => (
                  <ConnectionLabelItem
                    key={layout.edgeId}
                    layout={layout}
                    interactive={mode === 'edit' && selectedConnectionLabelEdgeId === layout.edgeId}
                    selected={selectedLabelConnectionEdgeId === layout.edgeId}
                    startDrag={startConnectionLabelDragRef}
                  />
                ))}
              </g>

              {mode === 'edit' && selectedObjectCount > 1 ? selectedElements.map((element) => (
                <g
                  key={`selection-${element.id}`}
                  className="selection-member"
                  data-element-id={element.id}
                  transform={`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`}
                >
                  <rect
                    className="selection-member__outline"
                    x={element.x}
                    y={element.y}
                    width={element.width}
                    height={element.height}
                  />
                </g>
              )) : null}

              {mode === 'edit' && selectedBusbar && selectedBusbarEnd && selectedBusbarCenter && selectedBusbarRotatePoint ? (
                <g
                  className="busbar-controls"
                  data-orientation={selectedBusbar.orientation}
                  data-busbar-id={selectedBusbar.id}
                >
                  <line
                    className="busbar-controls__outline"
                    x1={selectedBusbar.x}
                    y1={selectedBusbar.y}
                    x2={selectedBusbarEnd.x}
                    y2={selectedBusbarEnd.y}
                  />
                  <line
                    className="busbar-controls__stem"
                    x1={selectedBusbarCenter.x}
                    y1={selectedBusbarCenter.y}
                    x2={selectedBusbarRotatePoint.x}
                    y2={selectedBusbarRotatePoint.y}
                  />
                  <circle
                    className="busbar-handle busbar-handle--start"
                    cx={selectedBusbar.x}
                    cy={selectedBusbar.y}
                    r={5 / viewportValue.zoom}
                    onPointerDown={(event) => startBusbarResize(event, selectedBusbar, 'start')}
                  />
                  <circle
                    className="busbar-handle busbar-handle--end"
                    cx={selectedBusbarEnd.x}
                    cy={selectedBusbarEnd.y}
                    r={5 / viewportValue.zoom}
                    onPointerDown={(event) => startBusbarResize(event, selectedBusbar, 'end')}
                  />
                  <circle
                    className="busbar-handle busbar-handle--rotate"
                    cx={selectedBusbarRotatePoint.x}
                    cy={selectedBusbarRotatePoint.y}
                    r={5 / viewportValue.zoom}
                    onPointerDown={(event) => startBusbarRotate(event, selectedBusbar)}
                  />
                </g>
              ) : null}

              {mode === 'edit' && selectedElement ? (
                <g
                  className="transform-controls"
                  data-selection-count="1"
                  transform={`rotate(${selectedElement.rotation} ${selectedElement.x + selectedElement.width / 2} ${selectedElement.y + selectedElement.height / 2})`}
                >
                  <rect
                    className="transform-controls__outline"
                    x={selectedElement.x}
                    y={selectedElement.y}
                    width={selectedElement.width}
                    height={selectedElement.height}
                  />
                  <line
                    className="transform-controls__stem"
                    x1={selectedElement.x + selectedElement.width / 2}
                    y1={selectedElement.y}
                    x2={selectedElement.x + selectedElement.width / 2}
                    y2={selectedElement.y - 24 / viewportValue.zoom}
                  />
                  <circle
                    className="transform-handle transform-handle--rotate"
                    cx={selectedElement.x + selectedElement.width / 2}
                    cy={selectedElement.y - 24 / viewportValue.zoom}
                    r={5 / viewportValue.zoom}
                    onPointerDown={startRotate}
                  />
                  <circle
                    className="transform-handle transform-handle--resize"
                    cx={selectedElement.x + selectedElement.width}
                    cy={selectedElement.y + selectedElement.height}
                    r={5 / viewportValue.zoom}
                    onPointerDown={startResize}
                  />
                </g>
              ) : mode === 'edit' && selectedObjectCount > 1 && selectionBounds ? (
                <g
                  className="transform-controls"
                  data-selection-count={selectedObjectCount}
                  data-selection-has-busbar={selectedBusbars.length > 0 || undefined}
                >
                  <rect
                    className="transform-controls__outline"
                    x={selectionBounds.x}
                    y={selectionBounds.y}
                    width={selectionBounds.width}
                    height={selectionBounds.height}
                  />
                  <line
                    className="transform-controls__stem"
                    x1={selectionBounds.x + selectionBounds.width / 2}
                    y1={selectionBounds.y}
                    x2={selectionBounds.x + selectionBounds.width / 2}
                    y2={selectionBounds.y - 24 / viewportValue.zoom}
                  />
                  <circle
                    className="transform-handle transform-handle--rotate"
                    cx={selectionBounds.x + selectionBounds.width / 2}
                    cy={selectionBounds.y - 24 / viewportValue.zoom}
                    r={5 / viewportValue.zoom}
                    onPointerDown={startRotate}
                  />
                  {selectedBusbars.length === 0 ? (
                    <circle
                      className="transform-handle transform-handle--resize"
                      cx={selectionBounds.x + selectionBounds.width}
                      cy={selectionBounds.y + selectionBounds.height}
                      r={5 / viewportValue.zoom}
                      onPointerDown={startResize}
                    />
                  ) : null}
                </g>
              ) : null}

              {mode === 'edit' && marquee ? (
                <rect className="selection-marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} />
              ) : null}
            </g>
          </svg>
          {mode === 'monitor' && animationPlaying ? (
            <FlowAnimationLayer paths={monitorFlowPaths} viewport={viewportValue} />
          ) : null}
        </div>
      </div>
    )
  },
))
