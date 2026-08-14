import { describe, expect, it } from 'vitest'

import type { ConnectionNetwork } from '../domain/project'
import {
  busbarTapCount,
  compressBusbarTapOffsets,
  minimumBusbarLengthForConnections,
} from './busbars'

function networkWithTapOffsets(offsets: number[]): ConnectionNetwork[] {
  return [{
    id: 'network-1',
    diagramId: 'diagram-1',
    type: 'electrical',
    nodes: offsets.map((offset, index) => ({
      id: `tap-${index}`,
      kind: 'busbar-tap' as const,
      busbarId: 'busbar-1',
      offset,
    })),
    edges: [],
  }]
}

function tapOffsets(connections: ConnectionNetwork[]) {
  return connections.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'busbar-tap' ? [node.offset] : []
  )))
}

describe('busbar resizing constraints', () => {
  it('derives the minimum length from distinct tap nodes', () => {
    expect(minimumBusbarLengthForConnections([], 'busbar-1', 8)).toBe(8)
    expect(minimumBusbarLengthForConnections(networkWithTapOffsets([80]), 'busbar-1', 8)).toBe(8)
    expect(minimumBusbarLengthForConnections(networkWithTapOffsets([32, 80]), 'busbar-1', 8)).toBe(8)
    expect(minimumBusbarLengthForConnections(
      networkWithTapOffsets([0, 40, 80, 120, 160]),
      'busbar-1',
      8,
    )).toBe(32)
  })

  it('counts a shared tap once even when several edges reference it', () => {
    const connections = networkWithTapOffsets([80])
    connections[0].nodes.push(
      { id: 'anchor-1', kind: 'element-anchor', elementId: 'element-1', anchorId: 'anchor-1' },
      { id: 'anchor-2', kind: 'element-anchor', elementId: 'element-2', anchorId: 'anchor-2' },
    )
    connections[0].edges.push(
      { id: 'edge-1', sourceNodeId: 'tap-0', targetNodeId: 'anchor-1' },
      { id: 'edge-2', sourceNodeId: 'tap-0', targetNodeId: 'anchor-2' },
    )

    expect(busbarTapCount(connections, 'busbar-1')).toBe(1)
    expect(minimumBusbarLengthForConnections(connections, 'busbar-1', 8)).toBe(8)
  })

  it('compresses taps proportionally while preserving order and an 8px gap', () => {
    const connections = networkWithTapOffsets([0, 40, 80, 120, 160])
    const compressed = compressBusbarTapOffsets(connections, 'busbar-1', 160, 32, 8)

    expect(tapOffsets(compressed)).toEqual([0, 8, 16, 24, 32])
    expect(compressed).not.toBe(connections)
  })

  it('resolves snap collisions without merging tap nodes', () => {
    const compressed = compressBusbarTapOffsets(
      networkWithTapOffsets([0, 8, 16]),
      'busbar-1',
      160,
      16,
      8,
    )

    expect(tapOffsets(compressed)).toEqual([0, 8, 16])
  })

  it('does not spread compressed taps when the busbar grows', () => {
    const connections = networkWithTapOffsets([0, 8, 16])
    expect(compressBusbarTapOffsets(connections, 'busbar-1', 16, 160, 8)).toBe(connections)
  })
})
