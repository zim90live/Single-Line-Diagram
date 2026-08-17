import type { Busbar, BusbarLabelEndpoint } from '../domain/project'
import { busbarEndPoint } from './connections'
import {
  ELEMENT_LABEL_LINE_HEIGHT,
  estimateLabelTextWidth,
} from './elementLabels'
import type { Point, Rect } from './geometry'

export const BUSBAR_LABEL_ENDPOINT_GAP = 8

export interface BusbarLabelLayout {
  busbarId: string
  text: string
  endpoint: BusbarLabelEndpoint
  bounds: Rect
  textX: number
  textY: number
}

export function busbarLabelEndpointForPointer(
  busbar: Busbar,
  pointer: Point,
): BusbarLabelEndpoint {
  const end = busbarEndPoint(busbar)
  const midpoint = busbar.orientation === 'horizontal'
    ? (busbar.x + end.x) / 2
    : (busbar.y + end.y) / 2
  const pointerAxis = busbar.orientation === 'horizontal' ? pointer.x : pointer.y
  return pointerAxis < midpoint ? 'start' : 'end'
}

export function layoutBusbarLabels(busbars: Busbar[]): BusbarLabelLayout[] {
  return busbars.flatMap((busbar) => {
    if (busbar.labelVisible === false) return []
    const text = busbar.label?.trim()
    if (!text) return []
    const endpoint = busbar.labelEndpoint ?? 'end'
    const end = busbarEndPoint(busbar)
    const point = endpoint === 'start' ? { x: busbar.x, y: busbar.y } : end
    const labelWidth = estimateLabelTextWidth(text)
    const bounds = busbar.orientation === 'horizontal'
      ? {
          x: endpoint === 'start'
            ? point.x - BUSBAR_LABEL_ENDPOINT_GAP - labelWidth
            : point.x + BUSBAR_LABEL_ENDPOINT_GAP,
          y: point.y - ELEMENT_LABEL_LINE_HEIGHT / 2,
          width: labelWidth,
          height: ELEMENT_LABEL_LINE_HEIGHT,
        }
      : {
          x: point.x - labelWidth / 2,
          y: endpoint === 'start'
            ? point.y - BUSBAR_LABEL_ENDPOINT_GAP - ELEMENT_LABEL_LINE_HEIGHT
            : point.y + BUSBAR_LABEL_ENDPOINT_GAP,
          width: labelWidth,
          height: ELEMENT_LABEL_LINE_HEIGHT,
        }
    return [{
      busbarId: busbar.id,
      text,
      endpoint,
      bounds,
      textX: bounds.x + 2,
      textY: bounds.y + 11,
    }]
  })
}
