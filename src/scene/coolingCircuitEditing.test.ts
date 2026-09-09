import { describe, expect, it } from 'vitest'
import type { ConnectionNetwork } from '../domain/project'
import { changeCoolingCircuit } from './coolingCircuitEditing'

describe('cooling circuit editing', () => {
  const network: ConnectionNetwork = {
    id: 'network', diagramId: 'diagram', type: 'cooling-general',
    nodes: [{ id: 'a', kind: 'node', x: 0, y: 0 }, { id: 'b', kind: 'node', x: 8, y: 0 }],
    edges: [{ id: 'one', sourceNodeId: 'a', targetNodeId: 'b', color: '#123456' }],
  }
  it('changes the whole selected network and preserves custom color', () => {
    const other = { ...network, id: 'other', edges: [{ ...network.edges[0], id: 'two' }] }
    const result = changeCoolingCircuit([network, other], ['one'], 'cooling-tertiary-cold', [], new Map())!
    expect(result[0].type).toBe('cooling-tertiary-cold')
    expect(result[0].edges).toBe(network.edges)
    expect(result[1]).toBe(other)
    expect(network.type).toBe('cooling-general')
  })
  it('rejects the entire batch when a terminal cannot safely be changed', () => {
    const locked: ConnectionNetwork = { ...network, id: 'locked',
      nodes: [{ id: 'a', kind: 'element-anchor', elementId: 'missing', anchorId: 'port' }, network.nodes[1]],
      edges: [{ ...network.edges[0], id: 'two' }],
    }
    expect(changeCoolingCircuit([network, locked], ['one', 'two'], 'cooling-tertiary-hot', [], new Map())).toBeNull()
    expect(changeCoolingCircuit([network], ['one'], 'electrical', [], new Map())).toBeNull()
  })
})
