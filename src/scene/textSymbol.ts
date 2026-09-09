import type { DiagramElement } from '../domain/project'

export const TEXT_SYMBOL_KEY = 'text'
export const DEFAULT_TEXT_COLOR = '#888888'

export function textSymbolStyle(properties: DiagramElement['properties']) {
  return {
    text: typeof properties.text === 'string' ? properties.text : '文字',
    color: typeof properties.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(properties.textColor)
      ? properties.textColor : DEFAULT_TEXT_COLOR,
    fontSize: typeof properties.fontSize === 'number' && Number.isFinite(properties.fontSize)
      ? Math.max(8, Math.min(256, properties.fontSize)) : 24,
    fontWeight: typeof properties.fontWeight === 'number' && [400, 500, 600, 700, 800, 900].includes(properties.fontWeight)
      ? properties.fontWeight : 700,
  }
}

// Reserve a grid-aligned selection area; text itself has no background or border.
export function textSymbolSize(properties: DiagramElement['properties']) {
  const { text, fontSize } = textSymbolStyle(properties)
  const units = [...text].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : 0.65), 0)
  return {
    width: Math.max(16, Math.ceil((units * fontSize + 16) / 8) * 8),
    height: Math.ceil(fontSize * 1.5 / 8) * 8,
  }
}
