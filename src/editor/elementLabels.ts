import type {
  AssetDefinition,
  DiagramElement,
  ElementLabelPlacement,
} from '../domain/project'
import { resolveElementAnchor } from './connections'
import { elementsBounds, type Point, type Rect } from './geometry'

export const ELEMENT_LABEL_FONT_SIZE = 10
export const ELEMENT_LABEL_LINE_HEIGHT = 16
export const ELEMENT_LABEL_GAP = 2
export const ELEMENT_LABEL_AVOIDANCE_STEP = 2

export interface ElementLabelLayout {
  elementId: string
  text: string
  placement: ElementLabelPlacement
  bounds: Rect
  textX: number
  textY: number
}

const AUTO_PLACEMENT_ORDER: ElementLabelPlacement[] = ['bottom', 'right', 'top', 'left']
const DIRECTION_VECTOR: Record<ElementLabelPlacement, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
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
  shift: number,
): Rect {
  if (placement === 'top' || placement === 'bottom') {
    return {
      x: elementBounds.x + (elementBounds.width - labelWidth) / 2 + shift,
      y: placement === 'top'
        ? elementBounds.y - ELEMENT_LABEL_GAP - ELEMENT_LABEL_LINE_HEIGHT
        : elementBounds.y + elementBounds.height + ELEMENT_LABEL_GAP,
      width: labelWidth,
      height: ELEMENT_LABEL_LINE_HEIGHT,
    }
  }
  return {
    x: placement === 'left'
      ? elementBounds.x - ELEMENT_LABEL_GAP - labelWidth
      : elementBounds.x + elementBounds.width + ELEMENT_LABEL_GAP,
    y: elementBounds.y + (elementBounds.height - ELEMENT_LABEL_LINE_HEIGHT) / 2 + shift,
    width: labelWidth,
    height: ELEMENT_LABEL_LINE_HEIGHT,
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

function shiftsFor(elementBounds: Rect, labelWidth: number) {
  const range = Math.max(64, elementBounds.width, elementBounds.height, labelWidth)
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
): ElementLabelLayout[] {
  const elementRects = new Map(elements.flatMap((element) => {
    const bounds = elementsBounds([element])
    return bounds ? [[element.id, bounds] as const] : []
  }))
  const placed: Rect[] = []
  return elements.flatMap((element) => {
    if (element.labelVisible === false) return []
    const elementBounds = elementRects.get(element.id)
    if (!elementBounds) return []
    const text = elementDeviceIdentifier(element)
    const labelWidth = estimateLabelTextWidth(text)
    const corridors = anchorCorridors(element, assetsByKey.get(element.assetKey))
    const placements = element.labelPlacement
      ? [element.labelPlacement]
      : AUTO_PLACEMENT_ORDER
    const shifts = shiftsFor(elementBounds, labelWidth)
    let best: { bounds: Rect; placement: ElementLabelPlacement; score: number } | null = null
    let exactCandidateFound = false

    for (const shift of shifts) {
      for (const [placementIndex, placement] of placements.entries()) {
        const bounds = candidateBounds(elementBounds, placement, labelWidth, shift)
        const corridorOverlap = corridors.reduce(
          (total, corridor) => total + intersectionArea(bounds, corridor),
          0,
        )
        const otherElementOverlap = elements.reduce((total, candidate) => {
          if (candidate.id === element.id) return total
          const rect = elementRects.get(candidate.id)
          return total + (rect ? intersectionArea(bounds, expandRect(rect, 2)) : 0)
        }, 0)
        const labelOverlap = placed.reduce(
          (total, rect) => total + intersectionArea(bounds, expandRect(rect, 2)),
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
    placed.push(best.bounds)
    return [{
      elementId: element.id,
      text,
      placement: best.placement,
      bounds: best.bounds,
      textX: best.bounds.x + 2,
      textY: best.bounds.y + 11,
    }]
  })
}
