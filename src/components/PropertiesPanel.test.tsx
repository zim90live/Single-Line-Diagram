import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DiagramElement } from '../domain/project'
import { DEFAULT_CONFIGURABLE_SYMBOL_COLOR } from '../editor/symbolCatalog'
import { PropertiesPanel } from './PropertiesPanel'

function element(assetKey: string, properties: DiagramElement['properties'] = {}): DiagramElement {
  return {
    id: `${assetKey}-element`,
    diagramId: 'diagram-1',
    assetKey,
    name: assetKey,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    rotation: 0,
    properties,
    extensions: {},
  }
}

describe('PropertiesPanel color property', () => {
  it('shows color editing for a supported symbol and commits the selected color', () => {
    const onPatch = vi.fn()
    const onColorPreview = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('2-wv')]}
        onPatch={onPatch}
        onColorPreview={onColorPreview}
        onDelete={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('图元颜色')
    expect(input).toHaveValue(DEFAULT_CONFIGURABLE_SYMBOL_COLOR.toLowerCase())
    for (const color of ['#6688aa', '#6699bb', '#77aacc', '#77b4bf']) {
      fireEvent.input(input, { target: { value: color } })
    }

    expect(onPatch).not.toHaveBeenCalled()
    expect(onColorPreview).toHaveBeenCalledTimes(4)
    fireEvent.change(input, { target: { value: '#77b4bf' } })

    expect(onPatch).toHaveBeenCalledOnce()
    expect(onPatch).toHaveBeenLastCalledWith('2-wv-element', {
      properties: { color: '#77B4BF' },
    })
  })

  it('restores the default by removing the custom color property', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(
      <PropertiesPanel
        selectedElements={[element('switch', { tag: 'SW-01', color: '#E7A23B' })]}
        onPatch={onPatch}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '恢复默认' }))

    expect(onPatch).toHaveBeenCalledWith('switch-element', {
      properties: { tag: 'SW-01' },
    })
  })

  it('does not expose color editing for unsupported symbols', () => {
    render(
      <PropertiesPanel
        selectedElements={[element('chwp')]}
        onPatch={vi.fn()}
        onColorPreview={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('图元颜色')).not.toBeInTheDocument()
  })
})
