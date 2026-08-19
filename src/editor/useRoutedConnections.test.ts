import { describe, expect, it } from 'vitest'

import type { ConnectionNetwork } from '../domain/project'
import type { RoutedConnections } from './connections'
import type { RouteComputationInput } from './routeEngine'
import { routedConnectionsForInput, type RouteSnapshot } from './useRoutedConnections'

const network: ConnectionNetwork = {
  id: 'network',
  diagramId: 'diagram',
  type: 'electrical',
  nodes: [],
  edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'target' }],
}

function input(networks: ConnectionNetwork[] = [network]): RouteComputationInput {
  return {
    scopeKey: 'document:diagram',
    networks,
    elements: [],
    assets: [],
    gridSize: 8,
    busbars: [],
  }
}

const routed: RoutedConnections = {
  edges: [{
    networkId: network.id,
    edgeId: 'edge',
    type: 'electrical',
    sourceNodeId: 'source',
    targetNodeId: 'target',
    points: [{ x: 0, y: 0 }, { x: 8, y: 0 }],
    order: 0,
  }],
  crossings: [],
  invalidEdgeIds: [],
  resolvedBusbarTapOffsets: {},
}

describe('routed connection snapshots', () => {
  it('returns the completed snapshot unchanged for the exact route input', () => {
    const completedInput = input()
    const snapshot: RouteSnapshot = { input: completedInput, routed }

    expect(routedConnectionsForInput(snapshot, completedInput)).toBe(routed)
  })

  it('removes deleted logical edges while a newer route job is pending', () => {
    const completedInput = input()
    const snapshot: RouteSnapshot = { input: completedInput, routed }
    const pendingInput = { ...completedInput, networks: [] }

    expect(routedConnectionsForInput(snapshot, pendingInput).edges).toEqual([])
  })

  it('does not show a snapshot from another document or diagram scope', () => {
    const completedInput = input()
    const snapshot: RouteSnapshot = { input: completedInput, routed }

    expect(routedConnectionsForInput(snapshot, {
      ...completedInput,
      scopeKey: 'other:diagram',
    }).edges).toEqual([])
  })

  it('reuses routed geometry when only edge display properties change', () => {
    const completedInput = input()
    const snapshot: RouteSnapshot = { input: completedInput, routed }
    const displayOnlyInput = input([{
      ...network,
      edges: network.edges.map((edge) => ({ ...edge, label: 'Feeder' })),
    }])

    expect(routedConnectionsForInput(snapshot, displayOnlyInput)).toBe(routed)
  })
})
