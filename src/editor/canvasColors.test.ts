import { describe, expect, it } from 'vitest'

import type { Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
import { collectCanvasColorGroups, replaceCanvasColor } from './canvasColors'
import { DEFAULT_BUSBAR_COLOR, defaultConnectionColor } from './objectColors'
import { DEFAULT_CONFIGURABLE_SYMBOL_COLOR } from './symbolCatalog'

const elements: DiagramElement[] = [
  {
    id: 'switch-default', diagramId: 'diagram-1', assetKey: 'switch', name: 'Switch',
    x: 0, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {},
  },
  {
    id: 'switch-custom', diagramId: 'diagram-1', assetKey: 'switch', name: 'Switch',
    x: 40, y: 0, width: 32, height: 32, rotation: 0,
    properties: { color: '#77B4BF' }, extensions: {},
  },
  {
    id: 'chwp', diagramId: 'diagram-1', assetKey: 'chwp', name: 'CHWP',
    x: 80, y: 0, width: 200, height: 80, rotation: 0, properties: {}, extensions: {},
  },
]

const busbars: Busbar[] = [
  {
    id: 'busbar-default', diagramId: 'diagram-1', type: 'electrical',
    orientation: 'horizontal', x: 0, y: 80, length: 160,
  },
  {
    id: 'busbar-custom', diagramId: 'diagram-1', type: 'electrical',
    orientation: 'horizontal', x: 0, y: 120, length: 160, color: '#77B4BF',
  },
]

const connections: ConnectionNetwork[] = [{
  id: 'network-1',
  diagramId: 'diagram-1',
  type: 'electrical',
  nodes: [
    { id: 'node-1', kind: 'element-anchor', elementId: 'switch-default', anchorId: 'a' },
    { id: 'node-2', kind: 'element-anchor', elementId: 'switch-custom', anchorId: 'a' },
    { id: 'node-3', kind: 'busbar-tap', busbarId: 'busbar-default', offset: 16 },
  ],
  edges: [
    { id: 'edge-default', sourceNodeId: 'node-1', targetNodeId: 'node-2' },
    { id: 'edge-custom', sourceNodeId: 'node-2', targetNodeId: 'node-3', color: '#77B4BF' },
  ],
}]

describe('canvas color overview', () => {
  it('groups resolved colors by editable object category', () => {
    expect(collectCanvasColorGroups(elements, busbars, connections)).toEqual({
      element: [
        { category: 'element', color: DEFAULT_CONFIGURABLE_SYMBOL_COLOR, count: 1 },
        { category: 'element', color: '#77B4BF', count: 1 },
      ],
      busbar: [
        { category: 'busbar', color: '#77B4BF', count: 1 },
        { category: 'busbar', color: '#D5B96F', count: 1 },
      ],
      connection: [
        { category: 'connection', color: '#77B4BF', count: 1 },
        { category: 'connection', color: '#D5B96F', count: 1 },
      ],
    })
  })

  it('replaces only objects that currently resolve to the selected category and color', () => {
    const updated = replaceCanvasColor(
      { elements, busbars, connections },
      { category: 'connection', color: '#D5B96F' },
      defaultConnectionColor('cooling-primary-hot'),
    )

    expect(updated.elements).toBe(elements)
    expect(updated.busbars).toBe(busbars)
    expect(updated.connections[0].edges).toEqual([
      {
        id: 'edge-default',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        color: defaultConnectionColor('cooling-primary-hot'),
      },
      { id: 'edge-custom', sourceNodeId: 'node-2', targetNodeId: 'node-3', color: '#77B4BF' },
    ])
  })

  it('replaces matching editable elements and busbars without crossing category boundaries', () => {
    const replacement = defaultConnectionColor('cooling-primary-hot')
    const elementUpdate = replaceCanvasColor(
      { elements, busbars, connections },
      { category: 'element', color: DEFAULT_CONFIGURABLE_SYMBOL_COLOR },
      replacement,
    )
    expect(elementUpdate.elements[0].properties.color).toBe(replacement)
    expect(elementUpdate.elements[1].properties.color).toBe('#77B4BF')
    expect(elementUpdate.elements[2].properties.color).toBeUndefined()
    expect(elementUpdate.busbars).toBe(busbars)
    expect(elementUpdate.connections).toBe(connections)

    const busbarUpdate = replaceCanvasColor(
      { elements, busbars, connections },
      { category: 'busbar', color: DEFAULT_BUSBAR_COLOR },
      replacement,
    )
    expect(busbarUpdate.busbars[0].color).toBe(replacement)
    expect(busbarUpdate.busbars[1].color).toBe('#77B4BF')
    expect(busbarUpdate.elements).toBe(elements)
    expect(busbarUpdate.connections).toBe(connections)
  })
})
