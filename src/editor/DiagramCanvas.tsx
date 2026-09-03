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
  type MouseEvent,
  type PointerEvent,
} from 'react'

import type {
  AnchorType,
  AssetDefinition,
  Busbar,
  ConnectionEdge,
  ConnectionFlowDirection,
  ConnectionNetwork,
  ConnectionNode,
  CoolingLineRole,
  DiagramElement,
  DiagramViewport,
  LineSystemType,
  MonitorMetric,
  RouteWaypoint,
} from '../domain/project'
import { BUSBAR_MIN_LENGTH, resolvedElementOnOffState } from '../domain/project'
import {
  buildMonitorStaticFlowLineGroups,
  deriveInactiveFlowPaths,
  FLOW_BUSBAR_SCREEN_WIDTH,
  FlowAnimationLayer,
  type MonitorFlowPath,
} from '../monitoring/FlowAnimationLayer'
import {
  cloneMonitorMetricsWithNewIds,
} from '../monitoring/elementMetrics'
import type { MonitorDrillDownTarget } from '../monitoring/diagramDrillDown'
import { splitFlowPathAroundCrossings } from '../monitoring/flowPathGeometry'
import type { DiagramRuntimeContext } from '../runtime/types'
import { useDiagramMonitorRuntime } from '../runtime/useDiagramMonitorRuntime'
import { resizeBusbarPreservingTapPositions } from './busbars'
import {
  busbarLabelPlacementForPointer,
  DEFAULT_BUSBAR_LABEL_COLOR,
  layoutBusbarLabels,
} from '../scene/busbarLabels'
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
  type ConnectionLabelPlacement,
} from '../scene/connectionLabels'
import {
  COOLING_DIRECTION_ARROW_INSET_SCREEN,
  COOLING_PIPE_CORNER_RADIUS,
  COOLING_PIPE_SHELL_ENDPOINT_INSET,
  insetPolylineEndpoints,
  isCoolingConnectionType,
  routeHitWorldWidthForConnectionType,
} from '../scene/connectionAppearance'
import {
  connectionEdgeCrossingPriority,
} from '../scene/connectionCrossingOrder'
import {
  connectTerminalToRouteJunction,
  deleteConnectionJunctions,
  mergeCollidingConnectionPoints,
  type RouteJunctionTarget,
} from './connectionJunctions'
import {
  busbarEndPoint,
  busbarPoint,
  connectTerminals,
  connectedRouteEndpointGeometry,
  connectionRouteBranchPointKeys,
  connectionTerminalArrowPath,
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
  roundedOrthogonalPathData,
  routeConnectionNetworksForDirtyNetworks,
  routeConnectionNetworksIncrementally,
  routeConnectionPreviewWithContext,
  segmentConnectionEdgesAtNodes,
  type ConnectedRouteDisplayGeometry,
  type ConnectionTerminal,
  type RoutedConnectionEdge,
} from '../scene/connections'
import { createLatestFrameScheduler, createTrailingScheduler } from './frameScheduler'
import {
  busbarInsideRect,
  clampZoom,
  diagramContentBounds,
  diagramObjectsBounds,
  elementInsideRect,
  elementsBounds,
  elementsEqual,
  fitViewportToBounds,
  MIN_ZOOM,
  normalizedRect,
  rotatePoint,
  rotatePointOnGrid,
  screenToWorld,
  snap,
  translateDiagramSelection,
  worldDeltaToLocal,
  zoomAroundPoint,
  type Point,
  type Rect,
} from './geometry'
import {
  GRID_BACKGROUND_COLOR,
  GridSurface,
  type GridRenderState,
} from '../scene/GridSurface'
import { GRID_PRESENTATION, getAdaptiveGridScale } from '../scene/gridScale'
import {
  inferWheelGestureKind,
  pinchZoomFactor,
  type WheelGestureKind,
} from '../scene/wheelGestures'
import {
  labelPlacementForPointer,
  layoutElementLabels,
  nextDeviceIdentifier,
  type ElementLabelLayout,
} from '../scene/elementLabels'
import {
  GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY,
  getSnappedGenericSymbolSize,
  isGenericSymbolKey,
  normalizeGenericSymbolBackgroundColor,
  resolvedGenericSymbolBackgroundColor,
} from '../scene/genericSymbol'
import {
  DEFAULT_BUSBAR_COLOR,
  defaultConnectionColor,
  normalizeHexColor,
} from '../scene/objectColors'
import {
  derivedRouteCornerCandidateAtPointer,
  type DerivedRouteCornerCandidate,
} from './routeCornerCandidates'
import { useRoutedConnections } from '../runtime/useRoutedConnections'
import {
  applyDraggedRouteSegment,
  atomicRouteSegments,
  clearRouteWaypointsForEdges,
  deleteRouteWaypoints,
  draggedRouteSegmentAlignsWithExistingRoute,
  insetDraggedRouteSegmentFromElementAnchors,
  previewDraggedSegment,
  removeFoldbackRouteWaypoints,
  routeWaypointBounds,
  routeWaypointsForNetworks,
  snapDraggedRouteSegmentDelta,
  syncRouteWaypointsToNetworks,
  type DraggableRouteSegment,
} from './routeWaypoints'
import {
  clipboardCanPasteInto,
  clipboardSelectionBounds,
  centeredSelectionOffset,
  copyConnectionsWithinSelection,
  createEmptySelectionClipboard,
  instantiateCopiedElement,
  instantiateCopiedConnections,
  type DiagramClipboardOperation,
  type DiagramSelectionClipboard,
} from './selectionClipboard'
import {
  elementSupportsOnOffState,
  getScaledSymbolSize,
  normalizeSymbolColor,
  resolvedSymbolColor,
  resolvedSymbolColorForSlot,
  symbolColorPropertyKey,
  symbolColorSlotForElement,
  symbolSupportsOnOffState,
  symbolsByKey,
  type SymbolColorSlot,
  type SymbolDefinition,
  type SymbolVisualState,
} from '../scene/symbolCatalog'
import {
  BusbarVisual,
  BusbarTapVisual,
  BusbarLabelItem,
  ConnectionBridgeCasing,
  ConnectionLabelItem,
  CoolingPipeShell,
  CoolingPipeInnerShadowFilter,
  DiagramConnectionVisual,
  DiagramElementVisual,
  ElementLabelItem,
  MonitorStaticFlowLines,
  SymbolColorFilter,
  symbolColorFilterId,
} from '../scene/DiagramScenePrimitives'
import {
  createConnectedAnchorIdsByElement,
  createConnectionRouteRenderGroups,
  createCoolingNodeIdsByNetwork,
  createCoolingPipeFilterIds,
  createCoolingPipeShellsByRenderKey,
  createDisplayedRoutePaths,
  createRenderedConnectionPaths,
  createStaticConnectionGroupsByRenderKey,
  createUnderpassAnimationExclusions,
  type ConnectionRouteDisplayCacheEntry,
  type CoolingPipeShellRouteCacheEntry,
} from '../scene/connectionScene'

export type CanvasMode = 'edit' | 'monitor'

const COOLING_PIPE_PREVIEW_FILTER_ID = 'cooling-pipe-inner-shadow-preview'
const CANVAS_STAGE_STYLE = {
  '--diagram-canvas-background': GRID_BACKGROUND_COLOR,
} as CSSProperties

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
  selectedRouteWaypointCount: number
  selectedRouteWaypointMaxReferenceCount: number
  selectedJunctionCount: number
  wiringType: AnchorType | null
  directLineToolActive: boolean
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
  toggleDirectLineTool: () => void
  insertSymbol: (symbolKey: string) => void
  insertBusbar: () => void
  previewElementColor: (
    elementId: string,
    color: string | null,
    slot?: SymbolColorSlot,
  ) => void
  previewSelectionColor: (color: string | null) => void
  previewBusbarLabelColor: (busbarId: string, color: string | null) => void
  updateSelectionColor: (color: string | null) => void
  previewCanvasColor: (target: CanvasColorTarget, color: string | null) => void
  updateCanvasColor: (target: CanvasColorTarget, color: string) => void
  updateElement: (elementId: string, patch: Partial<DiagramElement>) => void
  updateElements: (elementIds: string[], patch: Partial<DiagramElement>) => void
  updateElementMetrics: (elementIds: string[], metrics: MonitorMetric[]) => void
  previewElementSelectionColor: (
    elementIds: string[],
    color: string | null,
    slot: SymbolColorSlot,
  ) => void
  updateElementSelectionColor: (
    elementIds: string[],
    color: string | null,
    slot: SymbolColorSlot,
  ) => void
  updateBusbar: (busbarId: string, patch: Partial<Busbar>) => void
  updateBusbars: (busbarIds: string[], patch: Partial<Busbar>) => void
  updateConnectionEdge: (edgeId: string, patch: Partial<ConnectionEdge>) => void
  updateConnectionEdges: (edgeIds: string[], patch: Partial<ConnectionEdge>) => void
  updateConnectionEdgeMetrics: (edgeIds: string[], metrics: MonitorMetric[]) => void
  resetSelectedConnectionRouting: () => void
}

interface DiagramCanvasProps {
  mode: CanvasMode
  animationPlaying: boolean
  runtime: DiagramRuntimeContext
  diagramId: string
  lineSystemType: LineSystemType
  documentEpoch: number
  gridSize: number
  viewport: DiagramViewport
  assets: AssetDefinition[]
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  onDiagramChange: (
    elements: DiagramElement[],
    busbars: Busbar[],
    connections: ConnectionNetwork[],
    routeWaypoints: RouteWaypoint[],
  ) => void
  onSelectionChange: (ids: string[]) => void
  onElementDrillDown?: (elementId: string) => void
  onCommandStateChange: (state: EditorCommandState) => void
  onActionMessage: (message: string, tone: 'success' | 'danger') => void
}

interface EditorSnapshot {
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
}

interface HistoryState {
  past: EditorSnapshot[]
  future: EditorSnapshot[]
}

interface WiringState {
  source: ConnectionTerminal
  pointer: Point
  provisionalSource?: RouteJunctionCandidate
}

interface BusbarCandidate {
  busbar: Busbar
  point: Point
  offset: number
}

interface RouteJunctionCandidate extends RouteJunctionTarget {
  type: AnchorType
  derivedCorner?: boolean
}

interface ProvisionalConnectionRoute {
  scopeKey: string
  route: RoutedConnectionEdge
}

interface HandlerRef<Handler> {
  current: Handler
}

interface DiagramElementItemProps {
  mode: CanvasMode
  element: DiagramElement
  asset?: AssetDefinition
  symbol?: SymbolDefinition
  symbolColor?: string
  genericBackgroundColor?: string
  selected: boolean
  anchorsVisible: boolean
  wiringType: AnchorType | null
  lineSystemType: LineSystemType
  occupiedAnchors: Set<string>
  zoom: number
  visualState: SymbolVisualState
  elementNodes: HandlerRef<Map<string, SVGGElement>>
  startMove: HandlerRef<(event: PointerEvent<SVGElement>, elementId: string) => void>
  enterAnchor: HandlerRef<(elementId: string, anchorId: string, type: AnchorType) => void>
  leaveAnchor: HandlerRef<(elementId: string, anchorId: string) => void>
  pressAnchor: HandlerRef<(
    event: PointerEvent<SVGCircleElement>,
    elementId: string,
    anchorId: string,
    type: AnchorType,
  ) => void>
  coolingPumpRunning: boolean
  coolingValveOpen: boolean
  hoverElement: HandlerRef<(elementId: string | null) => void>
  drillDownTarget?: MonitorDrillDownTarget
  drillDownElement: HandlerRef<(elementId: string) => void>
}

const DiagramElementItem = memo(function DiagramElementItem({
  mode,
  element,
  asset,
  symbol,
  symbolColor,
  genericBackgroundColor,
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
  coolingPumpRunning,
  coolingValveOpen,
  hoverElement,
  drillDownTarget,
  drillDownElement,
}: DiagramElementItemProps) {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const colorFilterId = symbolColor ? symbolColorFilterId(symbolColor) : undefined
  const generic = symbol?.renderMode === 'generic-frame'
  const coolingPumpStopped = mode === 'monitor' &&
    asset?.coolingDeviceRole === 'pump' &&
    !coolingPumpRunning
  const clipPathId = `generic-symbol-clip-${element.id}`
  const handlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (mode === 'monitor') {
      if (event.button !== 0) return
      if (drillDownTarget) {
        event.preventDefault()
        event.stopPropagation()
        drillDownElement.current(element.id)
        return
      }
      const coolingDeviceRole = asset?.coolingDeviceRole
      if (!symbolSupportsOnOffState(symbol) && !coolingDeviceRole) return
      event.preventDefault()
      event.stopPropagation()
      startMove.current(event, element.id)
      return
    }
    startMove.current(event, element.id)
  }
  const anchorNodes = mode === 'edit' && anchorsVisible ? asset?.anchors.map((anchor) => {
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
        data-flow-role={anchor.flowRole}
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
  }) : null
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
      data-monitor-on-off={mode === 'monitor' && symbolSupportsOnOffState(symbol) || undefined}
      data-monitor-cooling-role={mode === 'monitor' ? asset?.coolingDeviceRole : undefined}
      data-monitor-cooling-active={mode === 'monitor' && asset?.coolingDeviceRole
        ? asset.coolingDeviceRole === 'pump' ? coolingPumpRunning : coolingValveOpen
        : undefined}
      data-monitor-drill-down={mode === 'monitor' ? drillDownTarget?.diagramId : undefined}
      transform={generic ? undefined : `rotate(${element.rotation} ${centerX} ${centerY})`}
      onPointerEnter={() => hoverElement.current(element.id)}
      onPointerLeave={() => hoverElement.current(null)}
    >
      {mode === 'monitor' && drillDownTarget ? (
        <title>{`点击下探到${drillDownTarget.diagramName}`}</title>
      ) : null}
      <DiagramElementVisual
        element={element}
        symbol={symbol}
        symbolColor={symbolColor}
        genericBackgroundColor={genericBackgroundColor}
        visualState={visualState}
        coolingPumpStopped={coolingPumpStopped}
        showCoolingPumpState={mode === 'monitor' && asset?.coolingDeviceRole === 'pump'}
        colorFilterId={colorFilterId}
        clipPathId={clipPathId}
        onPointerDown={handlePointerDown}
      >
        {anchorNodes}
      </DiagramElementVisual>
      {mode === 'monitor' && selected ? (
        <rect
          className="diagram-element__monitor-selection"
          x={element.x - 3 / zoom}
          y={element.y - 3 / zoom}
          width={element.width + 6 / zoom}
          height={element.height + 6 / zoom}
          rx={2 / zoom}
          transform={generic ? `rotate(${element.rotation} ${centerX} ${centerY})` : undefined}
        />
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
  flowDirection?: ConnectionFlowDirection
  coolingLineRole?: CoolingLineRole
  directionArrowPath: string
  pressEdge: HandlerRef<(
    event: PointerEvent<SVGPathElement>,
    networkId: string,
    edgeId: string,
  ) => void>
  moveEdge: HandlerRef<(
    event: PointerEvent<SVGPathElement>,
    networkId: string,
    edgeId: string,
  ) => void>
  leaveEdge: HandlerRef<() => void>
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
  flowDirection,
  coolingLineRole,
  directionArrowPath,
  pressEdge,
  moveEdge,
  leaveEdge,
  edgeNodes,
}: ConnectionEdgeItemProps) {
  return (
    <DiagramConnectionVisual
      edgeId={edgeId}
      networkId={networkId}
      type={type}
      color={color}
      flowDirection={flowDirection}
      coolingLineRole={isCoolingConnectionType(type)
        ? coolingLineRole ?? 'primary'
        : undefined}
      selected={selected}
      interactive={interactive}
      linePath={linePath}
      directionArrowPath={directionArrowPath}
      nodeRegistry={edgeNodes}
      lineUnderlay={selected && isCoolingConnectionType(type) ? (
        <path className="connection-edge__cooling-selection" d={linePath} />
      ) : null}
    >
      <path
        className="connection-edge__hit"
        d={linePath}
        onPointerDown={interactive
          ? (event) => pressEdge.current(event, networkId, edgeId)
          : undefined}
        onPointerMove={interactive
          ? (event) => moveEdge.current(event, networkId, edgeId)
          : undefined}
        onPointerLeave={interactive ? () => leaveEdge.current() : undefined}
      />
      <path
        className="connection-edge__hit connection-edge__hit--world"
        d={linePath}
        onPointerDown={interactive
          ? (event) => pressEdge.current(event, networkId, edgeId)
          : undefined}
        onPointerMove={interactive
          ? (event) => moveEdge.current(event, networkId, edgeId)
          : undefined}
        onPointerLeave={interactive ? () => leaveEdge.current() : undefined}
      />
    </DiagramConnectionVisual>
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
  routeWaypoints: RouteWaypoint[] | null
}

interface RouteSegmentDragPreview {
  segment: DraggableRouteSegment
  start: Point
  end: Point
}

type Interaction =
  | {
      kind: 'pan'
      trigger: 'middle' | 'space-left'
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
      baseRouteWaypointSelection: string[]
      baseJunctionSelection: string[]
    }
  | {
      kind: 'move'
      pointerId: number
      startWorld: Point
      baseElements: DiagramElement[]
      baseBusbars: Busbar[]
      selectedIds: string[]
      selectedBusbarIds: string[]
      selectedRouteWaypointIds: string[]
      baseRouteWaypoints: RouteWaypoint[]
      baseConnections: ConnectionNetwork[]
      selectedJunctionIds: string[]
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
      selectedRouteWaypointIds: string[]
      baseRouteWaypoints: RouteWaypoint[]
      baseConnections: ConnectionNetwork[]
      selectedJunctionIds: string[]
    }
  | {
      kind: 'route-segment'
      pointerId: number
      startWorld: Point
      segment: DraggableRouteSegment
      baseConnections: ConnectionNetwork[]
      baseRouteWaypoints: RouteWaypoint[]
      routedEdges: RoutedConnectionEdge[]
      currentStart: Point
      currentEnd: Point
    }
  | {
      kind: 'route-waypoint'
      pointerId: number
      startWorld: Point
      baseElements: DiagramElement[]
      baseBusbars: Busbar[]
      baseRouteWaypoints: RouteWaypoint[]
      selectedIds: string[]
      selectedBusbarIds: string[]
      selectedRouteWaypointIds: string[]
    }
  | {
      kind: 'node'
      pointerId: number
      startWorld: Point
      junctionId: string
      baseConnections: ConnectionNetwork[]
      startPoint: Point
    }
  | {
      kind: 'route-corner'
      pointerId: number
      startWorld: Point
      candidate: DerivedRouteCornerCandidate
      materialized: {
        networks: ConnectionNetwork[]
        routeWaypoints: RouteWaypoint[]
        junctionId: string
      } | null
      currentPoint: Point
      hasMoved: boolean
    }
  | {
      kind: 'resize-busbar'
      pointerId: number
      endpoint: 'start' | 'end'
      baseBusbars: Busbar[]
      baseConnections: ConnectionNetwork[]
      busbar: Busbar
      constraintToastShown: boolean
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
const WHEEL_GESTURE_END_DELAY_MS = 160
const RENDER_CULLING_OBJECT_THRESHOLD = 180
const RENDER_OVERSCAN_SCREEN_PX = 160
const PAN_CULLING_SYNC_SCREEN_DISTANCE = 120
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

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

function connectedRouteDisplayGeometryKey(geometry: ConnectedRouteDisplayGeometry) {
  const endpointArcKey = (
    arc: ConnectedRouteDisplayGeometry['sourceEndpointArc'],
  ) => arc
    ? [
        arc.entry.x,
        arc.entry.y,
        arc.midpoint.x,
        arc.midpoint.y,
        arc.center.x,
        arc.center.y,
        arc.radius,
        arc.sweep,
      ].join(',')
    : ''
  const route = geometry.route
  return [
    route.networkId,
    route.edgeId,
    route.type,
    route.sourceNodeId,
    route.targetNodeId,
    route.order,
    route.points.map((point) => `${point.x},${point.y}`).join(';'),
    endpointArcKey(geometry.sourceEndpointArc),
    endpointArcKey(geometry.targetEndpointArc),
  ].join('|')
}

function projectedDistanceAlongPolyline(points: Point[], target: Point) {
  let accumulated = 0
  let best = { distanceAlong: 0, squaredDistance: Number.POSITIVE_INFINITY }
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const length = Math.sqrt(lengthSquared)
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared))
    const projected = { x: start.x + dx * ratio, y: start.y + dy * ratio }
    const squaredDistance = (target.x - projected.x) ** 2 + (target.y - projected.y) ** 2
    if (squaredDistance < best.squaredDistance) {
      best = { distanceAlong: accumulated + length * ratio, squaredDistance }
    }
    accumulated += length
  }
  return best.distanceAlong
}

function slicePolylineByDistance(points: Point[], lower: number, upper: number) {
  if (points.length < 2 || upper <= lower) return []
  let accumulated = 0
  const sliced: Point[] = []
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]
    const right = points[index]
    const length = Math.hypot(right.x - left.x, right.y - left.y)
    if (length === 0) continue
    const segmentStart = accumulated
    const segmentEnd = accumulated + length
    if (segmentEnd < lower || segmentStart > upper) {
      accumulated = segmentEnd
      continue
    }
    const interpolate = (distance: number) => {
      const ratio = Math.max(0, Math.min(1, (distance - segmentStart) / length))
      return {
        x: left.x + (right.x - left.x) * ratio,
        y: left.y + (right.y - left.y) * ratio,
      }
    }
    const clippedStart = interpolate(Math.max(lower, segmentStart))
    const clippedEnd = interpolate(Math.min(upper, segmentEnd))
    if (!sliced.length || sliced.at(-1)!.x !== clippedStart.x || sliced.at(-1)!.y !== clippedStart.y) {
      sliced.push(clippedStart)
    }
    if (sliced.at(-1)!.x !== clippedEnd.x || sliced.at(-1)!.y !== clippedEnd.y) {
      sliced.push(clippedEnd)
    }
    accumulated = segmentEnd
  }
  return sliced
}

function slicePolylineBetween(points: Point[], start: Point, end: Point) {
  if (points.length < 2) return []
  const startDistance = projectedDistanceAlongPolyline(points, start)
  const endDistance = projectedDistanceAlongPolyline(points, end)
  const sliced = slicePolylineByDistance(
    points,
    Math.min(startDistance, endDistance),
    Math.max(startDistance, endDistance),
  )
  return startDistance <= endDistance ? sliced : sliced.reverse()
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

function pointOnRouteSegment(segment: DraggableRouteSegment, point: Point) {
  return segment.orientation === 'horizontal'
    ? point.y === segment.start.y &&
      point.x >= Math.min(segment.start.x, segment.end.x) &&
      point.x <= Math.max(segment.start.x, segment.end.x)
    : point.x === segment.start.x &&
      point.y >= Math.min(segment.start.y, segment.end.y) &&
      point.y <= Math.max(segment.start.y, segment.end.y)
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
  connections: ConnectionNetwork[],
  gridSize: number,
  copyIndex = 1,
): Point {
  const baseOffset = gridSize * 2
  if (!connections.length) {
    return { x: baseOffset * copyIndex, y: baseOffset * copyIndex }
  }
  const bounds = clipboardSelectionBounds(elements, busbars, connections)
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
    ...(symbolSupportsOnOffState(symbol)
      ? { onOffState: symbol.defaultState ?? 'off' as const }
      : {}),
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
    const size = isGenericSymbolKey(element.assetKey)
      ? getSnappedGenericSymbolSize(element.width * scale, element.height * scale, gridSize)
      : getScaledSymbolSize(symbol, (element.width / symbol.intrinsicWidth) * scale, gridSize)
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
): Busbar[] {
  const swapsOrientation = Math.abs(Math.round(rotationDelta / 90)) % 2 === 1
  return busbars.map((busbar) => {
    if (!selectedIds.has(busbar.id)) return busbar
    const originalStart = { x: busbar.x, y: busbar.y }
    const end = busbarEndPoint(busbar)
    const midpoint = rotatePoint({
      x: (busbar.x + end.x) / 2,
      y: (busbar.y + end.y) / 2,
    }, center, rotationDelta)
    const orientation = swapsOrientation
      ? busbar.orientation === 'horizontal' ? 'vertical' : 'horizontal'
      : busbar.orientation
    const nextBusbar: Busbar = orientation === 'horizontal'
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
    if (!busbar.monitorFlowDirection) return nextBusbar
    const rotatedOriginalStart = rotatePoint(originalStart, center, rotationDelta)
    const nextStart = { x: nextBusbar.x, y: nextBusbar.y }
    const nextEnd = busbarEndPoint(nextBusbar)
    const distanceToNextStart = Math.hypot(
      rotatedOriginalStart.x - nextStart.x,
      rotatedOriginalStart.y - nextStart.y,
    )
    const distanceToNextEnd = Math.hypot(
      rotatedOriginalStart.x - nextEnd.x,
      rotatedOriginalStart.y - nextEnd.y,
    )
    if (distanceToNextStart <= distanceToNextEnd) return nextBusbar
    return {
      ...nextBusbar,
      monitorFlowDirection: busbar.monitorFlowDirection === 'start-to-end'
        ? 'end-to-start'
        : 'start-to-end',
    }
  })
}

function busbarMonitorFlowHintGeometry(busbar: Busbar) {
  if (!busbar.monitorFlowDirection) return null
  const start = { x: busbar.x, y: busbar.y }
  const end = busbarEndPoint(busbar)
  return busbar.monitorFlowDirection === 'start-to-end'
    ? { entry: start, exit: end }
    : { entry: end, exit: start }
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
      busbar.labelEndpoint === candidate.labelEndpoint &&
      busbar.labelSide === candidate.labelSide &&
      busbar.labelColor === candidate.labelColor &&
      busbar.monitorFlowDirection === candidate.monitorFlowDirection
  })
}

