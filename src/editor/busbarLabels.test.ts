import { describe, expect, it } from 'vitest'

import type { Busbar } from '../domain/project'
import {
  BUSBAR_LABEL_ENDPOINT_GAP,
  busbarLabelEndpointForPointer,
  layoutBusbarLabels,
} from './busbarLabels'

function busbar(patch: Partial<Busbar> = {}): Busbar {
  return {
    id: 'busbar-1',
    diagramId: 'diagram-1',
    type: 'electrical',
    orientation: 'horizontal',
    x: 16,
    y: 80,
    length: 160,
    ...patch,
  }
}

describe('busbar labels', () => {
  it('does not create a label until content is provided', () => {
    expect(layoutBusbarLabels([busbar()])).toEqual([])
    expect(layoutBusbarLabels([busbar({ label: '  ' } as Partial<Busbar>)]))
      .toEqual([])
  })

  it('omits only busbars whose label visibility is disabled', () => {
    expect(layoutBusbarLabels([
      busbar({ id: 'visible-busbar', label: '主母线' }),
      busbar({ id: 'hidden-busbar', label: '备用母线', labelVisible: false }),
    ]).map((layout) => layout.busbarId)).toEqual(['visible-busbar'])
  })

  it('places horizontal labels outside the selected endpoint', () => {
    const [endLayout] = layoutBusbarLabels([busbar({ label: '主母线' })])
    const [startLayout] = layoutBusbarLabels([busbar({
      label: '主母线',
      labelEndpoint: 'start',
    })])

    expect(BUSBAR_LABEL_ENDPOINT_GAP).toBe(8)
    expect(endLayout.endpoint).toBe('end')
    expect(endLayout.bounds.x).toBe(176 + BUSBAR_LABEL_ENDPOINT_GAP)
    expect(startLayout.bounds.x + startLayout.bounds.width)
      .toBe(16 - BUSBAR_LABEL_ENDPOINT_GAP)
  })

  it('places vertical labels above or below the two endpoints', () => {
    const [startLayout] = layoutBusbarLabels([busbar({
      orientation: 'vertical',
      label: '竖母线',
      labelEndpoint: 'start',
    })])
    const [endLayout] = layoutBusbarLabels([busbar({
      orientation: 'vertical',
      label: '竖母线',
      labelEndpoint: 'end',
    })])

    expect(startLayout.bounds.y + startLayout.bounds.height)
      .toBe(80 - BUSBAR_LABEL_ENDPOINT_GAP)
    expect(endLayout.bounds.y).toBe(240 + BUSBAR_LABEL_ENDPOINT_GAP)
  })

  it('selects only the start or end side from the pointer axis', () => {
    const current = busbar()
    expect(busbarLabelEndpointForPointer(current, { x: 20, y: 200 })).toBe('start')
    expect(busbarLabelEndpointForPointer(current, { x: 170, y: -100 })).toBe('end')
  })
})
