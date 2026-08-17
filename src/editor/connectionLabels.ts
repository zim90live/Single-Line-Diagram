import type {
  ConnectionLabelEndpoint,
  ConnectionLabelSide,
  ConnectionNetwork,
} from '../domain/project'
import type { RoutedConnectionEdge } from './connections'
import {
  ELEMENT_LABEL_LINE_HEIGHT,
  estimateLabelTextWidth,
} from './elementLabels'
import type { Point, Rect } from './geometry'

export const CONNECTION_LABEL_ENDPOINT_GAP = 8

export type ConnectionLabelOrientation = 'horizontal' | 'vertical'

export interface ConnectionLabelPlacement {
  edgeId: string
  endpoint: ConnectionLabelEndpoint
  side: ConnectionLabelSide
}

export interface ConnectionLabelLayout extends ConnectionLabelPlacement {
  text: string
  orientation: ConnectionLabelOrientation
  bounds: Rect
  textX: number
  textY: number
}

interface EndpointSegment {
  point: Point
  orientation: ConnectionLabelOrientation
}

function endpointSegment(
  route: RoutedConnectionEdge,
  endpoint: ConnectionLabelEndpoint,
): EndpointSegment | null {
  const points = endpoint === 'source' ? route.points : [...route.points].reverse()
  const point = points[0]
  const adjacent = points.find((candidate) => (
    candidate.x !== point?.x || candidate.y !== point?.y
  ))
  if (!point || !adjacent) return null
  return {
    point,
    orientation: Math.abs(adjacent.x - point.x) >= Math.abs(adjacent.y - point.y)
      ? 'horizontal'
      : 'vertical',
  }
}

function placementBounds(
  segment: EndpointSegment,
  side: ConnectionLabelSide,
  labelWidth: number,
): Rect {
  if (segment.orientation === 'horizontal') {
    return {
      x: segment.point.x - labelWidth / 2,
      y: side === 'negative'
        ? segment.point.y - CONNECTION_LABEL_ENDPOINT_GAP - ELEMENT_LABEL_LINE_HEIGHT
        : segment.point.y + CONNECTION_LABEL_ENDPOINT_GAP,
      width: labelWidth,
      height: ELEMENT_LABEL_LINE_HEIGHT,
    }
  }
  return {
    x: side === 'negative'
      ? segment.point.x - CONNECTION_LABEL_ENDPOINT_GAP - labelWidth
      : segment.point.x + CONNECTION_LABEL_ENDPOINT_GAP,
    y: segment.point.y - ELEMENT_LABEL_LINE_HEIGHT / 2,
    width: labelWidth,
    height: ELEMENT_LABEL_LINE_HEIGHT,
  }
}

export function connectionLabelPlacementForPointer(
  route: RoutedConnectionEdge,
  pointer: Point,
): Omit<ConnectionLabelPlacement, 'edgeId'> | null {
  const source = endpointSegment(route, 'source')
  const target = endpointSegment(route, 'target')
  if (!source || !target) return null
  const distanceSquared = (point: Point) => (
    (pointer.x - point.x) ** 2 + (pointer.y - point.y) ** 2
  )
  const endpoint: ConnectionLabelEndpoint = distanceSquared(source.point) <= distanceSquared(target.point)
    ? 'source'
    : 'target'
  const segment = endpoint === 'source' ? source : target
  const side: ConnectionLabelSide = segment.orientation === 'horizontal'
    ? pointer.y < segment.point.y ? 'negative' : 'positive'
    : pointer.x < segment.point.x ? 'negative' : 'positive'
  return { endpoint, side }
}

export function layoutConnectionLabels(
  routes: RoutedConnectionEdge[],
  networks: ConnectionNetwork[],
  preview: ConnectionLabelPlacement | null = null,
): ConnectionLabelLayout[] {
  const edgesById = new Map(networks.flatMap((network) => (
    network.edges.map((edge) => [edge.id, edge] as const)
  )))
  return routes.flatMap((route) => {
    const edge = edgesById.get(route.edgeId)
    if (!edge || edge.labelVisible === false) return []
    const text = edge.label?.trim()
    if (!text) return []
    const endpoint = preview?.edgeId === edge.id
      ? preview.endpoint
      : edge.labelEndpoint ?? 'target'
    const side = preview?.edgeId === edge.id
      ? preview.side
      : edge.labelSide ?? 'negative'
    const segment = endpointSegment(route, endpoint)
    if (!segment) return []
    const bounds = placementBounds(segment, side, estimateLabelTextWidth(text))
    return [{
      edgeId: edge.id,
      text,
      endpoint,
      side,
      orientation: segment.orientation,
      bounds,
      textX: bounds.x + 2,
      textY: bounds.y + 11,
    }]
  })
}
