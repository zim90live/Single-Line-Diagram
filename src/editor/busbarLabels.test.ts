import { describe, expect, it } from 'vitest'

import type { Busbar } from '../domain/project'
import { createDefaultProject, parseProjectDocument } from '../domain/project'
import { generateMonitorMetricPreviewReadings } from '../monitoring/elementMetrics'
import {
  BUSBAR_LABEL_ENDPOINT_GAP,
  BUSBAR_LABEL_ENDPOINT_PADDING,
  BUSBAR_LABEL_FONT_SIZE,
  BUSBAR_LABEL_LINE_HEIGHT,
  busbarLabelPlacementForPointer,
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
  it('renders data without a title and preserves fields and project label scale in JSON', () => {
    const item = busbar({ monitorDataVisible: true, labelVisible: false, monitorMetrics: [{ id: 'status', name: '状态', valueType: 'text', textOptions: [{ id: 'normal', value: '正常', severity: 'normal' }] }] })
    const readings = generateMonitorMetricPreviewReadings([item])
    const layout = layoutBusbarLabels([item], readings)[0]
    expect(layout.text).toBe('')
    expect(layout.metricRows).toHaveLength(1)
    expect(layout.metricRows[0].valueText).toBe('正常')
    expect(layoutBusbarLabels([{ ...item, monitorDataVisible: false }], readings)).toEqual([])
    const project = createDefaultProject()
    project.busbars = [{ ...item, diagramId: project.diagrams.find(d => project.lineSystems.find(l => l.id === d.lineSystemId)?.type === 'power')!.id }]
    project.elementLabelScale = 1.5
    const restored = parseProjectDocument(JSON.parse(JSON.stringify(project)))
    expect(restored.elementLabelScale).toBe(1.5)
    expect(restored.busbars[0].monitorMetrics).toEqual(item.monitorMetrics)
  })
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

  it('uses a larger font and places horizontal labels inward on either perpendicular side', () => {
    const [endLayout] = layoutBusbarLabels([busbar({ label: '主母线' })])
    const [startLayout] = layoutBusbarLabels([busbar({
      label: '主母线',
      labelEndpoint: 'start',
      labelSide: 'positive',
    })])

    expect(BUSBAR_LABEL_ENDPOINT_GAP).toBe(8)
    expect(BUSBAR_LABEL_ENDPOINT_PADDING).toBe(8)
    expect(BUSBAR_LABEL_FONT_SIZE).toBe(14)
    expect(BUSBAR_LABEL_LINE_HEIGHT).toBe(20)
    expect(endLayout.endpoint).toBe('end')
    expect(endLayout.side).toBe('negative')
    expect(endLayout.bounds.x + endLayout.bounds.width)
      .toBe(176 - BUSBAR_LABEL_ENDPOINT_PADDING)
    expect(endLayout.bounds.y + endLayout.bounds.height)
      .toBe(80 - BUSBAR_LABEL_ENDPOINT_GAP)
    expect(startLayout.bounds.x).toBe(16 + BUSBAR_LABEL_ENDPOINT_PADDING)
    expect(startLayout.bounds.y).toBe(80 + BUSBAR_LABEL_ENDPOINT_GAP)
  })

  it('passes a custom label color through to the rendered layout', () => {
    const [layout] = layoutBusbarLabels([busbar({
      label: 'Main',
      labelColor: '#12AB34',
    })])

    expect(layout.color).toBe('#12AB34')
    expect(layout.bounds.height).toBe(BUSBAR_LABEL_LINE_HEIGHT)
  })

  it('places vertical labels inward and to the left or right of the selected endpoint', () => {
    const [startLayout] = layoutBusbarLabels([busbar({
      orientation: 'vertical',
      label: '竖母线',
      labelEndpoint: 'start',
    })])
    const [endLayout] = layoutBusbarLabels([busbar({
      orientation: 'vertical',
      label: '竖母线',
      labelEndpoint: 'end',
      labelSide: 'positive',
    })])

    expect(startLayout.side).toBe('negative')
    expect(startLayout.bounds.x + startLayout.bounds.width)
      .toBe(16 - BUSBAR_LABEL_ENDPOINT_GAP)
    expect(startLayout.bounds.y).toBe(80 + BUSBAR_LABEL_ENDPOINT_PADDING)
    expect(endLayout.bounds.x).toBe(16 + BUSBAR_LABEL_ENDPOINT_GAP)
    expect(endLayout.bounds.y + endLayout.bounds.height)
      .toBe(240 - BUSBAR_LABEL_ENDPOINT_PADDING)
  })

  it('selects the nearest endpoint and its perpendicular side from the pointer', () => {
    const current = busbar()
    expect(busbarLabelPlacementForPointer(current, { x: 20, y: 200 }))
      .toEqual({ endpoint: 'start', side: 'positive' })
    expect(busbarLabelPlacementForPointer(current, { x: 170, y: -100 }))
      .toEqual({ endpoint: 'end', side: 'negative' })

    const vertical = busbar({ orientation: 'vertical' })
    expect(busbarLabelPlacementForPointer(vertical, { x: -100, y: 90 }))
      .toEqual({ endpoint: 'start', side: 'negative' })
    expect(busbarLabelPlacementForPointer(vertical, { x: 200, y: 230 }))
      .toEqual({ endpoint: 'end', side: 'positive' })
  })
})
