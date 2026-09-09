import type {
  Busbar,
  BusbarLabelEndpoint,
  BusbarLabelSide,
} from '../domain/project'
import { busbarEndPoint } from './connections'
import { estimateLabelTextWidth, resolveMonitorMetricLabelLines, monitorMetricLabelWidth, positionMonitorMetricLabelRows, ELEMENT_LABEL_LINE_HEIGHT, type ElementMetricLabelRow } from './elementLabels'
import type { MonitorMetricReadings } from '../monitoring/elementMetrics'
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
  metricRows: ElementMetricLabelRow[]
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

/** Derives presentation-only busbar labels without editor state. */
export function layoutBusbarLabels(busbars: Busbar[], readings: MonitorMetricReadings = {}): BusbarLabelLayout[] {
  return busbars.flatMap((busbar) => {
    const text = busbar.labelVisible === false ? '' : busbar.label?.trim() ?? ''
    const rows = resolveMonitorMetricLabelLines(busbar.id, busbar.monitorMetrics, busbar.monitorDataVisible, busbar.monitorMetricLabelsVisible !== false, readings)
    if (!text && !rows.length) return []
    const endpoint = busbar.labelEndpoint ?? 'end'
    const side = busbar.labelSide ?? 'negative'
    const end = busbarEndPoint(busbar)
    const point = endpoint === 'start' ? { x: busbar.x, y: busbar.y } : end
    const labelWidth = Math.max(text ? estimateLabelTextWidth(text, BUSBAR_LABEL_FONT_SIZE) : 0, monitorMetricLabelWidth(rows))
    const labelHeight = (text ? BUSBAR_LABEL_LINE_HEIGHT : 0) + rows.length * ELEMENT_LABEL_LINE_HEIGHT
    const bounds = busbar.orientation === 'horizontal'
      ? {
          x: endpoint === 'start'
            ? point.x + BUSBAR_LABEL_ENDPOINT_PADDING
            : point.x - BUSBAR_LABEL_ENDPOINT_PADDING - labelWidth,
          y: side === 'negative'
            ? point.y - BUSBAR_LABEL_ENDPOINT_GAP - labelHeight
            : point.y + BUSBAR_LABEL_ENDPOINT_GAP,
          width: labelWidth,
          height: labelHeight,
        }
      : {
          x: side === 'negative'
            ? point.x - BUSBAR_LABEL_ENDPOINT_GAP - labelWidth
            : point.x + BUSBAR_LABEL_ENDPOINT_GAP,
          y: endpoint === 'start'
            ? point.y + BUSBAR_LABEL_ENDPOINT_PADDING
            : point.y - BUSBAR_LABEL_ENDPOINT_PADDING - labelHeight,
          width: labelWidth,
          height: labelHeight,
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
      metricRows: positionMonitorMetricLabelRows(rows, { ...bounds, y: bounds.y + (text ? BUSBAR_LABEL_LINE_HEIGHT : 0) }, 0, textAnchor === 'end' ? 'end' : 'start'),
    }]
  })
}
