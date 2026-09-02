import { describe, expect, it } from 'vitest'

import type { Busbar, ConnectionNetwork } from '../domain/project'
import {
  busbarTapCount,
  resizeBusbarPreservingTapPositions,
} from './busbars'

const busbar: Busbar = {
  id: 'busbar-1',
  diagramId: 'diagram-1',
  type: 'electrical',
  orientation: 'horizontal',
  x: 64,
  y: 80,
  length: 160,
}

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
  })

  it('blocks an end resize before the furthest tap without moving tap offsets', () => {
    const connections = networkWithTapOffsets([32, 120])
    const result = resizeBusbarPreservingTapPositions(
      connections,
      busbar,
      'end',
      144,
      8,
    )

    expect(result.blocked).toBe(true)
    expect(result.busbar.length).toBe(120)
    expect(result.connections).toBe(connections)
    expect(tapOffsets(result.connections)).toEqual([32, 120])
  })

  it('keeps tap world positions fixed when moving the start endpoint', () => {
    const result = resizeBusbarPreservingTapPositions(
      networkWithTapOffsets([32, 120]),
      busbar,
      'start',
      80,
      8,
    )

    expect(result.blocked).toBe(false)
    expect(result.busbar).toMatchObject({ x: 80, length: 144 })
    expect(tapOffsets(result.connections)).toEqual([16, 104])
    expect(result.busbar.x + tapOffsets(result.connections)[0]).toBe(96)
    expect(result.busbar.x + tapOffsets(result.connections)[1]).toBe(184)
  })

  it('blocks a start resize that would move past the nearest tap', () => {
    const result = resizeBusbarPreservingTapPositions(
      networkWithTapOffsets([32, 120]),
      busbar,
      'start',
      120,
      8,
    )

    expect(result.blocked).toBe(true)
    expect(result.busbar).toMatchObject({ x: 96, length: 128 })
    expect(tapOffsets(result.connections)).toEqual([0, 88])
  })

  it('applies the same position-preserving rule to vertical busbars', () => {
    const result = resizeBusbarPreservingTapPositions(
      networkWithTapOffsets([80]),
      { ...busbar, orientation: 'vertical', x: 80, y: 64 },
      'start',
      88,
      8,
    )

    expect(result.busbar).toMatchObject({ y: 88, length: 136 })
    expect(tapOffsets(result.connections)).toEqual([56])
  })
})
