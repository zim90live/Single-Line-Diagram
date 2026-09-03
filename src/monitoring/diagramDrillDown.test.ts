import { describe, expect, it } from 'vitest'

import type { Diagram, DiagramElement } from '../domain/project'
import {
  parentElementsLinkedToDiagram,
  resolveMonitorDrillDownTarget,
} from './diagramDrillDown'

function diagram(id: string, name: string, parentId?: string): Diagram {
  return {
    id,
    lineSystemId: 'power-line',
    parentId: parentId ?? null,
    name,
    level: parentId ? 'device' : 'pod',
    canvas: { gridSize: 8, viewport: { zoom: 1, tx: 0, ty: 0 } },
  }
}

function element(id: string, assetKey: string, x: number): DiagramElement {
  return {
    id,
    diagramId: 'pod',
    assetKey,
    name: assetKey,
    x,
    y: 0,
    width: 48,
    height: 48,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

describe('monitor diagram drill-down mapping', () => {
  it('maps CDU-01 in a cooling POD to TMU到FM 01 by its device identifier', () => {
    const cdu01 = {
      ...element('cdu-01', 'cdu', 200),
      name: 'CDU',
      properties: { tag: 'CDU-01' },
    }
    const cdu02 = {
      ...element('cdu-02', 'cdu', 400),
      name: 'CDU',
      properties: { tag: 'CDU-02' },
    }
    const document = {
      diagrams: [diagram('pod', 'POD A'), diagram('tmu-fm-01', 'TMU到FM 01', 'pod')],
      elements: [cdu01, cdu02],
    }

    expect(resolveMonitorDrillDownTarget(document, 'pod', cdu01)).toEqual({
      diagramId: 'tmu-fm-01',
      diagramName: 'TMU到FM 01',
    })
    expect(resolveMonitorDrillDownTarget(document, 'pod', cdu02)).toBeNull()
    expect(parentElementsLinkedToDiagram(document, 'tmu-fm-01')).toEqual([cdu01])
  })

  it('maps Tap-off Unit A and the left UPS bank to their named child diagrams', () => {
    const tapA = element('tap-a', 'cabinet', 200)
    const tapB = element('tap-b', 'cabinet-b', 400)
    const leftUpsA = element('ups-left-a', 'ups', 0)
    const leftUpsB = element('ups-left-b', 'ups', 0)
    const rightUps = element('ups-right', 'ups', 600)
    const document = {
      diagrams: [
        diagram('pod', 'POD A'),
        diagram('tap-left', '分接单元 L', 'pod'),
        diagram('ups-left', 'UPS L', 'pod'),
      ],
      elements: [tapA, tapB, leftUpsA, leftUpsB, rightUps],
    }

    expect(resolveMonitorDrillDownTarget(document, 'pod', tapA)).toEqual({
      diagramId: 'tap-left',
      diagramName: '分接单元 L',
    })
    expect(resolveMonitorDrillDownTarget(document, 'pod', tapB)).toBeNull()
    expect(resolveMonitorDrillDownTarget(document, 'pod', leftUpsA)).toEqual({
      diagramId: 'ups-left',
      diagramName: 'UPS L',
    })
    expect(resolveMonitorDrillDownTarget(document, 'pod', leftUpsB)?.diagramId).toBe('ups-left')
    expect(resolveMonitorDrillDownTarget(document, 'pod', rightUps)).toBeNull()
    expect(parentElementsLinkedToDiagram(document, 'ups-left').map((item) => item.id)).toEqual([
      'ups-left-a',
      'ups-left-b',
    ])
  })

  it('prefers an explicit drillDownDiagramId over the naming convention', () => {
    const explicit = {
      ...element('explicit', 'cabinet-b', 400),
      properties: { drillDownDiagramId: 'tap-left' },
    }
    const document = {
      diagrams: [diagram('pod', 'POD A'), diagram('tap-left', '分接单元 L', 'pod')],
      elements: [explicit],
    }

    expect(resolveMonitorDrillDownTarget(document, 'pod', explicit)?.diagramId).toBe('tap-left')
    expect(parentElementsLinkedToDiagram(document, 'tap-left')).toEqual([explicit])
  })
})
