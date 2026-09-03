import type {
  Busbar,
  BusbarLabelEndpoint,
  BusbarLabelSide,
} from '../domain/project'
import { busbarEndPoint } from './connections'
import { estimateLabelTextWidth } from './elementLabels'
import type { Point, Rect } from './geometry'

export const BUSBAR_LABEL_ENDPOINT_GAP = 8
export const BUSBAR_LABEL_ENDPOINT_PADDING = 8
export const BUSBAR_LABEL_FONT_SIZE = 14
export const BUSBAR_LABEL_LINE_HEIGHT = 20
export const DEFAULT_BUSBAR_LABEL_COLOR = '#B6B8B4'

export interface BusbarLabelPlacement {
  endpoint: BusbarLabelEndpoint
  side: BusbarLabelSide
}

export interface BusbarLabelLayout extends BusbarLabelPlacement {
  busbarId: string
  text: string
  color?: string
  bounds: Rect
  textX: number
  textY: number
  textAnchor: 'start' | 'end'
}

export function busbarLabelPlacementForPointer(
  busbar: Busbar,
  pointer: Point,
): BusbarLabelPlacement {
  const end = busbarEndPoint(busbar)
  const start = { x: busbar.x, y: busbar.y }
  const distanceSquared = (point: Point) => (
    (pointer.x - point.x) ** 2 + (pointer.y - point.y) ** 2
  )
  const endpoint: BusbarLabelEndpoint = distanceSquared(start) <= distanceSquared(end)
    ? 'start'
    : 'end'
  const point = endpoint === 'start' ? start : end
  const side: BusbarLabelSide = busbar.orientation === 'horizontal'
    ? pointer.y < point.y ? 'negative' : 'positive'
    : pointer.x < point.x ? 'negative' : 'positive'
  return { endpoint, side }
}

export function layoutBusbarLabels(busbars: Busbar[]): BusbarLabelLayout[] {
  return busbars.flatMap((busbar) => {
    if (busbar.labelVisible === false) return []
    const text = busbar.label?.trim()
    if (!text) return []
    const endpoint = busbar.labelEndpoint ?? 'end'
    const side = busbar.labelSide ?? 'negative'
    const end = busbarEndPoint(busbar)
    const point = endpoint === 'start' ? { x: busbar.x, y: busbar.y } : end
    const labelWidth = estimateLabelTextWidth(text, BUSBAR_LABEL_FONT_SIZE)
    const bounds = busbar.orientation === 'horizontal'
      ? {
          x: endpoint === 'start'
            ? point.x + BUSBAR_LABEL_ENDPOINT_PADDING
            : point.x - BUSBAR_LABEL_ENDPOINT_PADDING - labelWidth,
          y: side === 'negative'
            ? point.y - BUSBAR_LABEL_ENDPOINT_GAP - BUSBAR_LABEL_LINE_HEIGHT
            : point.y + BUSBAR_LABEL_ENDPOINT_GAP,
          width: labelWidth,
          height: BUSBAR_LABEL_LINE_HEIGHT,
        }
      : {
          x: side === 'negative'
            ? point.x - BUSBAR_LABEL_ENDPOINT_GAP - labelWidth
            : point.x + BUSBAR_LABEL_ENDPOINT_GAP,
          y: endpoint === 'start'
            ? point.y + BUSBAR_LABEL_ENDPOINT_PADDING
            : point.y - BUSBAR_LABEL_ENDPOINT_PADDING - BUSBAR_LABEL_LINE_HEIGHT,
          width: labelWidth,
          height: BUSBAR_LABEL_LINE_HEIGHT,
        }
    const textAnchor = busbar.orientation === 'horizontal'
      ? endpoint === 'start' ? 'start' : 'end'
      : side === 'negative' ? 'end' : 'start'
    return [{
      busbarId: busbar.id,
      text,
      endpoint,
      side,
      color: busbar.labelColor,
      bounds,
      textX: textAnchor === 'start' ? bounds.x : bounds.x + bounds.width,
      textY: bounds.y + 15,
      textAnchor,
    }]
  })
}
