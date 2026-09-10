import type { FlowAnimationMode } from '../monitoring/flowPresentation'
import { Canvas } from '@react-three/fiber'
import { circuitBusbarColor, circuitDisplayEdges, circuitPaletteStyle } from '../scene/circuitPalette'
import { completeSceneBounds, fitSceneViewport } from '../scene/sceneFit'
import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from 'react'

import {
  resolvedElementOnOffState,
  resolvedElementMonitorInteraction,
  type AssetDefinition,
  type DiagramElement,
  type DiagramViewport,
} from '../domain/project'
import {
  buildMonitorStaticFlowLineGroups,
  deriveInactiveFlowPaths,
  FLOW_BUSBAR_SCREEN_WIDTH,
  FlowAnimationLayer,
  type MonitorFlowPath,
} from '../monitoring/FlowAnimationLayer'
import { splitFlowPathAroundCrossings } from '../monitoring/flowPathGeometry'
import { monitorMetricReadingKey } from '../monitoring/elementMetrics'
import {
  layoutBusbarLabels,
} from '../scene/busbarLabels'
import {
  layoutConnectionLabels,
} from '../scene/connectionLabels'
import {
  COOLING_DIRECTION_ARROW_INSET_SCREEN,
  COOLING_PIPE_CORNER_RADIUS,
  isCoolingConnectionType,
} from '../scene/connectionAppearance'
import {
  busbarEndPoint,
  busbarPoint,
  connectedRouteEndpointGeometry,
  connectionRouteBranchPointKeys,
  connectionTerminalArrowPath,
  indexConnectionCrossings,
} from '../scene/connections'
import {
  clampZoom,
  diagramContentBounds,
  elementsBounds,
  MIN_ZOOM,
  zoomAroundPoint,
  type Point,
  type Rect,
} from '../scene/geometry'
import {
  GRID_BACKGROUND_COLOR,
  GridSurface,
  type GridRenderState,
} from '../scene/GridSurface'
import { getAdaptiveGridScale, GRID_PRESENTATION } from '../scene/gridScale'
import {
  elementDeviceIdentifier,
  layoutElementLabels,
} from '../scene/elementLabels'
import {
  resolvedGenericSymbolBackgroundColor,
} from '../scene/genericSymbol'
import { DEFAULT_BUSBAR_COLOR } from '../scene/objectColors'
import {
  elementSupportsOnOffState,
  resolvedSymbolColor,
  symbolSupportsOnOffState,
  symbolsByKey,
  type SymbolDefinition,
  type SymbolVisualState,
} from '../scene/symbolCatalog'
import { useRoutedConnections } from './useRoutedConnections'
import { demoLeakRegion } from './demoLeakRegion'
import {
  inferWheelGestureKind,
  pinchZoomFactor,
  type WheelGestureKind,
} from '../scene/wheelGestures'
import type { DiagramRuntimeView } from './diagramRuntime'
import type { DemoDeviceRuntimeState } from './demoSimulationProfiles'
import type { MonitorMetricReadings } from '../monitoring/elementMetrics'
import type { DiagramRuntimeContext } from './types'
import { useDiagramMonitorRuntime } from './useDiagramMonitorRuntime'
import {
  BusbarLabelItem,
  BusbarTapVisual,
  BusbarVisual,
  ConnectionBridgeCasing,
  ConnectionDirectionArrow,
  ConnectionLabelItem,
  CoolingPipeShell,
  CoolingPipeOutlineFilter,
  DiagramElementVisual,
  ElementLabelItem,
  MonitorStaticFlowLines,
  SymbolColorFilter,
  symbolColorFilterId,
  type MetricPointerDownRef,
} from '../scene/DiagramScenePrimitives'
import {
  MonitorMetricDataPanel,
  type MonitorMetricPanelAnchor,
} from '../components/monitoring/MonitorMetricDataPanel'
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
} from '../scene/connectionScene'

const CANVAS_STAGE_STYLE = {
  '--diagram-canvas-background': GRID_BACKGROUND_COLOR,
} as CSSProperties
const RENDER_CULLING_OBJECT_THRESHOLD = 180
const RENDER_OVERSCAN_SCREEN_PX = 160
const PAN_CULLING_SYNC_SCREEN_DISTANCE = 120
const WHEEL_GESTURE_END_DELAY_MS = 160

