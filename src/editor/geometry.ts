import type {
  Busbar,
  ConnectionNetwork,
  DiagramElement,
  DiagramViewport,
  RouteWaypoint,
} from '../domain/project'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DiagramObjectSelection {
  elementIds: ReadonlySet<string>
  busbarIds: ReadonlySet<string>
  nodeIds: ReadonlySet<string>
  routeWaypointIds: ReadonlySet<string>
}

export function translateDiagramSelection(
  elements: DiagramElement[],
  busbars: Busbar[],
  connections: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
  selection: DiagramObjectSelection,
  delta: Point,
  gridSize?: number,
) {
  const translated = (value: number, offset: number) => (
    gridSize === undefined ? value + offset : snap(value + offset, gridSize)
  )
  return {
    elements: elements.map((element) => selection.elementIds.has(element.id)
      ? {
          ...element,
          x: translated(element.x, delta.x),
          y: translated(element.y, delta.y),
        }
      : element),
    busbars: busbars.map((busbar) => selection.busbarIds.has(busbar.id)
      ? {
          ...busbar,
          x: translated(busbar.x, delta.x),
          y: translated(busbar.y, delta.y),
        }
      : busbar),
    connections: connections.map((network) => ({
      ...network,
      nodes: network.nodes.map((node) => (
        node.kind === 'node' && selection.nodeIds.has(node.id)
          ? {
              ...node,
              x: translated(node.x, delta.x),
              y: translated(node.y, delta.y),
            }
          : node
      )),
    })),
    routeWaypoints: routeWaypoints.map((waypoint) => (
      selection.routeWaypointIds.has(waypoint.id)
        ? {
            ...waypoint,
            x: translated(waypoint.x, delta.x),
            y: translated(waypoint.y, delta.y),
          }
        : waypoint
    )),
  }
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function screenToWorld(point: Point, viewport: DiagramViewport): Point {
  return {
    x: (point.x - viewport.tx) / viewport.zoom,
    y: (point.y - viewport.ty) / viewport.zoom,
  }
}

export function worldToScreen(point: Point, viewport: DiagramViewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.tx,
    y: point.y * viewport.zoom + viewport.ty,
  }
}

export function zoomAroundPoint(
  viewport: DiagramViewport,
  screenPoint: Point,
  nextZoom: number,
): DiagramViewport {
  const worldPoint = screenToWorld(screenPoint, viewport)
  const zoom = clampZoom(nextZoom)
  return {
    zoom,
    tx: screenPoint.x - worldPoint.x * zoom,
    ty: screenPoint.y - worldPoint.y * zoom,
  }
}

export function snap(value: number, step: number) {
  return Math.round(value / step) * step
}

export function normalizedRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  }
}

export function rotatePointOnGrid(
  point: Point,
  center: Point,
  degrees: number,
  gridSize: number,
): Point {
  const rotated = rotatePoint(point, center, degrees)
  return {
    x: snap(rotated.x, gridSize),
    y: snap(rotated.y, gridSize),
  }
}

export function worldDeltaToLocal(delta: Point, rotation: number): Point {
  const radians = (-rotation * Math.PI) / 180
  return {
    x: delta.x * Math.cos(radians) - delta.y * Math.sin(radians),
    y: delta.x * Math.sin(radians) + delta.y * Math.cos(radians),
  }
}

export function elementCorners(element: DiagramElement): Point[] {
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  }
  return [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ].map((point) => rotatePoint(point, center, element.rotation))
}

export function elementsBounds(elements: DiagramElement[]): Rect | null {
  if (!elements.length) return null
  const corners = elements.flatMap(elementCorners)
  const left = Math.min(...corners.map((point) => point.x))
  const top = Math.min(...corners.map((point) => point.y))
  const right = Math.max(...corners.map((point) => point.x))
  const bottom = Math.max(...corners.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function busbarPoints(busbar: Busbar): [Point, Point] {
  return [
    { x: busbar.x, y: busbar.y },
    busbar.orientation === 'horizontal'
      ? { x: busbar.x + busbar.length, y: busbar.y }
      : { x: busbar.x, y: busbar.y + busbar.length },
  ]
}

export function diagramObjectsBounds(elements: DiagramElement[], busbars: Busbar[]): Rect | null {
  const points = [
    ...elements.flatMap(elementCorners),
    ...busbars.flatMap(busbarPoints),
  ]
  if (!points.length) return null
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function elementInsideRect(element: DiagramElement, rect: Rect) {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return elementCorners(element).every(
    (point) => point.x >= rect.x && point.x <= right && point.y >= rect.y && point.y <= bottom,
  )
}

export function busbarInsideRect(busbar: Busbar, rect: Rect) {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return busbarPoints(busbar).every(
    (point) => point.x >= rect.x && point.x <= right && point.y >= rect.y && point.y <= bottom,
  )
}

export function elementsEqual(left: DiagramElement[], right: DiagramElement[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((element, index) => {
    const candidate = right[index]
    return (
      element.id === candidate.id &&
      element.diagramId === candidate.diagramId &&
      element.assetKey === candidate.assetKey &&
      element.name === candidate.name &&
      element.x === candidate.x &&
      element.y === candidate.y &&
      element.width === candidate.width &&
      element.height === candidate.height &&
      element.rotation === candidate.rotation &&
      element.labelVisible === candidate.labelVisible &&
      element.labelPlacement === candidate.labelPlacement &&
      element.monitorDataVisible === candidate.monitorDataVisible &&
      element.monitorMetricLabelsVisible === candidate.monitorMetricLabelsVisible &&
      JSON.stringify(element.monitorMetrics) === JSON.stringify(candidate.monitorMetrics) &&
      JSON.stringify(element.properties) === JSON.stringify(candidate.properties) &&
      JSON.stringify(element.extensions) === JSON.stringify(candidate.extensions)
    )
  })
}
