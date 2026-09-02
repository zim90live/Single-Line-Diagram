import { describe, expect, it } from 'vitest'

import type {
  AssetDefinition,
  ConnectionNetwork,
  DiagramElement,
} from '../domain/project'
import {
  routeConnectionNetworks,
  routeConnectionNetworksIncrementally,
  type ConnectionRouteInput,
} from './connections'

const asset: AssetDefinition = {
  key: 'incremental-route-node',
  name: 'Incremental route node',
  category: '电力',
  source: 'incremental-route-node.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  anchors: [
    { id: 'left', name: 'Left', x: 0, y: 16, direction: 'left', type: 'electrical' },
    { id: 'right', name: 'Right', x: 32, y: 16, direction: 'right', type: 'electrical' },
  ],
}

function element(id: string, x: number, y: number): DiagramElement {
  return {
    id,
    diagramId: 'incremental-diagram',
    assetKey: asset.key,
    name: id,
    x,
    y,
    width: 32,
    height: 32,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

function network(id: string, sourceId: string, targetId: string): ConnectionNetwork {
  return {
    id,
    diagramId: 'incremental-diagram',
    type: 'electrical',
    nodes: [
      { id: `${id}-source`, kind: 'element-anchor', elementId: sourceId, anchorId: 'right' },
      { id: `${id}-target`, kind: 'element-anchor', elementId: targetId, anchorId: 'left' },
    ],
    edges: [{
      id: `${id}-edge`,
      sourceNodeId: `${id}-source`,
      targetNodeId: `${id}-target`,
    }],
  }
}

function fixture(): ConnectionRouteInput {
  const elements = [
    element('near-source', 0, 0),
    element('near-target', 192, 0),
    element('far-source', 0, 512),
    element('far-target', 192, 512),
  ]
  return {
    networks: [
      network('near-network', 'near-source', 'near-target'),
      network('far-network', 'far-source', 'far-target'),
    ],
    elements,
    assets: [asset],
    gridSize: 8,
    busbars: [],
  }
}

function coolingCrossingFixture(): ConnectionRouteInput {
  return {
    networks: [
      {
        id: 'cooling-horizontal-network',
        diagramId: 'incremental-diagram',
        type: 'cooling-primary-cold',
        nodes: [
          { id: 'cooling-left', kind: 'node', x: -32, y: 0 },
          { id: 'cooling-right', kind: 'node', x: 32, y: 0 },
        ],
        edges: [{
          id: 'cooling-horizontal-edge',
          sourceNodeId: 'cooling-left',
          targetNodeId: 'cooling-right',
        }],
      },
      {
        id: 'cooling-vertical-network',
        diagramId: 'incremental-diagram',
        type: 'cooling-primary-cold',
        nodes: [
          { id: 'cooling-top', kind: 'node', x: 0, y: -32 },
          { id: 'cooling-bottom', kind: 'node', x: 0, y: 32 },
        ],
        edges: [{
          id: 'cooling-vertical-edge',
          sourceNodeId: 'cooling-top',
          targetNodeId: 'cooling-bottom',
        }],
      },
    ],
    elements: [],
    assets: [],
    gridSize: 8,
    busbars: [],
  }
}

describe('incremental connection routing', () => {
  it('reuses the completed snapshot for display-only network changes', () => {
    const previous = fixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    const next = {
      ...previous,
      networks: previous.networks.map((item, index) => index === 0
        ? {
            ...item,
            edges: item.edges.map((edge) => ({ ...edge, label: 'Feeder' })),
          }
        : item),
    }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)

    expect(result.mode).toBe('reused')
    expect(result.routed).toBe(routed)
    expect(result.dirtyNetworkCount).toBe(0)
    expect(result.reusedEdgeCount).toBe(2)
  })

  it('updates primary-over-auxiliary crossings without rerouting geometry', () => {
    const previous = coolingCrossingFixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    expect(routed.crossings[0]).toMatchObject({
      bridgeEdgeId: 'cooling-vertical-edge',
      underEdgeId: 'cooling-horizontal-edge',
    })
    const next = {
      ...previous,
      networks: previous.networks.map((network) => (
        network.id === 'cooling-vertical-network'
          ? {
              ...network,
              edges: network.edges.map((edge) => ({
                ...edge,
                coolingLineRole: 'auxiliary' as const,
              })),
            }
          : network
      )),
    }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)

    expect(result.mode).toBe('reused')
    expect(result.dirtyNetworkCount).toBe(0)
    expect(result.routed.edges[0]).toBe(routed.edges[0])
    expect(result.routed.edges[1]).toBe(routed.edges[1])
    expect(result.routed.crossings).toEqual([{
      x: 0,
      y: 0,
      bridgeEdgeId: 'cooling-horizontal-edge',
      underEdgeId: 'cooling-vertical-edge',
    }])
  })

  it('updates manual crossing layers without rerouting geometry', () => {
    const previous = coolingCrossingFixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    const next = {
      ...previous,
      networks: previous.networks.map((network) => (
        network.id === 'cooling-horizontal-network'
          ? {
              ...network,
              edges: network.edges.map((edge) => ({
                ...edge,
                crossingLayer: 'upper' as const,
              })),
            }
          : network
      )),
    }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)

    expect(result.mode).toBe('reused')
    expect(result.dirtyNetworkCount).toBe(0)
    expect(result.routed.edges[0]).toBe(routed.edges[0])
    expect(result.routed.edges[1]).toBe(routed.edges[1])
    expect(result.routed.crossings[0]).toMatchObject({
      bridgeEdgeId: 'cooling-horizontal-edge',
      underEdgeId: 'cooling-vertical-edge',
    })
  })

  it('reroutes only the locally affected network and retains distant edge objects', () => {
    const previous = fixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    const next = {
      ...previous,
      elements: previous.elements.map((item) => item.id === 'near-target'
        ? { ...item, x: item.x + 32, y: item.y + 32 }
        : item),
    }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)
    const previousFar = routed.edges.find((edge) => edge.networkId === 'far-network')
    const nextFar = result.routed.edges.find((edge) => edge.networkId === 'far-network')

    expect(result.mode).toBe('incremental')
    expect(result.dirtyNetworkCount).toBe(1)
    expect(result.reusedEdgeCount).toBe(1)
    expect(nextFar).toBe(previousFar)
    expect(result.routed.invalidEdgeIds).toEqual([])
  })

  it('reroutes a line when a newly added obstacle enters its local corridor', () => {
    const previous = fixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    const obstacle = element('new-obstacle', 80, 512)
    const next = { ...previous, elements: [...previous.elements, obstacle] }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)
    const farRoute = result.routed.edges.find((edge) => edge.networkId === 'far-network')

    expect(result.mode).toBe('incremental')
    expect(result.dirtyNetworkCount).toBe(1)
    expect(farRoute?.points.some((point) => point.y !== 528)).toBe(true)
    expect(result.routed.invalidEdgeIds).toEqual([])
  })

  it('drops the old route when an edge keeps its id but moves to a new network', () => {
    const previous = fixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    const migrated = {
      ...previous.networks[0],
      id: 'migrated-network',
    }
    const next = {
      ...previous,
      networks: [migrated, previous.networks[1]],
    }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)
    const migratedRoutes = result.routed.edges.filter((edge) => (
      edge.edgeId === migrated.edges[0].id
    ))

    expect(result.mode).toBe('incremental')
    expect(result.dirtyNetworkCount).toBe(1)
    expect(result.reusedEdgeCount).toBe(1)
    expect(migratedRoutes).toHaveLength(1)
    expect(migratedRoutes[0].networkId).toBe(migrated.id)
    expect(new Set(result.routed.edges.map((edge) => edge.edgeId)).size)
      .toBe(result.routed.edges.length)
  })

  it('falls back to a full route when anchor geometry changes', () => {
    const previous = fixture()
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    const next = {
      ...previous,
      assets: [{
        ...asset,
        anchors: asset.anchors.map((anchor) => anchor.id === 'right'
          ? { ...anchor, y: 8 }
          : anchor),
      }],
    }

    const result = routeConnectionNetworksIncrementally(previous, routed, next)

    expect(result.mode).toBe('full')
    expect(result.dirtyNetworkCount).toBe(2)
    expect(result.reusedEdgeCount).toBe(0)
  })

  it('retries a previously invalid constrained network after an obstacle moves away', () => {
    const source = element('manual-source', 0, 0)
    const target = element('manual-target', 192, 0)
    const blocker = element('unrelated-blocker', 176, 0)
    const constrainedNetwork: ConnectionNetwork = {
      id: 'invalid-manual-network',
      diagramId: 'incremental-diagram',
      type: 'electrical',
      nodes: [
        {
          id: 'manual-source-anchor',
          kind: 'element-anchor',
          elementId: source.id,
          anchorId: 'right',
        },
        {
          id: 'manual-route-node',
          kind: 'node',
          x: 112,
          y: 80,
        },
        {
          id: 'manual-target-anchor',
          kind: 'element-anchor',
          elementId: target.id,
          anchorId: 'left',
        },
      ],
      edges: [{
        id: 'invalid-manual-edge',
        sourceNodeId: 'manual-source-anchor',
        targetNodeId: 'manual-target-anchor',
        routeNodeIds: ['manual-route-node'],
      }],
    }
    const previous: ConnectionRouteInput = {
      networks: [constrainedNetwork],
      elements: [source, target, blocker],
      assets: [asset],
      gridSize: 8,
      busbars: [],
    }
    const routed = routeConnectionNetworks(
      previous.networks,
      previous.elements,
      previous.assets,
      previous.gridSize,
    )
    expect(routed.invalidEdgeIds).toEqual(['invalid-manual-edge'])

    const next = {
      ...previous,
      elements: previous.elements.map((item) => item.id === blocker.id
        ? { ...item, x: 320 }
        : item),
    }
    const result = routeConnectionNetworksIncrementally(previous, routed, next)

    expect(result.mode).toBe('incremental')
    expect(result.dirtyNetworkCount).toBe(1)
    expect(result.routed.invalidEdgeIds).toEqual([])
    expect(result.routed.edges.map((edge) => edge.edgeId)).toEqual(['invalid-manual-edge'])
  })
})