export interface DiagramMonitorCanvasHandle {
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

export interface DiagramMonitorCanvasProps {
  view: DiagramRuntimeView
  runtime: DiagramRuntimeContext
  animationMode?: FlowAnimationMode
  animationPlaying: boolean
  documentEpoch?: number
  viewport?: DiagramViewport
  onSelectionChange?: (elementIds: string[]) => void
  onElementDrillDown?: (elementId: string) => void
  onViewportChange?: (viewport: DiagramViewport) => void
  onRuntimePresentationChange?: (presentation: DiagramMonitorRuntimePresentation) => void
}

export interface DiagramMonitorRuntimePresentation {
  timestamp: number
  readings: MonitorMetricReadings
  elements: DiagramElement[]
  deviceStates: Record<string, DemoDeviceRuntimeState>
  coolingPumpFlowRates: Record<string, number>
}

interface MonitorMetricPanelSelection {
  ownerId: string
  metricId: string
  anchor: MonitorMetricPanelAnchor
  viewport: DiagramViewport
  stageOrigin: Point
}

function useElementSize(elementRef: RefObject<HTMLElement | null>) {
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
  return points.slice(1).some((end, index) => (
    segmentIntersectsViewport(points[index], end, rect)
  ))
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
      : Math.max(0, Math.min(1, (
          (target.x - start.x) * dx + (target.y - start.y) * dy
        ) / lengthSquared))
    const projected = { x: start.x + dx * ratio, y: start.y + dy * ratio }
    const squaredDistance = (target.x - projected.x) ** 2 +
      (target.y - projected.y) ** 2
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
    if (
      !sliced.length || sliced.at(-1)!.x !== clippedStart.x ||
      sliced.at(-1)!.y !== clippedStart.y
    ) sliced.push(clippedStart)
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

function MonitorElement({
  element,
  asset,
  symbol,
  zoom,
  selected,
  runtime,
  deviceState,
  drillDownTarget,
  onSelect,
  onDrillDown,
  filterScope,
}: {
  element: DiagramElement
  asset?: AssetDefinition
  symbol?: SymbolDefinition
  zoom: number
  selected: boolean
  runtime: DiagramRuntimeContext
  deviceState?: DemoDeviceRuntimeState
  drillDownTarget?: DiagramRuntimeContext['navigation'][string]
  onSelect: (elementId: string) => void
  onDrillDown: (elementId: string) => void
  filterScope: string
}) {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const visualState: SymbolVisualState = elementSupportsOnOffState(element) &&
    resolvedElementOnOffState(element, runtime.state.onOffStates[element.id]) ? 'on' : 'off'
  const symbolColor = symbol?.configurableColor
    ? resolvedSymbolColor(element, visualState)
    : undefined
  const generic = symbol?.renderMode === 'generic-frame'
  const genericBackgroundColor = generic
    ? resolvedGenericSymbolBackgroundColor(element)
    : undefined
  const coolingPumpRunning = runtime.state.coolingPumpRunningStates[element.id] ?? true
  const coolingValveOpen = symbolSupportsOnOffState(symbol)
    ? resolvedElementOnOffState(element, runtime.state.onOffStates[element.id])
    : runtime.state.coolingValveOpenStates[element.id] ?? true
  const coolingPumpStopped = asset?.coolingDeviceRole === 'pump' && !coolingPumpRunning
  const showsDevicePanel = element.assetKey === 'generator' || element.assetKey === 'ups' || (
    element.assetKey === 'switch' && resolvedElementMonitorInteraction(element) === 'device-panel'
  )
  const clipPathId = `${filterScope}-generic-clip-${element.id}`
  const handlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (event.button !== 0) return
    if (drillDownTarget) {
      event.preventDefault()
      event.stopPropagation()
      onDrillDown(element.id)
      return
    }
    if (!showsDevicePanel && !symbolSupportsOnOffState(symbol) && !asset?.coolingDeviceRole) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(element.id)
  }
  return (
    <g
      className="diagram-element"
      data-element-id={element.id}
      data-asset-key={element.assetKey}
      data-selected={selected || undefined}
      data-health={deviceState?.health}
      data-operation={deviceState?.operation}
      data-monitor-on-off={symbolSupportsOnOffState(symbol) || undefined}
      data-monitor-cooling-role={asset?.coolingDeviceRole}
      data-monitor-cooling-active={asset?.coolingDeviceRole
        ? asset.coolingDeviceRole === 'pump' ? coolingPumpRunning : coolingValveOpen
        : undefined}
      data-monitor-drill-down={drillDownTarget?.diagramId}
      data-monitor-detail={showsDevicePanel || undefined}
      transform={generic ? undefined : `rotate(${element.rotation} ${centerX} ${centerY})`}
    >
      {drillDownTarget || deviceState?.health === 'offline' ? (
        <title>{[
          deviceState?.health === 'offline' ? '设备离线' : '',
          drillDownTarget ? `点击下探到${drillDownTarget.diagramName}` : '',
        ].filter(Boolean).join('；')}</title>
      ) : null}
      <DiagramElementVisual
        element={element}
        symbol={symbol}
        symbolColor={symbolColor}
        genericBackgroundColor={genericBackgroundColor}
        visualState={visualState}
        coolingPumpStopped={coolingPumpStopped}
        fault={deviceState?.health === 'minor' || deviceState?.health === 'major' || deviceState?.health === 'critical'}
        showCoolingPumpState={asset?.coolingDeviceRole === 'pump'}
        colorFilterId={symbolColor
          ? symbolColorFilterId(symbolColor, filterScope)
          : undefined}
        clipPathId={clipPathId}
        onPointerDown={handlePointerDown}
      />
      {selected ? (
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
}

export const DiagramMonitorCanvas = memo(forwardRef<
  DiagramMonitorCanvasHandle,
  DiagramMonitorCanvasProps
>(function DiagramMonitorCanvas({
  view,
  runtime,
  animationMode = view.lineSystem.type === 'power' ? 'dots' : 'wave',
  animationPlaying,
  documentEpoch = 0,
  viewport = view.diagram.canvas.viewport,
  onSelectionChange,
  onElementDrillDown,
  onViewportChange,
  onRuntimePresentationChange,
}, ref) {
  const { diagram, lineSystem, assets, elements, busbars, connections, routeWaypoints } = view
  const filterScope = `runtime-${useId().replace(/:/g, '')}`
  const viewportElementRef = useRef<HTMLDivElement>(null)
  const canvasStageRef = useRef<HTMLDivElement>(null)
  const viewportWorldRef = useRef<SVGGElement>(null)
  const labelWorldRef = useRef<SVGGElement>(null)
  const gridFallbackRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef(viewport)
  const gridInvalidateRef = useRef<(() => void) | null>(null)
  const flowInvalidateRef = useRef<(() => void) | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const pendingPanRef = useRef<DiagramViewport | null>(null)
  const lastReactViewportRef = useRef(viewport)
  const autoFitScopeRef = useRef<string | null>(null)
  const wheelGestureRef = useRef<{
    kind: WheelGestureKind | null
    panTarget: DiagramViewport | null
  }>({ kind: null, panTarget: null })
  const wheelEndTimerRef = useRef<number | null>(null)
  const spaceHeldRef = useRef(false)
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange
  const panInteractionRef = useRef<{
    pointerId: number
    trigger: 'middle' | 'space-left'
    startClient: Point
    startViewport: DiagramViewport
  } | null>(null)
  const [viewportValue, setViewportValue] = useState(viewport)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [metricPanelSelection, setMetricPanelSelection] = useState<MonitorMetricPanelSelection | null>(null)
  const previousDiagramIdRef = useRef(diagram.id)
  const canvasSize = useElementSize(viewportElementRef)
  const gridScale = getAdaptiveGridScale(diagram.canvas.gridSize, viewportValue.zoom)
  const gridRenderStateRef = useRef<GridRenderState>({
    viewport: viewportValue,
    worldStep: gridScale.worldStep,
  })

  const syncViewportPresentation = (nextViewport: DiagramViewport) => {
    const nextGridScale = getAdaptiveGridScale(diagram.canvas.gridSize, nextViewport.zoom)
    for (const world of [viewportWorldRef.current, labelWorldRef.current]) {
      if (!world) continue
      world.setAttribute(
        'transform',
        `translate(${nextViewport.tx} ${nextViewport.ty}) scale(${nextViewport.zoom})`,
      )
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

  const commitViewport = (nextViewport: DiagramViewport) => {
    viewportRef.current = nextViewport
    lastReactViewportRef.current = nextViewport
    syncViewportPresentation(nextViewport)
    setViewportValue(nextViewport)
    onViewportChangeRef.current?.(nextViewport)
  }

  const applyPanFrame = (nextViewport: DiagramViewport) => {
    pendingPanRef.current = null
    viewportRef.current = nextViewport
    syncViewportPresentation(nextViewport)
    const last = lastReactViewportRef.current
    if (Math.max(
      Math.abs(nextViewport.tx - last.tx),
      Math.abs(nextViewport.ty - last.ty),
    ) < PAN_CULLING_SYNC_SCREEN_DISTANCE) return
    lastReactViewportRef.current = nextViewport
    setViewportValue(nextViewport)
  }

  const schedulePan = (nextViewport: DiagramViewport) => {
    pendingPanRef.current = nextViewport
    if (panFrameRef.current !== null) return
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null
      const pending = pendingPanRef.current
      if (pending) applyPanFrame(pending)
    })
  }

  const flushPan = () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
    panFrameRef.current = null
    const pending = pendingPanRef.current
    if (pending) applyPanFrame(pending)
    pendingPanRef.current = null
    commitViewport(viewportRef.current)
  }

  useLayoutEffect(() => {
    syncViewportPresentation(viewportRef.current)
  }, [diagram.canvas.gridSize, gridScale.worldStep, viewportValue])

  useEffect(() => {
    viewportRef.current = viewport
    lastReactViewportRef.current = viewport
    setViewportValue(viewport)
  }, [viewport])

  useEffect(() => {
    if (previousDiagramIdRef.current === diagram.id) return
    previousDiagramIdRef.current = diagram.id
    setSelectedElementId(null)
    setMetricPanelSelection(null)
    onSelectionChange?.([])
  }, [diagram.id, onSelectionChange])

  const contentBounds = useMemo(
    () => diagramContentBounds(elements, busbars, connections),
    [busbars, connections, elements],
  )

  const zoomBy = (factor: number) => {
    const current = viewportRef.current
    const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
    commitViewport(zoomAroundPoint(
      current,
      center,
      clampZoom(current.zoom * factor, Math.min(MIN_ZOOM, current.zoom)),
      Math.min(MIN_ZOOM, current.zoom),
    ))
  }
  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(1.2),
    zoomOut: () => zoomBy(1 / 1.2),
    zoomReset: () => {
      const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
      commitViewport(zoomAroundPoint(viewportRef.current, center, 1))
    },
  }))

  useEffect(() => {
    const element = viewportElementRef.current
    if (!element) return
    const clientPoint = (event: WheelEvent) => {
      const rect = element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const finishWheel = () => {
      if (wheelGestureRef.current.kind === 'trackpad-pan') flushPan()
      wheelGestureRef.current = { kind: null, panTarget: null }
      wheelEndTimerRef.current = null
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.deltaX === 0 && event.deltaY === 0) return
      const legacy = event as WheelEvent & { wheelDelta?: number; wheelDeltaY?: number }
      const inferred = inferWheelGestureKind({
        ctrlKey: event.ctrlKey,
        deltaMode: event.deltaMode,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        devicePixelRatio: globalThis.devicePixelRatio,
        wheelDelta: legacy.wheelDelta,
        wheelDeltaY: legacy.wheelDeltaY,
      })
      const gesture = wheelGestureRef.current
      const changesPinch = gesture.kind !== null &&
        (gesture.kind === 'pinch-zoom') !== (inferred === 'pinch-zoom')
      if (changesPinch) finishWheel()
      if (!gesture.kind) gesture.kind = inferred
      if (wheelEndTimerRef.current !== null) window.clearTimeout(wheelEndTimerRef.current)
      wheelEndTimerRef.current = window.setTimeout(finishWheel, WHEEL_GESTURE_END_DELAY_MS)
      if (gesture.kind === 'trackpad-pan') {
        const base = gesture.panTarget ?? viewportRef.current
        const next = { ...base, tx: base.tx - event.deltaX, ty: base.ty - event.deltaY }
        gesture.panTarget = next
        schedulePan(next)
        return
      }
      const current = viewportRef.current
      const factor = gesture.kind === 'pinch-zoom'
        ? pinchZoomFactor(event.deltaY)
        : event.deltaY < 0 ? 1.12 : 1 / 1.12
      const minimumZoom = Math.min(MIN_ZOOM, current.zoom)
      commitViewport(zoomAroundPoint(
        current,
        clientPoint(event),
        clampZoom(current.zoom * factor, minimumZoom),
        minimumZoom,
      ))
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', handleWheel)
      if (wheelEndTimerRef.current !== null) window.clearTimeout(wheelEndTimerRef.current)
    }
  }, [canvasSize.height, canvasSize.width])

  useEffect(() => {
    const element = viewportElementRef.current
    const ownsCanvasContext = () => {
      const active = document.activeElement
      return Boolean(element && (
        element.matches(':hover') || active === element ||
        (active instanceof Node && element.contains(active))
      ))
    }
    const setReady = (ready: boolean) => {
      spaceHeldRef.current = ready
      if (!element) return
      if (ready) element.dataset.panReady = 'true'
      else delete element.dataset.panReady
    }
    const down = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey ||
        !ownsCanvasContext()
      ) return
      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable || target.matches('input, textarea, select')
      )) return
      event.preventDefault()
      if (!event.repeat) setReady(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceHeldRef.current) return
      event.preventDefault()
      setReady(false)
      const interaction = panInteractionRef.current
      if (interaction?.trigger === 'space-left') {
        flushPan()
        panInteractionRef.current = null
        delete element?.dataset.panning
        if (
          typeof element?.hasPointerCapture === 'function' &&
          element.hasPointerCapture(interaction.pointerId) &&
          typeof element.releasePointerCapture === 'function'
        ) {
          element.releasePointerCapture(interaction.pointerId)
        }
      }
    }
    const blur = () => {
      setReady(false)
      const interaction = panInteractionRef.current
      if (interaction?.trigger !== 'space-left') return
      flushPan()
      panInteractionRef.current = null
      delete element?.dataset.panning
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
    if (wheelEndTimerRef.current !== null) window.clearTimeout(wheelEndTimerRef.current)
  }, [])

  const handlePointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    const trigger = event.button === 1
      ? 'middle' as const
      : event.button === 0 && spaceHeldRef.current
        ? 'space-left' as const
        : null
    if (trigger) {
      event.preventDefault()
      event.stopPropagation()
      panInteractionRef.current = {
        pointerId: event.pointerId,
        trigger,
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: viewportRef.current,
      }
      event.currentTarget.dataset.panning = 'true'
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }
  }
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || spaceHeldRef.current) return
    setMetricPanelSelection(null)
    setSelectedElementId(null)
    onSelectionChange?.([])
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const interaction = panInteractionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    schedulePan({
      ...interaction.startViewport,
      tx: interaction.startViewport.tx + event.clientX - interaction.startClient.x,
      ty: interaction.startViewport.ty + event.clientY - interaction.startClient.y,
    })
  }
  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    const interaction = panInteractionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    flushPan()
    panInteractionRef.current = null
    delete event.currentTarget.dataset.panning
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId) &&
      typeof event.currentTarget.releasePointerCapture === 'function'
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const cancelPointer = (event: PointerEvent<HTMLDivElement>) => {
    const interaction = panInteractionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current)
    panFrameRef.current = null
    pendingPanRef.current = null
    commitViewport(interaction.startViewport)
    panInteractionRef.current = null
    delete event.currentTarget.dataset.panning
  }

  const routeInput = useMemo(() => ({
    scopeKey: `${documentEpoch}:${diagram.id}`,
    networks: connections,
    elements,
    assets,
    gridSize: diagram.canvas.gridSize,
    busbars,
    routeWaypoints,
  }), [
    assets,
    busbars,
    connections,
    diagram.canvas.gridSize,
    diagram.id,
    documentEpoch,
    elements,
    routeWaypoints,
  ])
  const { routed, isRouting, routeStats } = useRoutedConnections(routeInput)
  const renderWorldRect = useMemo(() => {
    const overscan = RENDER_OVERSCAN_SCREEN_PX / viewportValue.zoom
    return {
      x: -viewportValue.tx / viewportValue.zoom - overscan,
      y: -viewportValue.ty / viewportValue.zoom - overscan,
      width: canvasSize.width / viewportValue.zoom + overscan * 2,
      height: canvasSize.height / viewportValue.zoom + overscan * 2,
    }
  }, [canvasSize, viewportValue])
  const cullingEnabled = autoFitScopeRef.current === `${documentEpoch}:${diagram.id}` && elements.length + busbars.length + routed.edges.length >
    RENDER_CULLING_OBJECT_THRESHOLD
  const visibleElements = useMemo(() => cullingEnabled
    ? elements.filter((element) => {
        if (element.id === selectedElementId) return true
        const bounds = elementsBounds([element])
        return bounds ? rectsIntersect(bounds, renderWorldRect) : false
      })
    : elements, [cullingEnabled, elements, renderWorldRect, selectedElementId])
  const visibleBusbars = useMemo(() => cullingEnabled
    ? busbars.filter((busbar) => (
        segmentIntersectsViewport(busbar, busbarEndPoint(busbar), renderWorldRect)
      ))
    : busbars, [busbars, cullingEnabled, renderWorldRect])
  const visibleRoutes = useMemo(() => cullingEnabled
    ? routed.edges.filter((route) => polylineIntersectsViewport(route.points, renderWorldRect))
    : routed.edges, [cullingEnabled, renderWorldRect, routed.edges])
  const edgesById = useMemo(() => circuitDisplayEdges(connections, elements, new Map(assets.map((asset) => [asset.key, asset])), view.circuitPalette), [connections, elements, assets, view.circuitPalette])
  const networksById = useMemo(
    () => new Map(connections.map((network) => [network.id, network])),
    [connections],
  )
  const busbarsById = useMemo(
    () => new Map(busbars.map((busbar) => [busbar.id, busbar])),
    [busbars],
  )
  const assetsByKey = useMemo(
    () => new Map(assets.map((asset) => [asset.key, asset])),
    [assets],
  )
  const routeGroups = useMemo(
    () => createConnectionRouteRenderGroups(visibleRoutes, edgesById),
    [edgesById, visibleRoutes],
  )
  const crossingsByEdgeId = useMemo(
    () => indexConnectionCrossings(routed.crossings),
    [routed.crossings],
  )
  const branchPointKeysByNetworkId = useMemo(
    () => connectionRouteBranchPointKeys(routed.edges),
    [routed.edges],
  )
  const coolingNodeIdsByNetwork = useMemo(
    () => createCoolingNodeIdsByNetwork(connections),
    [connections],
  )
  const coolingGeometryByEdgeId = useMemo(() => connectedRouteEndpointGeometry(
    visibleRoutes.filter((route) => isCoolingConnectionType(route.type)),
    coolingNodeIdsByNetwork,
    crossingsByEdgeId,
    COOLING_PIPE_CORNER_RADIUS,
    branchPointKeysByNetworkId,
  ), [branchPointKeysByNetworkId, coolingNodeIdsByNetwork, crossingsByEdgeId, visibleRoutes])
  const renderedPaths = useMemo(() => createRenderedConnectionPaths(
    visibleRoutes,
    routed.edges,
    coolingGeometryByEdgeId,
    crossingsByEdgeId,
    branchPointKeysByNetworkId,
    diagram.canvas.gridSize,
  ), [
    branchPointKeysByNetworkId,
    coolingGeometryByEdgeId,
    crossingsByEdgeId,
    diagram.canvas.gridSize,
    routed.edges,
    visibleRoutes,
  ])
  const pipeShellsByRenderKey = useMemo(() => createCoolingPipeShellsByRenderKey(
    routeGroups,
    routed.edges,
    networksById,
    coolingGeometryByEdgeId,
    crossingsByEdgeId,
    branchPointKeysByNetworkId,
    diagram.canvas.gridSize,
  ), [
    branchPointKeysByNetworkId,
    coolingGeometryByEdgeId,
    crossingsByEdgeId,
    diagram.canvas.gridSize,
    networksById,
    routeGroups,
    routed.edges,
  ])
  const pipeFilterIds = useMemo(() => createCoolingPipeFilterIds(
    routeGroups,
    (index) => `${filterScope}-cooling-pipe-${index}`,
  ), [filterScope, routeGroups])
  const underpassExclusions = useMemo(() => createUnderpassAnimationExclusions(
    routed.edges,
    routed.crossings,
    diagram.canvas.gridSize,
  ), [diagram.canvas.gridSize, routed.crossings, routed.edges])
  const {
    powerFlowTopology,
    coolingFlowTopology,
    metricReadings,
    metricElements,
    metricConnections,
    metricDeviceStates,
    metricTimestamp,
    effectiveRuntimeState,
  } = useDiagramMonitorRuntime({
    enabled: true,
    lineSystemType: lineSystem.type,
    elements,
    busbars,
    connections,
    assets,
    resolvedBusbarTapOffsets: routed.resolvedBusbarTapOffsets,
    runtime,
    animationPlaying,
  })
  useEffect(() => {
    onRuntimePresentationChange?.({
      timestamp: metricTimestamp,
      readings: metricReadings,
      elements: metricElements,
      deviceStates: metricDeviceStates,
      coolingPumpFlowRates: coolingFlowTopology.pumpFlowRates,
    })
  }, [
    coolingFlowTopology.pumpFlowRates,
    metricDeviceStates,
    metricElements,
    metricReadings,
    metricTimestamp,
    onRuntimePresentationChange,
  ])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMetricPanelSelection(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const effectiveRuntime = useMemo(() => ({
    ...runtime,
    state: effectiveRuntimeState,
  }), [effectiveRuntimeState, runtime])
  const metricElementsById = useMemo(
    () => new Map(metricElements.map((element) => [element.id, element])),
    [metricElements],
  )
  const visibleMetricElements = useMemo(() => visibleElements.map((element) => (
    metricElementsById.get(element.id) ?? element
  )), [metricElementsById, visibleElements])
  const displayedRoutePaths = useMemo(() => createDisplayedRoutePaths(
    visibleRoutes,
    edgesById,
    coolingGeometryByEdgeId,
    crossingsByEdgeId,
    branchPointKeysByNetworkId,
    diagram.canvas.gridSize,
  ), [
    branchPointKeysByNetworkId,
    coolingGeometryByEdgeId,
    crossingsByEdgeId,
    diagram.canvas.gridSize,
    edgesById,
    visibleRoutes,
  ])
  const displayedFlowPaths = useMemo<MonitorFlowPath[]>(() => {
    const routes = [...displayedRoutePaths.values()].map(({ path }) => path)
    return lineSystem.type === 'power'
      ? [
          ...routes,
          ...visibleBusbars.map((busbar) => ({
            id: `busbar-display:${busbar.id}`,
            points: [busbar, busbarEndPoint(busbar)],
            screenWidth: FLOW_BUSBAR_SCREEN_WIDTH,
            style: 'power' as const,
            baseColor: circuitBusbarColor(busbar, connections, elements, new Map(assets.map((asset) => [asset.key, asset])), view.circuitPalette) ?? DEFAULT_BUSBAR_COLOR,
            renderPriority: -1,
          })),
        ]
      : routes
  }, [displayedRoutePaths, lineSystem.type, visibleBusbars, connections, elements, assets, view.circuitPalette])
  const activeFlowPaths = useMemo<MonitorFlowPath[]>(() => {
    const displayColors = new Map(displayedFlowPaths.map((path) => [path.id, path.baseColor]))
    const activeFlowEdges = lineSystem.type === 'cooling'
      ? coolingFlowTopology.edges
      : powerFlowTopology.edges
    const flowSegmentsByEdgeId = new Map<string, typeof activeFlowEdges>()
    activeFlowEdges.forEach((flow) => {
      const segments = flowSegmentsByEdgeId.get(flow.edgeId) ?? []
      segments.push(flow)
      flowSegmentsByEdgeId.set(flow.edgeId, segments)
    })
    const topologyByEdgeId = new Map(connections.flatMap((network) => {
      const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
      return network.edges.map((edge) => [edge.id, { edge, nodesById }] as const)
    }))
    const edgePaths = visibleRoutes.flatMap((route) => {
      const flowSegments = flowSegmentsByEdgeId.get(route.edgeId)
      if (!flowSegments?.length) return []
      const cooling = isCoolingConnectionType(route.type)
      const displayedPath = displayedRoutePaths.get(route.edgeId)?.path
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
          const start = pointForNode(flow.startNodeId, startIndex)
          const end = pointForNode(flow.endNodeId, endIndex)
          if (!start || !end) return []
          flowPoints = slicePolylineBetween(points, start, end)
        }
        if (flow.direction === 'reverse') flowPoints = [...flowPoints].reverse()
        return splitFlowPathAroundCrossings(
          flowPoints,
          underpassExclusions.get(route.edgeId) ?? [],
        ).map((fragment, fragmentIndex) => ({
          id: `edge-flow:${route.edgeId}:${flow.startNodeId ?? 'all'}:${index}:${fragmentIndex}`,
          connectionEdgeId: route.edgeId,
          points: fragment,
            phasePath: {
              id: `${route.edgeId}:${flow.startNodeId ?? 'all'}:${index}`,
              networkId: route.networkId,
              startNodeId: flow.direction === 'reverse'
                ? flow.endNodeId ?? route.targetNodeId
                : flow.startNodeId ?? route.sourceNodeId,
              endNodeId: flow.direction === 'reverse'
                ? flow.startNodeId ?? route.sourceNodeId
                : flow.endNodeId ?? route.targetNodeId,
              points: flowPoints,
            },
          worldWidth: displayedPath?.worldWidth,
          powerLineWidth: displayedPath?.powerLineWidth,
          speedMultiplier: flow.speedMultiplier,
          style: cooling ? 'cooling' as const : 'power' as const,
          animated: true,
          baseColor: displayedPath?.baseColor,
          renderPriority: displayedPath?.renderPriority,
        }))
      })
    })
    const busbarPaths = powerFlowTopology.busbarSegments.flatMap((segment) => {
      if (cullingEnabled && !segmentIntersectsViewport(segment.start, segment.end, renderWorldRect)) {
        return []
      }
      const lowerX = Math.min(segment.start.x, segment.end.x)
      const upperX = Math.max(segment.start.x, segment.end.x)
      const lowerY = Math.min(segment.start.y, segment.end.y)
      const upperY = Math.max(segment.start.y, segment.end.y)
      const exclusions = underpassExclusions.get(`busbar:${segment.busbarId}`)?.filter(({ point }) => (
        point.x >= lowerX && point.x <= upperX && point.y >= lowerY && point.y <= upperY
      )) ?? []
      return splitFlowPathAroundCrossings(
        [segment.start, segment.end],
        exclusions,
      ).map((fragment, fragmentIndex) => ({
        id: `${segment.id}:${fragmentIndex}`,
            phasePath: {
              id: segment.id,
              networkId: `busbar:${segment.busbarId}`,
              startNodeId: `${segment.start.x}:${segment.start.y}`,
              endNodeId: `${segment.end.x}:${segment.end.y}`,
              points: [segment.start, segment.end],
            },
        points: fragment,
        screenWidth: FLOW_BUSBAR_SCREEN_WIDTH,
        style: 'power' as const,
        animated: true,
        baseColor: displayColors.get(`busbar-display:${segment.busbarId}`) ?? DEFAULT_BUSBAR_COLOR,
        renderPriority: -1,
      }))
    })
    return [...edgePaths, ...busbarPaths]
  }, [
    displayedFlowPaths,
    connections,
    coolingFlowTopology.edges,
    cullingEnabled,
    displayedRoutePaths,
    lineSystem.type,
    powerFlowTopology.busbarSegments,
    powerFlowTopology.edges,
    renderWorldRect,
    underpassExclusions,
    visibleRoutes,
  ])
  const inactiveFlowPaths = useMemo(
    () => deriveInactiveFlowPaths(displayedFlowPaths, activeFlowPaths),
    [activeFlowPaths, displayedFlowPaths],
  )
  const staticFlowGroups = useMemo(
    () => buildMonitorStaticFlowLineGroups(activeFlowPaths, inactiveFlowPaths, animationMode),
    [activeFlowPaths, inactiveFlowPaths, animationMode],
  )
  const staticConnectionsByRenderKey = useMemo(
    () => createStaticConnectionGroupsByRenderKey(
      routeGroups,
      activeFlowPaths,
      inactiveFlowPaths,
      animationMode,
    ),
    [activeFlowPaths, inactiveFlowPaths, routeGroups, animationMode],
  )
  // One stable network represents the suspected area, not an exact leak location.
  const leakRegion = useMemo(() => demoLeakRegion(diagram.name, connections, elements), [diagram.name, connections, elements])
  const suspectedLeakNetworkId = leakRegion?.networkId
  const leakLabelElements = useMemo(() => visibleMetricElements.map((element) => (
    leakRegion?.sensorIds.includes(element.id) ? {
      ...element,
      monitorDataVisible: true,
      monitorMetrics: [
        ...(element.monitorDataVisible === false ? [] : element.monitorMetrics ?? []),
        { id: '__demo-suspected-leak', name: '管路状态', valueType: 'text' as const,
          textOptions: [{ id: 'leak', value: '疑似漏液', severity: 'critical' as const }] },
      ],
    } : element
  )), [leakRegion, visibleMetricElements])
  const leakLabelReadings = useMemo(() => ({
    ...metricReadings,
    ...Object.fromEntries((leakRegion?.sensorIds ?? []).map((id) => [
      monitorMetricReadingKey(id, '__demo-suspected-leak'),
      { elementId: id, metricId: '__demo-suspected-leak', value: '疑似漏液', severity: 'critical' as const },
    ])),
  }), [leakRegion, metricReadings])
  const connectedAnchors = useMemo(
    () => createConnectedAnchorIdsByElement(connections),
    [connections],
  )
  const elementLabels = useMemo(() => layoutElementLabels(leakLabelElements.map((element) => (
    element.assetKey === 'switch' ? {
      ...element,
      monitorMetrics: element.monitorMetrics?.filter((metric) => {
        if (metric.valueType !== 'text') return true
        const reading = metricReadings[monitorMetricReadingKey(element.id, metric.id)]
        // The symbol already conveys switching state; retain faults and other readings.
        return !reading || reading.severity !== 'normal' ||
          !/^(开启|关闭|开|关|闭合|断开|合闸|分闸|on|off|open|closed)$/i.test(String(reading.value).trim())
      }),
    } : element
  )), assetsByKey, {
    connectedAnchorIdsByElement: connectedAnchors,
    scale: view.elementLabelScale,
    readings: leakLabelReadings,
  }), [assetsByKey, connectedAnchors, metricReadings, leakLabelElements, leakLabelReadings, view.elementLabelScale])
  const busbarLabels = useMemo(() => layoutBusbarLabels(visibleBusbars, metricReadings), [visibleBusbars, metricReadings])
  const connectionLabels = useMemo(() => layoutConnectionLabels(
    visibleRoutes,
    metricConnections,
    null,
    { readings: metricReadings },
  ), [metricConnections, metricReadings, visibleRoutes])
  const metricPointerDownRef = useRef<MetricPointerDownRef['current']>(() => undefined)
  useEffect(() => {
    if (canvasSize.width <= 1 || canvasSize.height <= 1 || isRouting) return
    const scope = `${documentEpoch}:${diagram.id}`
    if (autoFitScopeRef.current === scope) return
    autoFitScopeRef.current = scope
    const bounds = completeSceneBounds(contentBounds, routed.edges, [...elementLabels, ...busbarLabels, ...connectionLabels])
    commitViewport(fitSceneViewport(bounds, canvasSize, viewportElementRef.current))
  }, [canvasSize, contentBounds, diagram.id, documentEpoch, isRouting, routed.edges, elementLabels, busbarLabels, connectionLabels])
  metricPointerDownRef.current = (event, ownerId, metricId) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const stageRect = canvasStageRef.current?.getBoundingClientRect()
    setMetricPanelSelection({
      ownerId,
      metricId,
      viewport: { ...viewportRef.current },
      stageOrigin: { x: stageRect?.left ?? 0, y: stageRect?.top ?? 0 },
      anchor: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    })
  }
  const metricPanelAnchor = metricPanelSelection ? (() => {
    const { anchor, viewport: initial, stageOrigin } = metricPanelSelection
    const stage = canvasStageRef.current?.getBoundingClientRect()
    const scale = viewportValue.zoom / initial.zoom
    const left = (stage?.left ?? stageOrigin.x) + viewportValue.tx +
      (anchor.left - stageOrigin.x - initial.tx) * scale
    const top = (stage?.top ?? stageOrigin.y) + viewportValue.ty +
      (anchor.top - stageOrigin.y - initial.ty) * scale
    const width = anchor.width * scale
    const height = anchor.height * scale
    return { left, top, width, height, right: left + width, bottom: top + height }
  })() : null
  const metricPanelOwner = metricPanelSelection
    ? metricElements.find((element) => element.id === metricPanelSelection.ownerId) ??
      busbars.find(busbar => busbar.id === metricPanelSelection.ownerId) ??
      metricConnections.flatMap((network) => network.edges).find((edge) => (
        edge.id === metricPanelSelection.ownerId
      ))
    : undefined
  const metricPanelMetric = metricPanelSelection
    ? metricPanelOwner?.monitorMetrics?.find((metric) => metric.id === metricPanelSelection.metricId)
    : undefined
  const metricPanelOwnerName = metricPanelOwner
    ? 'assetKey' in metricPanelOwner
      ? elementDeviceIdentifier(metricPanelOwner)
      : metricPanelOwner.label?.trim() || '线路数据'
    : ''
  const visibleSymbolColors = useMemo(() => [...new Set(visibleElements.flatMap((element) => {
    const symbol = symbolsByKey.get(element.assetKey)
    if (!symbol?.configurableColor) return []
    const state: SymbolVisualState = elementSupportsOnOffState(element) &&
      resolvedElementOnOffState(element, effectiveRuntime.state.onOffStates[element.id])
      ? 'on'
      : 'off'
    return [resolvedSymbolColor(element, state)]
  }))], [effectiveRuntime.state.onOffStates, visibleElements])
  const fallbackGridStyle = {
    '--grid-origin-x': `${viewportValue.tx}px`,
    '--grid-origin-y': `${viewportValue.ty}px`,
    '--grid-screen-step': `${gridScale.screenStep}px`,
    '--grid-dot-radius': `${gridScale.dotScreenRadius}px`,
  } as CSSProperties

  return (
    <div
      ref={canvasStageRef}
      className="canvas-stage"
      style={{ ...CANVAS_STAGE_STYLE, ...circuitPaletteStyle(view.circuitPalette) }}
      data-testid="diagram-monitor-canvas"
      data-grid-presentation={GRID_PRESENTATION}
      data-grid-size={diagram.canvas.gridSize}
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
      data-render-culling={cullingEnabled || undefined}
      data-rendered-elements={visibleElements.length}
      data-rendered-busbars={visibleBusbars.length}
      data-rendered-routes={visibleRoutes.length}
      data-animation-mode={animationMode}
      data-monitor-flow-path-count={animationPlaying ? activeFlowPaths.length : 0}
      data-mode="monitor"
      data-runtime-scene="readonly"
    >
      <div
        ref={viewportElementRef}
        className="diagram-viewport"
        tabIndex={0}
        aria-label="一次接线图监控画布"
        onAuxClick={(event) => { if (event.button === 1) event.preventDefault() }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
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
        <svg className="editor-overlay" data-testid="runtime-monitor-overlay">
          <defs>
            {routeGroups.flatMap((group) => {
              const id = pipeFilterIds.get(group.renderKey)
              const shell = pipeShellsByRenderKey.get(group.renderKey)
              return id && shell ? [(
                <CoolingPipeOutlineFilter
                  key={id}
                  id={id}
                  points={shell.points}
                  role={group.coolingLineRole}
                  suspectedLeak={group.routes.some((route) => route.networkId === suspectedLeakNetworkId)}
                />
              )] : []
            })}
            {visibleSymbolColors.map((color) => (
              <SymbolColorFilter
                key={color}
                id={symbolColorFilterId(color, filterScope)}
                color={color}
              />
            ))}
          </defs>
          <g
            ref={viewportWorldRef}
            className="viewport-world"
            transform={`translate(${viewportValue.tx} ${viewportValue.ty}) scale(${viewportValue.zoom})`}
          >
            <g className="busbar-layer" data-testid="busbar-layer">
              {visibleBusbars.map((busbar) => {
                return (
                  <BusbarVisual
                    key={busbar.id}
                    busbar={{ ...busbar, color: circuitBusbarColor(busbar, connections, elements, assetsByKey, view.circuitPalette) }}
                  />
                )
              })}
            </g>
            <g
              className="monitor-static-flow-layer"
              data-testid="monitor-static-busbar-layer"
              aria-hidden="true"
            >
              <MonitorStaticFlowLines groups={staticFlowGroups.filter(
                (group) => group.kind === 'busbar',
              )} />
            </g>
            <g className="connection-layer" data-testid="connection-layer">
              {routeGroups.map((group) => {
                const shell = pipeShellsByRenderKey.get(group.renderKey)
                const filterId = pipeFilterIds.get(group.renderKey)
                return (
                  <g
                    key={group.renderKey}
                    className="connection-network"
                    data-network-id={group.networkId}
                    data-connection-type={group.type}
                    data-cooling-line-role={group.coolingLineRole}
                  >
                    {group.routes.flatMap((route) => {
                      const casing = renderedPaths.get(route.edgeId)?.bridgeCasingPath
                      return casing ? [(
                        <ConnectionBridgeCasing
                          key={`runtime-bridge:${route.edgeId}`}
                          path={casing}
                          type={route.type}
                          coolingLineRole={group.coolingLineRole}
                        />
                      )] : []
                    })}
                    {shell && filterId ? (
                      <CoolingPipeShell
                        color={group.color}
                        path={shell.path}
                        type={group.type}
                        coolingLineRole={group.coolingLineRole ?? 'primary'}
                        filterId={filterId}
                      />
                    ) : null}
                    <MonitorStaticFlowLines groups={
                      staticConnectionsByRenderKey.get(group.renderKey) ?? []
                    } />
                    {group.routes.map((route) => {
                      const edge = edgesById.get(route.edgeId)
                      if (!edge?.flowDirection) return null
                      return (
                        <g
                          key={`runtime-arrow:${route.edgeId}`}
                          className="connection-edge"
                          data-connection-type={route.type}
                          data-cooling-line-role={edge.coolingLineRole}
                          style={edge.color
                            ? { '--connection-color': edge.color } as CSSProperties
                            : undefined}
                        >
                          <ConnectionDirectionArrow
                            path={connectionTerminalArrowPath(
                              route.points,
                              edge.flowDirection,
                              viewportValue.zoom,
                              isCoolingConnectionType(route.type)
                                ? COOLING_DIRECTION_ARROW_INSET_SCREEN
                                : 0,
                            )}
                          />
                        </g>
                      )
                    })}
                  </g>
                )
              })}
              {connections.flatMap((network) => network.nodes.flatMap((node) => {
                if (node.kind !== 'busbar-tap') return []
                const busbar = busbarsById.get(node.busbarId)
                if (!busbar) return []
                const offset = routed.resolvedBusbarTapOffsets[node.id] ?? node.offset
                const point = busbarPoint(busbar, offset)
                if (cullingEnabled && !pointInsideRect(point, renderWorldRect)) return []
                return [(
                  <BusbarTapVisual
                    key={node.id}
                    nodeId={node.id}
                    busbarId={node.busbarId}
                    offset={offset}
                    point={point}
                    color={circuitBusbarColor(busbar, connections, elements, assetsByKey, view.circuitPalette)}
                    zoom={viewportValue.zoom}
                  />
                )]
              }))}
            </g>
            {visibleElements.map((element) => (
              <MonitorElement
                key={element.id}
                element={element}
                asset={assetsByKey.get(element.assetKey)}
                symbol={symbolsByKey.get(element.assetKey)}
                zoom={viewportValue.zoom}
                selected={selectedElementId === element.id}
                runtime={effectiveRuntime}
                deviceState={metricDeviceStates[element.id]}
                drillDownTarget={runtime.navigation[element.id]}
                onSelect={(elementId) => {
                  setSelectedElementId(elementId)
                  onSelectionChange?.([elementId])
                }}
                onDrillDown={(elementId) => onElementDrillDown?.(elementId)}
                filterScope={filterScope}
              />
            ))}
          </g>
        </svg>
        {activeFlowPaths.length > 0 ? (
          <FlowAnimationLayer
            paths={activeFlowPaths}
            animationMode={animationMode}
            playing={animationPlaying}
            viewportRef={viewportRef}
            invalidateRef={flowInvalidateRef}
          />
        ) : null}
          <svg className="editor-overlay label-overlay" data-testid="label-overlay">
            <g ref={labelWorldRef} className="viewport-world"
              transform={`translate(${viewportValue.tx} ${viewportValue.ty}) scale(${viewportValue.zoom})`}>
            <g className="element-label-layer" data-testid="element-label-layer">
              {elementLabels.map((layout) => (
                <ElementLabelItem
                  key={layout.elementId}
                  layout={layout}
                  metricPointerDownRef={metricPointerDownRef}
                />
              ))}
              {busbarLabels.map((layout) => (
                <BusbarLabelItem key={layout.busbarId} layout={layout} metricPointerDownRef={metricPointerDownRef} />
              ))}
              {connectionLabels.map((layout) => (
                <ConnectionLabelItem
                  key={layout.edgeId}
                  layout={layout}
                  metricPointerDownRef={metricPointerDownRef}
                />
              ))}
            </g>
            </g>
          </svg>
        {metricPanelSelection && metricPanelMetric && metricPanelAnchor ? (
          <MonitorMetricDataPanel
            ownerName={metricPanelOwnerName}
            metric={metricPanelMetric}
            reading={metricReadings[
              `${metricPanelSelection.ownerId}::${metricPanelSelection.metricId}`
            ]}
            anchor={metricPanelAnchor}
          />
        ) : null}
      </div>
    </div>
  )
}))
