import { describe, expect, it } from 'vitest'

import type { AssetDefinition, DiagramElement } from '../domain/project'
import { monitorMetricReadingKey } from '../monitoring/elementMetrics'
import {
  positionMonitorMetricLabelRows,
  ELEMENT_LABEL_AVOIDANCE_STEP,
  ELEMENT_LABEL_FONT_SIZE,
  ELEMENT_LABEL_GAP,
  ELEMENT_LABEL_LINE_HEIGHT,
  ELEMENT_METRIC_COLUMN_GAP,
  elementDeviceIdentifier,
  estimateLabelTextWidth,
  labelPlacementForPointer,
  layoutElementLabels,
  monitorMetricLabelColumnWidths,
  nextDeviceIdentifier,
} from './elementLabels'

const asset: AssetDefinition = {
  key: 'chwp',
  name: 'CHWP',
  category: '冷却',
  source: 'CHWP.svg',
  intrinsicWidth: 80,
  intrinsicHeight: 40,
  anchors: [{
    id: 'bottom-anchor',
    name: '一次回路冷 1',
    x: 40,
    y: 40,
    direction: 'bottom',
    type: 'cooling-primary-cold',
  }],
}

function element(patch: Partial<DiagramElement> = {}): DiagramElement {
  return {
    id: 'element-1',
    diagramId: 'diagram-1',
    assetKey: asset.key,
    name: asset.name,
    x: 0,
    y: 0,
    width: 80,
    height: 40,
    rotation: 0,
    properties: { tag: 'CHWP-01' },
    extensions: {},
    ...patch,
  }
}

