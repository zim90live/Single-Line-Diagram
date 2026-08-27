import type { DiagramElement } from '../domain/project'

export const GENERIC_SYMBOL_KEY = 'generic'
export const GENERIC_SYMBOL_DEFAULT_WIDTH = 96
export const GENERIC_SYMBOL_DEFAULT_HEIGHT = 48
export const GENERIC_SYMBOL_MIN_WIDTH = 32
export const GENERIC_SYMBOL_MIN_HEIGHT = 24
export const GENERIC_SYMBOL_TAG_FONT_SIZE = 10
export const GENERIC_SYMBOL_TAG_HORIZONTAL_PADDING = 12

function snapDimension(value: number, minimum: number, gridSize: number) {
  return Math.max(minimum, Math.round(value / gridSize) * gridSize)
}

export function isGenericSymbolKey(assetKey: string) {
  return assetKey === GENERIC_SYMBOL_KEY
}

export function getSnappedGenericSymbolSize(
  width: number,
  height: number,
  gridSize: number,
) {
  return {
    width: snapDimension(width, GENERIC_SYMBOL_MIN_WIDTH, gridSize),
    height: snapDimension(height, GENERIC_SYMBOL_MIN_HEIGHT, gridSize),
  }
}

export function genericSymbolDisplayedWidth(element: DiagramElement) {
  const rotation = ((element.rotation % 360) + 360) % 360
  return rotation === 90 || rotation === 270 ? element.height : element.width
}

function estimatedTagWidth(text: string) {
  let width = 0
  for (const character of text) {
    if (/\s/u.test(character)) width += GENERIC_SYMBOL_TAG_FONT_SIZE / 3
    else if (/^[\x00-\x7F]$/u.test(character)) width += GENERIC_SYMBOL_TAG_FONT_SIZE * 0.6
    else width += GENERIC_SYMBOL_TAG_FONT_SIZE
  }
  return width
}

export function fitGenericSymbolTag(text: string, displayedWidth: number) {
  const normalized = text.trim()
  if (!normalized) return ''
  const availableWidth = Math.max(
    GENERIC_SYMBOL_TAG_FONT_SIZE,
    displayedWidth - GENERIC_SYMBOL_TAG_HORIZONTAL_PADDING,
  )
  if (estimatedTagWidth(normalized) <= availableWidth) return normalized

  const ellipsis = '…'
  const characters = [...normalized]
  let visible = ''
  for (const character of characters) {
    if (estimatedTagWidth(`${visible}${character}${ellipsis}`) > availableWidth) break
    visible += character
  }
  return `${visible}${ellipsis}`
}
