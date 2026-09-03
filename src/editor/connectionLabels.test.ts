import { describe, expect, it } from 'vitest'

import type { ConnectionNetwork } from '../domain/project'
import type { RoutedConnectionEdge } from './connections'
import { monitorMetricReadingKey } from '../monitoring/elementMetrics'
import {
  CONNECTION_LABEL_ENDPOINT_GAP,
  CONNECTION_LABEL_ENDPOINT_PADDING,
  connectionLabelPlacementForPointer,
  layoutConnectionLabels,
} from './connectionLabels'
import { estimateLabelTextWidth } from './elementLabels'

function network(patch: Partial<ConnectionNetwork['edges'][number]> = {}): ConnectionNetwork {
  return {
    id: 'network-1',
    diagramId: 'diagram-1',
    type: 'electrical',
    nodes: [
      { id: 'node-a', kind: 'busbar-tap', busbarId: 'busbar-a', offset: 0 },
      { id: 'node-b', kind: 'busbar-tap', busbarId: 'busbar-b', offset: 0 },
    ],
    edges: [{
      id: 'edge-1',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      ...patch,
    }],
  }
}

function route(points = [{ x: 0, y: 40 }, { x: 80, y: 40 }]): RoutedConnectionEdge {
  return {
    networkId: 'network-1',
    edgeId: 'edge-1',
    type: 'electrical',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    points,
    order: 0,
  }
}

