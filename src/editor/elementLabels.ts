import type {
  AssetDefinition,
  DiagramElement,
  ElementLabelPlacement,
  MonitorAlarmSeverity,
} from '../domain/project'
import {
  formatMonitorMetricValue,
  monitorAlarmSeverityLabel,
  monitorMetricReadingKey,
  type MonitorMetricReadings,
} from '../monitoring/elementMetrics'
import { resolveElementAnchor } from './connections'
import { elementsBounds, type Point, type Rect } from './geometry'

export const ELEMENT_LABEL_FONT_SIZE = 10
export const ELEMENT_LABEL_LINE_HEIGHT = 16
export const ELEMENT_LABEL_GAP = 2
export const ELEMENT_LABEL_AVOIDANCE_STEP = 2

export interface ElementLabelLayout {
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
  metricId: string
  label: string
  labelText: string
  valueText: string
  unit: string
  severity: MonitorAlarmSeverity
  ariaLabel: string
  labelX: number
  valueX: number
  textY: number
}

export interface ElementLabelLayoutOptions {
  readings?: MonitorMetricReadings
}

const AUTO_PLACEMENT_ORDER: ElementLabelPlacement[] = ['bottom', 'right', 'top', 'left']
const DIRECTION_VECTOR: Record<ElementLabelPlacement, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}
const LABEL_SPATIAL_CELL_SIZE = 128

interface SpatialRectEntry<T> {
  id: T
  rect: Rect
}

class RectSpatialIndex<T> {
  private cells = new Map<string, SpatialRectEntry<T>[]>()

  insert(id: T, rect: Rect) {
    const entry = { id, rect }
    this.cellKeys(rect).forEach((key) => {
      const entries = this.cells.get(key) ?? []
      entries.push(entry)
      this.cells.set(key, entries)
    })
  }

  query(rect: Rect) {
    const matches = new Set<SpatialRectEntry<T>>()
    this.cellKeys(rect).forEach((key) => {
      this.cells.get(key)?.forEach((entry) => matches.add(entry))
    })
    return [...matches]
  }

  private cellKeys(rect: Rect) {
    const left = Math.floor(rect.x / LABEL_SPATIAL_CELL_SIZE)
    const right = Math.floor((rect.x + rect.width) / LABEL_SPATIAL_CELL_SIZE)
    const top = Math.floor(rect.y / LABEL_SPATIAL_CELL_SIZE)
    const bottom = Math.floor((rect.y + rect.height) / LABEL_SPATIAL_CELL_SIZE)
    const keys: string[] = []
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) keys.push(`${x},${y}`)
    }
    return keys
  }
}

export function estimateLabelTextWidth(text: string) {
  let width = 0
  for (const character of text) {
    if (/\s/u.test(character)) width += ELEMENT_LABEL_FONT_SIZE / 3
    else if (/^[\x00-\x7F]$/u.test(character)) width += ELEMENT_LABEL_FONT_SIZE * 0.6
    else width += ELEMENT_LABEL_FONT_SIZE
  }
  return Math.max(16, Math.ceil(width + 4))
}

function intersectionArea(left: Rect, right: Rect) {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  return Math.max(0, width) * Math.max(0, height)
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  }
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
): Rect[] {
  if (!asset) return []
  return asset.anchors.map((anchor) => {
    const resolved = resolveElementAnchor(element, asset, anchor)
    const vector = DIRECTION_VECTOR[resolved.direction]
    const end = {
      x: resolved.point.x + vector.x * 24,
      y: resolved.point.y + vector.y * 24,
    }
    return {
      x: Math.min(resolved.point.x, end.x) - 4,
      y: Math.min(resolved.point.y, end.y) - 4,
      width: Math.abs(end.x - resolved.point.x) + 8,
      height: Math.abs(end.y - resolved.point.y) + 8,
    }
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
  const readings = options.readings ?? {}
  const elementRects = new Map(elements.flatMap((element) => {
    const bounds = elementsBounds([element])
    return bounds ? [[element.id, bounds] as const] : []
  }))
  const elementRectIndex = new RectSpatialIndex<string>()
  elementRects.forEach((rect, id) => elementRectIndex.insert(id, expandRect(rect, 2)))
  const placedRectIndex = new RectSpatialIndex<number>()
  let placedCount = 0
  return elements.flatMap((element) => {
    const nameText = element.labelVisible === false ? null : elementDeviceIdentifier(element)
    const metricLines = element.monitorDataVisible === true
      ? (element.monitorMetrics ?? []).flatMap((metric) => {
          const reading = readings[monitorMetricReadingKey(element.id, metric.id)]
          if (!reading) return []
          const valueText = formatMonitorMetricValue(metric, reading.value)
          const unit = metric.valueType === 'number' ? metric.unit?.trim() ?? '' : ''
          const labelText = unit ? `${metric.name}(${unit})` : metric.name
          return [{
            metricId: metric.id,
            label: metric.name,
            labelText,
            valueText,
            unit,
            severity: reading.severity,
            ariaLabel: `${labelText} ${valueText}，${monitorAlarmSeverityLabel[reading.severity]}`,
          }]
        })
      : []
    if (!nameText && metricLines.length === 0) return []
    const elementBounds = elementRects.get(element.id)
    if (!elementBounds) return []
    const text = [
      ...(nameText ? [nameText] : []),
      ...metricLines.map((line) => `${line.labelText}\t${line.valueText}`),
    ].join('\n')
    const nameWidth = nameText ? estimateLabelTextWidth(nameText) : 0
    const metricWidth = metricLines.reduce((width, line) => Math.max(
      width,
      estimateLabelTextWidth(line.labelText) + 8 + estimateLabelTextWidth(line.valueText),
    ), 0)
    const labelWidth = Math.max(nameWidth, metricWidth)
    const labelHeight = (Number(Boolean(nameText)) + metricLines.length) * ELEMENT_LABEL_LINE_HEIGHT
    const corridors = anchorCorridors(element, assetsByKey.get(element.assetKey))
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
        const otherElementOverlap = elementRectIndex.query(bounds).reduce((total, candidate) => {
          if (candidate.id === element.id) return total
          return total + intersectionArea(bounds, candidate.rect)
        }, 0)
        const labelOverlap = placedRectIndex.query(bounds).reduce(
          (total, candidate) => total + intersectionArea(bounds, candidate.rect),
          0,
        )
        const score = corridorOverlap * 1_000_000_000 +
          labelOverlap * 1_000_000 +
          otherElementOverlap * 10_000 +
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
    placedRectIndex.insert(placedCount++, expandRect(best.bounds, 2))
    return [{
      elementId: element.id,
      text,
      placement: best.placement,
      bounds: best.bounds,
      textX: best.bounds.x + 2,
      textY: best.bounds.y + 11,
      nameText,
      metricRows: metricLines.map((line, index) => ({
        ...line,
        labelX: best.bounds.x + 2,
        valueX: best.bounds.x + best.bounds.width - 2,
        textY: best.bounds.y +
          (index + Number(Boolean(nameText))) * ELEMENT_LABEL_LINE_HEIGHT + 11,
      })),
    }]
  })
}
