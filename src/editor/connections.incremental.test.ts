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
})