function connectionGeometryEqual(left: ConnectionNetwork[], right: ConnectionNetwork[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((network, networkIndex) => {
    const candidate = right[networkIndex]
    if (
      network.id !== candidate.id ||
      network.type !== candidate.type ||
      network.nodes.length !== candidate.nodes.length ||
      network.edges.length !== candidate.edges.length
    ) return false
    const nodesEqual = network.nodes.every((node, nodeIndex) => {
      const other = candidate.nodes[nodeIndex]
      if (node.id !== other.id || node.kind !== other.kind) return false
      if (node.kind === 'node' && other.kind === 'node') {
        return node.x === other.x && node.y === other.y
      }
      if (node.kind === 'busbar-tap' && other.kind === 'busbar-tap') {
        return node.busbarId === other.busbarId && node.offset === other.offset
      }
      return node.kind === 'element-anchor' && other.kind === 'element-anchor' &&
        node.elementId === other.elementId && node.anchorId === other.anchorId
    })
    return nodesEqual && network.edges.every((edge, edgeIndex) => {
      const other = candidate.edges[edgeIndex]
      return edge.id === other.id &&
        edge.sourceNodeId === other.sourceNodeId &&
        edge.targetNodeId === other.targetNodeId &&
        JSON.stringify(edge.routeNodeIds ?? []) === JSON.stringify(other.routeNodeIds ?? [])
    })
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
      runtime,
      diagramId,
      lineSystemType,
      documentEpoch,
      gridSize,
      viewport,
      assets,
      elements,
      busbars,
      connections,
      routeWaypoints,
      onDiagramChange,
      onSelectionChange,
      onElementDrillDown = () => undefined,
      onCommandStateChange,
      onActionMessage,
    },
    ref,
  ) {
    const {
      onOffStates,
      coolingPumpRunningStates,
      coolingValveOpenStates,
    } = runtime.state
    const monitorDrillDownTargets = runtime.navigation
    const canvasRenderRevisionRef = useRef(0)
    canvasRenderRevisionRef.current += 1
    const viewportElementRef = useRef<HTMLDivElement>(null)
    const canvasStageRef = useRef<HTMLDivElement>(null)
    const viewportWorldRef = useRef<SVGGElement>(null)
    const gridFallbackRef = useRef<HTMLDivElement>(null)
    const callbacksRef = useRef({
      onDiagramChange,
      onSelectionChange,
      onElementDrillDown,
      onCommandStateChange,
      onActionMessage,
    })
    const committedElementsRef = useRef(elements)
    const committedBusbarsRef = useRef(busbars)
    const committedConnectionsRef = useRef(connections)
    const committedRouteWaypointsRef = useRef(routeWaypoints)
    const viewportValueRef = useRef(viewport)
    const autoFitViewportScopeRef = useRef<string | null>(null)
    const reportedZoomRef = useRef(viewport.zoom)
    const lastPanReactViewportRef = useRef(viewport)
    const pendingPanViewportRef = useRef<DiagramViewport | null>(null)
    const panViewportApplyRef = useRef<(nextViewport: DiagramViewport) => void>(() => undefined)
    const selectedIdsRef = useRef<string[]>([])
    const selectedConnectionIdRef = useRef<string | null>(null)
    const selectedBusbarIdsRef = useRef<string[]>([])
    const selectedRouteWaypointIdsRef = useRef<string[]>([])
    const selectedJunctionIdsRef = useRef<string[]>([])
    const wiringRef = useRef<WiringState | null>(null)
    const directLineToolActiveRef = useRef(false)
    const directLineHistoryStartedRef = useRef(false)
    const hoveredWiringTargetRef = useRef<ConnectionTerminal | null>(null)
    const historyRef = useRef<HistoryState>({ past: [], future: [] })
    const clipboardRef = useRef<DiagramSelectionClipboard>(createEmptySelectionClipboard())
    const pasteCountRef = useRef(0)
    const interactionRef = useRef<Interaction | null>(null)
    const spacePanHeldRef = useRef(false)
    const finishSpacePanRef = useRef<() => void>(() => undefined)
    const wheelHandlerRef = useRef<(event: globalThis.WheelEvent) => void>(() => undefined)
    const wheelGestureRef = useRef<{
      kind: WheelGestureKind | null
      panTarget: DiagramViewport | null
    }>({ kind: null, panTarget: null })
    const finishWheelGestureRef = useRef<() => void>(() => undefined)
    const lastJunctionPressRef = useRef<{
      junctionId: string
      timeStamp: number
      clientX: number
      clientY: number
    } | null>(null)
    const lastRouteCornerPressRef = useRef<{
      candidateKey: string
      timeStamp: number
      clientX: number
      clientY: number
    } | null>(null)
    const previewElementsRef = useRef<DiagramElement[] | null>(null)
    const previewBusbarsRef = useRef<Busbar[] | null>(null)
    const previewConnectionsRef = useRef<ConnectionNetwork[] | null>(null)
    const previewRouteWaypointsRef = useRef<RouteWaypoint[] | null>(null)
    const connectionLabelPlacementPreviewRef = useRef<ConnectionLabelPlacement | null>(null)
    const nudgeSessionActiveRef = useRef(false)
    const nudgeCommitRef = useRef<() => void>(() => undefined)
    const symbolColorDefsRef = useRef<SVGDefsElement | null>(null)
    const elementNodeRefs = useRef(new Map<string, SVGGElement>())
    const elementLabelLayoutCacheRef = useRef(new Map<string, ElementLabelLayout>())
    const busbarNodeRefs = useRef(new Map<string, SVGGElement>())
    const busbarLabelNodeRefs = useRef(new Map<string, SVGGElement>())
    const busbarTapNodeRefs = useRef(new Map<string, SVGCircleElement>())
    const busbarCandidateNodeRef = useRef<SVGCircleElement | null>(null)
    const connectionEdgeNodeRefs = useRef(new Map<string, SVGGElement>())
    const renderedConnectionPathCacheRef = useRef(
      new Map<string, ConnectionRouteDisplayCacheEntry>(),
    )
    const connectedCoolingRouteGeometryCacheRef = useRef(new Map<string, {
      key: string
      geometry: ConnectedRouteDisplayGeometry
    }>())
    const branchPointKeysCacheRef = useRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
    const coolingPipeShellRouteCacheRef = useRef(
      new Map<string, CoolingPipeShellRouteCacheEntry>(),
    )
    const startElementMoveRef = useRef<
      (event: PointerEvent<SVGElement>, elementId: string) => void
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
    const pressConnectionEdgeRef = useRef<(
      event: PointerEvent<SVGPathElement>,
      networkId: string,
      edgeId: string,
    ) => void>(() => undefined)
    const moveConnectionEdgeRef = useRef<(
      event: PointerEvent<SVGPathElement>,
      networkId: string,
      edgeId: string,
    ) => void>(() => undefined)
    const leaveConnectionEdgeRef = useRef<() => void>(() => undefined)
    const hoverElementRef = useRef<(elementId: string | null) => void>(() => undefined)
    const drillDownElementRef = useRef<(elementId: string) => void>(() => undefined)
    const previewElementColorsRef = useRef(new Map<
      string,
      { slot: SymbolColorSlot; color: string }
    >())
    const [viewportValue, setViewportValue] = useState(viewport)
    const [selectedIds, setSelectedIdsState] = useState<string[]>([])
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
    const [selectedBusbarIds, setSelectedBusbarIdsState] = useState<string[]>([])
    const [selectedRouteWaypointIds, setSelectedRouteWaypointIdsState] = useState<string[]>([])
    const [selectedJunctionIds, setSelectedJunctionIdsState] = useState<string[]>([])
    const [selectedLabelElementId, setSelectedLabelElementId] = useState<string | null>(null)
    const [selectedLabelBusbarId, setSelectedLabelBusbarId] = useState<string | null>(null)
    const [selectedLabelConnectionEdgeId, setSelectedLabelConnectionEdgeId] = useState<string | null>(null)
    const [wiring, setWiringState] = useState<WiringState | null>(null)
    const [directLineToolActive, setDirectLineToolActiveState] = useState(false)
    const [hoveredWiringTarget, setHoveredWiringTarget] = useState<ConnectionTerminal | null>(null)
    const [busbarCandidate, setBusbarCandidate] = useState<BusbarCandidate | null>(null)
    const [routeJunctionCandidate, setRouteJunctionCandidate] = useState<
      RouteJunctionCandidate | null
    >(null)
    const [previewElements, setPreviewElements] = useState<DiagramElement[] | null>(null)
    const [previewBusbars, setPreviewBusbars] = useState<Busbar[] | null>(null)
    const [previewConnections, setPreviewConnections] = useState<ConnectionNetwork[] | null>(null)
    const [previewRouteWaypoints, setPreviewRouteWaypoints] = useState<RouteWaypoint[] | null>(null)
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
    const [routeSegmentDragPreview, setRouteSegmentDragPreview] = useState<
      RouteSegmentDragPreview | null
    >(null)

    const diagramPreviewScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      (frame: DiagramPreviewFrame) => {
        setPreviewElements(frame.elements)
        setPreviewBusbars(frame.busbars)
        setPreviewConnections(frame.connections)
        setPreviewRouteWaypoints(frame.routeWaypoints)
      },
    ), [])
    const wiringPointerScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      setWiringState,
    ), [])
    const viewportFrameScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      (nextViewport: DiagramViewport) => {
        lastPanReactViewportRef.current = nextViewport
        setViewportValue(nextViewport)
        if (reportedZoomRef.current !== nextViewport.zoom) {
          reportedZoomRef.current = nextViewport.zoom
          queueMicrotask(emitCommandState)
        }
      },
    ), [])
    const nudgeCommitScheduler = useMemo(() => createTrailingScheduler(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle),
      NUDGE_COMMIT_DELAY_MS,
      () => nudgeCommitRef.current(),
    ), [])
    const wheelGestureEndScheduler = useMemo(() => createTrailingScheduler(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle),
      WHEEL_GESTURE_END_DELAY_MS,
      () => finishWheelGestureRef.current(),
    ), [])
    const canvasSize = useElementSize(viewportElementRef)
    const contentBounds = useMemo(
      () => diagramContentBounds(elements, busbars, connections),
      [busbars, connections, elements],
    )
    const gridScale = getAdaptiveGridScale(gridSize, viewportValue.zoom)
    const gridRenderStateRef = useRef<GridRenderState>({
      viewport: viewportValue,
      worldStep: gridScale.worldStep,
    })
    const gridInvalidateRef = useRef<(() => void) | null>(null)
    const flowInvalidateRef = useRef<(() => void) | null>(null)

    const syncViewportPresentation = (nextViewport: DiagramViewport) => {
      const nextGridScale = getAdaptiveGridScale(gridSize, nextViewport.zoom)
      const world = viewportWorldRef.current
      if (world) {
        world.setAttribute(
          'transform',
          `translate(${nextViewport.tx} ${nextViewport.ty}) scale(${nextViewport.zoom})`,
        )
        world.style.transform = `translate(${nextViewport.tx}px, ${nextViewport.ty}px) scale(${nextViewport.zoom})`
      }

      const stage = canvasStageRef.current
      if (stage) {
        stage.dataset.gridZoom = String(nextViewport.zoom)
        stage.dataset.gridTranslationX = String(nextViewport.tx)
        stage.dataset.gridTranslationY = String(nextViewport.ty)
        stage.dataset.gridDensity = String(nextGridScale.density)
        stage.dataset.gridVisibleStep = String(nextGridScale.worldStep)
        stage.dataset.gridScreenStep = String(nextGridScale.screenStep)
        stage.dataset.gridScreenDotRadius = String(nextGridScale.dotScreenRadius)
      }

      const fallback = gridFallbackRef.current
      if (fallback) {
        fallback.style.setProperty('--grid-origin-x', `${nextViewport.tx}px`)
        fallback.style.setProperty('--grid-origin-y', `${nextViewport.ty}px`)
        fallback.style.setProperty('--grid-screen-step', `${nextGridScale.screenStep}px`)
        fallback.style.setProperty('--grid-dot-radius', `${nextGridScale.dotScreenRadius}px`)
      }

      gridRenderStateRef.current = {
        viewport: nextViewport,
        worldStep: nextGridScale.worldStep,
      }
      gridInvalidateRef.current?.()
      flowInvalidateRef.current?.()
    }

    panViewportApplyRef.current = (nextViewport) => {
      pendingPanViewportRef.current = null
      viewportValueRef.current = nextViewport
      syncViewportPresentation(nextViewport)

      const lastReactViewport = lastPanReactViewportRef.current
      const distance = Math.max(
        Math.abs(nextViewport.tx - lastReactViewport.tx),
        Math.abs(nextViewport.ty - lastReactViewport.ty),
      )
      if (distance < PAN_CULLING_SYNC_SCREEN_DISTANCE) return
      lastPanReactViewportRef.current = nextViewport
      setViewportValue(nextViewport)
    }

    const panViewportFrameScheduler = useMemo(() => createLatestFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      (nextViewport: DiagramViewport) => panViewportApplyRef.current(nextViewport),
    ), [])

    useLayoutEffect(() => {
      syncViewportPresentation(viewportValueRef.current)
    }, [
      gridSize,
      gridScale.worldStep,
      viewportValue.tx,
      viewportValue.ty,
      viewportValue.zoom,
    ])

    callbacksRef.current = {
      onDiagramChange,
      onSelectionChange,
      onElementDrillDown,
      onCommandStateChange,
      onActionMessage,
    }
    hoverElementRef.current = setHoveredElementId
    drillDownElementRef.current = callbacksRef.current.onElementDrillDown

    const emitCommandState = () => {
      const selectedRouteWaypointIdSet = new Set(selectedRouteWaypointIdsRef.current)
      const waypointReferenceCounts = new Map<string, number>()
      committedConnectionsRef.current.forEach((network) => network.edges.forEach((edge) => {
        const routeNodeIds = edge.routeNodeIds ?? []
        routeNodeIds.forEach((waypointId) => {
          if (!selectedRouteWaypointIdSet.has(waypointId)) return
          waypointReferenceCounts.set(
            waypointId,
            (waypointReferenceCounts.get(waypointId) ?? 0) + 1,
          )
        })
      }))
      callbacksRef.current.onCommandStateChange({
        canUndo: historyRef.current.past.length > 0,
        canRedo: historyRef.current.future.length > 0,
        canCopy:
          selectedIdsRef.current.length > 0 ||
          selectedBusbarIdsRef.current.length > 0 ||
          selectedRouteWaypointIdsRef.current.length > 0 ||
          selectedJunctionIdsRef.current.length > 0,
        hasSelection:
          selectedIdsRef.current.length > 0 ||
          selectedConnectionIdRef.current !== null ||
          selectedBusbarIdsRef.current.length > 0 ||
          selectedRouteWaypointIdsRef.current.length > 0 ||
          selectedJunctionIdsRef.current.length > 0,
        zoom: viewportValueRef.current.zoom,
        selectedConnection: selectedConnectionIdRef.current !== null,
        selectedBusbar: selectedBusbarIdsRef.current.length > 0,
        selectedConnectionId: selectedConnectionIdRef.current,
        selectedConnectionEdgeIds: selectedConnectionEdges(
          selectedConnectionIdRef.current,
          committedConnectionsRef.current,
        ).map((edge) => edge.id),
        selectedBusbarIds: [...selectedBusbarIdsRef.current],
        selectedRouteWaypointCount: selectedRouteWaypointIdsRef.current.length,
        selectedRouteWaypointMaxReferenceCount: Math.max(
          0,
          ...waypointReferenceCounts.values(),
        ),
        selectedJunctionCount: selectedJunctionIdsRef.current.length,
        wiringType: wiringRef.current?.source.type ?? null,
        directLineToolActive: directLineToolActiveRef.current,
      })
    }

    const setObjectSelection = (
      elementIds: string[],
      busbarIds: string[],
      preserveConnections = false,
      preserveRouteWaypoints = false,
      preserveJunctions = false,
    ) => {
      const uniqueElementIds = [...new Set(elementIds)]
      const uniqueBusbarIds = [...new Set(busbarIds)]
      const selectionUnchanged =
        uniqueElementIds.length === selectedIdsRef.current.length &&
        uniqueElementIds.every((id, index) => id === selectedIdsRef.current[index]) &&
        uniqueBusbarIds.length === selectedBusbarIdsRef.current.length &&
        uniqueBusbarIds.every((id, index) => id === selectedBusbarIdsRef.current[index])
      const clearedRouteWaypointSelection = !preserveRouteWaypoints &&
        selectedRouteWaypointIdsRef.current.length > 0
      if (clearedRouteWaypointSelection) {
        selectedRouteWaypointIdsRef.current = []
        setSelectedRouteWaypointIdsState([])
      }
      const clearedJunctionSelection = !preserveJunctions &&
        selectedJunctionIdsRef.current.length > 0
      if (clearedJunctionSelection) {
        selectedJunctionIdsRef.current = []
        setSelectedJunctionIdsState([])
      }
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
        if (clearedRouteWaypointSelection || clearedJunctionSelection) queueMicrotask(emitCommandState)
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
        selectedRouteWaypointIdsRef.current = []
        setSelectedRouteWaypointIdsState([])
        selectedJunctionIdsRef.current = []
        setSelectedJunctionIdsState([])
      }
      queueMicrotask(emitCommandState)
    }

    const selectBusbar = (busbarId: string | null, preserveElements = false) => {
      setObjectSelection(
        preserveElements ? selectedIdsRef.current : [],
        busbarId ? [busbarId] : [],
      )
    }

    const setRouteWaypointSelection = (
      waypointIds: string[],
      preserveObjects = false,
      preserveConnection = false,
      preserveJunctions = false,
    ) => {
      const uniqueIds = [...new Set(waypointIds)]
      selectedRouteWaypointIdsRef.current = uniqueIds
      setSelectedRouteWaypointIdsState(uniqueIds)
      if (!preserveObjects) {
        selectedIdsRef.current = []
        selectedBusbarIdsRef.current = []
        setSelectedIdsState([])
        setSelectedBusbarIdsState([])
        callbacksRef.current.onSelectionChange([])
      }
      if (!preserveJunctions) {
        selectedJunctionIdsRef.current = []
        setSelectedJunctionIdsState([])
      }
      if (!preserveConnection) {
        selectedConnectionIdRef.current = null
        setSelectedConnectionId(null)
      }
      queueMicrotask(emitCommandState)
    }

    const setJunctionSelection = (
      junctionIds: string[],
      preserveObjects = false,
      preserveRouteWaypoints = false,
    ) => {
      const uniqueIds = [...new Set(junctionIds)]
      selectedJunctionIdsRef.current = uniqueIds
      setSelectedJunctionIdsState(uniqueIds)
      if (!preserveObjects) {
        selectedIdsRef.current = []
        selectedBusbarIdsRef.current = []
        setSelectedIdsState([])
        setSelectedBusbarIdsState([])
        callbacksRef.current.onSelectionChange([])
      }
      selectedConnectionIdRef.current = null
      setSelectedConnectionId(null)
      if (!preserveRouteWaypoints) {
        selectedRouteWaypointIdsRef.current = []
        setSelectedRouteWaypointIdsState([])
      }
      queueMicrotask(emitCommandState)
    }

    const setConnectionPointSelectionAfterMerge = (
      nextNetworks: ConnectionNetwork[],
      _nextRouteWaypoints: RouteWaypoint[],
      mergedJunctionIds: string[],
      previousWaypointIds: string[],
      previousJunctionIds: string[],
      preserveObjects = true,
    ) => {
      const retainedNodeIds = new Set(nextNetworks.flatMap((network) => (
        network.nodes.flatMap((node) => (
          node.kind === 'node' || node.kind === 'busbar-tap' ? [node.id] : []
        ))
      )))
      const junctionIds = [...new Set([
        ...previousWaypointIds.filter((id) => retainedNodeIds.has(id)),
        ...previousJunctionIds.filter((id) => retainedNodeIds.has(id)),
        ...mergedJunctionIds,
      ])]
      selectedRouteWaypointIdsRef.current = []
      selectedJunctionIdsRef.current = junctionIds
      setSelectedRouteWaypointIdsState([])
      setSelectedJunctionIdsState(junctionIds)
      selectedConnectionIdRef.current = null
      setSelectedConnectionId(null)
      if (!preserveObjects) setObjectSelection([], [], true, true, true)
      queueMicrotask(emitCommandState)
    }

    const setWiring = (next: WiringState | null) => {
      wiringPointerScheduler.cancel()
      const previousType = wiringRef.current?.source.type ?? null
      const nextType = next?.source.type ?? null
      wiringRef.current = next
      setWiringState(next)
      if (!next) {
        setBusbarCandidate(null)
        setRouteJunctionCandidate(null)
        hoveredWiringTargetRef.current = null
        setHoveredWiringTarget(null)
      }
      if (previousType !== nextType) queueMicrotask(emitCommandState)
    }

    const stopDirectLineTool = () => {
      if (!directLineToolActiveRef.current) return
      directLineToolActiveRef.current = false
      directLineHistoryStartedRef.current = false
      setDirectLineToolActiveState(false)
      setWiring(null)
      queueMicrotask(emitCommandState)
    }

    const toggleDirectLineTool = () => {
      if (mode !== 'edit') return
      if (directLineToolActiveRef.current) {
        stopDirectLineTool()
        return
      }
      directLineToolActiveRef.current = true
      directLineHistoryStartedRef.current = false
      setDirectLineToolActiveState(true)
      setWiring(null)
      setSelection([])
      selectConnection(null)
      selectBusbar(null)
      viewportElementRef.current?.focus()
      queueMicrotask(emitCommandState)
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
        routeWaypoints: previewRouteWaypointsRef.current,
      })
    }

    const scheduleDiagramPreview = (
      nextElements: DiagramElement[] | null,
      nextBusbars: Busbar[] | null,
      nextConnections: ConnectionNetwork[] | null,
      nextRouteWaypoints: RouteWaypoint[] | null = previewRouteWaypointsRef.current,
    ) => {
      const currentElements = previewElementsRef.current ?? committedElementsRef.current
      const currentBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
      const currentConnections = previewConnectionsRef.current ?? committedConnectionsRef.current
      const elementsUnchanged = nextElements === null || elementsEqual(currentElements, nextElements)
      const busbarsUnchanged = nextBusbars === null || busbarsEqual(currentBusbars, nextBusbars)
      const connectionsUnchanged = nextConnections === null ||
        connectionGeometryEqual(currentConnections, nextConnections)
      const currentRouteWaypoints = previewRouteWaypointsRef.current ?? committedRouteWaypointsRef.current
      const routeWaypointsUnchanged = nextRouteWaypoints === null ||
        JSON.stringify(currentRouteWaypoints) === JSON.stringify(nextRouteWaypoints)
      if (
        elementsUnchanged &&
        busbarsUnchanged &&
        connectionsUnchanged &&
        routeWaypointsUnchanged
      ) return
      previewElementsRef.current = nextElements
      previewBusbarsRef.current = nextBusbars
      previewConnectionsRef.current = nextConnections
      previewRouteWaypointsRef.current = nextRouteWaypoints
      diagramPreviewScheduler.schedule({
        elements: nextElements,
        busbars: nextBusbars,
        connections: nextConnections,
        routeWaypoints: nextRouteWaypoints,
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

    const setRouteWaypointPreview = (next: RouteWaypoint[] | null) => {
      diagramPreviewScheduler.cancel()
      previewRouteWaypointsRef.current = next
      setPreviewRouteWaypoints(next)
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
      nextRouteWaypoints: RouteWaypoint[] = committedRouteWaypointsRef.current,
      recordHistory = true,
    ) => {
      if (mode !== 'edit') return false
      const syncedConnections = segmentConnectionEdgesAtNodes(
        syncRouteWaypointsToNetworks(nextConnections, nextRouteWaypoints),
      )
      const retainedRouteWaypoints = routeWaypointsForNetworks(syncedConnections)
      const current: EditorSnapshot = {
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
        routeWaypoints: committedRouteWaypointsRef.current,
      }
      if (
        elementsEqual(current.elements, nextElements) &&
        JSON.stringify(current.busbars) === JSON.stringify(nextBusbars) &&
        JSON.stringify(current.connections) === JSON.stringify(syncedConnections) &&
        JSON.stringify(current.routeWaypoints) === JSON.stringify(retainedRouteWaypoints)
      ) {
        setPreview(null)
        setBusbarPreview(null)
        setConnectionPreview(null)
        setRouteWaypointPreview(null)
        return false
      }
      if (recordHistory) {
        historyRef.current.past = [...historyRef.current.past.slice(-(HISTORY_LIMIT - 1)), current]
        historyRef.current.future = []
      }
      committedElementsRef.current = nextElements
      committedBusbarsRef.current = nextBusbars
      committedConnectionsRef.current = syncedConnections
      committedRouteWaypointsRef.current = retainedRouteWaypoints
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setRouteWaypointPreview(null)
      callbacksRef.current.onDiagramChange(
        nextElements,
        nextBusbars,
        syncedConnections,
        retainedRouteWaypoints,
      )
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
      const nextElements = previewElementsRef.current ?? committedElementsRef.current
      const nextBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
      let nextConnections = previewConnectionsRef.current ?? committedConnectionsRef.current
      let nextRouteWaypoints = previewRouteWaypointsRef.current ?? committedRouteWaypointsRef.current
      const merged = mergeCollidingConnectionPoints({
        networks: nextConnections,
        routeWaypoints: nextRouteWaypoints,
        routedEdges: renderedRoutedConnections.edges,
        diagramId,
        elements: nextElements,
        assets,
        busbars: nextBusbars,
        movedWaypointIds: new Set(selectedRouteWaypointIdsRef.current),
        movedJunctionIds: new Set(selectedJunctionIdsRef.current),
        movedElementIds: new Set(selectedIdsRef.current),
        movedBusbarIds: new Set(selectedBusbarIdsRef.current),
      })
      if (!merged) {
        callbacksRef.current.onActionMessage('无法合并：节点宿主或线路类型不兼容。', 'danger')
        setPreview(null)
        setBusbarPreview(null)
        setConnectionPreview(null)
        setRouteWaypointPreview(null)
        return false
      }
      nextConnections = merged.networks
      nextRouteWaypoints = merged.routeWaypoints
      const conflicts = manualRouteConflictCount(
        nextElements,
        nextBusbars,
        nextConnections,
        nextRouteWaypoints,
      )
      if (conflicts) {
        reportManualRouteConflict(conflicts)
        setPreview(null)
        setBusbarPreview(null)
        setConnectionPreview(null)
        setRouteWaypointPreview(null)
        return false
      }
      const committed = commitDiagram(nextElements, nextBusbars, nextConnections, nextRouteWaypoints)
      if (
        committed &&
        (merged.mergedJunctionIds.length || merged.absorbedNodeIds.length)
      ) {
        setConnectionPointSelectionAfterMerge(
          merged.networks,
          merged.routeWaypoints,
          merged.mergedJunctionIds,
          selectedRouteWaypointIdsRef.current,
          selectedJunctionIdsRef.current,
        )
      }
      return committed
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

    const schedulePanViewport = (nextViewport: DiagramViewport) => {
      pendingPanViewportRef.current = nextViewport
      panViewportFrameScheduler.schedule(nextViewport)
    }

    const flushPanViewport = () => {
      const pendingViewport = pendingPanViewportRef.current
      if (pendingViewport) {
        panViewportFrameScheduler.cancel()
        pendingPanViewportRef.current = null
        panViewportApplyRef.current(pendingViewport)
      }
      const currentViewport = viewportValueRef.current
      lastPanReactViewportRef.current = currentViewport
      setViewportValue(currentViewport)
    }

    finishWheelGestureRef.current = () => {
      const gesture = wheelGestureRef.current
      if (gesture.kind === 'trackpad-pan') flushPanViewport()
      gesture.kind = null
      gesture.panTarget = null
    }

    finishSpacePanRef.current = () => {
      const interaction = interactionRef.current
      if (interaction?.kind !== 'pan' || interaction.trigger !== 'space-left') return
      flushPanViewport()
      interactionRef.current = null
      const viewportElement = viewportElementRef.current
      delete viewportElement?.dataset.panning
      if (viewportElement?.hasPointerCapture(interaction.pointerId)) {
        viewportElement.releasePointerCapture(interaction.pointerId)
      }
    }

    useEffect(() => {
      const keyboardContextIsCanvas = () => {
        const viewportElement = viewportElementRef.current
        if (!viewportElement) return false
        const activeElement = document.activeElement
        return viewportElement.matches(':hover') ||
          activeElement === viewportElement ||
          (activeElement instanceof Node && viewportElement.contains(activeElement))
      }
      const textEntryTargetOwnsSpace = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false
        return target.isContentEditable || target.matches('input, textarea, select')
      }
      const setSpacePanReady = (ready: boolean) => {
        spacePanHeldRef.current = ready
        const viewportElement = viewportElementRef.current
        if (!viewportElement) return
        if (ready) viewportElement.dataset.panReady = 'true'
        else delete viewportElement.dataset.panReady
      }
      const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
        if (
          event.code !== 'Space' ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          textEntryTargetOwnsSpace(event.target) ||
          !keyboardContextIsCanvas()
        ) return
        event.preventDefault()
        if (event.repeat || spacePanHeldRef.current) return
        if (interactionRef.current && interactionRef.current.kind !== 'pan') return
        setSpacePanReady(true)
      }
      const handleWindowKeyUp = (event: globalThis.KeyboardEvent) => {
        if (event.code !== 'Space' || !spacePanHeldRef.current) return
        event.preventDefault()
        setSpacePanReady(false)
        finishSpacePanRef.current()
      }
      const handleWindowBlur = () => {
        if (!spacePanHeldRef.current) return
        setSpacePanReady(false)
        finishSpacePanRef.current()
      }

      window.addEventListener('keydown', handleWindowKeyDown)
      window.addEventListener('keyup', handleWindowKeyUp)
      window.addEventListener('blur', handleWindowBlur)
      return () => {
        window.removeEventListener('keydown', handleWindowKeyDown)
        window.removeEventListener('keyup', handleWindowKeyUp)
        window.removeEventListener('blur', handleWindowBlur)
        spacePanHeldRef.current = false
        const viewportElement = viewportElementRef.current
        delete viewportElement?.dataset.panReady
        delete viewportElement?.dataset.panning
      }
    }, [])

    useEffect(() => {
      const viewportElement = viewportElementRef.current
      if (!viewportElement) return
      const handleWheel = (event: globalThis.WheelEvent) => wheelHandlerRef.current(event)
      viewportElement.addEventListener('wheel', handleWheel, { passive: false })
      return () => viewportElement.removeEventListener('wheel', handleWheel)
    }, [])

    const clientPoint = (clientX: number, clientY: number): Point => {
      const rect = viewportElementRef.current?.getBoundingClientRect()
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
    }

    const worldPoint = (clientX: number, clientY: number) =>
      screenToWorld(clientPoint(clientX, clientY), viewportValueRef.current)

    const displayedElements = previewElements ?? elements
    const displayedBusbars = previewBusbars ?? busbars
    const displayedConnections = previewConnections ?? connections
    const displayedRouteWaypoints = previewRouteWaypoints ?? routeWaypoints
    const displayedBusbarsById = useMemo(
      () => new Map(displayedBusbars.map((busbar) => [busbar.id, busbar])),
      [displayedBusbars],
    )
    const displayedConnectionsById = useMemo(
      () => new Map(displayedConnections.map((network) => [network.id, network])),
      [displayedConnections],
    )
    const selectedConnectionEdgeIdSet = useMemo(() => new Set(
      selectedConnectionEdges(selectedConnectionId, displayedConnections).map((edge) => edge.id),
    ), [displayedConnections, selectedConnectionId])
    const displayedConnectionEdgesById = useMemo(() => new Map(
      displayedConnections.flatMap((network) => network.edges.map((edge) => [edge.id, edge] as const)),
    ), [displayedConnections])
    const displayedConnectionRouteIdentities = useMemo(() => new Set(
      displayedConnections.flatMap((network) => network.edges.map((edge) => (
        `${network.id}::${edge.id}`
      ))),
    ), [displayedConnections])
    const routeInput = useMemo(() => ({
      scopeKey: `${documentEpoch}:${diagramId}`,
      networks: connections,
      elements,
      assets,
      gridSize,
      busbars,
      routeWaypoints,
    }), [assets, busbars, connections, diagramId, documentEpoch, elements, gridSize, routeWaypoints])
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
    const routedConnectionsWithWaypointPreview = useMemo(() => {
      if (!previewRouteWaypoints) return routedConnections
      const committedWaypointById = new Map(routeWaypoints.map((waypoint) => (
        [waypoint.id, waypoint] as const
      )))
      const changedWaypointIds = new Set(previewRouteWaypoints.flatMap((waypoint) => {
        const committedWaypoint = committedWaypointById.get(waypoint.id)
        return !committedWaypoint ||
          committedWaypoint.x !== waypoint.x ||
          committedWaypoint.y !== waypoint.y
          ? [waypoint.id]
          : []
      }))
      const dirtyNetworkIds = new Set(displayedConnections.flatMap((network) => (
        network.edges.some((edge) => (
          (edge.routeNodeIds ?? []).some((id) => changedWaypointIds.has(id))
        )) ? [network.id] : []
      )))
      if (!dirtyNetworkIds.size) return routedConnections
      const preview = routeConnectionNetworksForDirtyNetworks({
        ...routeInput,
        networks: displayedConnections,
        elements: displayedElements,
        busbars: displayedBusbars,
        routeWaypoints: previewRouteWaypoints,
      }, routedConnections, dirtyNetworkIds)
      if (!preview.invalidEdgeIds.length) return preview
      const previewEdgeIds = new Set(preview.edges.map((edge) => edge.edgeId))
      const invalidEdgeIds = new Set(preview.invalidEdgeIds)
      return {
        ...preview,
        edges: [
          ...preview.edges,
          ...routedConnections.edges.filter((edge) => (
            invalidEdgeIds.has(edge.edgeId) && !previewEdgeIds.has(edge.edgeId)
          )),
        ],
      }
    }, [
      displayedBusbars,
      displayedConnections,
      displayedElements,
      previewRouteWaypoints,
      routeInput,
      routeWaypoints,
      routedConnections,
    ])
    const renderedRoutedConnections = useMemo(() => {
      const rendered = !routeSegmentDragPreview
        ? routedConnectionsWithWaypointPreview
        : {
            ...routedConnectionsWithWaypointPreview,
            edges: routedConnectionsWithWaypointPreview.edges.map((route) => previewDraggedSegment(
              route,
              routeSegmentDragPreview.segment,
              routeSegmentDragPreview.start,
              routeSegmentDragPreview.end,
            )),
          }
      const seenRouteIdentities = new Set<string>()
      const retainedEdges = rendered.edges.reduceRight<RoutedConnectionEdge[]>((result, route) => {
        const identity = `${route.networkId}::${route.edgeId}`
        if (
          !displayedConnectionRouteIdentities.has(identity) ||
          seenRouteIdentities.has(identity)
        ) return result
        seenRouteIdentities.add(identity)
        result.unshift(route)
        return result
      }, [])
      if (retainedEdges.length === rendered.edges.length) return rendered
      const retainedEdgeIds = new Set(retainedEdges.map((route) => route.edgeId))
      return {
        ...rendered,
        edges: retainedEdges,
        crossings: rendered.crossings.filter((crossing) => (
          retainedEdgeIds.has(crossing.bridgeEdgeId) &&
          retainedEdgeIds.has(crossing.underEdgeId)
        )),
        invalidEdgeIds: rendered.invalidEdgeIds.filter((edgeId) => (
          displayedConnectionEdgesById.has(edgeId)
        )),
      }
    }, [
      displayedConnectionEdgesById,
      displayedConnectionRouteIdentities,
      routeSegmentDragPreview,
      routedConnectionsWithWaypointPreview,
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
      renderedRoutedConnections.edges.length > RENDER_CULLING_OBJECT_THRESHOLD
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
      if (!cullingEnabled) return renderedRoutedConnections.edges
      return renderedRoutedConnections.edges.filter((route) => (
        selectedConnectionEdgeIdSet.has(route.edgeId) ||
        polylineIntersectsViewport(route.points, renderWorldRect)
      ))
    }, [
      cullingEnabled,
      renderWorldRect,
      renderedRoutedConnections.edges,
      selectedConnectionEdgeIdSet,
    ])
    const visibleRouteRenderGroups = useMemo(
      () => createConnectionRouteRenderGroups(visibleRoutes, displayedConnectionEdgesById),
      [displayedConnectionEdgesById, visibleRoutes],
    )
    const coolingPipeFilterIdsByRenderKey = useMemo(
      () => createCoolingPipeFilterIds(
        visibleRouteRenderGroups,
        (index) => `cooling-pipe-inner-shadow-${index}`,
      ),
      [visibleRouteRenderGroups],
    )
    const routeSegments = useMemo(
      () => atomicRouteSegments(renderedRoutedConnections.edges),
      [renderedRoutedConnections.edges],
    )
    const renderedRouteTypesByEdgeId = useMemo(() => new Map(
      renderedRoutedConnections.edges.map((route) => [route.edgeId, route.type] as const),
    ), [renderedRoutedConnections.edges])
    const routeCornerExcludedPoints = useMemo(() => [
      ...displayedConnections.flatMap((network) => network.nodes.flatMap((node) => (
        node.kind === 'node' ? [{ x: node.x, y: node.y }] : []
      ))),
      ...renderedRoutedConnections.edges.flatMap((route) => (
        route.points.length > 1 ? [route.points[0], route.points.at(-1)!] : []
      )),
    ], [displayedConnections, renderedRoutedConnections.edges])
    const draggableRouteSegments = useMemo(() => routeSegments.filter((segment) => (
      segment.edgeIds.some((edgeId) => selectedConnectionEdgeIdSet.has(edgeId))
    )), [routeSegments, selectedConnectionEdgeIdSet])
    const invalidPreviewWaypointIds = useMemo(() => {
      if (!previewRouteWaypoints || !routedConnectionsWithWaypointPreview.invalidEdgeIds.length) {
        return new Set<string>()
      }
      const invalidEdgeIds = new Set(routedConnectionsWithWaypointPreview.invalidEdgeIds)
      return new Set(displayedConnections.flatMap((network) => network.edges.flatMap((edge) => (
        invalidEdgeIds.has(edge.id) ? edge.routeNodeIds ?? [] : []
      ))))
    }, [displayedConnections, previewRouteWaypoints, routedConnectionsWithWaypointPreview])
    const occupiedAnchors = useMemo(
      () => occupiedAnchorKeys(displayedConnections),
      [displayedConnections],
    )
    const forbiddenCrossings = useMemo(
      () => crossingPointKeys(renderedRoutedConnections.crossings),
      [renderedRoutedConnections.crossings],
    )
    const crossingsByEdgeId = useMemo(
      () => indexConnectionCrossings(renderedRoutedConnections.crossings),
      [renderedRoutedConnections.crossings],
    )
    const underpassAnimationExclusionsByEdgeId = useMemo(
      () => createUnderpassAnimationExclusions(
        renderedRoutedConnections.edges,
        renderedRoutedConnections.crossings,
        gridSize,
      ),
      [gridSize, renderedRoutedConnections.crossings, renderedRoutedConnections.edges],
    )
    const branchPointKeysByNetworkId = useMemo(() => {
      const next = connectionRouteBranchPointKeys(
        renderedRoutedConnections.edges,
        branchPointKeysCacheRef.current,
      )
      branchPointKeysCacheRef.current = next
      return next
    }, [renderedRoutedConnections.edges])
    const roundableCoolingNodeIdsByNetworkId = useMemo(
      () => createCoolingNodeIdsByNetwork(displayedConnections),
      [displayedConnections],
    )
    const connectedCoolingRouteGeometryByEdgeId = useMemo(() => {
      const next = connectedRouteEndpointGeometry(
        visibleRoutes.filter((route) => (
          isCoolingConnectionType(route.type)
        )),
        roundableCoolingNodeIdsByNetworkId,
        crossingsByEdgeId,
        COOLING_PIPE_CORNER_RADIUS,
        branchPointKeysByNetworkId,
      )
      const cache = connectedCoolingRouteGeometryCacheRef.current
      const activeEdgeIds = new Set(next.keys())
      cache.forEach((_, edgeId) => {
        if (!activeEdgeIds.has(edgeId)) cache.delete(edgeId)
      })
      next.forEach((geometry, edgeId) => {
        const key = connectedRouteDisplayGeometryKey(geometry)
        const cached = cache.get(edgeId)
        if (cached?.key === key) next.set(edgeId, cached.geometry)
        else cache.set(edgeId, { key, geometry })
      })
      return next
    }, [
      branchPointKeysByNetworkId,
      crossingsByEdgeId,
      roundableCoolingNodeIdsByNetworkId,
      visibleRoutes,
    ])
    const renderedConnectionPaths = useMemo(() => createRenderedConnectionPaths(
      visibleRoutes,
      renderedRoutedConnections.edges,
      connectedCoolingRouteGeometryByEdgeId,
      crossingsByEdgeId,
      branchPointKeysByNetworkId,
      gridSize,
      renderedConnectionPathCacheRef.current,
    ), [
      branchPointKeysByNetworkId,
      connectedCoolingRouteGeometryByEdgeId,
      crossingsByEdgeId,
      gridSize,
      renderedRoutedConnections.edges,
      visibleRoutes,
    ])
    const coolingPipeShellsByRenderKey = useMemo(() => (
      createCoolingPipeShellsByRenderKey(
        visibleRouteRenderGroups,
        renderedRoutedConnections.edges,
        displayedConnectionsById,
        connectedCoolingRouteGeometryByEdgeId,
        crossingsByEdgeId,
        branchPointKeysByNetworkId,
        gridSize,
        coolingPipeShellRouteCacheRef.current,
      )
    ), [
      crossingsByEdgeId,
      branchPointKeysByNetworkId,
      connectedCoolingRouteGeometryByEdgeId,
      displayedConnectionsById,
      gridSize,
      renderedRoutedConnections.edges,
      visibleRouteRenderGroups,
    ])
    const {
      powerFlowTopology,
      coolingFlowTopology,
      metricReadings: resolvedMonitorMetricReadings,
    } = useDiagramMonitorRuntime({
      enabled: mode === 'monitor',
      lineSystemType,
      elements: displayedElements,
      busbars: displayedBusbars,
      connections: displayedConnections,
      assets,
      resolvedBusbarTapOffsets: renderedRoutedConnections.resolvedBusbarTapOffsets,
      runtime,
      animationPlaying,
    })
    const monitorDisplayedRoutePaths = useMemo(() => createDisplayedRoutePaths(
      visibleRoutes,
      displayedConnectionEdgesById,
      connectedCoolingRouteGeometryByEdgeId,
      crossingsByEdgeId,
      branchPointKeysByNetworkId,
      gridSize,
    ), [
      branchPointKeysByNetworkId,
      connectedCoolingRouteGeometryByEdgeId,
      crossingsByEdgeId,
      displayedConnectionEdgesById,
      gridSize,
      visibleRoutes,
    ])
    const monitorDisplayedFlowPaths = useMemo<MonitorFlowPath[]>(() => {
      if (mode !== 'monitor') return []
      const routePaths = [...monitorDisplayedRoutePaths.values()].map(({ path }) => path)
      if (lineSystemType !== 'power') return routePaths
      return [
        ...routePaths,
        ...visibleBusbars.map((busbar) => ({
          id: `busbar-display:${busbar.id}`,
          points: [busbar, busbarEndPoint(busbar)],
          screenWidth: FLOW_BUSBAR_SCREEN_WIDTH,
          style: 'power' as const,
          baseColor: busbar.color ?? DEFAULT_BUSBAR_COLOR,
          renderPriority: -1,
        })),
      ]
    }, [lineSystemType, mode, monitorDisplayedRoutePaths, visibleBusbars])
    const monitorActiveFlowPaths = useMemo<MonitorFlowPath[]>(() => {
      if (mode !== 'monitor') return []
      const activeFlowEdges = lineSystemType === 'cooling'
        ? coolingFlowTopology.edges
        : powerFlowTopology.edges
      const flowSegmentsByEdgeId = new Map<string, typeof activeFlowEdges>()
      activeFlowEdges.forEach((edge) => {
        const segments = flowSegmentsByEdgeId.get(edge.edgeId) ?? []
        segments.push(edge)
        flowSegmentsByEdgeId.set(edge.edgeId, segments)
      })
      const topologyByEdgeId = new Map(displayedConnections.flatMap((network) => {
        const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
        return network.edges.map((edge) => [edge.id, { edge, nodesById }] as const)
      }))
      const edgePaths = visibleRoutes.flatMap((route) => {
        const flowSegments = flowSegmentsByEdgeId.get(route.edgeId)
        if (!flowSegments?.length) return []
        const coolingRoute = isCoolingConnectionType(route.type)
        const displayedPath = monitorDisplayedRoutePaths.get(route.edgeId)?.path
        const points = displayedPath?.points ?? route.points
        const topology = topologyByEdgeId.get(route.edgeId)
        return flowSegments.flatMap((flow, index) => {
          let flowPoints = points
          if (flow.startNodeId && flow.endNodeId && topology) {
            const chain = [
              topology.edge.sourceNodeId,
              ...(topology.edge.routeNodeIds ?? []),
              topology.edge.targetNodeId,
            ]
            const startIndex = chain.indexOf(flow.startNodeId)
            const endIndex = chain.indexOf(flow.endNodeId)
            if (startIndex < 0 || endIndex !== startIndex + 1) return []
            const pointForNode = (nodeId: string, chainIndex: number) => {
              if (chainIndex === 0) return route.points[0]
              if (chainIndex === chain.length - 1) return route.points.at(-1)!
              const node = topology.nodesById.get(nodeId)
              return node?.kind === 'node' ? { x: node.x, y: node.y } : null
            }
            const startPoint = pointForNode(flow.startNodeId, startIndex)
            const endPoint = pointForNode(flow.endNodeId, endIndex)
            if (!startPoint || !endPoint) return []
            flowPoints = slicePolylineBetween(points, startPoint, endPoint)
          }
          if (flow.direction === 'reverse') flowPoints = [...flowPoints].reverse()
          return splitFlowPathAroundCrossings(
            flowPoints,
            underpassAnimationExclusionsByEdgeId.get(route.edgeId) ?? [],
          ).map((fragment, fragmentIndex) => ({
            id: `edge-flow:${route.edgeId}:${flow.startNodeId ?? 'all'}:${index}:${fragmentIndex}`,
            connectionEdgeId: route.edgeId,
            points: fragment,
            worldWidth: displayedPath?.worldWidth,
            speedMultiplier: flow.speedMultiplier,
            style: coolingRoute ? 'cooling' as const : 'power' as const,
            animated: true,
            baseColor: displayedPath?.baseColor,
            renderPriority: displayedPath?.renderPriority,
          }))
        })
      })
      return [
        ...edgePaths,
        ...powerFlowTopology.busbarSegments.flatMap((segment) => {
          if (
            cullingEnabled &&
            !segmentIntersectsViewport(segment.start, segment.end, renderWorldRect)
          ) return []
          const lowerX = Math.min(segment.start.x, segment.end.x)
          const upperX = Math.max(segment.start.x, segment.end.x)
          const lowerY = Math.min(segment.start.y, segment.end.y)
          const upperY = Math.max(segment.start.y, segment.end.y)
          const exclusions = underpassAnimationExclusionsByEdgeId
            .get(`busbar:${segment.busbarId}`)
            ?.filter(({ point }) => (
              point.x >= lowerX && point.x <= upperX &&
              point.y >= lowerY && point.y <= upperY
            )) ?? []
          return splitFlowPathAroundCrossings(
            [segment.start, segment.end],
            exclusions,
          ).map((fragment, fragmentIndex) => ({
            id: `${segment.id}:${fragmentIndex}`,
            points: fragment,
            screenWidth: FLOW_BUSBAR_SCREEN_WIDTH,
            style: 'power' as const,
            animated: true,
            baseColor: displayedBusbarsById.get(segment.busbarId)?.color ??
              DEFAULT_BUSBAR_COLOR,
            renderPriority: -1,
          }))
        }),
      ]
    }, [
      cullingEnabled,
      coolingFlowTopology.edges,
      displayedConnections,
      displayedBusbarsById,
      lineSystemType,
      mode,
      monitorDisplayedRoutePaths,
      powerFlowTopology.busbarSegments,
      powerFlowTopology.edges,
      renderWorldRect,
      underpassAnimationExclusionsByEdgeId,
      visibleRoutes,
    ])
    const monitorInactiveFlowPaths = useMemo(() => deriveInactiveFlowPaths(
      monitorDisplayedFlowPaths,
      monitorActiveFlowPaths,
    ), [monitorActiveFlowPaths, monitorDisplayedFlowPaths])
    const monitorStaticFlowLineGroups = useMemo(() => (
      buildMonitorStaticFlowLineGroups(
        monitorActiveFlowPaths,
        monitorInactiveFlowPaths,
      )
    ), [monitorActiveFlowPaths, monitorInactiveFlowPaths])
    const monitorStaticConnectionGroupsByRenderKey = useMemo(
      () => createStaticConnectionGroupsByRenderKey(
        visibleRouteRenderGroups,
        monitorActiveFlowPaths,
        monitorInactiveFlowPaths,
      ),
      [monitorActiveFlowPaths, monitorInactiveFlowPaths, visibleRouteRenderGroups],
    )
    const monitorFlowPaths = useMemo(() => (
      animationPlaying ? monitorActiveFlowPaths : []
    ), [animationPlaying, monitorActiveFlowPaths])
    const assetsByKey = useMemo(
      () => new Map(assets.map((asset) => [asset.key, asset])),
      [assets],
    )
    const connectedAnchorIdsByElement = useMemo(
      () => createConnectedAnchorIdsByElement(displayedConnections),
      [displayedConnections],
    )
    const elementLabelLayouts = useMemo(() => {
      const nextCache = new Map<string, ElementLabelLayout>()
      const layouts = layoutElementLabels(visibleElements, assetsByKey, {
        connectedAnchorIdsByElement,
        readings: resolvedMonitorMetricReadings,
      }).map((layout) => {
        const previous = elementLabelLayoutCacheRef.current.get(layout.elementId)
        const stable = previous &&
          previous.text === layout.text &&
          previous.placement === layout.placement &&
          previous.bounds.x === layout.bounds.x &&
          previous.bounds.y === layout.bounds.y &&
          previous.bounds.width === layout.bounds.width &&
          previous.bounds.height === layout.bounds.height &&
          previous.metricRows.length === layout.metricRows.length &&
          previous.metricRows.every((row, index) => (
            row.severity === layout.metricRows[index]?.severity
          ))
          ? previous
          : layout
        nextCache.set(layout.elementId, stable)
        return stable
      })
      elementLabelLayoutCacheRef.current = nextCache
      return layouts
    }, [
      assetsByKey,
      connectedAnchorIdsByElement,
      resolvedMonitorMetricReadings,
      visibleElements,
    ])
    const busbarLabelLayouts = useMemo(
      () => layoutBusbarLabels(visibleBusbars),
      [visibleBusbars],
    )
    const connectionLabelLayouts = useMemo(
      () => layoutConnectionLabels(
        visibleRoutes,
        displayedConnections,
        connectionLabelPlacementPreview,
        { readings: resolvedMonitorMetricReadings },
      ),
      [
        connectionLabelPlacementPreview,
        displayedConnections,
        resolvedMonitorMetricReadings,
        visibleRoutes,
      ],
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
    const routeJunctionTargetTerminal = useMemo<ConnectionTerminal | null>(() => {
      if (!routeJunctionCandidate) return null
      const existing = displayedConnections
        .find((network) => network.id === routeJunctionCandidate.networkId)
        ?.nodes.find((node) => (
          node.kind === 'node' &&
          node.x === routeJunctionCandidate.point.x &&
          node.y === routeJunctionCandidate.point.y
        ))
      return {
        kind: 'node',
        networkId: routeJunctionCandidate.networkId,
        nodeId: existing?.id ?? 'pending-route-junction',
        point: routeJunctionCandidate.point,
        type: routeJunctionCandidate.type,
      }
    }, [displayedConnections, routeJunctionCandidate])
    const wiringPreview = useMemo(() => wiring && wiringPreviewContext
      ? routeConnectionPreviewWithContext(
          wiringPreviewContext,
          busbarCandidate?.point ?? routeJunctionCandidate?.point ?? wiring.pointer,
          hoveredWiringTarget ?? routeJunctionTargetTerminal,
        )
      : null, [
        busbarCandidate,
        hoveredWiringTarget,
        routeJunctionCandidate,
        routeJunctionTargetTerminal,
        wiring,
        wiringPreviewContext,
      ])
    const coolingPipeShellPreview = useMemo(() => wiringPreview && wiring
      ? insetPolylineEndpoints(
          wiringPreview,
          wiring.source.kind === 'anchor' ? COOLING_PIPE_SHELL_ENDPOINT_INSET : 0,
          hoveredWiringTarget?.kind === 'anchor' ? COOLING_PIPE_SHELL_ENDPOINT_INSET : 0,
        )
      : null, [hoveredWiringTarget?.kind, wiring, wiringPreview])
    const roundedWiringPreviewPath = useMemo(() => wiringPreview
      ? wiring?.source.type && isCoolingConnectionType(wiring.source.type)
        ? roundedOrthogonalPathData(wiringPreview, COOLING_PIPE_CORNER_RADIUS)
        : pathData(wiringPreview)
      : '', [wiring?.source.type, wiringPreview])
    const roundedCoolingPipeShellPreviewPath = useMemo(() => coolingPipeShellPreview
      ? roundedOrthogonalPathData(coolingPipeShellPreview, COOLING_PIPE_CORNER_RADIUS)
      : '', [coolingPipeShellPreview])

    const anchorAllowedOnDiagram = (type: AnchorType) => (
      lineSystemType === 'power' ? type === 'electrical' : type !== 'electrical'
    )

    const materializeWiringSource = (active: WiringState) => {
      if (!active.provisionalSource) return {
        networks: committedConnectionsRef.current,
        routeWaypoints: committedRouteWaypointsRef.current,
        source: active.source,
      }
      const result = connectTerminalToRouteJunction({
        networks: committedConnectionsRef.current,
        routeWaypoints: committedRouteWaypointsRef.current,
        routedEdges: renderedRoutedConnections.edges,
        diagramId,
        target: active.provisionalSource,
      })
      if (!result) return null
      return {
        networks: result.networks,
        routeWaypoints: result.routeWaypoints,
        source: {
          kind: 'node' as const,
          networkId: result.junctionNetworkId,
          nodeId: result.junctionId,
          point: active.provisionalSource.point,
          type: active.provisionalSource.type,
        },
      }
    }

    const commitWiringToTerminal = (
      target: ConnectionTerminal,
      continueFromTarget = false,
    ) => {
      const active = wiringRef.current
      if (!active || !connectionTypesCompatible(active.source.type, target.type)) return false
      if (
        active.source.kind === 'anchor' &&
        target.kind === 'anchor' &&
        active.source.elementId === target.elementId &&
        active.source.anchorId === target.anchorId
      ) return false
      const materialized = materializeWiringSource(active)
      if (!materialized) return false
      const next = connectTerminals(
        materialized.networks,
        diagramId,
        materialized.source,
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
      const existingEdgeIds = new Set(materialized.networks.flatMap((network) => (
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
      const directSession = directLineToolActiveRef.current
      if (!commitDiagram(
        committedElementsRef.current,
        committedBusbarsRef.current,
        next,
        materialized.routeWaypoints,
        !directSession || !directLineHistoryStartedRef.current,
      )) return false
      if (directSession) directLineHistoryStartedRef.current = true
      if (continueFromTarget && target.kind === 'node') {
        const targetNetwork = committedConnectionsRef.current.find((network) => (
          network.nodes.some((node) => node.id === target.nodeId)
        ))
        setWiring({
          source: {
            ...target,
            networkId: targetNetwork?.id ?? target.networkId,
            type: targetNetwork?.type ?? target.type,
          },
          pointer: target.point,
        })
      } else {
        setWiring(null)
      }
      selectConnection(null)
      selectBusbar(null)
      return true
    }

    const finishWiring = (target: ConnectionTerminal) => (
      commitWiringToTerminal(target)
    )

    const finishWiringToRoute = (target: RouteJunctionCandidate) => {
      const active = wiringRef.current
      if (!active || !connectionTypesCompatible(active.source.type, target.type)) return false
      const materialized = materializeWiringSource(active)
      if (!materialized) return false
      const result = connectTerminalToRouteJunction({
        networks: materialized.networks,
        routeWaypoints: materialized.routeWaypoints,
        routedEdges: renderedRoutedConnections.edges,
        diagramId,
        source: materialized.source,
        target,
      })
      const targetTerminal: ConnectionTerminal = {
        kind: 'node',
        networkId: target.networkId,
        nodeId: result?.junctionId ?? 'pending-route-junction',
        point: target.point,
        type: target.type,
      }
      const previewRoute = wiringPreview ?? (wiringPreviewContext
        ? routeConnectionPreviewWithContext(
            wiringPreviewContext,
            target.point,
            targetTerminal,
          )
        : null)
      if (!result || !previewRoute?.length) return false
      const addedNetwork = result.networks.find((network) => (
        network.edges.some((edge) => edge.id === result.connectionEdgeId)
      ))
      const addedEdge = addedNetwork?.edges.find((edge) => edge.id === result.connectionEdgeId)
      if (addedNetwork && addedEdge) {
        const provisional: ProvisionalConnectionRoute = {
          scopeKey: routeInput.scopeKey,
          route: {
            networkId: addedNetwork.id,
            edgeId: addedEdge.id,
            type: addedNetwork.type,
            sourceNodeId: addedEdge.sourceNodeId,
            targetNodeId: addedEdge.targetNodeId,
            points: previewRoute,
            order: committedRoutedConnections.edges.length,
          },
        }
        setProvisionalConnectionRoutes((current) => [
          ...current.filter((candidate) => candidate.route.edgeId !== provisional.route.edgeId),
          provisional,
        ])
      }
      const directSession = directLineToolActiveRef.current
      if (!commitDiagram(
        committedElementsRef.current,
        committedBusbarsRef.current,
        result.networks,
        result.routeWaypoints,
        !directSession || !directLineHistoryStartedRef.current,
      )) return false
      if (directSession) directLineHistoryStartedRef.current = true
      setRouteJunctionCandidate(null)
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
      setRouteJunctionCandidate(null)
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

    const startDirectWiringAtPoint = (point: Point) => {
      const snappedPoint = { x: snap(point.x, gridSize), y: snap(point.y, gridSize) }
      const type: AnchorType = lineSystemType === 'power' ? 'electrical' : 'cooling-general'
      setSelection([])
      selectConnection(null)
      selectBusbar(null)
      setWiring({
        source: {
          kind: 'node',
          networkId: `pending-direct-network-${crypto.randomUUID()}`,
          nodeId: `connection-node-${crypto.randomUUID()}`,
          point: snappedPoint,
          type,
        },
        pointer: snappedPoint,
      })
    }

    const extendDirectWiringAtPoint = (point: Point) => {
      const active = wiringRef.current
      if (!active) {
        startDirectWiringAtPoint(point)
        return true
      }
      const snappedPoint = { x: snap(point.x, gridSize), y: snap(point.y, gridSize) }
      if (
        active.source.kind === 'node' &&
        active.source.point.x === snappedPoint.x &&
        active.source.point.y === snappedPoint.y
      ) return false
      const connected = commitWiringToTerminal({
        kind: 'node',
        networkId: active.source.kind === 'node'
          ? active.source.networkId
          : `pending-direct-network-${crypto.randomUUID()}`,
        nodeId: `connection-node-${crypto.randomUUID()}`,
        point: snappedPoint,
        type: active.source.type,
      }, true)
      if (!connected) callbacksRef.current.onActionMessage('当前位置无法生成有效线路。', 'danger')
      return connected
    }

    const startWiringFromRouteCandidate = (
      event: PointerEvent<SVGElement> | MouseEvent<SVGElement>,
      candidate: RouteJunctionCandidate,
    ) => {
      if (mode !== 'edit' || event.button !== 0 || wiringRef.current) return
      event.preventDefault()
      event.stopPropagation()
      setSelection([])
      selectConnection(null)
      selectBusbar(null)
      setRouteJunctionCandidate(null)
      setWiring({
        source: {
          kind: 'node',
          networkId: candidate.networkId,
          nodeId: 'pending-route-corner-source',
          point: candidate.point,
          type: candidate.type,
        },
        provisionalSource: candidate,
        pointer: candidate.point,
      })
    }

    const startRouteCornerInteraction = (
      event: PointerEvent<SVGElement>,
      candidate: DerivedRouteCornerCandidate,
    ) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) return false
      const candidateKey = [
        candidate.networkId,
        candidate.point.x,
        candidate.point.y,
        ...candidate.edgeIds,
      ].join(':')
      const previousPress = lastRouteCornerPressRef.current
      const isDoublePress = previousPress?.candidateKey === candidateKey &&
        event.timeStamp - previousPress.timeStamp <= 500 &&
        Math.hypot(
          event.clientX - previousPress.clientX,
          event.clientY - previousPress.clientY,
        ) <= 5
      lastRouteCornerPressRef.current = isDoublePress
        ? null
        : {
            candidateKey,
            timeStamp: event.timeStamp,
            clientX: event.clientX,
            clientY: event.clientY,
          }
      if (isDoublePress) {
        startWiringFromRouteCandidate(event, candidate)
        return true
      }

      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      selectConnection(connectionSelectionToken(candidate.edgeIds))
      interactionRef.current = {
        kind: 'route-corner',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        candidate,
        materialized: null,
        currentPoint: candidate.point,
        hasMoved: false,
      }
      viewportElementRef.current?.setPointerCapture(event.pointerId)
      return true
    }

    const handleConnectionPointerDown = (
      event: PointerEvent<SVGPathElement>,
      route: RoutedConnectionEdge,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      const hoveredCorner = routeJunctionCandidate?.derivedCorner &&
        routeJunctionCandidate.networkId === route.networkId &&
        routeJunctionCandidate.edgeIds.includes(route.edgeId)
        ? routeJunctionCandidate as DerivedRouteCornerCandidate
        : null
      if (wiringRef.current) {
        const candidate = routeJunctionCandidate
        if (
          candidate?.networkId === route.networkId &&
          candidate.edgeIds.includes(route.edgeId)
        ) finishWiringToRoute(candidate)
        return
      }
      if (directLineToolActiveRef.current) {
        const candidate = routeJunctionCandidateAtPointer(
          route.networkId,
          route.edgeId,
          event.clientX,
          event.clientY,
        )
        if (candidate) startWiringFromRouteCandidate(event, candidate)
        return
      }
      if (hoveredCorner && startRouteCornerInteraction(event, hoveredCorner)) return
      const point = worldPoint(event.clientX, event.clientY)
      const clickedEdgeIdsAtPoint = renderedRoutedConnections.edges.flatMap((candidate) => (
        candidate.networkId === route.networkId &&
        routeContainsGridPoint(candidate, point, gridSize)
          ? [candidate.edgeId]
          : []
      ))
      const clickedSelection = connectionSelectionToken(clickedEdgeIdsAtPoint) ?? route.edgeId
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

    const updateDerivedRouteCornerCandidate = (
      networkId: string,
      edgeId: string,
      clientX: number,
      clientY: number,
    ) => {
      const derivedCorner = derivedRouteCornerCandidateAtPointer({
        routes: renderedRoutedConnections.edges,
        networkId,
        edgeId,
        pointer: worldPoint(clientX, clientY),
        maxDistance: 8 / viewportValueRef.current.zoom,
        excludedPoints: routeCornerExcludedPoints,
      })
      if (
        !derivedCorner ||
        forbiddenCrossings.has(`${derivedCorner.point.x},${derivedCorner.point.y}`)
      ) {
        setRouteJunctionCandidate(null)
        return
      }
      setRouteJunctionCandidate((current) => (
        current?.derivedCorner &&
        current.networkId === derivedCorner.networkId &&
        current.point.x === derivedCorner.point.x &&
        current.point.y === derivedCorner.point.y &&
        current.edgeIds.join(',') === derivedCorner.edgeIds.join(',')
          ? current
          : { ...derivedCorner, derivedCorner: true }
      ))
    }

    const routeJunctionCandidateAtPointer = (
      networkId: string,
      edgeId: string,
      clientX: number,
      clientY: number,
    ): RouteJunctionCandidate | null => {
      const network = displayedConnections.find((candidate) => candidate.id === networkId)
      const active = wiringRef.current
      if (
        !network ||
        active && !connectionTypesCompatible(active.source.type, network.type)
      ) return null
      const point = worldPoint(clientX, clientY)
      const candidatePoint = { x: snap(point.x, gridSize), y: snap(point.y, gridSize) }
      if (forbiddenCrossings.has(`${candidatePoint.x},${candidatePoint.y}`)) return null
      const segment = routeSegments.find((candidate) => (
        candidate.networkId === networkId &&
        candidate.edgeIds.includes(edgeId) &&
        pointOnRouteSegment(candidate, candidatePoint)
      ))
      if (!segment) return null
      const existingJunction = network.nodes.some((node) => (
        node.kind === 'node' && node.x === candidatePoint.x && node.y === candidatePoint.y
      ))
      const interiorParticipant = segment.edgeIds.some((participantEdgeId) => {
        const route = renderedRoutedConnections.edges.find((candidate) => (
          candidate.networkId === networkId && candidate.edgeId === participantEdgeId
        ))
        if (!route) return false
        const first = route.points[0]
        const last = route.points.at(-1)!
        return !(
          first.x === candidatePoint.x && first.y === candidatePoint.y ||
          last.x === candidatePoint.x && last.y === candidatePoint.y
        )
      })
      if (!existingJunction && !interiorParticipant) return null
      return {
        networkId,
        point: candidatePoint,
        edgeIds: segment.edgeIds,
        type: network.type,
      }
    }

    const handleConnectionPointerMove = (
      event: PointerEvent<SVGPathElement>,
      networkId: string,
      edgeId: string,
    ) => {
      const active = wiringRef.current
      if (!active) {
        if (directLineToolActiveRef.current) {
          setRouteJunctionCandidate(routeJunctionCandidateAtPointer(
            networkId,
            edgeId,
            event.clientX,
            event.clientY,
          ))
        } else {
          updateDerivedRouteCornerCandidate(networkId, edgeId, event.clientX, event.clientY)
        }
        return
      }
      const candidate = routeJunctionCandidateAtPointer(
        networkId,
        edgeId,
        event.clientX,
        event.clientY,
      )
      if (!candidate) {
        setRouteJunctionCandidate(null)
        return
      }
      setRouteJunctionCandidate((current) => (
        current?.networkId === networkId &&
        current.point.x === candidate.point.x &&
        current.point.y === candidate.point.y &&
        current.edgeIds.join(',') === candidate.edgeIds.join(',')
          ? current
          : candidate
      ))
    }

    const candidateForBusbar = (busbar: Busbar, point: Point) => {
      const activeWiring = wiringRef.current
      if (activeWiring) {
        if (activeWiring.source.type !== 'electrical') return null
        if (activeWiring.source.kind === 'busbar' && activeWiring.source.busbarId === busbar.id) {
          return null
        }
      } else if (directLineToolActiveRef.current) {
        if (lineSystemType !== 'power') return null
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
      if (directLineToolActiveRef.current) {
        const candidate = candidateForBusbar(busbar, worldPoint(event.clientX, event.clientY))
        if (candidate) {
          setSelection([])
          selectConnection(null)
          selectBusbar(null)
          setWiring({
            source: {
              kind: 'busbar',
              busbarId: busbar.id,
              offset: candidate.offset,
              point: candidate.point,
              type: 'electrical',
            },
            pointer: candidate.point,
          })
        }
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
          true,
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
        additive || alreadySelected,
        additive || alreadySelected,
      )
      interactionRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        baseElements: committedElementsRef.current,
        baseBusbars: committedBusbarsRef.current,
        selectedIds: nextElementSelection,
        selectedBusbarIds: nextBusbarSelection,
        selectedRouteWaypointIds: additive || alreadySelected
          ? selectedRouteWaypointIdsRef.current
          : [],
        baseRouteWaypoints: committedRouteWaypointsRef.current,
        baseConnections: committedConnectionsRef.current,
        selectedJunctionIds: additive || alreadySelected
          ? selectedJunctionIdsRef.current
          : [],
        hasMoved: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const deleteSelected = () => {
      const selectedJunctionIds = new Set(selectedJunctionIdsRef.current)
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
      const selectedRouteWaypointIds = new Set(selectedRouteWaypointIdsRef.current)
      if (
        !selectedElements.size &&
        !selectedBusbars.size &&
        !selectedRouteWaypointIds.size &&
        !selectedJunctionIds.size
      ) return
      const junctionDeletion = selectedJunctionIds.size
        ? deleteConnectionJunctions(
            committedConnectionsRef.current,
            selectedJunctionIds,
            committedElementsRef.current,
            assets,
            committedBusbarsRef.current,
            committedRouteWaypointsRef.current,
          )
        : {
            networks: committedConnectionsRef.current,
            routeWaypoints: committedRouteWaypointsRef.current,
          }
      const routeWaypointDeletion = deleteRouteWaypoints(
        junctionDeletion.networks,
        junctionDeletion.routeWaypoints,
        selectedRouteWaypointIds,
      )
      const next = committedElementsRef.current.filter((element) => !selectedElements.has(element.id))
      const nextBusbars = committedBusbarsRef.current.filter((busbar) => !selectedBusbars.has(busbar.id))
      const nextConnections = normalizeConnectionNetworks(
        routeWaypointDeletion.networks,
        next,
        assets,
        nextBusbars,
      )
      if (commitDiagram(
        next,
        nextBusbars,
        nextConnections,
        routeWaypointDeletion.routeWaypoints,
      )) {
        setObjectSelection([], [])
        setRouteWaypointSelection([])
        setJunctionSelection([])
      }
    }

    const copySelected = (operation: DiagramClipboardOperation = 'copy') => {
      const selectedElements = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      const selectedConnectionNodeIds = operation === 'copy'
        ? new Set([
            ...selectedRouteWaypointIdsRef.current,
            ...selectedJunctionIdsRef.current,
          ])
        : new Set<string>()
      if (
        !selectedElements.size &&
        !selectedBusbars.size &&
        !selectedConnectionNodeIds.size
      ) return false
      const copiedConnections = copyConnectionsWithinSelection(
        committedConnectionsRef.current,
        selectedElements,
        selectedBusbars,
        selectedConnectionNodeIds,
        (_network, node) => {
          if (node.kind === 'node') return node
          if (node.kind === 'busbar-tap') {
            const busbar = committedBusbarsRef.current.find((candidate) => (
              candidate.id === node.busbarId
            ))
            return busbar ? busbarPoint(busbar, node.offset) : null
          }
          const element = committedElementsRef.current.find((candidate) => (
            candidate.id === node.elementId
          ))
          const asset = element ? assetsByKey.get(element.assetKey) : undefined
          const anchor = asset?.anchors.find((candidate) => candidate.id === node.anchorId)
          return element && asset && anchor
            ? resolveElementAnchor(element, asset, anchor).point
            : null
        },
      )
      const copiedNodeIds = new Set(copiedConnections.flatMap((network) => (
        network.nodes.map((node) => node.id)
      )))
      const copiedRouteWaypointIds = new Set(copiedConnections.flatMap((network) => (
        network.edges.flatMap((edge) => edge.routeNodeIds ?? [])
      )))
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
        connections: copiedConnections,
        routeWaypoints: committedRouteWaypointsRef.current
          .filter((waypoint) => copiedRouteWaypointIds.has(waypoint.id))
          .map((waypoint) => ({ ...waypoint })),
        selectedNodeIds: [...selectedConnectionNodeIds].filter((id) => copiedNodeIds.has(id)),
      }
      pasteCountRef.current = 0
      return true
    }

    const cutSelected = () => {
      if (
        selectedRouteWaypointIdsRef.current.length ||
        selectedJunctionIdsRef.current.length
      ) {
        callbacksRef.current.onActionMessage('节点暂不支持剪切，请先复制再删除。', 'danger')
        return
      }
      if (!copySelected('cut')) return
      deleteSelected()
    }

    const paste = () => {
      const clipboard = clipboardRef.current
      if (
        !clipboard.elements.length &&
        !clipboard.busbars.length &&
        !clipboard.connections.length
      ) return
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
            clipboard.connections,
          )
        : copiedSelectionOffset(
            clipboard.elements,
            clipboard.busbars,
            clipboard.connections,
            gridSize,
            pasteCountRef.current,
          )
      const elementIdMap = new Map<string, string>()
      const busbarIdMap = new Map<string, string>()
      const routeWaypointIdMap = new Map<string, string>()
      const copiedNodeIdMap = new Map<string, string>()
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
      const pastedRouteWaypoints = clipboard.routeWaypoints.map((waypoint) => {
        const id = `route-waypoint-${crypto.randomUUID()}`
        routeWaypointIdMap.set(waypoint.id, id)
        return {
          id,
          x: snap(waypoint.x + offset.x, gridSize),
          y: snap(waypoint.y + offset.y, gridSize),
        }
      })
      const pastedConnections = instantiateCopiedConnections(
        clipboard.connections,
        diagramId,
        elementIdMap,
        busbarIdMap,
        undefined,
        routeWaypointIdMap,
        offset,
        copiedNodeIdMap,
      )
      const nextConnections = normalizeConnectionNetworks(
        [...committedConnectionsRef.current, ...pastedConnections],
        nextElements,
        assets,
        nextBusbars,
      )
      const nextRouteWaypoints = [
        ...committedRouteWaypointsRef.current,
        ...pastedRouteWaypoints,
      ]
      const pastedNodeIds = new Set(pastedConnections.flatMap((network) => (
        network.nodes.flatMap((node) => node.kind === 'node' ? [node.id] : [])
      )))
      const merged = mergeCollidingConnectionPoints({
        networks: nextConnections,
        routeWaypoints: nextRouteWaypoints,
        routedEdges: renderedRoutedConnections.edges,
        diagramId,
        elements: nextElements,
        assets,
        busbars: nextBusbars,
        movedWaypointIds: new Set(pastedRouteWaypoints.map((point) => point.id)),
        movedJunctionIds: pastedNodeIds,
        movedElementIds: new Set(pastedElements.map((element) => element.id)),
        movedBusbarIds: new Set(pastedBusbars.map((busbar) => busbar.id)),
      })
      if (!merged) {
        callbacksRef.current.onActionMessage('无法粘贴：重合节点的线路类型不兼容。', 'danger')
        return
      }
      if (commitDiagram(
        nextElements,
        nextBusbars,
        merged.networks,
        merged.routeWaypoints,
      )) {
        const pastedSelectedNodeIds = clipboard.selectedNodeIds.flatMap((id) => {
          const mappedId = copiedNodeIdMap.get(id)
          return mappedId ? [mappedId] : []
        })
        if (crossDiagram) {
          clipboardRef.current = {
            operation: 'copy',
            sourceDiagramId: diagramId,
            sourceLineSystemType: lineSystemType,
            elements: pastedElements.map(cloneElement),
            busbars: pastedBusbars.map(cloneBusbar),
            connections: pastedConnections,
            routeWaypoints: pastedRouteWaypoints,
            selectedNodeIds: pastedSelectedNodeIds,
          }
          pasteCountRef.current = 0
        } else if (clipboard.operation === 'cut') {
          clipboardRef.current = { ...clipboard, operation: 'copy' }
        }
        setObjectSelection(
          pastedElements.map((element) => element.id),
          pastedBusbars.map((busbar) => busbar.id),
        )
        if (pastedSelectedNodeIds.length) {
          setConnectionPointSelectionAfterMerge(
            merged.networks,
            merged.routeWaypoints,
            pastedSelectedNodeIds.some((id) => merged.absorbedNodeIds.includes(id))
              ? merged.mergedJunctionIds
              : [],
            [],
            pastedSelectedNodeIds,
          )
        }
      }
    }

    const duplicateSelected = () => {
      const selectedElements = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      const selectedConnectionNodeIds = new Set([
        ...selectedRouteWaypointIdsRef.current,
        ...selectedJunctionIdsRef.current,
      ])
      if (
        !selectedElements.size &&
        !selectedBusbars.size &&
        !selectedConnectionNodeIds.size
      ) return
      const duplicatedTopology = copyConnectionsWithinSelection(
        committedConnectionsRef.current,
        selectedElements,
        selectedBusbars,
        selectedConnectionNodeIds,
        (_network, node) => {
          if (node.kind === 'node') return node
          if (node.kind === 'busbar-tap') {
            const busbar = committedBusbarsRef.current.find((candidate) => (
              candidate.id === node.busbarId
            ))
            return busbar ? busbarPoint(busbar, node.offset) : null
          }
          const element = committedElementsRef.current.find((candidate) => (
            candidate.id === node.elementId
          ))
          const asset = element ? assetsByKey.get(element.assetKey) : undefined
          const anchor = asset?.anchors.find((candidate) => candidate.id === node.anchorId)
          return element && asset && anchor
            ? resolveElementAnchor(element, asset, anchor).point
            : null
        },
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
        duplicatedTopology,
        gridSize,
      )
      const elementIdMap = new Map<string, string>()
      const busbarIdMap = new Map<string, string>()
      const routeWaypointIdMap = new Map<string, string>()
      const copiedNodeIdMap = new Map<string, string>()
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
      const duplicatedRouteWaypointIds = new Set(duplicatedTopology.flatMap((network) => (
        network.edges.flatMap((edge) => edge.routeNodeIds ?? [])
      )))
      const duplicatedRouteWaypoints = committedRouteWaypointsRef.current.flatMap((waypoint) => {
        if (!duplicatedRouteWaypointIds.has(waypoint.id)) return []
        const id = `route-waypoint-${crypto.randomUUID()}`
        routeWaypointIdMap.set(waypoint.id, id)
        return [{
          id,
          x: snap(waypoint.x + offset.x, gridSize),
          y: snap(waypoint.y + offset.y, gridSize),
        }]
      })
      const duplicatedConnections = instantiateCopiedConnections(
        duplicatedTopology,
        diagramId,
        elementIdMap,
        busbarIdMap,
        undefined,
        routeWaypointIdMap,
        offset,
        copiedNodeIdMap,
      )
      const nextElements = [...committedElementsRef.current, ...duplicatedElements]
      const nextBusbars = [...committedBusbarsRef.current, ...duplicatedBusbars]
      const nextConnections = normalizeConnectionNetworks(
        [...committedConnectionsRef.current, ...duplicatedConnections],
        nextElements,
        assets,
        nextBusbars,
      )
      const nextRouteWaypoints = [
        ...committedRouteWaypointsRef.current,
        ...duplicatedRouteWaypoints,
      ]
      const duplicatedNodeIds = new Set(duplicatedConnections.flatMap((network) => (
        network.nodes.flatMap((node) => node.kind === 'node' ? [node.id] : [])
      )))
      const merged = mergeCollidingConnectionPoints({
        networks: nextConnections,
        routeWaypoints: nextRouteWaypoints,
        routedEdges: renderedRoutedConnections.edges,
        diagramId,
        elements: nextElements,
        assets,
        busbars: nextBusbars,
        movedWaypointIds: new Set(duplicatedRouteWaypoints.map((point) => point.id)),
        movedJunctionIds: duplicatedNodeIds,
        movedElementIds: new Set(duplicatedElements.map((element) => element.id)),
        movedBusbarIds: new Set(duplicatedBusbars.map((busbar) => busbar.id)),
      })
      if (!merged) {
        callbacksRef.current.onActionMessage('无法复制：重合节点的线路类型不兼容。', 'danger')
        return
      }
      if (commitDiagram(
        nextElements,
        nextBusbars,
        merged.networks,
        merged.routeWaypoints,
      )) {
        const duplicatedSelectedNodeIds = [...selectedConnectionNodeIds].flatMap((id) => {
          const mappedId = copiedNodeIdMap.get(id)
          return mappedId ? [mappedId] : []
        })
        setObjectSelection(
          duplicatedElements.map((element) => element.id),
          duplicatedBusbars.map((busbar) => busbar.id),
        )
        if (duplicatedSelectedNodeIds.length) {
          setConnectionPointSelectionAfterMerge(
            merged.networks,
            merged.routeWaypoints,
            duplicatedSelectedNodeIds.some((id) => merged.absorbedNodeIds.includes(id))
              ? merged.mergedJunctionIds
              : [],
            [],
            duplicatedSelectedNodeIds,
          )
        }
      }
    }

    const undo = () => {
      if (mode !== 'edit') return
      if (directLineToolActiveRef.current) stopDirectLineTool()
      const previous = historyRef.current.past.at(-1)
      if (!previous) return
      const current: EditorSnapshot = {
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
        routeWaypoints: committedRouteWaypointsRef.current,
      }
      historyRef.current.past = historyRef.current.past.slice(0, -1)
      historyRef.current.future = [current, ...historyRef.current.future].slice(0, HISTORY_LIMIT)
      committedElementsRef.current = previous.elements
      committedBusbarsRef.current = previous.busbars
      committedConnectionsRef.current = previous.connections
      committedRouteWaypointsRef.current = previous.routeWaypoints
      callbacksRef.current.onDiagramChange(
        previous.elements,
        previous.busbars,
        previous.connections,
        previous.routeWaypoints,
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
      if (directLineToolActiveRef.current) stopDirectLineTool()
      const next = historyRef.current.future[0]
      if (!next) return
      const current: EditorSnapshot = {
        elements: committedElementsRef.current,
        busbars: committedBusbarsRef.current,
        connections: committedConnectionsRef.current,
        routeWaypoints: committedRouteWaypointsRef.current,
      }
      historyRef.current.future = historyRef.current.future.slice(1)
      historyRef.current.past = [...historyRef.current.past, current].slice(-HISTORY_LIMIT)
      committedElementsRef.current = next.elements
      committedBusbarsRef.current = next.busbars
      committedConnectionsRef.current = next.connections
      committedRouteWaypointsRef.current = next.routeWaypoints
      callbacksRef.current.onDiagramChange(
        next.elements,
        next.busbars,
        next.connections,
        next.routeWaypoints,
      )
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
      const currentViewport = viewportValueRef.current
      const minimumZoom = Math.min(MIN_ZOOM, currentViewport.zoom)
      applyViewport(
        zoomAroundPoint(
          currentViewport,
          center,
          currentViewport.zoom * factor,
          minimumZoom,
        ),
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
      const normalizedColor = normalizeSymbolColor(color)
      const genericFrame = elementNode?.querySelector<SVGRectElement>(
        '.diagram-element__generic-frame',
      )
      if (genericFrame) {
        genericFrame.dataset.symbolColor = normalizedColor
        genericFrame.setAttribute('stroke', normalizedColor)
        return
      }
      const image = elementNode?.querySelector<SVGImageElement>('.diagram-element__image')
      if (!image) return
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

    const paintGenericElementBackgroundColor = (elementId: string, color: string) => {
      const frame = elementNodeRefs.current.get(elementId)?.querySelector<SVGRectElement>(
        '.diagram-element__generic-frame',
      )
      if (!frame) return
      const normalizedColor = normalizeGenericSymbolBackgroundColor(color)
      frame.dataset.backgroundColor = normalizedColor
      frame.setAttribute('fill', normalizedColor)
    }

    const previewElementColor = (
      elementId: string,
      color: string | null,
      requestedSlot?: SymbolColorSlot,
    ) => {
      const element = committedElementsRef.current.find((candidate) => candidate.id === elementId)
      if (!element) return
      const visualState: SymbolVisualState = elementSupportsOnOffState(element) &&
        resolvedElementOnOffState(element, onOffStates[elementId])
        ? 'on'
        : 'off'
      const activeSlot = symbolColorSlotForElement(element, visualState)
      const slot = requestedSlot ?? activeSlot
      if (color === null) {
        previewElementColorsRef.current.delete(elementId)
        if (slot === 'generic-background') {
          paintGenericElementBackgroundColor(
            elementId,
            resolvedGenericSymbolBackgroundColor(element),
          )
          return
        }
        paintElementColor(elementId, resolvedSymbolColor(element, visualState))
        return
      }
      const normalizedColor = slot === 'generic-background'
        ? normalizeGenericSymbolBackgroundColor(color)
        : normalizeSymbolColor(color)
      previewElementColorsRef.current.set(elementId, { slot, color: normalizedColor })
      if (slot === 'generic-background') {
        paintGenericElementBackgroundColor(elementId, normalizedColor)
        return
      }
      if (slot === activeSlot) paintElementColor(elementId, normalizedColor)
    }

    const updateElements = (elementIds: string[], patch: Partial<DiagramElement>) => {
      if (!elementIds.length) return
      const elementIdSet = new Set(elementIds)
      elementIds.forEach((elementId) => previewElementColorsRef.current.delete(elementId))
      const next = committedElementsRef.current.map((element) => {
        if (!elementIdSet.has(element.id)) return element
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
          if (isGenericSymbolKey(element.assetKey)) {
            const size = getSnappedGenericSymbolSize(
              normalizedPatch.width ?? element.width,
              normalizedPatch.height ?? element.height,
              gridSize,
            )
            if (normalizedPatch.width !== undefined) normalizedPatch.width = size.width
            if (normalizedPatch.height !== undefined) normalizedPatch.height = size.height
          } else {
            const requestedScale = normalizedPatch.width !== undefined
              ? normalizedPatch.width / symbol.intrinsicWidth
              : (normalizedPatch.height ?? element.height) / symbol.intrinsicHeight
            const size = getScaledSymbolSize(symbol, requestedScale, gridSize)
            normalizedPatch.width = size.width
            normalizedPatch.height = size.height
          }
        }
        return { ...element, ...normalizedPatch }
      })
      if (patch.labelVisible === false) setSelectedLabelElementId(null)
      const patchesGeometry = ['x', 'y', 'width', 'height', 'rotation'].some((key) => (
        Object.prototype.hasOwnProperty.call(patch, key)
      ))
      if (patchesGeometry) {
        const conflicts = manualRouteConflictCount(
          next,
          committedBusbarsRef.current,
          committedConnectionsRef.current,
          committedRouteWaypointsRef.current,
        )
        if (conflicts) {
          reportManualRouteConflict(conflicts)
          return
        }
      }
      commitElements(next)
    }

    const updateElement = (elementId: string, patch: Partial<DiagramElement>) => {
      updateElements([elementId], patch)
    }

    const updateElementMetrics = (elementIds: string[], metrics: MonitorMetric[]) => {
      if (!elementIds.length) return
      const elementIdSet = new Set(elementIds)
      const next = committedElementsRef.current.map((element) => (
        elementIdSet.has(element.id)
          ? { ...element, monitorMetrics: cloneMonitorMetricsWithNewIds(metrics) }
          : element
      ))
      commitElements(next)
    }

    const previewElementSelectionColor = (
      elementIds: string[],
      color: string | null,
      slot: SymbolColorSlot,
    ) => {
      elementIds.forEach((elementId) => previewElementColor(elementId, color, slot))
    }

    const updateElementSelectionColor = (
      elementIds: string[],
      color: string | null,
      slot: SymbolColorSlot,
    ) => {
      if (!elementIds.length) return
      previewElementSelectionColor(elementIds, null, slot)
      const elementIdSet = new Set(elementIds)
      const next = committedElementsRef.current.map((element) => {
        if (!elementIdSet.has(element.id)) return element
        const properties = { ...element.properties }
        if (slot === 'switch-off' || slot === 'switch-on') {
          const legacyColor = properties.color
          if (typeof legacyColor === 'string' && /^#[0-9a-f]{6}$/i.test(legacyColor)) {
            properties.switchOffColor ??= normalizeSymbolColor(legacyColor)
            properties.switchOnColor ??= normalizeSymbolColor(legacyColor)
            delete properties.color
          }
        }
        const property = slot === 'generic-background'
          ? GENERIC_SYMBOL_BACKGROUND_COLOR_PROPERTY
          : symbolColorPropertyKey(slot)
        if (color === null) delete properties[property]
        else properties[property] = slot === 'generic-background'
          ? normalizeGenericSymbolBackgroundColor(color)
          : normalizeSymbolColor(color)
        return { ...element, properties }
      })
      commitElements(next)
    }

    const updateBusbars = (busbarIds: string[], patch: Partial<Busbar>) => {
      if (!busbarIds.length) return
      const busbarIdSet = new Set(busbarIds)
      const patchesLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
      const patchesMonitorFlowDirection = Object.prototype.hasOwnProperty.call(
        patch,
        'monitorFlowDirection',
      )
      const patchesLabelColor = Object.prototype.hasOwnProperty.call(patch, 'labelColor')
      const next = committedBusbarsRef.current.map((busbar) => {
        if (!busbarIdSet.has(busbar.id)) return busbar
        let updated: Busbar = { ...busbar, ...patch }
        if (patchesMonitorFlowDirection && patch.monitorFlowDirection === undefined) {
          const {
            monitorFlowDirection: _monitorFlowDirection,
            ...withoutMonitorFlowDirection
          } = updated
          updated = withoutMonitorFlowDirection
        }
        if (patchesLabelColor && patch.labelColor === undefined) {
          const { labelColor: _labelColor, ...withoutLabelColor } = updated
          updated = withoutLabelColor
        }
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
      const patchesGeometry = ['x', 'y', 'length', 'orientation'].some((key) => (
        Object.prototype.hasOwnProperty.call(patch, key)
      ))
      if (patchesGeometry) {
        const conflicts = manualRouteConflictCount(
          committedElementsRef.current,
          next,
          committedConnectionsRef.current,
          committedRouteWaypointsRef.current,
        )
        if (conflicts) {
          reportManualRouteConflict(conflicts)
          return
        }
      }
      commitBusbars(next)
    }

    const updateBusbar = (busbarId: string, patch: Partial<Busbar>) => {
      updateBusbars([busbarId], patch)
    }

    const updateConnectionEdges = (edgeIds: string[], patch: Partial<ConnectionEdge>) => {
      if (!edgeIds.length) return
      const edgeIdSet = new Set(edgeIds)
      const patchesLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
      const patchesFlowDirection = Object.prototype.hasOwnProperty.call(patch, 'flowDirection')
      const patchesExternalSupplyEndpoint = Object.prototype.hasOwnProperty.call(
        patch,
        'externalSupplyEndpoint',
      )
      const patchesCoolingLineRole = Object.prototype.hasOwnProperty.call(
        patch,
        'coolingLineRole',
      )
      const patchesCrossingLayer = Object.prototype.hasOwnProperty.call(
        patch,
        'crossingLayer',
      )
      const next = committedConnectionsRef.current.map((network) => ({
        ...network,
        edges: network.edges.map((edge) => {
          if (!edgeIdSet.has(edge.id)) return edge
          let updated: ConnectionEdge = { ...edge, ...patch }
          if (patchesFlowDirection && patch.flowDirection === undefined) {
            const { flowDirection: _flowDirection, ...withoutFlowDirection } = updated
            updated = withoutFlowDirection
          }
          if (patchesExternalSupplyEndpoint && patch.externalSupplyEndpoint === undefined) {
            const {
              externalSupplyEndpoint: _externalSupplyEndpoint,
              ...withoutExternalSupplyEndpoint
            } = updated
            updated = withoutExternalSupplyEndpoint
          }
          if (patchesCoolingLineRole && patch.coolingLineRole === undefined) {
            const { coolingLineRole: _coolingLineRole, ...withoutCoolingLineRole } = updated
            updated = withoutCoolingLineRole
          }
          if (patchesCrossingLayer && patch.crossingLayer === undefined) {
            const { crossingLayer: _crossingLayer, ...withoutCrossingLayer } = updated
            updated = withoutCrossingLayer
          }
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

    const updateConnectionEdge = (edgeId: string, patch: Partial<ConnectionEdge>) => {
      updateConnectionEdges([edgeId], patch)
    }

    const updateConnectionEdgeMetrics = (edgeIds: string[], metrics: MonitorMetric[]) => {
      if (!edgeIds.length) return
      const edgeIdSet = new Set(edgeIds)
      const next = committedConnectionsRef.current.map((network) => ({
        ...network,
        edges: network.edges.map((edge) => (
          edgeIdSet.has(edge.id)
            ? { ...edge, monitorMetrics: cloneMonitorMetricsWithNewIds(metrics) }
            : edge
        )),
      }))
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

    const previewBusbarLabelColor = (busbarId: string, color: string | null) => {
      const node = busbarLabelNodeRefs.current.get(busbarId)
      const busbar = committedBusbarsRef.current.find((candidate) => candidate.id === busbarId)
      const nextColor = color === null
        ? busbar?.labelColor ?? null
        : normalizeHexColor(color, DEFAULT_BUSBAR_LABEL_COLOR)
      if (nextColor) node?.style.setProperty('--busbar-label-color', nextColor)
      else node?.style.removeProperty('--busbar-label-color')
    }

    const previewCanvasColor = (target: CanvasColorTarget, color: string | null) => {
      const previewColor = color === null
        ? null
        : normalizeHexColor(color, target.color)

      if (target.category === 'element') {
        const slot = target.elementColorSlot ?? 'default'
        for (const element of committedElementsRef.current) {
          if (target.elementAssetKey && element.assetKey !== target.elementAssetKey) continue
          const currentColor = resolvedElementColor(element, slot)
          if (currentColor !== target.color) continue
          if (previewColor === null) previewElementColorsRef.current.delete(element.id)
          else previewElementColorsRef.current.set(element.id, { slot, color: previewColor })
          const visualState: SymbolVisualState = elementSupportsOnOffState(element) &&
            resolvedElementOnOffState(element, onOffStates[element.id])
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

    const resetSelectedConnectionRouting = () => {
      const selectedEdges = selectedConnectionEdges(
        selectedConnectionIdRef.current,
        committedConnectionsRef.current,
      )
      const edgeIds = new Set(selectedEdges.map((edge) => edge.id))
      if (!edgeIds.size) return
      const legacyReset = clearRouteWaypointsForEdges(
        committedConnectionsRef.current,
        committedRouteWaypointsRef.current,
        edgeIds,
      )
      const selectedLogicalConnectionIds = new Set(selectedEdges.flatMap((edge) => (
        edge.logicalConnectionId ? [edge.logicalConnectionId] : []
      )))
      const resettableNodeIds = new Set(legacyReset.networks.flatMap((network) => (
        network.nodes.flatMap((node) => {
          if (node.kind !== 'node') return []
          const incidentEdges = network.edges.filter((edge) => (
            edge.sourceNodeId === node.id || edge.targetNodeId === node.id
          ))
          if (
            incidentEdges.length !== 2 ||
            !incidentEdges[0].logicalConnectionId ||
            incidentEdges[0].logicalConnectionId !== incidentEdges[1].logicalConnectionId ||
            !selectedLogicalConnectionIds.has(incidentEdges[0].logicalConnectionId)
          ) return []
          return [node.id]
        })
      )))
      const next = resettableNodeIds.size
        ? deleteConnectionJunctions(
            legacyReset.networks,
            resettableNodeIds,
            committedElementsRef.current,
            assets,
            committedBusbarsRef.current,
            legacyReset.routeWaypoints,
          )
        : legacyReset
      if (commitDiagram(
        committedElementsRef.current,
        committedBusbarsRef.current,
        next.networks,
        next.routeWaypoints,
      )) {
        selectConnection(null)
        setRouteWaypointSelection([], true, true)
        setJunctionSelection([], true, true)
        callbacksRef.current.onActionMessage('已恢复所选子线的自动布线。', 'success')
      }
    }

    useImperativeHandle(ref, () => ({
      undo,
      redo,
      copy: () => { copySelected() },
      cut: cutSelected,
      paste,
      duplicate: duplicateSelected,
      deleteSelected,
      selectAll: () => {
        setObjectSelection(
          committedElementsRef.current.map((element) => element.id),
          committedBusbarsRef.current.map((busbar) => busbar.id),
          false,
          true,
          true,
        )
        setRouteWaypointSelection(
          [],
          true,
          false,
          true,
        )
        setJunctionSelection(
          committedConnectionsRef.current.flatMap((network) => (
            network.nodes.flatMap((node) => node.kind === 'node' ? [node.id] : [])
          )),
          true,
          true,
        )
      },
      zoomIn: () => zoomBy(1.2),
      zoomOut: () => zoomBy(1 / 1.2),
      zoomReset: () => {
        const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
        applyViewport(zoomAroundPoint(viewportValueRef.current, center, 1))
      },
      toggleDirectLineTool,
      insertSymbol,
      insertBusbar,
      previewElementColor,
      previewSelectionColor: paintSelectionColor,
      previewBusbarLabelColor,
      updateSelectionColor,
      previewCanvasColor,
      updateCanvasColor,
      updateElement,
      updateElements,
      updateElementMetrics,
      previewElementSelectionColor,
      updateElementSelectionColor,
      updateBusbar,
      updateBusbars,
      updateConnectionEdge,
      updateConnectionEdges,
      updateConnectionEdgeMetrics,
      resetSelectedConnectionRouting,
    }))

    useEffect(() => {
      if (!interactionRef.current) {
        committedElementsRef.current = elements
        committedBusbarsRef.current = busbars
        committedConnectionsRef.current = connections
        committedRouteWaypointsRef.current = routeWaypoints
      }
    }, [busbars, connections, elements, routeWaypoints])

    useEffect(() => {
      const syncSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => ({
        ...snapshot,
        elements: snapshot.elements.map((element) => {
          if (
            !elementSupportsOnOffState(element) ||
            !Object.prototype.hasOwnProperty.call(onOffStates, element.id)
          ) return element
          const onOffState = onOffStates[element.id] ? 'on' as const : 'off' as const
          return element.onOffState === onOffState ? element : { ...element, onOffState }
        }),
      })
      historyRef.current = {
        past: historyRef.current.past.map(syncSnapshot),
        future: historyRef.current.future.map(syncSnapshot),
      }
    }, [onOffStates])

    useEffect(() => {
      viewportFrameScheduler.cancel()
      panViewportFrameScheduler.cancel()
      wheelGestureEndScheduler.cancel()
      pendingPanViewportRef.current = null
      wheelGestureRef.current = { kind: null, panTarget: null }
      viewportValueRef.current = viewport
      reportedZoomRef.current = viewport.zoom
      lastPanReactViewportRef.current = viewport
      setViewportValue(viewport)
    }, [panViewportFrameScheduler, viewport, viewportFrameScheduler, wheelGestureEndScheduler])

    useEffect(() => {
      if (canvasSize.width <= 1 || canvasSize.height <= 1) return
      const scopeKey = `${documentEpoch}:${diagramId}`
      if (autoFitViewportScopeRef.current === scopeKey) return
      autoFitViewportScopeRef.current = scopeKey

      const nextViewport = contentBounds
        ? fitViewportToBounds(contentBounds, canvasSize)
        : { zoom: 1, tx: 0, ty: 0 }
      viewportFrameScheduler.cancel()
      panViewportFrameScheduler.cancel()
      wheelGestureEndScheduler.cancel()
      pendingPanViewportRef.current = null
      wheelGestureRef.current = { kind: null, panTarget: null }
      viewportValueRef.current = nextViewport
      lastPanReactViewportRef.current = nextViewport
      setViewportValue(nextViewport)
      queueMicrotask(emitCommandState)
    }, [
      canvasSize,
      contentBounds,
      diagramId,
      documentEpoch,
      panViewportFrameScheduler,
      viewportFrameScheduler,
      wheelGestureEndScheduler,
    ])

    useEffect(() => {
      committedElementsRef.current = elements
      committedBusbarsRef.current = busbars
      committedConnectionsRef.current = connections
      committedRouteWaypointsRef.current = routeWaypoints
      historyRef.current = { past: [], future: [] }
      pasteCountRef.current = 0
      previewElementColorsRef.current.clear()
      elementLabelLayoutCacheRef.current.clear()
      busbarNodeRefs.current.clear()
      busbarLabelNodeRefs.current.clear()
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
      setRouteWaypointPreview(null)
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
      directLineToolActiveRef.current = false
      directLineHistoryStartedRef.current = false
      setDirectLineToolActiveState(false)
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
      if (interactionRef.current?.kind === 'pan') flushPanViewport()
      interactionRef.current = null
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setRouteWaypointPreview(null)
      setMarquee(null)
      setActiveMoveElementIds([])
      setHoveredElementId(null)
      setLibraryDragTarget(null)
      directLineToolActiveRef.current = false
      directLineHistoryStartedRef.current = false
      setDirectLineToolActiveState(false)
      setWiring(null)
      selectConnection(null)
      setObjectSelection([], [])
    }, [mode])

    useEffect(() => () => {
      diagramPreviewScheduler.cancel()
      wiringPointerScheduler.cancel()
      nudgeCommitScheduler.cancel()
      panViewportFrameScheduler.cancel()
      viewportFrameScheduler.cancel()
      wheelGestureEndScheduler.cancel()
      pendingPanViewportRef.current = null
    }, [
      diagramPreviewScheduler,
      nudgeCommitScheduler,
      panViewportFrameScheduler,
      viewportFrameScheduler,
      wheelGestureEndScheduler,
      wiringPointerScheduler,
    ])

    const startElementMove = (event: PointerEvent<SVGElement>, elementId: string) => {
      if (event.button !== 0) return
      event.stopPropagation()
      viewportElementRef.current?.focus()
      if (mode === 'monitor') {
        setObjectSelection([elementId], [], false, false, false)
        return
      }
      if (mode !== 'edit') return
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
          true,
          true,
          true,
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
      setObjectSelection(
        nextSelection,
        nextBusbarSelection,
        false,
        additive || alreadySelected,
        additive || alreadySelected,
      )
      interactionRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        baseElements: committedElementsRef.current,
        baseBusbars: committedBusbarsRef.current,
        selectedIds: nextSelection,
        selectedBusbarIds: nextBusbarSelection,
        selectedRouteWaypointIds: additive || alreadySelected
          ? selectedRouteWaypointIdsRef.current
          : [],
        baseRouteWaypoints: committedRouteWaypointsRef.current,
        baseConnections: committedConnectionsRef.current,
        selectedJunctionIds: additive || alreadySelected
          ? selectedJunctionIdsRef.current
          : [],
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
    pressConnectionEdgeRef.current = (event, networkId, edgeId) => {
      const route = renderedRoutedConnections.edges.find((candidate) => (
        candidate.networkId === networkId && candidate.edgeId === edgeId
      ))
      if (route) handleConnectionPointerDown(event, route)
    }
    moveConnectionEdgeRef.current = handleConnectionPointerMove
    leaveConnectionEdgeRef.current = () => {
      if (!routeJunctionCandidate?.derivedCorner) setRouteJunctionCandidate(null)
    }

    const startRouteSegmentDrag = (
      event: PointerEvent<SVGLineElement>,
      segment: DraggableRouteSegment,
    ) => {
      if (mode !== 'edit' || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        setObjectSelection([], [], true)
      }
      const interaction: Extract<Interaction, { kind: 'route-segment' }> = {
        kind: 'route-segment',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        segment,
        baseConnections: committedConnectionsRef.current,
        baseRouteWaypoints: committedRouteWaypointsRef.current,
        routedEdges: routedConnections.edges,
        currentStart: segment.start,
        currentEnd: segment.end,
      }
      interactionRef.current = interaction
      setRouteSegmentDragPreview({ segment, start: segment.start, end: segment.end })
      viewportElementRef.current?.setPointerCapture(event.pointerId)
    }

    const startJunctionDrag = (
      event: PointerEvent<SVGCircleElement>,
      networkId: string,
      node: Extract<ConnectionNode, { kind: 'node' | 'busbar-tap' }>,
      point: Point,
      type: AnchorType,
    ) => {
      if (mode !== 'edit' || event.button !== 0) return
      const junctionId = node.id
      const terminal: ConnectionTerminal = node.kind === 'busbar-tap'
        ? {
            kind: 'busbar',
            busbarId: node.busbarId,
            offset: node.offset,
            point,
            type: 'electrical',
          }
        : { kind: 'node', networkId, nodeId: node.id, point, type }
      if (directLineToolActiveRef.current && !wiringRef.current) {
        event.preventDefault()
        event.stopPropagation()
        viewportElementRef.current?.focus()
        setSelection([])
        selectConnection(null)
        selectBusbar(null)
        setWiring({ source: terminal, pointer: point })
        return
      }
      const previousPress = lastJunctionPressRef.current
      const isDoublePress = previousPress?.junctionId === junctionId &&
        event.timeStamp - previousPress.timeStamp <= 500 &&
        Math.hypot(
          event.clientX - previousPress.clientX,
          event.clientY - previousPress.clientY,
        ) <= 5
      lastJunctionPressRef.current = isDoublePress
        ? null
        : {
            junctionId,
            timeStamp: event.timeStamp,
            clientX: event.clientX,
            clientY: event.clientY,
          }
      if (isDoublePress && !wiringRef.current) {
        startWiringFromEditableNode(event, networkId, node, point, type)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      viewportElementRef.current?.focus()
      if (wiringRef.current) {
        lastJunctionPressRef.current = null
        if (node.kind === 'busbar-tap') finishWiring(terminal)
        else finishWiringToRoute({ networkId, point, edgeIds: [], type })
        return
      }
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const alreadySelected = selectedJunctionIdsRef.current.includes(junctionId)
      if (additive && alreadySelected) {
        setJunctionSelection(
          selectedJunctionIdsRef.current.filter((id) => id !== junctionId),
          true,
          true,
        )
        return
      }
      const nextJunctionSelection = additive
        ? [...selectedJunctionIdsRef.current, junctionId]
        : alreadySelected
          ? selectedJunctionIdsRef.current
          : [junctionId]
      setJunctionSelection(nextJunctionSelection, additive || alreadySelected, additive || alreadySelected)
      interactionRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startWorld: worldPoint(event.clientX, event.clientY),
        baseElements: committedElementsRef.current,
        baseBusbars: committedBusbarsRef.current,
        baseConnections: committedConnectionsRef.current,
        baseRouteWaypoints: committedRouteWaypointsRef.current,
        selectedIds: additive || alreadySelected ? selectedIdsRef.current : [],
        selectedBusbarIds: additive || alreadySelected ? selectedBusbarIdsRef.current : [],
        selectedRouteWaypointIds: additive || alreadySelected
          ? selectedRouteWaypointIdsRef.current
          : [],
        selectedJunctionIds: nextJunctionSelection,
        hasMoved: false,
      }
      viewportElementRef.current?.setPointerCapture(event.pointerId)
    }

    const startWiringFromEditableNode = (
      event: MouseEvent<SVGCircleElement>,
      networkId: string,
      node: Extract<ConnectionNode, { kind: 'node' | 'busbar-tap' }>,
      point: Point,
      type: AnchorType,
    ) => {
      if (mode !== 'edit' || event.button !== 0 || wiringRef.current) return
      event.preventDefault()
      event.stopPropagation()
      setSelection([])
      selectConnection(null)
      selectBusbar(null)
      setWiring({
        source: node.kind === 'busbar-tap'
          ? {
              kind: 'busbar',
              busbarId: node.busbarId,
              offset: node.offset,
              point,
              type: 'electrical',
            }
          : { kind: 'node', networkId, nodeId: node.id, point, type },
        pointer: point,
      })
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
      const selectedRouteWaypointIds = selectedRouteWaypointIdsRef.current
      const selectedRouteWaypoints = committedRouteWaypointsRef.current.filter((waypoint) => (
        selectedRouteWaypointIds.includes(waypoint.id)
      ))
      const selectedJunctionIds = selectedJunctionIdsRef.current
      const baseBusbarsById = new Map(committedBusbarsRef.current.map((busbar) => (
        [busbar.id, busbar] as const
      )))
      const hasDetachedSelectedTap = committedConnectionsRef.current.some((network) => (
        network.nodes.some((node) => (
          node.kind === 'busbar-tap' &&
          selectedJunctionIds.includes(node.id) &&
          !selectedBusbarIds.includes(node.busbarId)
        ))
      ))
      if (hasDetachedSelectedTap) return
      const selectedJunctionPoints = committedConnectionsRef.current.flatMap((network) => (
        network.nodes.flatMap((node) => (
          node.kind === 'node' && selectedJunctionIds.includes(node.id)
            ? [{ id: node.id, x: node.x, y: node.y }]
            : node.kind === 'busbar-tap' && selectedJunctionIds.includes(node.id)
              ? (() => {
                  const busbar = baseBusbarsById.get(node.busbarId)
                  return busbar ? [{ id: node.id, ...busbarPoint(busbar, node.offset) }] : []
                })()
            : []
        ))
      ))
      const objectBounds = diagramObjectsBounds(selected, selectedBusbars)
      const waypointBounds = routeWaypointBounds([
        ...selectedRouteWaypoints,
        ...selectedJunctionPoints,
      ])
      const bounds = objectBounds && waypointBounds
        ? {
            x: Math.min(objectBounds.x, waypointBounds.x),
            y: Math.min(objectBounds.y, waypointBounds.y),
            width: Math.max(objectBounds.x + objectBounds.width, waypointBounds.x + waypointBounds.width) -
              Math.min(objectBounds.x, waypointBounds.x),
            height: Math.max(objectBounds.y + objectBounds.height, waypointBounds.y + waypointBounds.height) -
              Math.min(objectBounds.y, waypointBounds.y),
          }
        : objectBounds ?? waypointBounds
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
        selectedRouteWaypointIds,
        baseRouteWaypoints: committedRouteWaypointsRef.current,
        baseConnections: committedConnectionsRef.current,
        selectedJunctionIds,
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
        constraintToastShown: false,
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

    const startPanInteraction = (
      event: PointerEvent<HTMLDivElement>,
      trigger: 'middle' | 'space-left',
    ) => {
      if (interactionRef.current) return false
      wheelGestureEndScheduler.cancel()
      finishWheelGestureRef.current()
      event.preventDefault()
      viewportElementRef.current?.focus()
      interactionRef.current = {
        kind: 'pan',
        trigger,
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: viewportValueRef.current,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.dataset.panning = 'true'
      return true
    }

    const handlePointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
      flushPendingNudge()
      if (event.button !== 0 || !spacePanHeldRef.current) return
      if (startPanInteraction(event, 'space-left')) event.stopPropagation()
    }

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
      viewportElementRef.current?.focus()
      if (event.button === 1) {
        startPanInteraction(event, 'middle')
        return
      }
      if (mode === 'monitor') {
        if (event.button === 0) setObjectSelection([], [])
        return
      }
      if (mode !== 'edit') return
      if (directLineToolActiveRef.current) {
        if (event.button !== 0) return
        event.preventDefault()
        const point = worldPoint(event.clientX, event.clientY)
        if (wiringRef.current) extendDirectWiringAtPoint(point)
        else startDirectWiringAtPoint(point)
        return
      }
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
        baseRouteWaypointSelection: selectedRouteWaypointIdsRef.current,
        baseJunctionSelection: selectedJunctionIdsRef.current,
      }
      setMarquee({ x: startWorld.x, y: startWorld.y, width: 0, height: 0 })
      if (!additive) setObjectSelection([], [])
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (interaction?.kind === 'pan' && interaction.pointerId === event.pointerId) {
        schedulePanViewport({
          ...interaction.startViewport,
          tx: interaction.startViewport.tx + event.clientX - interaction.startClient.x,
          ty: interaction.startViewport.ty + event.clientY - interaction.startClient.y,
        })
        return
      }

      const world = worldPoint(event.clientX, event.clientY)
      if (wiringRef.current) scheduleWiringPointer(world)
      if (
        busbarCandidate &&
        event.target instanceof Element &&
        !event.target.closest('.busbar__hit, .busbar-tap-candidate')
      ) {
        setBusbarCandidate(null)
      }
      if (
        routeJunctionCandidate?.derivedCorner &&
        event.target instanceof Element &&
        !event.target.closest(
          '.connection-edge__hit, .route-segment-handle, .connection-junction-candidate',
        )
      ) {
        setRouteJunctionCandidate(null)
      }
      if (!interaction || interaction.pointerId !== event.pointerId) return
      if (interaction.kind === 'pan') return

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
        const placement = busbarLabelPlacementForPointer(selected, world)
        scheduleDiagramPreview(null, interaction.baseBusbars.map((busbar) => (
          busbar.id === selected.id && (
            busbar.labelEndpoint !== placement.endpoint ||
            busbar.labelSide !== placement.side
          )
            ? {
                ...busbar,
                labelEndpoint: placement.endpoint,
                labelSide: placement.side,
              }
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

      if (interaction.kind === 'route-corner') {
        const dx = snap(world.x - interaction.startWorld.x, gridSize)
        const dy = snap(world.y - interaction.startWorld.y, gridSize)
        interaction.currentPoint = {
          x: interaction.candidate.point.x + dx,
          y: interaction.candidate.point.y + dy,
        }
        interaction.hasMoved = dx !== 0 || dy !== 0
        if (!interaction.hasMoved) {
          setConnectionPreview(null)
          setRouteWaypointPreview(null)
          return
        }
        if (!interaction.materialized) {
          const result = connectTerminalToRouteJunction({
            networks: committedConnectionsRef.current,
            routeWaypoints: committedRouteWaypointsRef.current,
            routedEdges: interaction.candidate.edgeIds.flatMap((edgeId) => (
              renderedRoutedConnections.edges.find((route) => (
                route.networkId === interaction.candidate.networkId && route.edgeId === edgeId
              )) ?? []
            )),
            diagramId,
            target: interaction.candidate,
          })
          if (!result) return
          interaction.materialized = {
            networks: result.networks,
            routeWaypoints: result.routeWaypoints,
            junctionId: result.junctionId,
          }
        }
        const junctionId = interaction.materialized.junctionId
        const nextConnections = interaction.materialized.networks.map((network) => ({
          ...network,
          nodes: network.nodes.map((node) => (
            node.kind === 'node' && node.id === junctionId
              ? { ...node, ...interaction.currentPoint }
              : node
          )),
        }))
        const nextRouteWaypoints = interaction.materialized.routeWaypoints.map((waypoint) => (
          waypoint.id === junctionId ? { ...waypoint, ...interaction.currentPoint } : waypoint
        ))
        setRouteJunctionCandidate(null)
        scheduleDiagramPreview(null, null, nextConnections, nextRouteWaypoints)
        return
      }

      if (interaction.kind === 'route-segment') {
        const rawDelta = interaction.segment.orientation === 'horizontal'
          ? world.y - interaction.startWorld.y
          : world.x - interaction.startWorld.x
        const delta = snapDraggedRouteSegmentDelta(
          interaction.segment,
          interaction.routedEdges,
          rawDelta,
          gridSize,
          interaction.baseConnections,
        )
        const nextStart = interaction.segment.orientation === 'horizontal'
          ? { x: interaction.segment.start.x, y: interaction.segment.start.y + delta }
          : { x: interaction.segment.start.x + delta, y: interaction.segment.start.y }
        const nextEnd = interaction.segment.orientation === 'horizontal'
          ? { x: interaction.segment.end.x, y: interaction.segment.end.y + delta }
          : { x: interaction.segment.end.x + delta, y: interaction.segment.end.y }
        interaction.currentStart = nextStart
        interaction.currentEnd = nextEnd
        setRouteSegmentDragPreview({ segment: interaction.segment, start: nextStart, end: nextEnd })
        return
      }

      if (interaction.kind === 'route-waypoint') {
        const dx = snap(world.x - interaction.startWorld.x, gridSize)
        const dy = snap(world.y - interaction.startWorld.y, gridSize)
        const selectedWaypointIds = new Set(interaction.selectedRouteWaypointIds)
        const selectedElementIds = new Set(interaction.selectedIds)
        const selectedBusbarIds = new Set(interaction.selectedBusbarIds)
        scheduleDiagramPreview(
          interaction.baseElements.map((element) => selectedElementIds.has(element.id)
            ? { ...element, x: element.x + dx, y: element.y + dy }
            : element),
          interaction.baseBusbars.map((busbar) => selectedBusbarIds.has(busbar.id)
            ? { ...busbar, x: busbar.x + dx, y: busbar.y + dy }
            : busbar),
          null,
          interaction.baseRouteWaypoints.map((waypoint) => (
            selectedWaypointIds.has(waypoint.id)
              ? { ...waypoint, x: waypoint.x + dx, y: waypoint.y + dy }
              : waypoint
          )),
        )
        return
      }

      if (interaction.kind === 'node') {
        const dx = snap(world.x - interaction.startWorld.x, gridSize)
        const dy = snap(world.y - interaction.startWorld.y, gridSize)
        const nextPoint = {
          x: interaction.startPoint.x + dx,
          y: interaction.startPoint.y + dy,
        }
        scheduleDiagramPreview(null, null, interaction.baseConnections.map((network) => ({
          ...network,
          nodes: network.nodes.map((node) => (
            node.kind === 'node' && node.id === interaction.junctionId
              ? { ...node, ...nextPoint }
              : node
          )),
        })))
        return
      }

      if (interaction.kind === 'resize-busbar') {
        const base = interaction.busbar
        const resized = resizeBusbarPreservingTapPositions(
          interaction.baseConnections,
          base,
          interaction.endpoint,
          base.orientation === 'horizontal' ? world.x : world.y,
          gridSize,
          BUSBAR_MIN_LENGTH,
        )
        const next = resized.busbar
        if (resized.blocked && !interaction.constraintToastShown) {
          interaction.constraintToastShown = true
          callbacksRef.current.onActionMessage(
            '无法缩短母线：请先移动或删除范围外的节点。',
            'danger',
          )
        }
        const nextBusbars = interaction.baseBusbars.map((candidate) => (
          candidate.id === base.id ? next : candidate
        ))
        if (busbarsEqual(
          previewBusbarsRef.current ?? interaction.baseBusbars,
          nextBusbars,
        )) return
        scheduleDiagramPreview(null, nextBusbars, resized.connections)
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
        if (hasMoved) lastJunctionPressRef.current = null
        const selected = new Set(interaction.selectedIds)
        const selectedBusbars = new Set(interaction.selectedBusbarIds)
        const selectedRouteWaypoints = new Set(interaction.selectedRouteWaypointIds)
        const selectedJunctions = new Set(interaction.selectedJunctionIds)
        const translated = translateDiagramSelection(
          interaction.baseElements,
          interaction.baseBusbars,
          interaction.baseConnections,
          interaction.baseRouteWaypoints,
          {
            elementIds: selected,
            busbarIds: selectedBusbars,
            nodeIds: selectedJunctions,
            routeWaypointIds: selectedRouteWaypoints,
          },
          { x: dx, y: dy },
        )
        scheduleDiagramPreview(
          selected.size ? translated.elements : null,
          selectedBusbars.size ? translated.busbars : null,
          selectedJunctions.size
            ? translated.connections
            : null,
          selectedRouteWaypoints.size
            ? translated.routeWaypoints
            : null,
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
          if (isGenericSymbolKey(base.assetKey)) {
            const size = getSnappedGenericSymbolSize(
              base.width + localDelta.x,
              base.height + localDelta.y,
              gridSize,
            )
            schedulePreview(interaction.baseElements.map((element) => (
              element.id === base.id ? { ...element, ...size } : element
            )))
            return
          }
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
        interaction.baseConnections.map((network) => ({
          ...network,
          nodes: network.nodes.map((node) => (
            node.kind === 'node' && interaction.selectedJunctionIds.includes(node.id)
              ? {
                  ...node,
                  ...rotatePointOnGrid(
                    node,
                    interaction.center,
                    rotationDelta,
                    gridSize,
                  ),
                }
              : node
          )),
        })),
        interaction.baseRouteWaypoints.map((waypoint) => (
          interaction.selectedRouteWaypointIds.includes(waypoint.id)
            ? {
                ...waypoint,
                ...rotatePointOnGrid(
                  waypoint,
                  interaction.center,
                  rotationDelta,
                  gridSize,
                ),
              }
            : waypoint
        )),
      )
    }

    const manualRouteConflictCount = (
      nextElements: DiagramElement[],
      nextBusbars: Busbar[],
      nextConnections: ConnectionNetwork[],
      nextRouteWaypoints: RouteWaypoint[],
      requestedNetworkIds?: Set<string>,
    ) => {
      const nextInput = {
        ...routeInput,
        networks: nextConnections,
        elements: nextElements,
        busbars: nextBusbars,
        routeWaypoints: nextRouteWaypoints,
      }
      const incremental = requestedNetworkIds
        ? null
        : routeConnectionNetworksIncrementally(
            routeInput,
            committedRoutedConnections,
            nextInput,
          )
      const routed = incremental?.routed ?? routeConnectionNetworksForDirtyNetworks(
        nextInput,
        committedRoutedConnections,
        requestedNetworkIds ?? new Set(),
      )
      const previousRouteByEdgeId = new Map(committedRoutedConnections.edges.map((edge) => (
        [edge.edgeId, edge] as const
      )))
      const nextRouteByEdgeId = new Map(routed.edges.map((edge) => [edge.edgeId, edge] as const))
      const invalidEdgeIds = new Set(routed.invalidEdgeIds)
      const dirtyNetworkIds = requestedNetworkIds ?? new Set(nextConnections.flatMap((network) => (
        network.edges.some((edge) => (
          invalidEdgeIds.has(edge.id) ||
          nextRouteByEdgeId.get(edge.id) !== previousRouteByEdgeId.get(edge.id)
        )) ? [network.id] : []
      )))
      if (!dirtyNetworkIds.size) return 0
      const constrainedEdgeIds = new Set(nextConnections.flatMap((network) => {
        if (!dirtyNetworkIds.has(network.id)) return []
        const constrainedNodeIds = new Set(network.nodes.flatMap((node) => (
          node.kind === 'node' || node.kind === 'busbar-tap' ? [node.id] : []
        )))
        return network.edges.flatMap((edge) => (
          edge.routeNodeIds?.length ||
          constrainedNodeIds.has(edge.sourceNodeId) ||
          constrainedNodeIds.has(edge.targetNodeId)
            ? [edge.id]
            : []
        ))
      }))
      const previouslyInvalidEdgeIds = new Set(
        committedRoutedConnections.invalidEdgeIds,
      )
      return routed.invalidEdgeIds.filter((edgeId) => (
        constrainedEdgeIds.has(edgeId) && !previouslyInvalidEdgeIds.has(edgeId)
      )).length
    }

    const reportManualRouteConflict = (count: number) => {
      callbacksRef.current.onActionMessage(
        `无法完成变换：${count} 条手动线路的节点约束发生冲突，请同时移动相关节点或先恢复自动布线。`,
        'danger',
      )
    }

    const finishInteraction = (event: PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return
      if (interaction.kind === 'pan') {
        flushPanViewport()
        delete event.currentTarget.dataset.panning
      } else if (interaction.kind === 'marquee') {
        const rect = normalizedRect(interaction.startWorld, interaction.currentWorld)
        const matches = committedElementsRef.current
          .filter((element) => elementInsideRect(element, rect))
          .map((element) => element.id)
        const busbarMatches = committedBusbarsRef.current
          .filter((busbar) => busbarInsideRect(busbar, rect))
          .map((busbar) => busbar.id)
        const junctionMatches = committedConnectionsRef.current.flatMap((network) => (
          network.nodes.flatMap((node) => {
            if (node.kind === 'node') return pointInsideRect(node, rect) ? [node.id] : []
            if (node.kind !== 'busbar-tap') return []
            const busbar = committedBusbarsRef.current.find((candidate) => (
              candidate.id === node.busbarId
            ))
            return busbar && pointInsideRect(busbarPoint(busbar, node.offset), rect)
              ? [node.id]
              : []
          })
        ))
        setObjectSelection(
          interaction.additive ? [...interaction.baseSelection, ...matches] : matches,
          interaction.additive
            ? [...interaction.baseBusbarSelection, ...busbarMatches]
            : busbarMatches,
          false,
          true,
          true,
        )
        setRouteWaypointSelection(
          [],
          true,
          false,
          true,
        )
        setJunctionSelection(
          interaction.additive
            ? [...interaction.baseJunctionSelection, ...junctionMatches]
            : junctionMatches,
          true,
          true,
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
      } else if (interaction.kind === 'route-corner') {
        if (!interaction.hasMoved || !interaction.materialized) {
          setConnectionPreview(null)
          setRouteWaypointPreview(null)
        } else {
          setRouteJunctionCandidate(null)
          const nextConnections = previewConnectionsRef.current ?? interaction.materialized.networks
          const nextRouteWaypoints = previewRouteWaypointsRef.current ??
            interaction.materialized.routeWaypoints
          const merged = mergeCollidingConnectionPoints({
            networks: nextConnections,
            routeWaypoints: nextRouteWaypoints,
            routedEdges: renderedRoutedConnections.edges,
            diagramId,
            elements: committedElementsRef.current,
            assets,
            busbars: committedBusbarsRef.current,
            movedJunctionIds: new Set([interaction.materialized.junctionId]),
          })
          if (!merged) {
            callbacksRef.current.onActionMessage('无法合并：节点宿主或线路类型不兼容。', 'danger')
            setConnectionPreview(null)
            setRouteWaypointPreview(null)
          } else {
            const conflicts = manualRouteConflictCount(
              committedElementsRef.current,
              committedBusbarsRef.current,
              merged.networks,
              merged.routeWaypoints,
            )
            if (conflicts) {
              reportManualRouteConflict(conflicts)
              setConnectionPreview(null)
              setRouteWaypointPreview(null)
            } else if (commitDiagram(
              committedElementsRef.current,
              committedBusbarsRef.current,
              merged.networks,
              merged.routeWaypoints,
            )) {
              if (merged.mergedJunctionIds.length || merged.absorbedNodeIds.length) {
                setConnectionPointSelectionAfterMerge(
                  merged.networks,
                  merged.routeWaypoints,
                  merged.mergedJunctionIds,
                  [],
                  [interaction.materialized.junctionId],
                )
              } else {
                setJunctionSelection([interaction.materialized.junctionId])
              }
            }
          }
        }
      } else if (interaction.kind === 'route-segment') {
        setRouteSegmentDragPreview(null)
        if (
          interaction.currentStart.x !== interaction.segment.start.x ||
          interaction.currentStart.y !== interaction.segment.start.y ||
          interaction.currentEnd.x !== interaction.segment.end.x ||
          interaction.currentEnd.y !== interaction.segment.end.y
        ) {
          const insetSegment = insetDraggedRouteSegmentFromElementAnchors(
            interaction.baseConnections,
            interaction.routedEdges,
            interaction.segment,
            interaction.currentStart,
            interaction.currentEnd,
            gridSize,
          )
          const candidate = applyDraggedRouteSegment(
            interaction.baseConnections,
            interaction.baseRouteWaypoints,
            interaction.routedEdges,
            interaction.segment,
            insetSegment.start,
            insetSegment.end,
          )
          const merged = mergeCollidingConnectionPoints({
            networks: candidate.networks,
            routeWaypoints: candidate.routeWaypoints,
            routedEdges: renderedRoutedConnections.edges,
            diagramId,
            elements: committedElementsRef.current,
            assets,
            busbars: committedBusbarsRef.current,
            movedWaypointIds: new Set(candidate.waypointIds),
            movedJunctionIds: new Set(candidate.waypointIds),
          })
          if (!merged) {
            callbacksRef.current.onActionMessage('无法合并：节点宿主或线路类型不兼容。', 'danger')
            setRouteSegmentDragPreview(null)
            return
          }
          const routeSegmentDelta = interaction.segment.orientation === 'horizontal'
            ? interaction.currentStart.y - interaction.segment.start.y
            : interaction.currentStart.x - interaction.segment.start.x
          const restoresExistingRoute = draggedRouteSegmentAlignsWithExistingRoute(
            interaction.segment,
            interaction.routedEdges,
            routeSegmentDelta,
            interaction.baseConnections,
          )
          const restoredJunctionIds = restoresExistingRoute
            ? new Set(merged.networks.flatMap((network) => network.nodes.flatMap((node) => {
                if (node.kind !== 'node' || !candidate.waypointIds.includes(node.id)) return []
                const incidentEdges = network.edges.filter((edge) => (
                  edge.sourceNodeId === node.id || edge.targetNodeId === node.id
                ))
                const logicalConnectionId = incidentEdges[0]?.logicalConnectionId
                return incidentEdges.length === 2 && logicalConnectionId &&
                  incidentEdges[1].logicalConnectionId === logicalConnectionId
                  ? [node.id]
                  : []
              })))
            : new Set<string>()
          const contracted = restoredJunctionIds.size
            ? deleteConnectionJunctions(
                merged.networks,
                restoredJunctionIds,
                committedElementsRef.current,
                assets,
                committedBusbarsRef.current,
                merged.routeWaypoints,
              )
            : { networks: merged.networks, routeWaypoints: merged.routeWaypoints }
          const endpointNodeIds = new Set(contracted.networks.flatMap((network) => (
            network.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId])
          )))
          const mergedRouteWaypointIds = new Set(
            contracted.routeWaypoints.map((waypoint) => waypoint.id),
          )
          const restoredWaypointIds = restoresExistingRoute
            ? new Set(candidate.waypointIds.filter((id) => (
                mergedRouteWaypointIds.has(id) && !endpointNodeIds.has(id)
              )))
            : new Set<string>()
          const restored = restoredWaypointIds.size
            ? deleteRouteWaypoints(
                contracted.networks,
                contracted.routeWaypoints,
                restoredWaypointIds,
              )
            : contracted
          let cleaned = {
            ...restored,
            removedWaypointIds: [...restoredWaypointIds, ...restoredJunctionIds],
          }
          for (
            let pass = 0;
            restoresExistingRoute && pass <= merged.routeWaypoints.length;
            pass += 1
          ) {
            const mergedRoute = routeConnectionNetworksForDirtyNetworks({
              ...routeInput,
              networks: cleaned.networks,
              elements: committedElementsRef.current,
              busbars: committedBusbarsRef.current,
              routeWaypoints: cleaned.routeWaypoints,
            }, committedRoutedConnections, new Set([interaction.segment.networkId]))
            const nextCleaned = removeFoldbackRouteWaypoints(
              cleaned.networks,
              cleaned.routeWaypoints,
              mergedRoute.edges,
            )
            if (!nextCleaned.removedWaypointIds.length) break
            cleaned = {
              ...nextCleaned,
              removedWaypointIds: [
                ...cleaned.removedWaypointIds,
                ...nextCleaned.removedWaypointIds,
              ],
            }
          }
          const conflicts = manualRouteConflictCount(
            committedElementsRef.current,
            committedBusbarsRef.current,
            cleaned.networks,
            cleaned.routeWaypoints,
            new Set([interaction.segment.networkId]),
          )
          if (conflicts) reportManualRouteConflict(conflicts)
          else if (commitDiagram(
            committedElementsRef.current,
            committedBusbarsRef.current,
            cleaned.networks,
            cleaned.routeWaypoints,
          )) {
            if (
              merged.mergedJunctionIds.length ||
              merged.absorbedNodeIds.length ||
              cleaned.removedWaypointIds.length
            ) {
              setConnectionPointSelectionAfterMerge(
                cleaned.networks,
                cleaned.routeWaypoints,
                merged.mergedJunctionIds,
                candidate.waypointIds,
                selectedJunctionIdsRef.current,
              )
            } else {
              setRouteWaypointSelection([], true, true, true)
              setJunctionSelection(candidate.waypointIds, true, true)
            }
          }
        }
      } else if (interaction.kind === 'route-waypoint') {
        const nextElements = previewElementsRef.current ?? committedElementsRef.current
        const nextBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
        const nextRouteWaypoints = previewRouteWaypointsRef.current ?? committedRouteWaypointsRef.current
        const merged = mergeCollidingConnectionPoints({
          networks: committedConnectionsRef.current,
          routeWaypoints: nextRouteWaypoints,
          routedEdges: renderedRoutedConnections.edges,
          diagramId,
          elements: nextElements,
          assets,
          busbars: nextBusbars,
          movedWaypointIds: new Set(interaction.selectedRouteWaypointIds),
        })
        if (!merged) {
          callbacksRef.current.onActionMessage('无法合并：节点宿主或线路类型不兼容。', 'danger')
          setPreview(null)
          setBusbarPreview(null)
          setRouteWaypointPreview(null)
          return
        }
        const conflicts = manualRouteConflictCount(
          nextElements,
          nextBusbars,
          merged.networks,
          merged.routeWaypoints,
        )
        if (conflicts) {
          reportManualRouteConflict(conflicts)
          setPreview(null)
          setBusbarPreview(null)
          setRouteWaypointPreview(null)
        } else {
          commitDiagram(
            nextElements,
            nextBusbars,
            merged.networks,
            merged.routeWaypoints,
          )
          if (merged.mergedJunctionIds.length || merged.absorbedNodeIds.length) {
            setConnectionPointSelectionAfterMerge(
              merged.networks,
              merged.routeWaypoints,
              merged.mergedJunctionIds,
              interaction.selectedRouteWaypointIds,
              selectedJunctionIdsRef.current,
            )
          }
        }
      } else if (interaction.kind === 'node') {
        const nextConnections = previewConnectionsRef.current ?? interaction.baseConnections
        const merged = mergeCollidingConnectionPoints({
          networks: nextConnections,
          routeWaypoints: committedRouteWaypointsRef.current,
          routedEdges: renderedRoutedConnections.edges,
          diagramId,
          elements: committedElementsRef.current,
          assets,
          busbars: committedBusbarsRef.current,
          movedJunctionIds: new Set([interaction.junctionId]),
        })
        if (!merged) {
          callbacksRef.current.onActionMessage('无法合并：节点宿主或线路类型不兼容。', 'danger')
          setConnectionPreview(null)
          return
        }
        const conflicts = manualRouteConflictCount(
          committedElementsRef.current,
          committedBusbarsRef.current,
          merged.networks,
          merged.routeWaypoints,
        )
        if (conflicts) {
          reportManualRouteConflict(conflicts)
          setConnectionPreview(null)
        } else {
          commitDiagram(
            committedElementsRef.current,
            committedBusbarsRef.current,
            merged.networks,
            merged.routeWaypoints,
          )
          if (merged.mergedJunctionIds.length || merged.absorbedNodeIds.length) {
            setConnectionPointSelectionAfterMerge(
              merged.networks,
              merged.routeWaypoints,
              merged.mergedJunctionIds,
              selectedRouteWaypointIdsRef.current,
              [interaction.junctionId],
            )
          }
        }
      } else if (
        previewElementsRef.current ||
        previewBusbarsRef.current ||
        previewConnectionsRef.current ||
        previewRouteWaypointsRef.current
      ) {
        const nextElements = previewElementsRef.current ?? committedElementsRef.current
        const nextBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
        let nextConnections = previewConnectionsRef.current ?? committedConnectionsRef.current
        let nextRouteWaypoints = previewRouteWaypointsRef.current ?? committedRouteWaypointsRef.current
        let mergedJunctionIds: string[] = []
        let absorbedNodeIds: string[] = []
        if (interaction.kind === 'move' || interaction.kind === 'rotate') {
          const merged = mergeCollidingConnectionPoints({
            networks: nextConnections,
            routeWaypoints: nextRouteWaypoints,
            routedEdges: renderedRoutedConnections.edges,
            diagramId,
            elements: nextElements,
            assets,
            busbars: nextBusbars,
            movedWaypointIds: new Set(interaction.selectedRouteWaypointIds),
            movedJunctionIds: new Set(interaction.selectedJunctionIds),
            movedElementIds: new Set(interaction.selectedIds),
            movedBusbarIds: new Set(interaction.selectedBusbarIds),
          })
          if (!merged) {
            callbacksRef.current.onActionMessage('无法合并：节点宿主或线路类型不兼容。', 'danger')
            setPreview(null)
            setBusbarPreview(null)
            setConnectionPreview(null)
            setRouteWaypointPreview(null)
            return
          }
          nextConnections = merged.networks
          nextRouteWaypoints = merged.routeWaypoints
          mergedJunctionIds = merged.mergedJunctionIds
          absorbedNodeIds = merged.absorbedNodeIds
        }
        const conflicts = manualRouteConflictCount(
          nextElements,
          nextBusbars,
          nextConnections,
          nextRouteWaypoints,
        )
        if (conflicts) {
          reportManualRouteConflict(conflicts)
          setPreview(null)
          setBusbarPreview(null)
          setConnectionPreview(null)
          setRouteWaypointPreview(null)
        } else {
          if (commitDiagram(nextElements, nextBusbars, nextConnections, nextRouteWaypoints)) {
            if (mergedJunctionIds.length || absorbedNodeIds.length) {
              setConnectionPointSelectionAfterMerge(
                nextConnections,
                nextRouteWaypoints,
                mergedJunctionIds,
                interaction.kind === 'move' || interaction.kind === 'rotate'
                  ? interaction.selectedRouteWaypointIds
                  : [],
                interaction.kind === 'move' || interaction.kind === 'rotate'
                  ? interaction.selectedJunctionIds
                  : [],
              )
            }
          }
        }
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
      if (interaction.kind === 'pan') {
        panViewportFrameScheduler.cancel()
        pendingPanViewportRef.current = null
        viewportValueRef.current = interaction.startViewport
        lastPanReactViewportRef.current = interaction.startViewport
        syncViewportPresentation(interaction.startViewport)
        setViewportValue(interaction.startViewport)
      }
      delete event.currentTarget.dataset.panning
      interactionRef.current = null
      if (interaction.kind === 'move') setActiveMoveElementIds([])
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setRouteWaypointPreview(null)
      setRouteSegmentDragPreview(null)
      setConnectionLabelPlacementPreview(null)
      setRouteJunctionCandidate(null)
      setMarquee(null)
    }

    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      if (event.deltaX === 0 && event.deltaY === 0) return

      const legacyEvent = event as globalThis.WheelEvent & {
        readonly wheelDelta?: number
        readonly wheelDeltaY?: number
      }
      const inferredKind = inferWheelGestureKind({
        ctrlKey: event.ctrlKey,
        deltaMode: event.deltaMode,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        devicePixelRatio: globalThis.devicePixelRatio,
        wheelDelta: legacyEvent.wheelDelta,
        wheelDeltaY: legacyEvent.wheelDeltaY,
      })
      const gesture = wheelGestureRef.current
      const changesPinchMode = gesture.kind !== null &&
        (gesture.kind === 'pinch-zoom') !== (inferredKind === 'pinch-zoom')
      const gainsHorizontalTrackpadSignal = gesture.kind === 'mouse-zoom' &&
        inferredKind === 'trackpad-pan' && event.deltaX !== 0
      if (changesPinchMode || gainsHorizontalTrackpadSignal) {
        wheelGestureEndScheduler.cancel()
        finishWheelGestureRef.current()
      }
      if (!gesture.kind) gesture.kind = inferredKind
      wheelGestureEndScheduler.schedule()

      if (gesture.kind === 'trackpad-pan') {
        const baseViewport = gesture.panTarget ?? viewportValueRef.current
        const nextViewport = {
          ...baseViewport,
          tx: baseViewport.tx - event.deltaX,
          ty: baseViewport.ty - event.deltaY,
        }
        gesture.panTarget = nextViewport
        schedulePanViewport(nextViewport)
        return
      }

      const currentViewport = viewportValueRef.current
      const zoomFactor = gesture.kind === 'pinch-zoom'
        ? pinchZoomFactor(event.deltaY)
        : event.deltaY < 0 ? 1.12 : 1 / 1.12
      const minimumZoom = Math.min(MIN_ZOOM, currentViewport.zoom)
      const nextZoom = clampZoom(currentViewport.zoom * zoomFactor, minimumZoom)
      applyViewport(
        zoomAroundPoint(
          currentViewport,
          clientPoint(event.clientX, event.clientY),
          nextZoom,
          minimumZoom,
        ),
      )
    }
    wheelHandlerRef.current = handleWheel

    const nudgeSelection = (x: number, y: number) => {
      const selected = new Set(selectedIdsRef.current)
      const selectedBusbars = new Set(selectedBusbarIdsRef.current)
      const selectedRouteWaypoints = new Set(selectedRouteWaypointIdsRef.current)
      const selectedJunctions = new Set(selectedJunctionIdsRef.current)
      if (
        (
          !selected.size &&
          !selectedBusbars.size &&
          !selectedRouteWaypoints.size &&
          !selectedJunctions.size
        ) ||
        interactionRef.current
      ) return false
      const currentElements = previewElementsRef.current ?? committedElementsRef.current
      const currentBusbars = previewBusbarsRef.current ?? committedBusbarsRef.current
      const currentConnections = previewConnectionsRef.current ?? committedConnectionsRef.current
      const currentRouteWaypoints = previewRouteWaypointsRef.current ??
        committedRouteWaypointsRef.current
      const translated = translateDiagramSelection(
        currentElements,
        currentBusbars,
        currentConnections,
        currentRouteWaypoints,
        {
          elementIds: selected,
          busbarIds: selectedBusbars,
          nodeIds: selectedJunctions,
          routeWaypointIds: selectedRouteWaypoints,
        },
        { x, y },
        gridSize,
      )
      nudgeSessionActiveRef.current = true
      scheduleDiagramPreview(
        translated.elements,
        translated.busbars,
        selectedJunctions.size
          ? translated.connections
          : null,
        selectedRouteWaypoints.size
          ? translated.routeWaypoints
          : null,
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
        const exitDirectLineTool = directLineToolActiveRef.current
        const activeInteraction = interactionRef.current
        if (activeInteraction) {
          interactionRef.current = null
          if (activeInteraction.kind === 'pan') {
            panViewportFrameScheduler.cancel()
            pendingPanViewportRef.current = null
            viewportValueRef.current = activeInteraction.startViewport
            lastPanReactViewportRef.current = activeInteraction.startViewport
            syncViewportPresentation(activeInteraction.startViewport)
            setViewportValue(activeInteraction.startViewport)
            delete event.currentTarget.dataset.panning
          }
          if (activeInteraction.kind === 'move') setActiveMoveElementIds([])
          setPreview(null)
          setBusbarPreview(null)
          setConnectionPreview(null)
          setRouteWaypointPreview(null)
          setRouteSegmentDragPreview(null)
          setConnectionLabelPlacementPreview(null)
          setRouteJunctionCandidate(null)
          setMarquee(null)
          const viewportElement = viewportElementRef.current
          if (viewportElement?.hasPointerCapture(activeInteraction.pointerId)) {
            viewportElement.releasePointerCapture(activeInteraction.pointerId)
          }
          if (exitDirectLineTool) stopDirectLineTool()
          return
        }
        if (exitDirectLineTool) {
          stopDirectLineTool()
          return
        }
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
          false,
          true,
          true,
        )
        setRouteWaypointSelection(
          committedRouteWaypointsRef.current.map((waypoint) => waypoint.id),
          true,
          false,
          true,
        )
        setJunctionSelection(
          committedConnectionsRef.current.flatMap((network) => (
            network.nodes.flatMap((node) => (
              node.kind === 'node' || node.kind === 'busbar-tap' ? [node.id] : []
            ))
          )),
          true,
          true,
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
    const selectedRouteWaypointIdSet = new Set(selectedRouteWaypointIds)
    const selectedRouteWaypoints = displayedRouteWaypoints.filter((waypoint) => (
      selectedRouteWaypointIdSet.has(waypoint.id)
    ))
    const selectedJunctionIdSet = new Set(selectedJunctionIds)
    const selectedTapHostIds = new Set(displayedConnections.flatMap((network) => (
      network.nodes.flatMap((node) => (
        node.kind === 'busbar-tap' && selectedJunctionIdSet.has(node.id)
          ? [node.busbarId]
          : []
      ))
    )))
    const canRotateSelection = [...selectedTapHostIds].every((busbarId) => (
      selectedBusbarIdSet.has(busbarId)
    ))
    const selectedJunctionPoints = displayedConnections.flatMap((network) => (
      network.nodes.flatMap((node) => {
        if (node.kind === 'node' && selectedJunctionIdSet.has(node.id)) {
          return [{ id: node.id, x: node.x, y: node.y }]
        }
        if (node.kind !== 'busbar-tap' || !selectedJunctionIdSet.has(node.id)) return []
        const busbar = displayedBusbarsById.get(node.busbarId)
        return busbar ? [{ id: node.id, ...busbarPoint(busbar, node.offset) }] : []
      })
    ))
    const selectedObjectCount = selectedElements.length + selectedBusbars.length +
      selectedRouteWaypoints.length + selectedJunctionPoints.length
    const selectedConnectionLabelEdgeId =
      selectedObjectCount === 0 && selectedConnectionEdgeIdSet.size === 1
        ? selectedConnectionEdgeIdSet.values().next().value as string
        : null
    const selectedDiagramObjectBounds = diagramObjectsBounds(selectedElements, selectedBusbars)
    const selectedWaypointBounds = routeWaypointBounds([
      ...selectedRouteWaypoints,
      ...selectedJunctionPoints,
    ])
    const selectionBounds = selectedDiagramObjectBounds && selectedWaypointBounds
      ? {
          x: Math.min(selectedDiagramObjectBounds.x, selectedWaypointBounds.x),
          y: Math.min(selectedDiagramObjectBounds.y, selectedWaypointBounds.y),
          width: Math.max(
            selectedDiagramObjectBounds.x + selectedDiagramObjectBounds.width,
            selectedWaypointBounds.x + selectedWaypointBounds.width,
          ) - Math.min(selectedDiagramObjectBounds.x, selectedWaypointBounds.x),
          height: Math.max(
            selectedDiagramObjectBounds.y + selectedDiagramObjectBounds.height,
            selectedWaypointBounds.y + selectedWaypointBounds.height,
          ) - Math.min(selectedDiagramObjectBounds.y, selectedWaypointBounds.y),
        }
      : selectedDiagramObjectBounds ?? selectedWaypointBounds
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
      const visualState: SymbolVisualState = elementSupportsOnOffState(element) &&
        resolvedElementOnOffState(element, onOffStates[element.id])
        ? 'on'
        : 'off'
      const activeColorSlot = symbolColorSlotForElement(element, visualState)
      const colorPreview = previewElementColorsRef.current.get(element.id)
      const symbolColor = symbol?.configurableColor
        ? colorPreview?.slot === activeColorSlot
          ? colorPreview.color
          : resolvedSymbolColor(element, visualState)
        : undefined
      const genericBackgroundColor = symbol?.renderMode === 'generic-frame'
        ? colorPreview?.slot === 'generic-background'
          ? colorPreview.color
          : resolvedGenericSymbolBackgroundColor(element)
        : undefined
      return { element, symbol, visualState, symbolColor, genericBackgroundColor }
    })
    const visibleSymbolColors = [...new Set(visibleElementPresentations.flatMap(({ symbolColor }) => (
      symbolColor ? [symbolColor] : []
    )))]

    return (
      <div
        ref={canvasStageRef}
        className="canvas-stage"
        style={CANVAS_STAGE_STYLE}
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
        data-cooling-flow-diagnostics={lineSystemType === 'cooling'
          ? coolingFlowTopology.diagnostics.length
          : undefined}
        data-cooling-flow-diagnostic-codes={lineSystemType === 'cooling'
          ? [...new Set(coolingFlowTopology.diagnostics.map((diagnostic) => diagnostic.code))]
              .join(',')
          : undefined}
        data-active-cooling-pumps={lineSystemType === 'cooling'
          ? coolingFlowTopology.activePumpElementIds.size
          : undefined}
        data-monitor-flow-path-count={mode === 'monitor' ? monitorFlowPaths.length : undefined}
        data-canvas-render-revision={canvasRenderRevisionRef.current}
        data-mode={mode}
        data-direct-line-tool={directLineToolActive || undefined}
      >
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
          onPointerDownCapture={handlePointerDownCapture}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
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
                ref={gridFallbackRef}
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
              {visibleRouteRenderGroups.flatMap((group) => {
                const filterId = coolingPipeFilterIdsByRenderKey.get(group.renderKey)
                const shell = coolingPipeShellsByRenderKey.get(group.renderKey)
                if (!filterId || !shell || !group.coolingLineRole) return []
                return [(
                  <CoolingPipeInnerShadowFilter
                    key={filterId}
                    id={filterId}
                    points={shell.points}
                    role={group.coolingLineRole}
                  />
                )]
              })}
              {mode === 'edit' && coolingPipeShellPreview && wiring?.source.type &&
              isCoolingConnectionType(wiring.source.type) ? (
                <CoolingPipeInnerShadowFilter
                  id={COOLING_PIPE_PREVIEW_FILTER_ID}
                  points={coolingPipeShellPreview}
                />
              ) : null}
              {visibleSymbolColors.map((color) => (
                <SymbolColorFilter
                  key={color}
                  id={symbolColorFilterId(color)}
                  color={color}
                />
              ))}
            </defs>
            <g
              ref={viewportWorldRef}
              className="viewport-world"
              transform={`translate(${viewportValue.tx} ${viewportValue.ty}) scale(${viewportValue.zoom})`}
              style={{
                transform: `translate(${viewportValue.tx}px, ${viewportValue.ty}px) scale(${viewportValue.zoom})`,
              }}
            >
              <g className="busbar-layer" data-testid="busbar-layer">
                {visibleBusbars.map((busbar) => {
                  const end = busbarEndPoint(busbar)
                  const data = `M ${busbar.x} ${busbar.y} L ${end.x} ${end.y}`
                  const monitorFlowHint = mode === 'edit'
                    ? busbarMonitorFlowHintGeometry(busbar)
                    : null
                  const hintScale = 1 / viewportValue.zoom
                  const hintLabel = busbar.orientation === 'horizontal'
                    ? { x: 0, y: -10, textAnchor: 'middle' as const }
                    : { x: 10, y: 3, textAnchor: 'start' as const }
                  return (
                    <BusbarVisual
                      key={busbar.id}
                      busbar={busbar}
                      selected={selectedBusbarIdSet.has(busbar.id)}
                      nodeRegistry={busbarNodeRefs}
                    >
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
                      {monitorFlowHint ? (
                        <g className="busbar-flow-hint" aria-hidden="true">
                          <g transform={`translate(${monitorFlowHint.entry.x} ${monitorFlowHint.entry.y}) scale(${hintScale})`}>
                            <text
                              className="busbar-flow-hint__label"
                              x={hintLabel.x}
                              y={hintLabel.y}
                              textAnchor={hintLabel.textAnchor}
                            >入口</text>
                          </g>
                          <g transform={`translate(${monitorFlowHint.exit.x} ${monitorFlowHint.exit.y}) scale(${hintScale})`}>
                            <text
                              className="busbar-flow-hint__label"
                              x={hintLabel.x}
                              y={hintLabel.y}
                              textAnchor={hintLabel.textAnchor}
                            >出口</text>
                          </g>
                        </g>
                      ) : null}
                    </BusbarVisual>
                  )
                })}
              </g>
              {mode === 'monitor' ? (
                <g
                  className="monitor-static-flow-layer"
                  data-testid="monitor-static-busbar-layer"
                  aria-hidden="true"
                >
                  <MonitorStaticFlowLines groups={monitorStaticFlowLineGroups.filter(
                    (group) => group.kind === 'busbar',
                  )} />
                </g>
              ) : null}
              <g className="connection-layer" data-testid="connection-layer">
                {visibleRouteRenderGroups.map((group) => {
                  const pipeShell = coolingPipeShellsByRenderKey.get(group.renderKey)
                  const pipeFilterId = coolingPipeFilterIdsByRenderKey.get(group.renderKey)
                  return (
                    <g
                      key={`connection-network:${group.renderKey}`}
                      className="connection-network"
                      data-network-id={group.networkId}
                      data-connection-type={group.type}
                      data-cooling-line-role={group.coolingLineRole}
                    >
                      {group.routes.flatMap((route) => {
                        const bridgeCasingPath = renderedConnectionPaths
                          .get(route.edgeId)?.bridgeCasingPath
                        const coolingLineRole = displayedConnectionEdgesById
                          .get(route.edgeId)?.coolingLineRole ?? 'primary'
                        return bridgeCasingPath ? [(
                          <ConnectionBridgeCasing
                            key={`connection-bridge:${route.edgeId}`}
                            path={bridgeCasingPath}
                            type={route.type}
                            coolingLineRole={isCoolingConnectionType(route.type)
                              ? coolingLineRole
                              : undefined}
                          />
                        )] : []
                      })}
                      {pipeShell && pipeFilterId && group.coolingLineRole ? (
                        <CoolingPipeShell
                          key={`connection-pipe-shell:${group.renderKey}`}
                          path={pipeShell.path}
                          type={group.type}
                          coolingLineRole={group.coolingLineRole}
                          filterId={pipeFilterId}
                        />
                      ) : null}
                      {group.routes.map((route) => {
                        const renderedPath = renderedConnectionPaths.get(route.edgeId)
                        const linePath = renderedPath?.linePath ?? pathData(route.points)
                        const edge = displayedConnectionEdgesById.get(route.edgeId)
                        const flowDirection = edge?.flowDirection
                        return (
                          <ConnectionEdgeItem
                            key={`${route.networkId}:${route.edgeId}`}
                            edgeId={route.edgeId}
                            networkId={route.networkId}
                            type={route.type}
                            color={edge?.color}
                            flowDirection={flowDirection}
                            coolingLineRole={edge?.coolingLineRole}
                            directionArrowPath={flowDirection
                              ? connectionTerminalArrowPath(
                                  route.points,
                                  flowDirection,
                                  viewportValue.zoom,
                                  isCoolingConnectionType(route.type)
                                    ? COOLING_DIRECTION_ARROW_INSET_SCREEN
                                    : 0,
                                )
                              : ''}
                            selected={mode === 'edit' &&
                              selectedConnectionEdgeIdSet.has(route.edgeId)}
                            interactive={mode === 'edit'}
                            linePath={linePath}
                            pressEdge={pressConnectionEdgeRef}
                            moveEdge={moveConnectionEdgeRef}
                            leaveEdge={leaveConnectionEdgeRef}
                            edgeNodes={connectionEdgeNodeRefs}
                          />
                        )
                      })}
                    </g>
                  )
                })}
                {mode === 'monitor' ? (
                  <g
                    className="monitor-static-flow-layer"
                    data-testid="monitor-static-connection-layer"
                    aria-hidden="true"
                  >
                    {visibleRouteRenderGroups.map((group) => {
                      const pipeShell = coolingPipeShellsByRenderKey.get(group.renderKey)
                      const pipeFilterId = coolingPipeFilterIdsByRenderKey.get(group.renderKey)
                      const staticGroups = monitorStaticConnectionGroupsByRenderKey
                        .get(group.renderKey) ?? []
                      return (
                        <g
                          key={`monitor-static-connection-group:${group.renderKey}`}
                          data-network-id={group.networkId}
                          data-render-priority={connectionEdgeCrossingPriority({
                            crossingLayer: group.crossingLayer,
                            coolingLineRole: group.coolingLineRole,
                          })}
                        >
                          {group.routes.flatMap((route) => {
                            const bridgeCasingPath = renderedConnectionPaths
                              .get(route.edgeId)?.bridgeCasingPath
                            const coolingLineRole = displayedConnectionEdgesById
                              .get(route.edgeId)?.coolingLineRole ?? 'primary'
                            return bridgeCasingPath ? [(
                              <ConnectionBridgeCasing
                                key={`monitor-connection-bridge:${route.edgeId}`}
                                path={bridgeCasingPath}
                                type={route.type}
                                coolingLineRole={isCoolingConnectionType(route.type)
                                  ? coolingLineRole
                                  : undefined}
                              />
                            )] : []
                          })}
                          {pipeShell && pipeFilterId && group.coolingLineRole ? (
                            <CoolingPipeShell
                              path={pipeShell.path}
                              type={group.type}
                              coolingLineRole={group.coolingLineRole}
                              filterId={pipeFilterId}
                              monitorReplay
                            />
                          ) : null}
                          <MonitorStaticFlowLines groups={staticGroups} />
                        </g>
                      )
                    })}
                  </g>
                ) : null}
                {mode === 'edit' && !directLineToolActive ? draggableRouteSegments.map((segment) => {
                  const type = segment.edgeIds
                    .map((edgeId) => renderedRouteTypesByEdgeId.get(edgeId))
                    .find((candidate): candidate is AnchorType => Boolean(candidate)) ?? 'electrical'
                  return (
                    <line
                      key={`route-segment-handle:${segment.id}`}
                      className="route-segment-handle"
                      data-orientation={segment.orientation}
                      data-edge-count={segment.edgeIds.length}
                      data-connection-type={type}
                      x1={segment.start.x}
                      y1={segment.start.y}
                      x2={segment.end.x}
                      y2={segment.end.y}
                      strokeWidth={routeHitWorldWidthForConnectionType(type, viewportValue.zoom)}
                      onPointerDown={(event) => startRouteSegmentDrag(event, segment)}
                      onPointerMove={(event) => {
                        if (wiringRef.current) return
                        const edgeId = segment.edgeIds[0]
                        if (edgeId) updateDerivedRouteCornerCandidate(
                          segment.networkId,
                          edgeId,
                          event.clientX,
                          event.clientY,
                        )
                      }}
                    />
                  )
                }) : null}
                {mode === 'edit' && routeJunctionCandidate ? (
                  <circle
                    className="connection-junction-candidate"
                    data-network-id={routeJunctionCandidate.networkId}
                    data-derived-corner={routeJunctionCandidate.derivedCorner || undefined}
                    data-edge-count={routeJunctionCandidate.edgeIds.length}
                    cx={routeJunctionCandidate.point.x}
                    cy={routeJunctionCandidate.point.y}
                    r={5 / viewportValue.zoom}
                    strokeWidth={2 / viewportValue.zoom}
                    pointerEvents={routeJunctionCandidate.derivedCorner ? 'all' : 'none'}
                    onPointerDown={routeJunctionCandidate.derivedCorner
                      ? (event) => startRouteCornerInteraction(
                          event,
                          routeJunctionCandidate as DerivedRouteCornerCandidate,
                        )
                      : undefined}
                    onDoubleClick={routeJunctionCandidate.derivedCorner
                      ? (event) => startWiringFromRouteCandidate(
                          event,
                          routeJunctionCandidate as DerivedRouteCornerCandidate,
                        )
                      : undefined}
                  >
                    {routeJunctionCandidate.derivedCorner
                      ? <title>双击从节点接线</title>
                      : null}
                  </circle>
                ) : null}
                {mode === 'edit' ? displayedConnections.flatMap((network) => (
                  network.nodes.flatMap((node) => {
                    if (node.kind !== 'node') return []
                    if (cullingEnabled && !pointInsideRect(node, renderWorldRect)) return []
                    return [(
                      <circle
                        key={`connection-junction:${node.id}`}
                        className="connection-junction-handle"
                        data-node-id={node.id}
                        data-network-id={network.id}
                        data-selected={(
                          selectedJunctionIds.includes(node.id) ||
                          selectedRouteWaypointIds.includes(node.id)
                        ) || undefined}
                        data-invalid={invalidPreviewWaypointIds.has(node.id) || undefined}
                        cx={node.x}
                        cy={node.y}
                        r={7 / viewportValue.zoom}
                        strokeWidth={2 / viewportValue.zoom}
                        onPointerEnter={() => {
                          if (!wiringRef.current) return
                          setRouteJunctionCandidate({
                            networkId: network.id,
                            point: { x: node.x, y: node.y },
                            edgeIds: [],
                            type: network.type,
                          })
                        }}
                        onPointerLeave={() => {
                          if (wiringRef.current) setRouteJunctionCandidate(null)
                        }}
                        onPointerDown={(event) => startJunctionDrag(
                          event,
                          network.id,
                          node,
                          { x: node.x, y: node.y },
                          network.type,
                        )}
                        onDoubleClick={(event) => startWiringFromEditableNode(
                          event,
                          network.id,
                          node,
                          { x: node.x, y: node.y },
                          network.type,
                        )}
                      >
                        <title>双击从节点接线</title>
                      </circle>
                    )]
                  })
                )) : null}
                {displayedConnections.flatMap((network) => network.nodes.flatMap((node) => {
                  if (node.kind === 'busbar-tap') {
                    const busbar = displayedBusbarsById.get(node.busbarId)
                    if (!busbar) return []
                    const resolvedOffset = routedConnections.resolvedBusbarTapOffsets[node.id] ?? node.offset
                    const point = busbarPoint(busbar, resolvedOffset)
                    if (cullingEnabled && !pointInsideRect(point, renderWorldRect)) return []
                    return [(
                      <g key={node.id}>
                        <BusbarTapVisual
                          nodeId={node.id}
                          busbarId={node.busbarId}
                          offset={resolvedOffset}
                          point={point}
                          color={busbar.color}
                          zoom={viewportValue.zoom}
                          nodeRegistry={busbarTapNodeRefs}
                        />
                        {mode === 'edit' ? (
                          <circle
                            className="connection-junction-handle connection-junction-handle--busbar"
                            data-node-id={node.id}
                            data-network-id={network.id}
                            data-selected={selectedJunctionIds.includes(node.id) || undefined}
                            cx={point.x}
                            cy={point.y}
                            r={7 / viewportValue.zoom}
                            strokeWidth={2 / viewportValue.zoom}
                            onPointerEnter={() => {
                              const active = wiringRef.current
                              if (!active || active.source.type !== 'electrical') return
                              const target: ConnectionTerminal = {
                                kind: 'busbar',
                                busbarId: node.busbarId,
                                offset: node.offset,
                                point,
                                type: 'electrical',
                              }
                              setRouteJunctionCandidate(null)
                              hoveredWiringTargetRef.current = target
                              setHoveredWiringTarget(target)
                            }}
                            onPointerLeave={() => {
                              const current = hoveredWiringTargetRef.current
                              if (
                                current?.kind !== 'busbar' ||
                                current.busbarId !== node.busbarId ||
                                current.offset !== node.offset
                              ) return
                              hoveredWiringTargetRef.current = null
                              setHoveredWiringTarget(null)
                            }}
                            onPointerDown={(event) => startJunctionDrag(
                              event,
                              network.id,
                              node,
                              point,
                              'electrical',
                            )}
                            onDoubleClick={(event) => startWiringFromEditableNode(
                              event,
                              network.id,
                              node,
                              point,
                              'electrical',
                            )}
                          >
                            <title>双击从节点接线</title>
                          </circle>
                        ) : null}
                      </g>
                    )]
                  }
                  return []
                }))}
                {mode === 'edit' && wiringPreview ? (
                  <>
                    <path
                      className="connection-preview connection-preview--pipe-shell"
                      data-connection-type={wiring?.source.type}
                      d={roundedCoolingPipeShellPreviewPath || roundedWiringPreviewPath}
                      filter={wiring?.source.type && isCoolingConnectionType(wiring.source.type)
                        ? `url(#${COOLING_PIPE_PREVIEW_FILTER_ID})`
                        : undefined}
                    />
                    <path
                      className="connection-preview"
                      data-connection-type={wiring?.source.type}
                      data-testid="connection-preview"
                      d={roundedWiringPreviewPath}
                    />
                  </>
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

              {visibleElementPresentations.map(({
                element,
                symbol,
                visualState,
                symbolColor,
                genericBackgroundColor,
              }) => {
                return (
                  <DiagramElementItem
                    key={element.id}
                    mode={mode}
                    element={element}
                    asset={assetsByKey.get(element.assetKey)}
                    symbol={symbol}
                    symbolColor={symbolColor}
                    genericBackgroundColor={genericBackgroundColor}
                    selected={selectedIdSet.has(element.id)}
                    anchorsVisible={
                      directLineToolActive || wiring !== null || hoveredElementId === element.id
                    }
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
                    coolingPumpRunning={coolingPumpRunningStates[element.id] ?? true}
                    coolingValveOpen={symbolSupportsOnOffState(symbol)
                      ? resolvedElementOnOffState(element, onOffStates[element.id])
                      : coolingValveOpenStates[element.id] ?? true}
                    hoverElement={hoverElementRef}
                    drillDownTarget={monitorDrillDownTargets[element.id]}
                    drillDownElement={drillDownElementRef}
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
                    pointerDownRef={startLabelDragRef}
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
                    nodeRegistry={busbarLabelNodeRefs}
                    pointerDownRef={startBusbarLabelDragRef}
                  />
                ))}
                {connectionLabelLayouts.map((layout) => (
                  <ConnectionLabelItem
                    key={layout.edgeId}
                    layout={layout}
                    interactive={mode === 'edit' && selectedConnectionLabelEdgeId === layout.edgeId}
                    selected={selectedLabelConnectionEdgeId === layout.edgeId}
                    pointerDownRef={startConnectionLabelDragRef}
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
                  {canRotateSelection ? (
                    <>
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
                    </>
                  ) : null}
                  {selectedBusbars.length === 0 &&
                  selectedRouteWaypoints.length === 0 &&
                  selectedJunctionPoints.length === 0 ? (
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
          {mode === 'monitor' && monitorFlowPaths.length > 0 ? (
            <FlowAnimationLayer
              paths={monitorFlowPaths}
              viewportRef={viewportValueRef}
              invalidateRef={flowInvalidateRef}
            />
          ) : null}
        </div>
      </div>
    )
  },
))
