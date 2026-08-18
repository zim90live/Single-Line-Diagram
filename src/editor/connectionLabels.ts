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
export const CONNECTION_LABEL_ENDPOINT_PADDING = 8

export type ConnectionLabelOrientation = 'horizontal' | 'vertical'
export type ConnectionLabelAxisAlignment = 'left' | 'right' | 'top' | 'bottom'

export interface ConnectionLabelPlacement {
  edgeId: string
  endpoint: ConnectionLabelEndpoint
  side: ConnectionLabelSide
}

export interface ConnectionLabelLayout extends ConnectionLabelPlacement {
  text: string
  orientation: ConnectionLabelOrientation
  axisAlignment: ConnectionLabelAxisAlignment
  bounds: Rect
  textX: number
  textY: number
  textAnchor: 'start' | 'end'
}

interface EndpointSegment {
  point: Point
  orientation: ConnectionLabelOrientation
  direction: -1 | 1
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
  const orientation = Math.abs(adjacent.x - point.x) >= Math.abs(adjacent.y - point.y)
    ? 'horizontal'
    : 'vertical'
  return {
    point,
    orientation,
    direction: orientation === 'horizontal'
      ? adjacent.x > point.x ? 1 : -1
      : adjacent.y > point.y ? 1 : -1,
  }
}

function placementBounds(
  segment: EndpointSegment,
  side: ConnectionLabelSide,
  labelWidth: number,
): Pick<ConnectionLabelLayout, 'axisAlignment' | 'bounds' | 'textX' | 'textY' | 'textAnchor'> {
  if (segment.orientation === 'horizontal') {
    const axisAlignment = segment.direction > 0 ? 'left' : 'right'
    const x = segment.direction > 0
      ? segment.point.x + CONNECTION_LABEL_ENDPOINT_PADDING
      : segment.point.x - CONNECTION_LABEL_ENDPOINT_PADDING - labelWidth
    const y = side === 'negative'
      ? segment.point.y - CONNECTION_LABEL_ENDPOINT_GAP - ELEMENT_LABEL_LINE_HEIGHT
      : segment.point.y + CONNECTION_LABEL_ENDPOINT_GAP
    return {
      axisAlignment,
      bounds: {
        x,
        y,
        width: labelWidth,
        height: ELEMENT_LABEL_LINE_HEIGHT,
      },
      textX: segment.direction > 0 ? x : x + labelWidth,
      textY: y + 11,
      textAnchor: segment.direction > 0 ? 'start' : 'end',
    }
  }
  const axisAlignment = segment.direction > 0 ? 'top' : 'bottom'
  const x = side === 'negative'
    ? segment.point.x - CONNECTION_LABEL_ENDPOINT_GAP - labelWidth
    : segment.point.x + CONNECTION_LABEL_ENDPOINT_GAP
  const y = segment.direction > 0
    ? segment.point.y + CONNECTION_LABEL_ENDPOINT_PADDING
    : segment.point.y - CONNECTION_LABEL_ENDPOINT_PADDING - ELEMENT_LABEL_LINE_HEIGHT
  return {
    axisAlignment,
    bounds: {
      x,
      y,
      width: labelWidth,
      height: ELEMENT_LABEL_LINE_HEIGHT,
    },
    textX: side === 'negative' ? x + labelWidth : x,
    textY: y + 11,
    textAnchor: side === 'negative' ? 'end' : 'start',
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
    const placement = placementBounds(segment, side, estimateLabelTextWidth(text))
    return [{
      edgeId: edge.id,
      text,
      endpoint,
      side,
      orientation: segment.orientation,
      ...placement,
    }]
  })
}
