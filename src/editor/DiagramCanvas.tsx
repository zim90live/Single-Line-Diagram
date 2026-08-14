import { Canvas } from '@react-three/fiber'
import {
  forwardRef,
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
  ConnectionNetwork,
  DiagramElement,
  DiagramViewport,
  LineSystemType,
} from '../domain/project'
import { BUSBAR_MIN_LENGTH } from '../domain/project'
import {
  compressBusbarTapOffsets,
  minimumBusbarLengthForConnections,
} from './busbars'
import {
  busbarEndPoint,
  busbarPoint,
  connectTerminals,
  connectionTypesCompatible,
  crossingPointKeys,
  deleteConnectionEdge,
  nearestPointOnBusbar,
  normalizeConnectionNetworks,
  occupiedAnchorKeys,
  pathData,
  pathDataWithBridges,
  previewConnectionRoutesForDiagram,
  resolveElementAnchor,
  routeConnectionNetworks,
  routeConnectionPreview,
  type ConnectionTerminal,
  type RoutedConnectionEdge,
} from './connections'
import { createLatestFrameScheduler } from './frameScheduler'
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
import { Rulers } from './Rulers'
import {
  getSymbolStateUrl,
  getScaledSymbolSize,
  normalizeSymbolColor,
  symbolsByKey,
  type SymbolDefinition,
} from './symbolCatalog'

export interface EditorCommandState {
  canUndo: boolean
  canRedo: boolean
  canCopy: boolean
  hasSelection: boolean
  zoom: number
  selectedConnection: boolean
  selectedBusbar: boolean
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
  paste: () => void
  duplicate: () => void
  deleteSelected: () => void
  selectAll: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  insertSymbol: (symbolKey: string) => void
  insertBusbar: () => void
  previewElementColor: (elementId: string, color: string | null) => void
  updateElement: (elementId: string, patch: Partial<DiagramElement>) => void
}

interface DiagramCanvasProps {
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
  onViewportChange: (viewport: DiagramViewport) => void
  onSelectionChange: (ids: string[]) => void
  onCommandStateChange: (state: EditorCommandState) => void
  onPointerChange: (position: PointerPosition | null) => void
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

function networkSelectionToken(networkId: string) {
  return `${NETWORK_SELECTION_PREFIX}${networkId}`
}

function selectedNetworkId(selection: string | null) {
  return selection?.startsWith(NETWORK_SELECTION_PREFIX)
    ? selection.slice(NETWORK_SELECTION_PREFIX.length)
    : null
}

function connectionSelectionExists(
  selection: string,
  networks: ConnectionNetwork[],
) {
  const networkId = selectedNetworkId(selection)
  return networkId
    ? networks.some((network) => network.id === networkId)
    : networks.some((network) => network.edges.some((edge) => edge.id === selection))
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
    properties: structuredClone(element.properties),
    extensions: structuredClone(element.extensions),
  }
}