describe('connection labels', () => {
  it('omits empty and individually hidden labels', () => {
    expect(layoutConnectionLabels([route()], [network()])).toEqual([])
    expect(layoutConnectionLabels([route()], [network({
      label: '联络线',
      labelVisible: false,
    })])).toEqual([])
  })

  it('lays out monitoring rows independently from child-line label visibility', () => {
    const monitored = network({
      label: '馈线 01',
      labelVisible: false,
      monitorDataVisible: true,
      monitorMetricLabelsVisible: true,
      monitorMetrics: [{
        id: 'current',
        name: '电流',
        valueType: 'number',
        unit: 'A',
        precision: 1,
        simulationMin: 0,
        simulationMax: 100,
        alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
      }],
    })
    const [layout] = layoutConnectionLabels([route()], [monitored], null, {
      readings: {
        [monitorMetricReadingKey('edge-1', 'current')]: {
          elementId: 'edge-1',
          metricId: 'current',
          value: 88.3,
          severity: 'major',
        },
      },
    })

    expect(layout.nameText).toBeNull()
    expect(layout.bounds.height).toBe(16)
    expect(layout.metricRows).toEqual([
      expect.objectContaining({
        labelText: '电流(A)',
        labelVisible: true,
        valueText: '88.3',
        severity: 'major',
      }),
    ])

    monitored.edges[0].labelVisible = true
    monitored.edges[0].monitorMetricLabelsVisible = false
    const [withName] = layoutConnectionLabels([route()], [monitored], null, {
      readings: {
        [monitorMetricReadingKey('edge-1', 'current')]: {
          elementId: 'edge-1',
          metricId: 'current',
          value: 50,
          severity: 'normal',
        },
      },
    })
    expect(withName.nameText).toBe('馈线 01')
    expect(withName.bounds.height).toBe(32)
    expect(withName.metricRows[0]).toMatchObject({
      labelVisible: false,
      valueText: '50.0',
    })
  })

  it('keeps the running-data column intrinsic when the child-line name is longer', () => {
    const monitored = network({
      label: '这是一条非常长但不应拉宽运行数据列的子线标签名称',
      monitorDataVisible: true,
      monitorMetrics: [
        {
          id: 'short-value',
          name: '非常长的电流指标名称',
          valueType: 'text',
          textOptions: [{ id: 'on', value: '开', severity: 'normal' }],
        },
        {
          id: 'long-value',
          name: '状态',
          valueType: 'text',
          textOptions: [{ id: 'offline', value: '设备完全离线', severity: 'critical' }],
        },
      ],
    })
    const readings = {
      [monitorMetricReadingKey('edge-1', 'short-value')]: {
        elementId: 'edge-1',
        metricId: 'short-value',
        value: '开',
        severity: 'normal' as const,
      },
      [monitorMetricReadingKey('edge-1', 'long-value')]: {
        elementId: 'edge-1',
        metricId: 'long-value',
        value: '设备完全离线',
        severity: 'critical' as const,
      },
    }
    const [endAligned] = layoutConnectionLabels(
      [route()],
      [monitored],
      null,
      { readings },
    )
    const [startAligned] = layoutConnectionLabels(
      [route()],
      [network({ ...monitored.edges[0], labelEndpoint: 'source' })],
      null,
      { readings },
    )
    const expectedValueWidth = estimateLabelTextWidth('设备完全离线')

    expect(endAligned.metricRows.map((row) => row.valueBounds.width))
      .toEqual([expectedValueWidth, expectedValueWidth])
    expect(endAligned.metricRows.map((row) => row.valueX))
      .toEqual([endAligned.metricRows[0].valueX, endAligned.metricRows[0].valueX])
    expect(endAligned.metricRows[0].valueX).toBe(endAligned.bounds.x + endAligned.bounds.width - 2)
    expect(startAligned.metricRows.map((row) => row.valueBounds.width))
      .toEqual([expectedValueWidth, expectedValueWidth])
    expect(startAligned.metricRows.map((row) => row.valueX))
      .toEqual([startAligned.metricRows[0].valueX, startAligned.metricRows[0].valueX])
    expect(startAligned.metricRows[0].valueX)
      .toBeLessThan(startAligned.bounds.x + startAligned.bounds.width - 2)
  })

  it('places horizontal endpoint labels above or below the nearby segment', () => {
    const [above] = layoutConnectionLabels([route()], [network({ label: '联络线' })])
    const [below] = layoutConnectionLabels([route()], [network({
      label: '联络线',
      labelEndpoint: 'source',
      labelSide: 'positive',
    })])

    expect(CONNECTION_LABEL_ENDPOINT_GAP).toBe(8)
    expect(CONNECTION_LABEL_ENDPOINT_PADDING).toBe(8)
    expect(above).toMatchObject({
      endpoint: 'target',
      side: 'negative',
      orientation: 'horizontal',
      axisAlignment: 'right',
      textAnchor: 'end',
    })
    expect(above.bounds.y + above.bounds.height).toBe(40 - CONNECTION_LABEL_ENDPOINT_GAP)
    expect(above.bounds.x + above.bounds.width).toBe(80 - CONNECTION_LABEL_ENDPOINT_PADDING)
    expect(above.textX).toBe(80 - CONNECTION_LABEL_ENDPOINT_PADDING)
    expect(below.bounds.y).toBe(40 + CONNECTION_LABEL_ENDPOINT_GAP)
    expect(below).toMatchObject({ axisAlignment: 'left', textAnchor: 'start' })
    expect(below.bounds.x).toBe(CONNECTION_LABEL_ENDPOINT_PADDING)
    expect(below.textX).toBe(CONNECTION_LABEL_ENDPOINT_PADDING)
  })

  it('places vertical endpoint labels to the left or right of the nearby segment', () => {
    const verticalRoute = route([{ x: 24, y: 0 }, { x: 24, y: 96 }])
    const [left] = layoutConnectionLabels([verticalRoute], [network({ label: '竖向子线' })])
    const [right] = layoutConnectionLabels([verticalRoute], [network({
      label: '竖向子线',
      labelSide: 'positive',
    })])

    expect(left).toMatchObject({
      orientation: 'vertical',
      side: 'negative',
      axisAlignment: 'bottom',
    })
    expect(left.bounds.x + left.bounds.width).toBe(24 - CONNECTION_LABEL_ENDPOINT_GAP)
    expect(left.textX).toBe(24 - CONNECTION_LABEL_ENDPOINT_GAP)
    expect(left.bounds.y + left.bounds.height).toBe(96 - CONNECTION_LABEL_ENDPOINT_PADDING)
    expect(right.bounds.x).toBe(24 + CONNECTION_LABEL_ENDPOINT_GAP)
    expect(right).toMatchObject({ axisAlignment: 'bottom' })
    expect(right.textX).toBe(24 + CONNECTION_LABEL_ENDPOINT_GAP)

    const [topAligned] = layoutConnectionLabels([verticalRoute], [network({
      label: '竖向子线',
      labelEndpoint: 'source',
    })])
    expect(topAligned).toMatchObject({ axisAlignment: 'top' })
    expect(topAligned.bounds.y).toBe(CONNECTION_LABEL_ENDPOINT_PADDING)
  })

  it('selects the nearest endpoint and the pointer side from local segment orientation', () => {
    const dogleg = route([
      { x: 0, y: 40 },
      { x: 64, y: 40 },
      { x: 64, y: 120 },
    ])

    expect(connectionLabelPlacementForPointer(dogleg, { x: 8, y: 20 }))
      .toEqual({ endpoint: 'source', side: 'negative' })
    expect(connectionLabelPlacementForPointer(dogleg, { x: 90, y: 112 }))
      .toEqual({ endpoint: 'target', side: 'positive' })
  })

  it('uses transient placement without mutating the persisted edge', () => {
    const persisted = network({ label: '联络线' })
    const [layout] = layoutConnectionLabels([route()], [persisted], {
      edgeId: 'edge-1',
      endpoint: 'source',
      side: 'positive',
    })

    expect(layout).toMatchObject({ endpoint: 'source', side: 'positive' })
    expect(persisted.edges[0].labelEndpoint).toBeUndefined()
    expect(persisted.edges[0].labelSide).toBeUndefined()
  })
})
