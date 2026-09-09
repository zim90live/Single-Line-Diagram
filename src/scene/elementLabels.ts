import type {
  AssetDefinition,
  DiagramElement,
  ElementLabelPlacement,
  MonitorAlarmSeverity,
  MonitorMetric,
} from '../domain/project'
import {
  formatMonitorMetricValue,
  monitorAlarmSeverityLabel,
  monitorMetricReadingKey,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'
import { resolveElementAnchor } from './connections'
import { isGenericSymbolKey } from './genericSymbol'
import { elementsBounds, type Point, type Rect } from './geometry'

export const ELEMENT_LABEL_FONT_SIZE = 10
export const ELEMENT_LABEL_LINE_HEIGHT = 16
export const ELEMENT_LABEL_GAP = 2
export const ELEMENT_LABEL_AVOIDANCE_STEP = 2
export const ELEMENT_METRIC_COLUMN_GAP = 2

export interface ElementLabelLayout {
  scale?: number
  elementId: string
  text: string
  nameText: string | null
  placement: ElementLabelPlacement
  bounds: Rect
  textX: number
  textY: number
  metricRows: ElementMetricLabelRow[]
}

export interface ElementMetricLabelRow {
  valueType?: 'number' | 'text'
  metricId: string
  label: string
  labelText: string
  labelVisible: boolean
  valueText: string
  unit: string
  severity: MonitorAlarmSeverity
  ariaLabel: string
  valueBounds: Rect
  labelX: number
  valueX: number
  textY: number
}

export type MonitorMetricLabelLine = Omit<
  ElementMetricLabelRow,
  'valueBounds' | 'labelX' | 'valueX' | 'textY'
>

export interface MonitorMetricLabelColumnWidths {
  label: number
  value: number
  total: number
}

export type MonitorMetricLabelHorizontalAlignment = 'start' | 'center' | 'end'

export interface ElementLabelLayoutOptions {
  scale?: number
  readings?: MonitorMetricReadings
  connectedAnchorIdsByElement?: ReadonlyMap<string, ReadonlySet<string>>
}

const AUTO_PLACEMENT_ORDER: ElementLabelPlacement[] = ['bottom', 'right', 'top', 'left']
const DIRECTION_VECTOR: Record<ElementLabelPlacement, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

export function estimateLabelTextWidth(
  text: string,
  fontSize = ELEMENT_LABEL_FONT_SIZE,
) {
  let width = 0
  for (const character of text) {
    if (/\s/u.test(character)) width += fontSize / 3
    else if (/^[\x00-\x7F]$/u.test(character)) width += fontSize * 0.6
    else width += fontSize
  }
  return Math.max(16, Math.ceil(width + 4))
}

export function resolveMonitorMetricLabelLines(
  ownerId: string,
  metrics: MonitorMetric[] = [],
  dataVisible = false,
  labelsVisible = true,
  readings: MonitorMetricReadings = {},
): MonitorMetricLabelLine[] {
  if (!dataVisible) return []
  return metrics.flatMap((metric) => {
    const reading = readings[monitorMetricReadingKey(ownerId, metric.id)]
    if (!reading) return []
    const valueText = formatMonitorMetricValue(metric, reading.value)
    const unit = metric.valueType === 'number' ? metric.unit?.trim() ?? '' : ''
    const labelText = unit ? `${metric.name}(${unit})` : metric.name
    return [{
      metricId: metric.id,
      valueType: metric.valueType,
      label: metric.name,
      labelText,
      labelVisible: labelsVisible,
      valueText,
      unit,
      severity: reading.severity,
      ariaLabel: `${labelText} ${valueText}，${monitorAlarmSeverityLabel[reading.severity]}`,
    }]
  })
}

export function monitorMetricLabelColumnWidths(
  lines: MonitorMetricLabelLine[],
): MonitorMetricLabelColumnWidths {
  const label = lines.reduce((width, line) => (
    line.labelVisible
      ? Math.max(width, estimateLabelTextWidth(line.labelText))
      : width
  ), 0)
  const value = lines.reduce((width, line) => (
    Math.max(width, estimateLabelTextWidth(line.valueText))
  ), 0)
  return {
    label,
    value,
    total: label + (label > 0 && value > 0 ? ELEMENT_METRIC_COLUMN_GAP : 0) + value,
  }
}

export function monitorMetricLabelWidth(lines: MonitorMetricLabelLine[]) {
  return monitorMetricLabelColumnWidths(lines).total
}

export function positionMonitorMetricLabelRows(
  lines: MonitorMetricLabelLine[],
  bounds: Rect,
  leadingLineCount: number,
  horizontalAlignment: MonitorMetricLabelHorizontalAlignment = 'start',
): ElementMetricLabelRow[] {
  const columns = monitorMetricLabelColumnWidths(lines)
  const valueWidths = { number: 0, text: 0 }
  for (const line of lines) {
    const type = line.valueType ?? 'number'
    valueWidths[type] = Math.max(valueWidths[type], estimateLabelTextWidth(line.valueText))
  }
  const rowsX = horizontalAlignment === 'end'
    ? bounds.x + bounds.width - columns.total
    : horizontalAlignment === 'center'
      ? bounds.x + (bounds.width - columns.total) / 2
      : bounds.x
  const valueColumnX = rowsX + columns.label + (
    columns.label > 0 && columns.value > 0 ? ELEMENT_METRIC_COLUMN_GAP : 0
  )
  return lines.map((line, index) => {
    const y = bounds.y + (index + leadingLineCount) * ELEMENT_LABEL_LINE_HEIGHT
    const valueWidth = valueWidths[line.valueType ?? 'number']
    return {
      ...line,
      valueBounds: {
        x: valueColumnX,
        y,
        width: valueWidth,
        height: ELEMENT_LABEL_LINE_HEIGHT,
      },
      labelX: rowsX + 2,
      valueX: valueColumnX + valueWidth - 2,
      textY: y + 11,
    }
  })
}

function intersectionArea(left: Rect, right: Rect) {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  return Math.max(0, width) * Math.max(0, height)
}

function candidateBounds(
  elementBounds: Rect,
  placement: ElementLabelPlacement,
  labelWidth: number,
  labelHeight: number,
  shift: number,
): Rect {
  if (placement === 'top' || placement === 'bottom') {
    return {
      x: elementBounds.x + (elementBounds.width - labelWidth) / 2 + shift,
      y: placement === 'top'
        ? elementBounds.y - ELEMENT_LABEL_GAP - labelHeight
        : elementBounds.y + elementBounds.height + ELEMENT_LABEL_GAP,
      width: labelWidth,
      height: labelHeight,
    }
  }
  return {
    x: placement === 'left'
      ? elementBounds.x - ELEMENT_LABEL_GAP - labelWidth
      : elementBounds.x + elementBounds.width + ELEMENT_LABEL_GAP,
    y: elementBounds.y + (elementBounds.height - labelHeight) / 2 + shift,
    width: labelWidth,
    height: labelHeight,
  }
}

function anchorCorridors(
  element: DiagramElement,
  asset: AssetDefinition | undefined,
  connectedAnchorIds: ReadonlySet<string> | undefined,
): Rect[] {
  if (!asset || !connectedAnchorIds?.size) return []
  return asset.anchors.flatMap((anchor) => {
    if (!connectedAnchorIds.has(anchor.id)) return []
    const resolved = resolveElementAnchor(element, asset, anchor)
    const vector = DIRECTION_VECTOR[resolved.direction]
    const end = {
      x: resolved.point.x + vector.x * 24,
      y: resolved.point.y + vector.y * 24,
    }
    return [{
      x: Math.min(resolved.point.x, end.x) - 4,
      y: Math.min(resolved.point.y, end.y) - 4,
      width: Math.abs(end.x - resolved.point.x) + 8,
      height: Math.abs(end.y - resolved.point.y) + 8,
    }]
  })
}

function shiftsFor(elementBounds: Rect, labelWidth: number, labelHeight: number) {
  const range = Math.max(64, elementBounds.width, elementBounds.height, labelWidth, labelHeight)
  const shifts = [0]
  for (
    let value = ELEMENT_LABEL_AVOIDANCE_STEP;
    value <= range;
    value += ELEMENT_LABEL_AVOIDANCE_STEP
  ) shifts.push(value, -value)
  return shifts
}

export function elementDeviceIdentifier(element: DiagramElement) {
  const tag = element.properties.tag
  return typeof tag === 'string' && tag.trim() ? tag.trim() : element.name
}

export function nextDeviceIdentifier(
  name: string,
  diagramId: string,
  elements: DiagramElement[],
) {
  const base = name.trim() || '设备'
  const used = new Set(elements.flatMap((element) => {
    if (element.diagramId !== diagramId) return []
    const tag = element.properties.tag
    return typeof tag === 'string' && tag.trim() ? [tag.trim()] : []
  }))
  let index = 1
  let candidate = `${base}-${String(index).padStart(2, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base}-${String(index).padStart(2, '0')}`
  }
  return candidate
}