describe('element label layout', () => {
  it('ignores other elements and labels regardless of ordering', () => {
    const item = element()
    const assets = new Map([[asset.key, asset]])
    const baseline = layoutElementLabels([item], assets)[0]
    const overlappingElement = element({ id: 'obstacle', x: 0, y: 42 })
    const overlappingLabel = element({ id: 'same-position' })
    for (const items of [
      [overlappingElement, overlappingLabel, item],
      [item, overlappingLabel, overlappingElement],
    ]) {
      expect(layoutElementLabels(items, assets).find(row => row.elementId === item.id))
        .toEqual(baseline)
    }
  })
  it('scales only the element label geometry and preserves placement', () => {
    const item = element({ labelPlacement: 'right' })
    const base = layoutElementLabels([item], new Map([[asset.key, asset]]))[0]
    const larger = layoutElementLabels([item], new Map([[asset.key, asset]]), { scale: 1.5 })[0]
    expect(larger.bounds.width).toBe(base.bounds.width * 1.5)
    expect(larger.bounds.height).toBe(base.bounds.height * 1.5)
    expect(larger.bounds.x).toBe(base.bounds.x)
    expect(larger.scale).toBe(1.5)
  })
  it('left-aligns metric names beside one compact value column', () => {
    const lines = ['状态', '有功功率(kW)'].map((labelText, index) => ({ metricId: String(index), label: labelText, labelText, labelVisible: true, valueText: '50', unit: '', severity: 'normal' as const, ariaLabel: labelText }))
    const rows = positionMonitorMetricLabelRows(lines, { x: 0, y: 0, width: 200, height: 32 }, 0)
    expect(rows[0].labelX).toBe(rows[1].labelX)
    expect(rows[0].labelX).toBe(2)
  })
  it('keeps UPS numeric values compact independently of a long supply status', () => {
    const lines = ['主路供电', '25.0', '17.4', '39.4'].map((valueText, index) => ({
      metricId: String(index), valueType: index === 0 ? 'text' as const : 'number' as const,
      label: index === 0 ? '供电方式' : `L${index} 输入电流(A)`, labelText: index === 0 ? '供电方式' : `L${index} 输入电流(A)`,
      labelVisible: true, valueText, unit: '', severity: 'normal' as const, ariaLabel: valueText,
    }))
    const rows = positionMonitorMetricLabelRows(lines, { x: 0, y: 0, width: 200, height: 64 }, 0)
    expect(rows.every(row => row.labelX === 2)).toBe(true)
    expect(rows.slice(1).every(row => row.valueX === rows[1].valueX)).toBe(true)
    expect(rows[1].valueBounds.width).toBe(estimateLabelTextWidth('25.0'))
    expect(rows[0].valueBounds.width).toBe(estimateLabelTextWidth('主路供电'))
    const extended = positionMonitorMetricLabelRows([{ ...lines[0], valueText: '更加长的供电状态' }, ...lines.slice(1)], { x: 0, y: 0, width: 240, height: 64 }, 0)
    expect(extended[1].valueX).toBe(rows[1].valueX)
  })
  it('uses the device identifier and generates the next unused default', () => {
    const current = element()
    expect(ELEMENT_LABEL_FONT_SIZE).toBe(10)
    expect(ELEMENT_LABEL_GAP).toBe(2)
    expect(ELEMENT_LABEL_AVOIDANCE_STEP).toBe(2)
    expect(elementDeviceIdentifier(current)).toBe('CHWP-01')
    expect(nextDeviceIdentifier('CHWP', 'diagram-1', [current])).toBe('CHWP-02')
  })

  it('selects a canvas-relative side from the pointer', () => {
    const current = element({ rotation: 90 })
    expect(labelPlacementForPointer(current, { x: 40, y: -40 })).toBe('top')
    expect(labelPlacementForPointer(current, { x: 120, y: 20 })).toBe('right')
  })

  it('does not avoid an anchor corridor until that anchor is connected', () => {
    const assets = new Map([[asset.key, asset]])
    const [unconnectedLayout] = layoutElementLabels([element()], assets)
    expect(unconnectedLayout.placement).toBe('bottom')

    const [layout] = layoutElementLabels([element()], assets, {
      connectedAnchorIdsByElement: new Map([[
        'element-1',
        new Set(['bottom-anchor']),
      ]]),
    })
    expect(layout.placement).not.toBe('bottom')
  })

  it('omits only elements whose label visibility is disabled', () => {
    const layouts = layoutElementLabels([
      element({ id: 'visible-element' }),
      element({ id: 'hidden-element', x: 160, labelVisible: false }),
    ], new Map([[asset.key, asset]]))

    expect(layouts.map((layout) => layout.elementId)).toEqual(['visible-element'])
  })

  it('combines the optional device name and supplied metrics in edit and monitor layouts', () => {
    const current = element({
      labelVisible: false,
      monitorDataVisible: true,
      monitorMetrics: [
        {
          id: 'temperature',
          name: '出水温度',
          valueType: 'number',
          unit: '°C',
          precision: 1,
          simulationMin: 0,
          simulationMax: 100,
          alarm: { mode: 'upper', minor: 60, major: 75, critical: 90 },
        },
        {
          id: 'running-state',
          name: '运行状态',
          valueType: 'text',
          textOptions: [{ id: 'offline', value: '离线', severity: 'critical' }],
        },
      ],
    })
    const key = monitorMetricReadingKey(current.id, 'temperature')
    const textKey = monitorMetricReadingKey(current.id, 'running-state')
    const [layout] = layoutElementLabels([current], new Map([[asset.key, asset]]), {
      readings: {
        [key]: {
          elementId: current.id,
          metricId: 'temperature',
          value: 82.34,
          severity: 'major',
        },
        [textKey]: {
          elementId: current.id,
          metricId: 'running-state',
          value: '离线',
          severity: 'critical',
        },
      },
    })

    expect(layout.nameText).toBeNull()
    expect(layout.bounds.height).toBe(32)
    expect(layout.metricRows).toEqual([
      expect.objectContaining({
        label: '出水温度',
        labelText: '出水温度(°C)',
        labelVisible: true,
        valueText: '82.3',
        unit: '°C',
        severity: 'major',
        valueBounds: {
          x: layout.bounds.x + layout.bounds.width - estimateLabelTextWidth('82.3'),
          y: layout.bounds.y,
          width: estimateLabelTextWidth('82.3'),
          height: ELEMENT_LABEL_LINE_HEIGHT,
        },
      }),
      expect.objectContaining({
        label: '运行状态',
        labelText: '运行状态',
        labelVisible: true,
        valueText: '离线',
        unit: '',
        severity: 'critical',
        valueBounds: {
          x: layout.bounds.x + layout.bounds.width - estimateLabelTextWidth('82.3'),
          y: layout.bounds.y + ELEMENT_LABEL_LINE_HEIGHT,
          width: estimateLabelTextWidth('离线'),
          height: ELEMENT_LABEL_LINE_HEIGHT,
        },
      }),
    ])
    expect(layout.text).toContain('出水温度(°C)\t82.3')
    expect(layout.text).not.toContain('82.3°C')
    expect(layout.text).not.toContain('CHWP-01')
    const widestMetricRow = layout.metricRows[0]
    expect(
      widestMetricRow.valueBounds.x -
      (layout.bounds.x + estimateLabelTextWidth(widestMetricRow.labelText)),
    ).toBe(ELEMENT_METRIC_COLUMN_GAP)

    const [valuesOnlyLayout] = layoutElementLabels([{
      ...current,
      monitorMetricLabelsVisible: false,
    }], new Map([[asset.key, asset]]), {
      readings: {
        [key]: {
          elementId: current.id,
          metricId: 'temperature',
          value: 82.34,
          severity: 'major',
        },
        [textKey]: {
          elementId: current.id,
          metricId: 'running-state',
          value: '离线',
          severity: 'critical',
        },
      },
    })
    expect(valuesOnlyLayout.metricRows).toEqual([
      expect.objectContaining({ labelVisible: false, valueText: '82.3' }),
      expect.objectContaining({ labelVisible: false, valueText: '离线' }),
    ])
    expect(valuesOnlyLayout.text).toBe('82.3\n离线')
    expect(valuesOnlyLayout.bounds.width).toBeLessThan(layout.bounds.width)
    expect(valuesOnlyLayout.metricRows[0].valueBounds.width).toBe(
      layout.metricRows[0].valueBounds.width,
    )
    expect(valuesOnlyLayout.metricRows[0].valueBounds.x).toBe(valuesOnlyLayout.bounds.x)
    expect(valuesOnlyLayout.metricRows[0].ariaLabel).toContain('出水温度(°C)')
  })

  it('sizes the running-data column from the longest value only', () => {
    const current = element({
      properties: { tag: 'VERY-LONG-DEVICE-IDENTIFIER-THAT-MUST-NOT-STRETCH-DATA' },
      monitorDataVisible: true,
      monitorMetrics: [
        {
          id: 'long-label',
          name: '这是一个明显比其他指标更长的指标名称',
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
      [monitorMetricReadingKey(current.id, 'long-label')]: {
        elementId: current.id,
        metricId: 'long-label',
        value: '开',
        severity: 'normal' as const,
      },
      [monitorMetricReadingKey(current.id, 'long-value')]: {
        elementId: current.id,
        metricId: 'long-value',
        value: '设备完全离线',
        severity: 'critical' as const,
      },
    }
    const [layout] = layoutElementLabels(
      [current],
      new Map([[asset.key, asset]]),
      { readings },
    )
    const columns = monitorMetricLabelColumnWidths(layout.metricRows)
    const expectedValueWidth = estimateLabelTextWidth('设备完全离线')

    expect(columns.value).toBe(expectedValueWidth)
    expect(layout.metricRows.map((row) => row.valueBounds.width))
      .toEqual([expectedValueWidth, expectedValueWidth])
    expect(layout.metricRows.map((row) => row.valueBounds.x))
      .toEqual([layout.metricRows[0].valueBounds.x, layout.metricRows[0].valueBounds.x])
    expect(layout.metricRows.map((row) => row.valueX))
      .toEqual([layout.metricRows[0].valueX, layout.metricRows[0].valueX])
    expect(layout.bounds.width).toBeGreaterThan(columns.total)

    for (const placement of ['top', 'right', 'bottom', 'left'] as const) {
      const [shortNameLayout] = layoutElementLabels(
        [{
          ...current,
          labelPlacement: placement,
          properties: { tag: 'SHORT' },
        }],
        new Map([[asset.key, asset]]),
        { readings },
      )
      const [longNameLayout] = layoutElementLabels(
        [{ ...current, labelPlacement: placement }],
        new Map([[asset.key, asset]]),
        { readings },
      )
      expect(longNameLayout.metricRows[0].valueBounds)
        .toEqual(shortNameLayout.metricRows[0].valueBounds)
    }
  })

  it('keeps a generic symbol identifier inside the frame while laying metrics outside', () => {
    const genericAsset: AssetDefinition = {
      ...asset,
      key: 'generic',
      name: '通用图元',
      category: '通用',
      intrinsicWidth: 96,
      intrinsicHeight: 48,
      anchors: [],
    }
    const current = element({
      assetKey: 'generic',
      name: '通用图元',
      width: 96,
      height: 48,
      properties: { tag: 'AHU-01' },
      monitorDataVisible: true,
      monitorMetrics: [{
        id: 'power',
        name: '有功功率',
        valueType: 'number',
        unit: 'kW',
        precision: 1,
        simulationMin: 0,
        simulationMax: 100,
        alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
      }],
    })
    const key = monitorMetricReadingKey(current.id, 'power')
    const [layout] = layoutElementLabels(
      [current],
      new Map([[genericAsset.key, genericAsset]]),
      {
        readings: {
          [key]: {
            elementId: current.id,
            metricId: 'power',
            value: 42.4,
            severity: 'normal',
          },
        },
      },
    )

    expect(layout.nameText).toBeNull()
    expect(layout.text).toBe('有功功率(kW)\t42.4')
    expect(layout.metricRows).toHaveLength(1)
  })

  it('keeps a manually selected side after element rotation and shifts along that side', () => {
    const current = element({ rotation: 90, labelPlacement: 'bottom' })
    const [layout] = layoutElementLabels([current], new Map([[asset.key, asset]]))
    expect(layout.placement).toBe('bottom')
    expect(layout.bounds.y).toBe(62)
  })

  it('keeps large-diagram label derivation lightweight', () => {
    const elements = Array.from({ length: 80 }, (_, index) => element({
      id: `element-${index}`,
      x: (index % 10) * 240,
      y: Math.floor(index / 10) * 120,
      properties: { tag: `CHWP-${String(index + 1).padStart(2, '0')}` },
    }))
    const assets = new Map([[asset.key, asset]])
    const start = performance.now()
    for (let index = 0; index < 20; index += 1) layoutElementLabels(elements, assets)
    expect(performance.now() - start).toBeLessThan(120)
  })
})
