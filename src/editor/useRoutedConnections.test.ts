import { describe, expect, it } from 'vitest'

import type { Busbar, ConnectionNetwork } from '../domain/project'
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

  it('retains child-line crossings over existing busbars', () => {
    const busbar: Busbar = {
      id: 'busbar',
      diagramId: 'diagram',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 80,
    }
    const completedInput = { ...input(), busbars: [busbar] }
    const routedWithBusbarCrossing: RoutedConnections = {
      ...routed,
      crossings: [{
        x: 4,
        y: 0,
        bridgeEdgeId: 'edge',
        underEdgeId: 'busbar:busbar',
      }],
    }
    const snapshot: RouteSnapshot = {
      input: completedInput,
      routed: routedWithBusbarCrossing,
    }

    expect(routedConnectionsForInput(snapshot, completedInput))
      .toBe(routedWithBusbarCrossing)
  })

  it('removes deleted logical edges while a newer route job is pending', () => {
    const completedInput = input()
    const snapshot: RouteSnapshot = { input: completedInput, routed }
    const pendingInput = { ...completedInput, networks: [] }

    expect(routedConnectionsForInput(snapshot, pendingInput).edges).toEqual([])
  })

  it('removes an old route when its edge moves to another network', () => {
    const completedInput = input()
    const snapshot: RouteSnapshot = { input: completedInput, routed }
    const pendingInput = input([{
      ...network,
      id: 'migrated-network',
    }])

    expect(routedConnectionsForInput(snapshot, pendingInput).edges).toEqual([])
  })

  it('keeps only the latest route for a duplicated network and edge identity', () => {
    const completedInput = input()
    const latestRoute = {
      ...routed.edges[0],
      points: [{ x: 0, y: 8 }, { x: 8, y: 8 }],
    }
    const snapshot: RouteSnapshot = {
      input: completedInput,
      routed: {
        ...routed,
        edges: [routed.edges[0], latestRoute],
      },
    }

    expect(routedConnectionsForInput(snapshot, completedInput).edges).toEqual([latestRoute])
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

  it('previews a changed cooling bridge priority while the route job is pending', () => {
    const horizontal: ConnectionNetwork = {
      id: 'horizontal-network',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'left', kind: 'node', x: -8, y: 0 },
        { id: 'right', kind: 'node', x: 8, y: 0 },
      ],
      edges: [{ id: 'horizontal-edge', sourceNodeId: 'left', targetNodeId: 'right' }],
    }
    const vertical: ConnectionNetwork = {
      id: 'vertical-network',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'top', kind: 'node', x: 0, y: -8 },
        { id: 'bottom', kind: 'node', x: 0, y: 8 },
      ],
      edges: [{ id: 'vertical-edge', sourceNodeId: 'top', targetNodeId: 'bottom' }],
    }
    const completedInput = input([horizontal, vertical])
    const crossingRoutes: RoutedConnections = {
      edges: [
        {
          networkId: horizontal.id,
          edgeId: horizontal.edges[0].id,
          type: horizontal.type,
          sourceNodeId: 'left',
          targetNodeId: 'right',
          points: [{ x: -8, y: 0 }, { x: 8, y: 0 }],
          order: 0,
        },
        {
          networkId: vertical.id,
          edgeId: vertical.edges[0].id,
          type: vertical.type,
          sourceNodeId: 'top',
          targetNodeId: 'bottom',
          points: [{ x: 0, y: -8 }, { x: 0, y: 8 }],
          order: 1,
        },
      ],
      crossings: [{
        x: 0,
        y: 0,
        bridgeEdgeId: 'vertical-edge',
        underEdgeId: 'horizontal-edge',
      }],
      invalidEdgeIds: [],
      resolvedBusbarTapOffsets: {},
    }
    const snapshot: RouteSnapshot = { input: completedInput, routed: crossingRoutes }
    const pendingInput = input([horizontal, {
      ...vertical,
      edges: vertical.edges.map((edge) => ({
        ...edge,
        coolingLineRole: 'auxiliary' as const,
      })),
    }])

    const preview = routedConnectionsForInput(snapshot, pendingInput)

    expect(preview.edges).toEqual(crossingRoutes.edges)
    expect(preview.crossings).toEqual([{
      x: 0,
      y: 0,
      bridgeEdgeId: 'horizontal-edge',
      underEdgeId: 'vertical-edge',
    }])
  })
})