function createElement(
  symbol: SymbolDefinition,
  diagramId: string,
  center: Point,
  gridSize: number,
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
    properties: {},
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
      busbar.orientation === candidate.orientation
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

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(
  function DiagramCanvas(
    {
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
      onViewportChange,
      onSelectionChange,
      onCommandStateChange,
      onPointerChange,
    },
    ref,
  ) {
    const viewportElementRef = useRef<HTMLDivElement>(null)
    const callbacksRef = useRef({
      onDiagramChange,
      onViewportChange,
      onSelectionChange,
      onCommandStateChange,
      onPointerChange,
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
    const clipboardRef = useRef<DiagramElement[]>([])
    const pasteCountRef = useRef(0)
    const interactionRef = useRef<Interaction | null>(null)
    const previewElementsRef = useRef<DiagramElement[] | null>(null)
    const previewBusbarsRef = useRef<Busbar[] | null>(null)
    const previewConnectionsRef = useRef<ConnectionNetwork[] | null>(null)
    const elementNodeRefs = useRef(new Map<string, SVGGElement>())
    const previewElementColorsRef = useRef(new Map<string, string>())
    const [viewportValue, setViewportValue] = useState(viewport)
    const [selectedIds, setSelectedIdsState] = useState<string[]>([])
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
    const [selectedBusbarIds, setSelectedBusbarIdsState] = useState<string[]>([])
    const [wiring, setWiringState] = useState<WiringState | null>(null)
    const [hoveredWiringTarget, setHoveredWiringTarget] = useState<ConnectionTerminal | null>(null)
    const [busbarCandidate, setBusbarCandidate] = useState<BusbarCandidate | null>(null)
    const [previewElements, setPreviewElements] = useState<DiagramElement[] | null>(null)
    const [previewBusbars, setPreviewBusbars] = useState<Busbar[] | null>(null)
    const [previewConnections, setPreviewConnections] = useState<ConnectionNetwork[] | null>(null)
    const [marquee, setMarquee] = useState<Rect | null>(null)
    const [activeMoveElementIds, setActiveMoveElementIds] = useState<string[]>([])
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
      onViewportChange,
      onSelectionChange,
      onCommandStateChange,
      onPointerChange,
    }

    const emitCommandState = () => {
      callbacksRef.current.onCommandStateChange({
        canUndo: historyRef.current.past.length > 0,
        canRedo: historyRef.current.future.length > 0,
        canCopy: selectedIdsRef.current.length > 0,
        hasSelection:
          selectedIdsRef.current.length > 0 ||
          selectedConnectionIdRef.current !== null ||
          selectedBusbarIdsRef.current.length > 0,
        zoom: viewportValueRef.current.zoom,
        selectedConnection: selectedConnectionIdRef.current !== null,
        selectedBusbar: selectedBusbarIdsRef.current.length > 0,
        wiringType: wiringRef.current?.source.type ?? null,
      })
    }

    const setObjectSelection = (elementIds: string[], busbarIds: string[]) => {
      const uniqueElementIds = [...new Set(elementIds)]
      const uniqueBusbarIds = [...new Set(busbarIds)]
      if (uniqueElementIds.length || uniqueBusbarIds.length) {
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

    const selectConnection = (edgeId: string | null) => {
      selectedConnectionIdRef.current = edgeId
      setSelectedConnectionId(edgeId)
      if (edgeId) {
        selectedIdsRef.current = []
        selectedBusbarIdsRef.current = []
        setSelectedIdsState([])
        setSelectedBusbarIdsState([])
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

    const commitDiagram = (
      nextElements: DiagramElement[],
      nextBusbars: Busbar[],
      nextConnections: ConnectionNetwork[],
    ) => {
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

    const applyViewport = (nextViewport: DiagramViewport, persist = true) => {
      viewportValueRef.current = nextViewport
      setViewportValue(nextViewport)
      if (persist) callbacksRef.current.onViewportChange(nextViewport)
      queueMicrotask(emitCommandState)
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
    const committedRoutedConnections = useMemo(() => routeConnectionNetworks(
      connections,
      elements,
      assets,
      gridSize,
      busbars,
    ), [assets, busbars, connections, elements, gridSize])
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
    const occupiedAnchors = useMemo(
      () => occupiedAnchorKeys(displayedConnections),
      [displayedConnections],
    )
    const forbiddenCrossings = useMemo(
      () => crossingPointKeys(routedConnections.crossings),
      [routedConnections.crossings],
    )
    const assetsByKey = useMemo(
      () => new Map(assets.map((asset) => [asset.key, asset])),
      [assets],
    )
    const wiringPreview = useMemo(() => wiring
      ? routeConnectionPreview(
          wiring.source,
          busbarCandidate?.point ?? wiring.pointer,
          displayedConnections,
          displayedElements,
          assets,
          gridSize,
          displayedBusbars,
          routedConnections,
          hoveredWiringTarget,
        )
      : null, [assets, busbarCandidate, displayedBusbars, displayedConnections, displayedElements, gridSize, hoveredWiringTarget, routedConnections, wiring])

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
      const routed = routeConnectionNetworks(
        next,
        committedElementsRef.current,
        assets,
        gridSize,
        committedBusbarsRef.current,
      )
      if (routed.invalidEdgeIds.length) return false
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
      selectConnection(sharedRouteCount > 1
        ? networkSelectionToken(route.networkId)
        : route.edgeId)
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
      if (event.button !== 0 || !busbarCandidate) return
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
      if (event.button !== 0) return
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
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const alreadySelected = selectedBusbarIdsRef.current.includes(busbar.id)
      if (additive && alreadySelected) {
        setObjectSelection(
          selectedIdsRef.current,
          selectedBusbarIdsRef.current.filter((id) => id !== busbar.id),
        )
        return
      }
      const nextElementSelection = additive || alreadySelected ? selectedIdsRef.current : []
      const nextBusbarSelection = additive
        ? [...selectedBusbarIdsRef.current, busbar.id]
        : alreadySelected
          ? selectedBusbarIdsRef.current
          : [busbar.id]
      setObjectSelection(nextElementSelection, nextBusbarSelection)
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
      if (selectedConnectionIdRef.current) {
        const networkId = selectedNetworkId(selectedConnectionIdRef.current)
        const nextConnections = networkId
          ? committedConnectionsRef.current.filter((network) => network.id !== networkId)
          : deleteConnectionEdge(
              committedConnectionsRef.current,
              selectedConnectionIdRef.current,
              committedElementsRef.current,
              assets,
              committedBusbarsRef.current,
            )
        if (commitConnections(nextConnections)) selectConnection(null)
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

    const copySelected = () => {
      const selected = new Set(selectedIdsRef.current)
      clipboardRef.current = committedElementsRef.current
        .filter((element) => selected.has(element.id))
        .map(cloneElement)
      pasteCountRef.current = 0
    }

    const paste = () => {
      if (!clipboardRef.current.length) return
      pasteCountRef.current += 1
      const offset = gridSize * 2 * pasteCountRef.current
      const pasted = clipboardRef.current.map((element) => ({
        ...cloneElement(element),
        id: crypto.randomUUID(),
        diagramId,
        x: snap(element.x + offset, gridSize),
        y: snap(element.y + offset, gridSize),
      }))
      if (commitElements([...committedElementsRef.current, ...pasted])) {
        setSelection(pasted.map((element) => element.id))
      }
    }

    const duplicateSelected = () => {
      const selected = new Set(selectedIdsRef.current)
      if (!selected.size) return
      const offset = gridSize * 2
      const duplicated = committedElementsRef.current.flatMap((element) => (
        selected.has(element.id)
          ? [{
              ...cloneElement(element),
              id: crypto.randomUUID(),
              x: snap(element.x + offset, gridSize),
              y: snap(element.y + offset, gridSize),
            }]
          : []
      ))
      if (commitElements([...committedElementsRef.current, ...duplicated])) {
        setSelection(duplicated.map((element) => element.id))
      }
    }

    const undo = () => {
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
      )
      if (
        selectedConnectionIdRef.current &&
        !connectionSelectionExists(selectedConnectionIdRef.current, previous.connections)
      ) selectConnection(null)
      emitCommandState()
    }

    const redo = () => {
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
      const element = createElement(symbol, diagramId, worldCenter, gridSize)
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
      elementNode?.querySelector('feFlood')?.setAttribute('flood-color', color)
      const image = elementNode?.querySelector<SVGImageElement>('.diagram-element__image')
      if (image) image.dataset.symbolColor = color
    }

    const previewElementColor = (elementId: string, color: string | null) => {
      if (color === null) {
        previewElementColorsRef.current.delete(elementId)
        const element = committedElementsRef.current.find((candidate) => candidate.id === elementId)
        paintElementColor(elementId, normalizeSymbolColor(element?.properties.color))
        return
      }
      const normalizedColor = normalizeSymbolColor(color)
      previewElementColorsRef.current.set(elementId, normalizedColor)
      paintElementColor(elementId, normalizedColor)
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
      commitElements(next)
    }

    useImperativeHandle(ref, () => ({
      undo,
      redo,
      copy: copySelected,
      paste,
      duplicate: duplicateSelected,
      deleteSelected,
      selectAll: () => setSelection(committedElementsRef.current.map((element) => element.id)),
      zoomIn: () => zoomBy(1.2),
      zoomOut: () => zoomBy(1 / 1.2),
      zoomReset: () => {
        const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
        applyViewport(zoomAroundPoint(viewportValueRef.current, center, 1))
      },
      insertSymbol,
      insertBusbar,
      previewElementColor,
      updateElement,
    }))

    useEffect(() => {
      if (!interactionRef.current) {
        committedElementsRef.current = elements
        committedBusbarsRef.current = busbars
        committedConnectionsRef.current = connections
      }
    }, [busbars, connections, elements])

    useEffect(() => {
      viewportValueRef.current = viewport
      setViewportValue(viewport)
    }, [viewport])

    useEffect(() => {
      committedElementsRef.current = elements
      committedBusbarsRef.current = busbars
      committedConnectionsRef.current = connections
      historyRef.current = { past: [], future: [] }
      clipboardRef.current = []
      pasteCountRef.current = 0
      previewElementColorsRef.current.clear()
      interactionRef.current = null
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
      setMarquee(null)
      setActiveMoveElementIds([])
      setLibraryDragTarget(null)
      selectConnection(null)
      selectBusbar(null)
      setWiring(null)
      setSelection([])
      emitCommandState()
    }, [diagramId, documentEpoch])

    useEffect(() => () => {
      diagramPreviewScheduler.cancel()
      wiringPointerScheduler.cancel()
      pointerPositionScheduler.cancel()
    }, [diagramPreviewScheduler, pointerPositionScheduler, wiringPointerScheduler])

    const startElementMove = (event: PointerEvent<SVGImageElement>, elementId: string) => {
      if (event.button !== 0) return
      event.stopPropagation()
      viewportElementRef.current?.focus()
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
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const point = worldPoint(event.clientX, event.clientY)
      interactionRef.current = {
        kind: 'rotate',
        pointerId: event.pointerId,
        center,
        startAngle: Math.atan2(point.y - center.y, point.x - center.x),
        baseElements: committedElementsRef.current,
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
          false,
        )
        return
      }

      if (interaction.kind === 'marquee') {
        interaction.currentWorld = world
        setMarquee(normalizedRect(interaction.startWorld, world))
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
        callbacksRef.current.onViewportChange(viewportValueRef.current)
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
      if (interaction.kind === 'pan') applyViewport(interaction.startViewport, false)
      delete event.currentTarget.dataset.panning
      interactionRef.current = null
      if (interaction.kind === 'move') setActiveMoveElementIds([])
      setPreview(null)
      setBusbarPreview(null)
      setConnectionPreview(null)
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
      if (!selected.size && !selectedBusbars.size) return
      commitDiagram(
        committedElementsRef.current.map((element) => selected.has(element.id)
          ? { ...element, x: snap(element.x + x, gridSize), y: snap(element.y + y, gridSize) }
          : element),
        committedBusbarsRef.current.map((busbar) => selectedBusbars.has(busbar.id)
          ? { ...busbar, x: snap(busbar.x + x, gridSize), y: snap(busbar.y + y, gridSize) }
          : busbar),
        committedConnectionsRef.current,
      )
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
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
      } else if (modifier && key === 'v') {
        event.preventDefault()
        paste()
      } else if (modifier && key === 'd') {
        event.preventDefault()
        duplicateSelected()
      } else if (modifier && key === 'a') {
        event.preventDefault()
        setSelection(committedElementsRef.current.map((element) => element.id))
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const distance = gridSize
        if (event.key === 'ArrowLeft') nudgeSelection(-distance, 0)
        if (event.key === 'ArrowRight') nudgeSelection(distance, 0)
        if (event.key === 'ArrowUp') nudgeSelection(0, -distance)
        if (event.key === 'ArrowDown') nudgeSelection(0, distance)
      }
    }

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setLibraryDragTarget(null)
      const symbolKey = event.dataTransfer.getData('application/x-aidc-symbol')
      if (symbolKey) insertSymbol(symbolKey, worldPoint(event.clientX, event.clientY))
      if (event.dataTransfer.getData(BUSBAR_DRAG_TYPE) && lineSystemType === 'power') {
        insertBusbar(worldPoint(event.clientX, event.clientY))
      }
    }

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
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
      >
        <Rulers viewport={viewportValue} width={canvasSize.width} height={canvasSize.height} gridSize={gridSize} />
        <div
          ref={viewportElementRef}
          className="diagram-viewport"
          tabIndex={0}
          aria-label="一次接线图编辑画布"
          onAuxClick={(event) => { if (event.button === 1) event.preventDefault() }}
          onContextMenu={(event) => {
            event.preventDefault()
            if (wiringRef.current) setWiring(null)
          }}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          onPointerCancel={cancelInteraction}
          onPointerDown={handlePointerDown}
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
            <g transform={`translate(${viewportValue.tx} ${viewportValue.ty}) scale(${viewportValue.zoom})`}>
              <g className="busbar-layer" data-testid="busbar-layer">
                {displayedBusbars.map((busbar) => {
                  const end = busbarEndPoint(busbar)
                  const data = `M ${busbar.x} ${busbar.y} L ${end.x} ${end.y}`
                  return (
                    <g
                      key={busbar.id}
                      className="busbar"
                      data-busbar-id={busbar.id}
                      data-orientation={busbar.orientation}
                      data-selected={selectedBusbarIdSet.has(busbar.id) || undefined}
                    >
                      <path className="busbar__line" d={data} />
                      <path
                        className="busbar__hit"
                        d={data}
                        onPointerDown={(event) => handleBusbarPointerDown(event, busbar)}
                        onPointerMove={(event) => handleBusbarPointerMove(event, busbar)}
                      />
                    </g>
                  )
                })}
              </g>
              <g className="connection-layer" data-testid="connection-layer">
                {routedConnections.edges.map((route) => (
                  <g
                    key={route.edgeId}
                    className="connection-edge"
                    data-edge-id={route.edgeId}
                    data-network-id={route.networkId}
                    data-connection-type={route.type}
                    data-selected={(
                      selectedConnectionId === route.edgeId ||
                      selectedNetworkId(selectedConnectionId) === route.networkId
                    ) || undefined}
                  >
                    <path
                      className="connection-edge__line"
                      d={pathDataWithBridges(route, routedConnections.crossings, gridSize)}
                    />
                    <path
                      className="connection-edge__hit"
                      d={pathData(route.points)}
                      onPointerDown={(event) => handleConnectionPointerDown(event, route)}
                    />
                  </g>
                ))}
                {displayedConnections.flatMap((network) => network.nodes.flatMap((node) => {
                  if (node.kind === 'busbar-tap') {
                    const busbar = displayedBusbars.find((candidate) => candidate.id === node.busbarId)
                    if (!busbar) return []
                    const resolvedOffset = routedConnections.resolvedBusbarTapOffsets[node.id] ?? node.offset
                    const point = busbarPoint(busbar, resolvedOffset)
                    return [(
                      <circle
                        key={node.id}
                        className="busbar-tap"
                        data-connection-type="electrical"
                        data-busbar-id={node.busbarId}
                        data-busbar-offset={resolvedOffset}
                        cx={point.x}
                        cy={point.y}
                        r={2.5 / viewportValue.zoom}
                      />
                    )]
                  }
                  return []
                }))}
                {wiringPreview ? (
                  <path
                    className="connection-preview"
                    data-connection-type={wiring?.source.type}
                    data-testid="connection-preview"
                    d={pathData(wiringPreview)}
                  />
                ) : null}
                {busbarCandidate ? (
                  <circle
                    className="busbar-tap-candidate"
                    data-connection-type="electrical"
                    data-mode={wiring ? 'target' : 'source'}
                    data-testid="busbar-tap-candidate"
                    cx={busbarCandidate.point.x}
                    cy={busbarCandidate.point.y}
                    r={5 / viewportValue.zoom}
                    onPointerDown={handleBusbarCandidatePointerDown}
                  />
                ) : null}
              </g>

              {alignmentViewport ? (
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

              {displayedElements.map((element, index) => {
                const symbol = symbolsByKey.get(element.assetKey)
                const centerX = element.x + element.width / 2
                const centerY = element.y + element.height / 2
                const symbolColor = symbol?.configurableColor
                  ? previewElementColorsRef.current.get(element.id) ??
                    normalizeSymbolColor(element.properties.color)
                  : undefined
                const colorFilterId = `symbol-color-filter-${index}`
                return (
                  <g
                    key={element.id}
                    ref={(node) => {
                      if (node) elementNodeRefs.current.set(element.id, node)
                      else elementNodeRefs.current.delete(element.id)
                    }}
                    className="diagram-element"
                    data-element-id={element.id}
                    data-asset-key={element.assetKey}
                    data-selected={selectedIds.includes(element.id) || undefined}
                    transform={`rotate(${element.rotation} ${centerX} ${centerY})`}
                  >
                    {symbol ? (
                      <>
                        {symbolColor ? (
                          <defs>
                            <filter
                              id={colorFilterId}
                              x="-5%"
                              y="-5%"
                              width="110%"
                              height="110%"
                              colorInterpolationFilters="sRGB"
                            >
                              <feFlood floodColor={symbolColor} result="symbol-color" />
                              <feComposite
                                in="symbol-color"
                                in2="SourceAlpha"
                                operator="in"
                              />
                            </filter>
                          </defs>
                        ) : null}
                        <image
                          className="diagram-element__image"
                          data-symbol-color={symbolColor}
                          data-symbol-state={symbol.defaultState}
                          filter={symbolColor ? `url(#${colorFilterId})` : undefined}
                          href={getSymbolStateUrl(symbol)}
                          x={element.x}
                          y={element.y}
                          width={element.width}
                          height={element.height}
                          preserveAspectRatio="xMidYMid meet"
                          onPointerDown={(event) => startElementMove(event, element.id)}
                        />
                        {assetsByKey.get(element.assetKey)?.anchors.map((anchor) => {
                          const resolved = resolveElementAnchor(
                            element,
                            assetsByKey.get(element.assetKey)!,
                            anchor,
                          )
                          const occupied = occupiedAnchors.has(`${element.id}::${anchor.id}`)
                          const compatible = wiring
                            ? connectionTypesCompatible(wiring.source.type, anchor.type)
                            : anchorAllowedOnDiagram(anchor.type)
                          const localX = element.x + (anchor.x / assetsByKey.get(element.assetKey)!.intrinsicWidth) * element.width
                          const localY = element.y + (anchor.y / assetsByKey.get(element.assetKey)!.intrinsicHeight) * element.height
                          return (
                            <circle
                              key={anchor.id}
                              className="connection-anchor"
                              data-anchor-id={anchor.id}
                              data-anchor-type={anchor.type}
                              data-compatible={compatible || undefined}
                              data-occupied={occupied || undefined}
                              data-world-x={resolved.point.x}
                              data-world-y={resolved.point.y}
                              cx={localX}
                              cy={localY}
                              r={5 / viewportValue.zoom}
                              onPointerEnter={() => handleAnchorPointerEnter(
                                element.id,
                                anchor.id,
                                anchor.type,
                              )}
                              onPointerLeave={() => handleAnchorPointerLeave(
                                element.id,
                                anchor.id,
                              )}
                              onPointerDown={compatible
                                ? (event) => handleAnchorPointerDown(
                                    event,
                                    element.id,
                                    anchor.id,
                                    anchor.type,
                                  )
                                : undefined}
                            />
                          )
                        })}
                      </>
                    ) : null}
                  </g>
                )
              })}

              {selectedObjectCount > 1 ? selectedElements.map((element) => (
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

              {selectedBusbar && selectedBusbarEnd && selectedBusbarCenter && selectedBusbarRotatePoint ? (
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

              {selectedElement ? (
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
              ) : selectedObjectCount > 1 && selectionBounds ? (
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

              {marquee ? (
                <rect className="selection-marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} />
              ) : null}
            </g>
          </svg>
        </div>
      </div>
    )
  },
)
