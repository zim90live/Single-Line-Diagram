import { describe, expect, it } from 'vitest'

import type { ConnectionNetwork } from '../domain/project'
import {
  copyConnectionsWithinSelection,
  instantiateCopiedConnections,
} from './selectionClipboard'

const network: ConnectionNetwork = {
  id: 'network-original',
  diagramId: 'diagram-original',
  type: 'electrical',
  nodes: [
    { id: 'node-a', kind: 'element-anchor', elementId: 'element-a', anchorId: 'right' },
    { id: 'tap-b', kind: 'busbar-tap', busbarId: 'busbar-b', offset: 24 },
    { id: 'node-c', kind: 'element-anchor', elementId: 'element-c', anchorId: 'left' },
  ],
  edges: [
    {
      id: 'edge-a-b',
      sourceNodeId: 'node-a',
      targetNodeId: 'tap-b',
      color: '#77B4BF',
      label: '馈线 01',
      labelVisible: false,
      labelEndpoint: 'source',
      labelSide: 'positive',
    },
    { id: 'edge-b-c', sourceNodeId: 'tap-b', targetNodeId: 'node-c' },
  ],
}

describe('selection clipboard topology', () => {
  it('copies only logical edges whose endpoint objects are both selected', () => {
    const copied = copyConnectionsWithinSelection(
      [network],
      new Set(['element-a']),
      new Set(['busbar-b']),
    )

    expect(copied).toHaveLength(1)
    expect(copied[0].nodes.map((node) => node.id)).toEqual(['node-a', 'tap-b'])
    expect(copied[0].edges.map((edge) => edge.id)).toEqual(['edge-a-b'])
  })

  it('does not copy a route that only passes through unselected objects', () => {
    const copied = copyConnectionsWithinSelection(
      [network],
      new Set(['element-a', 'element-c']),
      new Set(),
    )

    expect(copied).toEqual([])
  })

  it('creates fresh topology IDs and remaps element and busbar references', () => {
    const copied = copyConnectionsWithinSelection(
      [network],
      new Set(['element-a']),
      new Set(['busbar-b']),
    )
    let nextId = 0
    const instantiated = instantiateCopiedConnections(
      copied,
      'diagram-copy',
      new Map([['element-a', 'element-a-copy']]),
      new Map([['busbar-b', 'busbar-b-copy']]),
      (prefix) => `${prefix}-copy-${nextId++}`,
    )

    expect(instantiated).toHaveLength(1)
    expect(instantiated[0].id).not.toBe(network.id)
    expect(instantiated[0].diagramId).toBe('diagram-copy')
    expect(instantiated[0].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'element-anchor', elementId: 'element-a-copy' }),
      expect.objectContaining({ kind: 'busbar-tap', busbarId: 'busbar-b-copy', offset: 24 }),
    ]))
    expect(instantiated[0].nodes.every((node) => !['node-a', 'tap-b'].includes(node.id))).toBe(true)
    expect(instantiated[0].edges[0]).toEqual(expect.objectContaining({
      id: expect.not.stringMatching(/^edge-a-b$/),
      sourceNodeId: instantiated[0].nodes[0].id,
      targetNodeId: instantiated[0].nodes[1].id,
      color: '#77B4BF',
      label: '馈线 01',
      labelVisible: false,
      labelEndpoint: 'source',
      labelSide: 'positive',
    }))
  })
})
