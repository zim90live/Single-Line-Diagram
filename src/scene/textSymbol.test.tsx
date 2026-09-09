import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DiagramElement } from '../domain/project'
import { DiagramElementVisual } from './DiagramScenePrimitives'
import { symbolsByKey } from './symbolCatalog'
import { textSymbolSize, textSymbolStyle } from './textSymbol'

describe('文字图元', () => {
  it('defaults to 24px Bold gray with grid-aligned bounds and no anchors', () => {
    expect(textSymbolStyle({})).toEqual({ text: '文字', fontSize: 24, fontWeight: 700, color: '#888888' })
    expect(textSymbolSize({})).toEqual({ width: 64, height: 40 })
    expect(symbolsByKey.get('text')).toMatchObject({ category: '通用', renderMode: 'text', anchors: [] })
  })
  it('renders custom plain text without an image or visible background', () => {
    const properties = { text: 'POD A', fontSize: 32, fontWeight: 400, textColor: '#abcdef' }
    const element: DiagramElement = {
      id: 'text-1', diagramId: 'diagram', assetKey: 'text', name: '文字',
      x: 0, y: 0, ...textSymbolSize(properties), rotation: 90, properties, extensions: {},
    }
    const onPointerDown = vi.fn()
    const { container } = render(<svg style={{ pointerEvents: 'none' }}><DiagramElementVisual element={element}
      symbol={symbolsByKey.get('text')} visualState="off" clipPathId="text-clip" onPointerDown={onPointerDown} /></svg>)
    const text = container.querySelector('text')!
    expect(text.textContent).toBe('POD A')
    expect(text.getAttribute('font-size')).toBe('32')
    expect(text.getAttribute('font-weight')).toBe('400')
    expect(text.getAttribute('fill')).toBe('#abcdef')
    expect(container.querySelector('image')).toBeNull()
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('transparent')
    const hit = container.querySelector('.diagram-element__text-hit')!
    expect(hit.getAttribute('pointer-events')).toBe('all')
    fireEvent.pointerDown(hit, { button: 0, clientX: 16, clientY: 16 })
    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(container.querySelector('[transform]')).toBeNull() // Rotation belongs to the caller.
    expect(textSymbolStyle(JSON.parse(JSON.stringify(properties)))).toEqual(textSymbolStyle(properties))
  })
  it('normalizes invalid settings and grows bounds for longer text', () => {
    expect(textSymbolStyle({ fontSize: -1, fontWeight: 123, textColor: 'invalid' }))
      .toMatchObject({ fontSize: 8, fontWeight: 700, color: '#888888' })
    expect(textSymbolSize({ text: '更长的文字说明' }).width).toBeGreaterThan(64)
  })
})
