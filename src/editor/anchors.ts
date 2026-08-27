import {
  EDITOR_GRID_SIZE,
  type AnchorDirection,
  type AnchorType,
  type AssetDefinition,
  type DiagramElement,
  type LineSystemType,
  type SymbolAnchor,
} from '../domain/project'

export const ANCHOR_TYPE_OPTIONS: ReadonlyArray<{ value: AnchorType; label: string }> = [
  { value: 'electrical', label: '电路' },
  { value: 'cooling-primary-cold', label: '一次回路冷' },
  { value: 'cooling-primary-hot', label: '一次回路热' },
  { value: 'cooling-secondary-cold', label: '二次回路冷' },
  { value: 'cooling-secondary-hot', label: '二次回路热' },
  { value: 'cooling-general', label: '通用' },
]

const anchorTypeLabels = new Map(ANCHOR_TYPE_OPTIONS.map((option) => [option.value, option.label]))

export interface AnchorPoint {
  x: number
  y: number
  direction: AnchorDirection
}

export interface TransformedAnchorPoint extends AnchorPoint {
  id: string
  name: string
  type: AnchorType
}

export function getAnchorTypeLabel(type: AnchorType) {
  return anchorTypeLabels.get(type) ?? type
}

export function getDefaultAnchorType(
  category: string,
  lineSystemType?: LineSystemType,
): AnchorType {
  if (category === '冷却') return 'cooling-general'
  if (category === '电力') return 'electrical'
  return lineSystemType === 'power' ? 'electrical' : 'cooling-general'
}

export function deriveAnchorDirection(
  x: number,
  y: number,
  width: number,
  height: number,
): AnchorDirection | null {
  if (x < 0 || x > width || y < 0 || y > height) return null
  const onLeft = x === 0
  const onRight = x === width
  const onTop = y === 0
  const onBottom = y === height
  const edgeCount = Number(onLeft) + Number(onRight) + Number(onTop) + Number(onBottom)
  if (edgeCount !== 1) return null
  if (onTop) return 'top'
  if (onRight) return 'right'
  if (onBottom) return 'bottom'
  return 'left'
}

export function isLegalAnchorPoint(
  point: Pick<AnchorPoint, 'x' | 'y'>,
  asset: Pick<AssetDefinition, 'intrinsicWidth' | 'intrinsicHeight'>,
) {
  return (
    point.x % EDITOR_GRID_SIZE === 0 &&
    point.y % EDITOR_GRID_SIZE === 0 &&
    deriveAnchorDirection(point.x, point.y, asset.intrinsicWidth, asset.intrinsicHeight) !== null
  )
}

export function getLegalAnchorPoints(
  asset: Pick<AssetDefinition, 'intrinsicWidth' | 'intrinsicHeight'>,
): AnchorPoint[] {
  const points: AnchorPoint[] = []
  for (let x = EDITOR_GRID_SIZE; x < asset.intrinsicWidth; x += EDITOR_GRID_SIZE) {
    points.push({ x, y: 0, direction: 'top' })
    points.push({ x, y: asset.intrinsicHeight, direction: 'bottom' })
  }
  for (let y = EDITOR_GRID_SIZE; y < asset.intrinsicHeight; y += EDITOR_GRID_SIZE) {
    points.push({ x: 0, y, direction: 'left' })
    points.push({ x: asset.intrinsicWidth, y, direction: 'right' })
  }
  return points
}

export function getNextAnchorName(
  anchors: SymbolAnchor[],
  type: AnchorType,
) {
  const label = getAnchorTypeLabel(type)
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedLabel} (\\d+)$`)
  const highest = anchors.reduce((current, anchor) => {
    if (anchor.type !== type) return current
    const match = anchor.name.match(pattern)
    return match ? Math.max(current, Number(match[1])) : current
  }, 0)
  return `${label} ${highest + 1}`
}

export function isAutomaticAnchorName(name: string, type: AnchorType) {
  const label = getAnchorTypeLabel(type)
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escapedLabel} \\d+$`).test(name)
}

export function createSymbolAnchor(
  asset: Pick<AssetDefinition, 'category' | 'intrinsicWidth' | 'intrinsicHeight' | 'anchors'>,
  point: Pick<AnchorPoint, 'x' | 'y'>,
  lineSystemType?: LineSystemType,
): SymbolAnchor {
  const direction = deriveAnchorDirection(
    point.x,
    point.y,
    asset.intrinsicWidth,
    asset.intrinsicHeight,
  )
  if (!direction || !isLegalAnchorPoint(point, asset)) {
    throw new Error('锚点只能添加在图元边缘的 8px 网格点，四个角不可用。')
  }
  if (asset.anchors.some((anchor) => anchor.x === point.x && anchor.y === point.y)) {
    throw new Error('该位置已有锚点。')
  }

  const type = getDefaultAnchorType(asset.category, lineSystemType)
  return {
    id: `anchor-${crypto.randomUUID()}`,
    name: getNextAnchorName(asset.anchors, type),
    x: point.x,
    y: point.y,
    direction,
    type,
  }
}

export function constrainAnchorDrag(
  anchor: SymbolAnchor,
  pointer: Pick<AnchorPoint, 'x' | 'y'>,
  asset: Pick<AssetDefinition, 'intrinsicWidth' | 'intrinsicHeight'>,
): AnchorPoint {
  const snap = (value: number, maximum: number) =>
    Math.min(maximum - EDITOR_GRID_SIZE, Math.max(EDITOR_GRID_SIZE, Math.round(value / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE))

  if (anchor.direction === 'top' || anchor.direction === 'bottom') {
    return {
      x: snap(pointer.x, asset.intrinsicWidth),
      y: anchor.direction === 'top' ? 0 : asset.intrinsicHeight,
      direction: anchor.direction,
    }
  }

  return {
    x: anchor.direction === 'left' ? 0 : asset.intrinsicWidth,
    y: snap(pointer.y, asset.intrinsicHeight),
    direction: anchor.direction,
  }
}

export function transformAnchorToElement(
  anchor: SymbolAnchor,
  asset: Pick<AssetDefinition, 'intrinsicWidth' | 'intrinsicHeight'>,
  element: Pick<DiagramElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
): TransformedAnchorPoint {
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  }
  const unrotated = {
    x: element.x + (anchor.x / asset.intrinsicWidth) * element.width,
    y: element.y + (anchor.y / asset.intrinsicHeight) * element.height,
  }
  const radians = (element.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const dx = unrotated.x - center.x
  const dy = unrotated.y - center.y
  const directionOrder: AnchorDirection[] = ['top', 'right', 'bottom', 'left']
  const directionIndex = directionOrder.indexOf(anchor.direction)
  const quarterTurns = ((Math.round(element.rotation / 90) % 4) + 4) % 4

  return {
    id: anchor.id,
    name: anchor.name,
    type: anchor.type,
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
    direction: directionOrder[(directionIndex + quarterTurns) % directionOrder.length],
  }
}