export function labelPlacementForPointer(
  element: DiagramElement,
  pointer: Point,
): ElementLabelPlacement {
  const dx = pointer.x - (element.x + element.width / 2)
  const dy = pointer.y - (element.y + element.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'top' : 'bottom'
}

export function layoutElementLabels(
  elements: DiagramElement[],
  assetsByKey: Map<string, AssetDefinition>,
  options: ElementLabelLayoutOptions = {},
): ElementLabelLayout[] {
  const scale = options.scale ?? 1
  if (scale !== 1) return layoutElementLabels(elements, assetsByKey, { ...options, scale: 1 }).map(layout => {
    const ox = layout.placement === 'left' ? layout.bounds.x + layout.bounds.width : layout.placement === 'right' ? layout.bounds.x : layout.bounds.x + layout.bounds.width / 2
    const oy = layout.placement === 'top' ? layout.bounds.y + layout.bounds.height : layout.bounds.y
    const x = (value: number) => ox + (value - ox) * scale
    const y = (value: number) => oy + (value - oy) * scale
    const rect = (value: Rect) => ({ x: x(value.x), y: y(value.y), width: value.width * scale, height: value.height * scale })
    return { ...layout, scale, bounds: rect(layout.bounds), textX: x(layout.textX), textY: y(layout.textY), metricRows: layout.metricRows.map(row => ({ ...row, valueBounds: rect(row.valueBounds), labelX: x(row.labelX), valueX: x(row.valueX), textY: y(row.textY) })) }
  })
  const readings = options.readings ?? {}
  const elementRects = new Map(elements.flatMap((element) => {
    const bounds = elementsBounds([element])
    return bounds ? [[element.id, bounds] as const] : []
  }))
  return elements.flatMap((element) => {
    const nameText = element.labelVisible === false || isGenericSymbolKey(element.assetKey)
      ? null
      : elementDeviceIdentifier(element)
    const metricLines = resolveMonitorMetricLabelLines(
      element.id,
      element.monitorMetrics,
      element.monitorDataVisible === true,
      element.monitorMetricLabelsVisible !== false,
      readings,
    )
    if (!nameText && metricLines.length === 0) return []
    const elementBounds = elementRects.get(element.id)
    if (!elementBounds) return []
    const text = [
      ...(nameText ? [nameText] : []),
      ...metricLines.map((line) => line.labelVisible
        ? `${line.labelText}\t${line.valueText}`
        : line.valueText),
    ].join('\n')
    const nameWidth = nameText ? estimateLabelTextWidth(nameText) : 0
    const metricWidth = monitorMetricLabelWidth(metricLines)
    const labelWidth = Math.max(nameWidth, metricWidth)
    const labelHeight = (Number(Boolean(nameText)) + metricLines.length) * ELEMENT_LABEL_LINE_HEIGHT
    const corridors = anchorCorridors(
      element,
      assetsByKey.get(element.assetKey),
      options.connectedAnchorIdsByElement?.get(element.id),
    )
    const placements = element.labelPlacement
      ? [element.labelPlacement]
      : AUTO_PLACEMENT_ORDER
    const shifts = shiftsFor(elementBounds, labelWidth, labelHeight)
    let best: { bounds: Rect; placement: ElementLabelPlacement; score: number } | null = null
    let exactCandidateFound = false

    for (const shift of shifts) {
      for (const [placementIndex, placement] of placements.entries()) {
        const bounds = candidateBounds(
          elementBounds,
          placement,
          labelWidth,
          labelHeight,
          shift,
        )
        const corridorOverlap = corridors.reduce(
          (total, corridor) => total + intersectionArea(bounds, corridor),
          0,
        )
        const score = corridorOverlap * 1_000_000_000 +
          Math.abs(shift) * 10 +
          placementIndex
        if (!best || score < best.score) best = { bounds, placement, score }
        if (shift === 0 && score === placementIndex) {
          exactCandidateFound = true
          break
        }
      }
      if (exactCandidateFound) break
    }

    if (!best) return []
    return [{
      elementId: element.id,
      text,
      placement: best.placement,
      bounds: best.bounds,
      textX: best.bounds.x + 2,
      textY: best.bounds.y + 11,
      nameText,
      metricRows: positionMonitorMetricLabelRows(
        metricLines,
        best.bounds,
        Number(Boolean(nameText)),
        best.placement === 'left'
          ? 'end'
          : best.placement === 'right'
            ? 'start'
            : 'center',
      ),
    }]
  })
}
