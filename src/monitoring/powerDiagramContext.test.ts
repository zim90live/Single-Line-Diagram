import { describe, expect, it } from 'vitest'

import type { ProjectDocument } from '../domain/project'
import { isPowerDiagramExternallyEnergized } from './powerDiagramContext'

function documentWithParentFeed(sourceAssetKey = 'grid') {
  return {
    lineSystems: [{ id: 'power-line', type: 'power', name: '电力线路', rootDiagramId: 'pod' }],
    diagrams: [
      {
        id: 'pod', lineSystemId: 'power-line', name: 'POD A', level: 'pod',
        canvas: { gridSize: 8, viewport: { zoom: 1, tx: 0, ty: 0 } },
      },
      {
        id: 'tap-left', lineSystemId: 'power-line', parentId: 'pod',
        name: '分接单元 L', level: 'device',
        canvas: { gridSize: 8, viewport: { zoom: 1, tx: 0, ty: 0 } },
      },
    ],
    elements: [
      {
        id: 'source', diagramId: 'pod', assetKey: sourceAssetKey, name: 'Source',
        x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
      },
      {
        id: 'tap-a', diagramId: 'pod', assetKey: 'cabinet', name: 'Tap-off Unit A',
        x: 80, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
      },
    ],
    busbars: [],
    connections: [{
      id: 'parent-network', diagramId: 'pod', type: 'electrical',
      nodes: [
        { id: 'source-node', kind: 'element-anchor', elementId: 'source', anchorId: 'out' },
        { id: 'tap-node', kind: 'element-anchor', elementId: 'tap-a', anchorId: 'in' },
      ],
      edges: [{ id: 'parent-edge', sourceNodeId: 'source-node', targetNodeId: 'tap-node' }],
    }],
  } as unknown as ProjectDocument
}

function documentWithUpsGroupFeed() {
  const document = documentWithParentFeed()
  document.diagrams[1] = {
    ...document.diagrams[1],
    id: 'ups-left',
    name: 'UPS L',
  }
  document.elements[1] = {
    ...document.elements[1],
    id: 'ups-group-left',
    assetKey: 'ups-group',
    name: 'UPS-group',
  }
  const targetNode = document.connections[0].nodes[1]
  if (targetNode.kind !== 'element-anchor') {
    throw new Error('测试夹具的目标节点必须是图元锚点')
  }
  targetNode.elementId = 'ups-group-left'
  return document
}

describe('power detail external supply context', () => {
  it('inherits supply when the linked parent equipment is energized', () => {
    expect(isPowerDiagramExternallyEnergized({
      document: documentWithParentFeed(),
      diagramId: 'tap-left',
      switchStates: {},
    })).toBe(true)
  })

  it('does not invent supply when the parent diagram has no source', () => {
    expect(isPowerDiagramExternallyEnergized({
      document: documentWithParentFeed('transformer'),
      diagramId: 'tap-left',
      switchStates: {},
    })).toBe(false)
  })

  it('inherits supply through an UPS-group parent for an UPS L detail diagram', () => {
    expect(isPowerDiagramExternallyEnergized({
      document: documentWithUpsGroupFeed(),
      diagramId: 'ups-left',
      switchStates: {},
    })).toBe(true)
  })
})
