import { describe, expect, it } from 'vitest'

import type {
  AssetDefinition,
  Busbar,
  ConnectionNetwork,
  DiagramElement,
  RouteWaypoint,
} from '../domain/project'
import type { RoutedConnectionEdge } from './connections'
import {
  connectTerminalToRouteJunction,
  deleteConnectionJunctions,
  mergeCollidingConnectionPoints,
} from './connectionJunctions'
import {
  applyDraggedRouteSegment,
  atomicRouteSegments,
  snapDraggedRouteSegmentDelta,
} from './routeWaypoints'

const asset: AssetDefinition = {
  key: 'junction-test',
  name: '分流测试',
  category: '冷却',
  source: 'junction-test.svg',
  intrinsicWidth: 64,
  intrinsicHeight: 64,
  anchors: [{
    id: 'right',
    name: '右侧',
    x: 64,
    y: 32,
    direction: 'right',
    type: 'cooling-primary-cold',
  }],
}

function element(id: string): DiagramElement {
  return {
    id,
    diagramId: 'diagram',
    assetKey: asset.key,
    name: id,
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

const network: ConnectionNetwork = {
  id: 'network',
  diagramId: 'diagram',
  type: 'cooling-primary-cold',
  nodes: [
    { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'right' },
    { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'right' },
    { id: 'route-point', kind: 'node', x: 40, y: 0 },
  ],
  edges: [{
    id: 'main-edge',
    sourceNodeId: 'left-node',
    targetNodeId: 'right-node',
    flowDirection: 'forward',
    coolingLineRole: 'auxiliary',
    color: '#123456',
    label: '主管',
    labelEndpoint: 'target',
    routeNodeIds: ['route-point'],
  }],
}

const route: RoutedConnectionEdge = {
  networkId: network.id,
  edgeId: 'main-edge',
  type: network.type,
  sourceNodeId: 'left-node',
  targetNodeId: 'right-node',
  points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
  order: 0,
}

const electricalBusbar: Busbar = {
  id: 'busbar',
  diagramId: 'diagram',
  type: 'electrical',
  orientation: 'horizontal',
  x: 0,
  y: 0,
  length: 160,
}

describe('connection junction topology', () => {
  it('promotes the hovered route node and connects a new terminal without splitting logical properties', () => {
    const waypoints: RouteWaypoint[] = [{ id: 'route-point', x: 40, y: 0 }]
    let id = 0
    const result = connectTerminalToRouteJunction({
      networks: [network],
      routeWaypoints: waypoints,
      routedEdges: [route],
      diagramId: 'diagram',
      source: {
        kind: 'anchor',
        elementId: 'branch',
        anchorId: 'right',
        type: 'cooling-primary-cold',
      },
      target: {
        networkId: network.id,
        point: { x: 40, y: 0 },
        edgeIds: ['main-edge'],
      },
      createId: (prefix) => `${prefix}-${++id}`,
    })

    expect(result).not.toBeNull()
    expect(result?.routeWaypoints).toEqual(waypoints)
    const next = result!.networks[0]
    const junction = next.nodes.find((node) => node.kind === 'node')
    expect(junction).toMatchObject({ x: 40, y: 0 })
    expect(next.edges).toHaveLength(2)
    expect(next.edges.find((edge) => edge.id === 'main-edge')).toMatchObject({
      flowDirection: 'forward',
      coolingLineRole: 'auxiliary',
      color: '#123456',
      label: '主管',
      labelEndpoint: 'target',
      routeNodeIds: ['route-point'],
    })
    expect(next.edges.find((edge) => edge.id !== 'main-edge')).toMatchObject({
      sourceNodeId: expect.any(String),
      targetNodeId: junction?.id,
    })
  })

  it('creates a node when a new connection ends on an unconstrained child line', () => {
    const automatic: ConnectionNetwork = {
      ...network,
      nodes: network.nodes.filter((node) => node.id !== 'route-point'),
      edges: network.edges.map((edge) => {
        const { routeNodeIds: _routeNodeIds, ...automaticEdge } = edge
        return automaticEdge
      }),
    }
    let id = 0
    const result = connectTerminalToRouteJunction({
      networks: [automatic],
      routeWaypoints: [],
      routedEdges: [route],
      diagramId: 'diagram',
      source: {
        kind: 'anchor',
        elementId: 'branch',
        anchorId: 'right',
        type: 'cooling-primary-cold',
      },
      target: {
        networkId: automatic.id,
        point: { x: 40, y: 0 },
        edgeIds: ['main-edge'],
      },
      createId: (prefix) => `${prefix}-${++id}`,
    })

    expect(result).not.toBeNull()
    const createdNode = result!.networks[0].nodes.find((node) => node.kind === 'node')
    expect(createdNode).toEqual({
      id: 'connection-node-1',
      kind: 'node',
      x: 40,
      y: 0,
    })
    expect(result!.networks[0].edges.find((edge) => edge.id === 'main-edge')).toMatchObject({
      routeNodeIds: [createdNode!.id],
      flowDirection: 'forward',
      color: '#123456',
      label: '主管',
    })
    expect(result!.routeWaypoints).toEqual([{
      id: createdNode!.id,
      x: 40,
      y: 0,
    }])
  })

  it('materializes an automatic route point without creating a branch edge yet', () => {
    const automatic: ConnectionNetwork = {
      ...network,
      nodes: network.nodes.filter((node) => node.id !== 'route-point'),
      edges: network.edges.map((edge) => {
        const { routeNodeIds: _routeNodeIds, ...automaticEdge } = edge
        return automaticEdge
      }),
    }
    const result = connectTerminalToRouteJunction({
      networks: [automatic],
      routeWaypoints: [],
      routedEdges: [route],
      diagramId: 'diagram',
      target: {
        networkId: automatic.id,
        point: { x: 40, y: 0 },
        edgeIds: ['main-edge'],
      },
      createId: (prefix) => `${prefix}-derived-corner`,
    })

    expect(result).not.toBeNull()
    expect(result?.connectionEdgeId).toBeNull()
    expect(result?.networks[0].edges).toHaveLength(1)
    expect(result?.networks[0].edges[0].routeNodeIds).toEqual([
      'connection-node-derived-corner',
    ])
    expect(result?.routeWaypoints).toEqual([{
      id: 'connection-node-derived-corner',
      x: 40,
      y: 0,
    }])
  })

  it('connects a deferred automatic corner source to another child line', () => {
    const automaticSource: ConnectionNetwork = {
      ...network,
      nodes: network.nodes.filter((node) => node.id !== 'route-point'),
      edges: network.edges.map((edge) => {
        const { routeNodeIds: _routeNodeIds, ...automaticEdge } = edge
        return automaticEdge
      }),
    }
    const targetNetwork: ConnectionNetwork = {
      ...automaticSource,
      id: 'target-network',
      nodes: automaticSource.nodes.map((node) => ({
        ...node,
        id: `target-${node.id}`,
      })),
      edges: automaticSource.edges.map((edge) => ({
        ...edge,
        id: 'target-edge',
        sourceNodeId: `target-${edge.sourceNodeId}`,
        targetNodeId: `target-${edge.targetNodeId}`,
      })),
    }
    const targetRoute: RoutedConnectionEdge = {
      ...route,
      networkId: targetNetwork.id,
      edgeId: 'target-edge',
      sourceNodeId: 'target-left-node',
      targetNodeId: 'target-right-node',
      points: [{ x: 0, y: 80 }, { x: 80, y: 80 }],
    }
    let id = 0
    const createId = (prefix: string) => `${prefix}-${++id}`
    const materializedSource = connectTerminalToRouteJunction({
      networks: [automaticSource, targetNetwork],
      routeWaypoints: [],
      routedEdges: [route, targetRoute],
      diagramId: 'diagram',
      target: {
        networkId: automaticSource.id,
        point: { x: 40, y: 0 },
        edgeIds: ['main-edge'],
      },
      createId,
    })!
    const connected = connectTerminalToRouteJunction({
      networks: materializedSource.networks,
      routeWaypoints: materializedSource.routeWaypoints,
      routedEdges: [route, targetRoute],
      diagramId: 'diagram',
      source: {
        kind: 'node',
        networkId: materializedSource.junctionNetworkId,
        nodeId: materializedSource.junctionId,
        point: { x: 40, y: 0 },
        type: automaticSource.type,
      },
      target: {
        networkId: targetNetwork.id,
        point: { x: 40, y: 80 },
        edgeIds: ['target-edge'],
      },
      createId,
    })

    expect(connected).not.toBeNull()
    expect(connected?.networks).toHaveLength(1)
    expect(connected?.networks[0].edges).toHaveLength(3)
    expect(connected?.networks[0].nodes.filter((node) => node.kind === 'node')).toHaveLength(2)
    expect(connected?.connectionEdgeId).not.toBeNull()
  })

  it('deletes a junction together with every incident connection', () => {
    const connected: ConnectionNetwork = {
      id: 'connected',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'a', kind: 'element-anchor', elementId: 'left', anchorId: 'right' },
        { id: 'b', kind: 'element-anchor', elementId: 'right', anchorId: 'right' },
        { id: 'c', kind: 'element-anchor', elementId: 'branch', anchorId: 'right' },
        { id: 'node', kind: 'node', x: 40, y: 0 },
      ],
      edges: [
        { id: 'a-j', sourceNodeId: 'a', targetNodeId: 'node' },
        { id: 'j-b', sourceNodeId: 'node', targetNodeId: 'b' },
        { id: 'c-j', sourceNodeId: 'c', targetNodeId: 'node' },
      ],
    }
    const result = deleteConnectionJunctions(
      [connected],
      new Set(['node']),
      [element('left'), element('right'), element('branch')],
      [asset],
      [],
      [],
    )

    expect(result.networks).toEqual([])
    expect(result.routeWaypoints).toEqual([])
  })

  it('deletes a busbar node together with every connection attached to it', () => {
    const electrical: ConnectionNetwork = {
      id: 'electrical',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'tap', kind: 'busbar-tap', busbarId: electricalBusbar.id, offset: 40 },
        { id: 'anchor-a', kind: 'element-anchor', elementId: 'a', anchorId: 'power' },
        { id: 'anchor-b', kind: 'element-anchor', elementId: 'b', anchorId: 'power' },
      ],
      edges: [
        { id: 'edge-a', sourceNodeId: 'tap', targetNodeId: 'anchor-a' },
        { id: 'edge-b', sourceNodeId: 'tap', targetNodeId: 'anchor-b' },
      ],
    }
    const result = deleteConnectionJunctions(
      [electrical],
      new Set(['tap']),
      [],
      [],
      [electricalBusbar],
      [],
    )

    expect(result.networks).toEqual([])
    expect(result.routeWaypoints).toEqual([])
  })

  it('deletes a degree-two route node by restoring local automatic routing', () => {
    const routed: ConnectionNetwork = {
      id: 'routed',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'a', kind: 'element-anchor', elementId: 'left', anchorId: 'right' },
        { id: 'b', kind: 'element-anchor', elementId: 'right', anchorId: 'right' },
        { id: 'route-node', kind: 'node', x: 40, y: 0 },
      ],
      edges: [{
        id: 'logical-edge',
        sourceNodeId: 'a',
        targetNodeId: 'b',
        routeNodeIds: ['route-node'],
        color: '#123456',
        flowDirection: 'forward',
        label: '主管',
      }],
    }

    const result = deleteConnectionJunctions(
      [routed],
      new Set(['route-node']),
      [element('left'), element('right')],
      [asset],
      [],
      [{ id: 'route-node', x: 40, y: 0 }],
    )

    expect(result.networks[0].nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(result.networks[0].edges).toEqual([{
      id: 'logical-edge',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      color: '#123456',
      flowDirection: 'forward',
      label: '主管',
    }])
    expect(result.routeWaypoints).toEqual([])
  })

  it('contracts a degree-two endpoint node and keeps the labelled edge orientation coherent', () => {
    const connected: ConnectionNetwork = {
      id: 'connected-through-node',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'a', kind: 'element-anchor', elementId: 'left', anchorId: 'right' },
        { id: 'b', kind: 'element-anchor', elementId: 'right', anchorId: 'right' },
        { id: 'middle', kind: 'node', x: 40, y: 0 },
      ],
      edges: [
        {
          id: 'a-middle',
          sourceNodeId: 'a',
          targetNodeId: 'middle',
          crossingLayer: 'lower',
          externalSupplyEndpoint: 'source',
        },
        {
          id: 'middle-b',
          sourceNodeId: 'middle',
          targetNodeId: 'b',
          label: '主管',
          labelEndpoint: 'source',
          labelSide: 'positive',
          flowDirection: 'forward',
          coolingLineRole: 'auxiliary',
          crossingLayer: 'upper',
          monitorDataVisible: true,
          monitorMetricLabelsVisible: false,
          monitorMetrics: [{
            id: 'flow',
            name: '流量',
            valueType: 'number',
            unit: 'm³/h',
            precision: 1,
            simulationMin: 0,
            simulationMax: 100,
            alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
          }],
        },
      ],
    }

    const result = deleteConnectionJunctions(
      [connected],
      new Set(['middle']),
      [element('left'), element('right')],
      [asset],
      [],
      [],
    )

    expect(result.networks[0].edges).toEqual([{
      id: 'middle-b',
      sourceNodeId: 'b',
      targetNodeId: 'a',
      label: '主管',
      labelEndpoint: 'target',
      labelSide: 'negative',
      flowDirection: 'reverse',
      crossingLayer: 'upper',
      externalSupplyEndpoint: 'target',
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [expect.objectContaining({ id: 'flow', name: '流量' })],
    }])
  })

  it('promotes compatible waypoints at the same grid point to one shared junction', () => {
    const secondNetwork: ConnectionNetwork = {
      ...network,
      id: 'network-2',
      nodes: network.nodes.map((node) => ({
        ...node,
        id: `${node.id}-2`,
        ...(node.kind === 'element-anchor' ? { elementId: `${node.elementId}-2` } : {}),
      })),
      edges: [{
        id: 'second-edge',
        sourceNodeId: 'left-node-2',
        targetNodeId: 'right-node-2',
        routeNodeIds: ['route-point-2'],
      }],
    }
    const secondRoute: RoutedConnectionEdge = {
      ...route,
      networkId: secondNetwork.id,
      edgeId: 'second-edge',
      sourceNodeId: 'left-node-2',
      targetNodeId: 'right-node-2',
    }
    let id = 0
    const result = mergeCollidingConnectionPoints({
      networks: [network, secondNetwork],
      routeWaypoints: [
        { id: 'route-point', x: 40, y: 0 },
        { id: 'route-point-2', x: 40, y: 0 },
      ],
      routedEdges: [route, secondRoute],
      diagramId: 'diagram',
      movedWaypointIds: new Set(['route-point-2']),
      createId: (prefix) => `${prefix}-${++id}`,
    })

    expect(result).not.toBeNull()
    expect(result?.routeWaypoints).toEqual([{ id: 'route-point', x: 40, y: 0 }])
    expect(result?.networks).toHaveLength(1)
    const merged = result!.networks[0]
    const junction = merged.nodes.find((node) => node.kind === 'node')
    expect(junction).toBeDefined()
    expect(merged.edges).toHaveLength(2)
    expect(merged.edges.every((edge) => edge.routeNodeIds?.includes(junction!.id))).toBe(true)
  })

  it('removes the connecting edge when two joined junctions collapse together', () => {
    const collapsed: ConnectionNetwork = {
      id: 'collapsed-network',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'collapsed-left', kind: 'element-anchor', elementId: 'left', anchorId: 'right' },
        { id: 'collapsed-right', kind: 'element-anchor', elementId: 'right', anchorId: 'right' },
        { id: 'junction-a', kind: 'node', x: 40, y: 0 },
        { id: 'junction-b', kind: 'node', x: 40, y: 0 },
      ],
      edges: [
        { id: 'collapsed-left-edge', sourceNodeId: 'collapsed-left', targetNodeId: 'junction-a' },
        {
          id: 'collapsed-bridge-edge',
          sourceNodeId: 'junction-a',
          targetNodeId: 'junction-b',
          color: '#FFC800',
        },
        { id: 'collapsed-right-edge', sourceNodeId: 'junction-b', targetNodeId: 'collapsed-right' },
      ],
    }

    const result = mergeCollidingConnectionPoints({
      networks: [collapsed],
      routeWaypoints: [],
      routedEdges: [],
      diagramId: 'diagram',
      movedJunctionIds: new Set(['junction-b']),
    })

    expect(result).not.toBeNull()
    expect(result?.networks).toHaveLength(1)
    expect(result?.networks[0].nodes.filter((node) => node.kind === 'node')).toHaveLength(1)
    expect(result?.networks[0].edges.map((edge) => edge.id)).toEqual([
      'collapsed-left-edge',
      'collapsed-right-edge',
    ])
    expect(result?.networks[0].edges.every((edge) => (
      edge.sourceNodeId !== edge.targetNodeId
    ))).toBe(true)
  })

  it('absorbs a colliding route node into its element anchor without leaving a degenerate stub', () => {
    const anchored: ConnectionNetwork = {
      id: 'anchor-merge-network',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'source-anchor', kind: 'element-anchor', elementId: 'source', anchorId: 'right' },
        { id: 'target-anchor', kind: 'element-anchor', elementId: 'target', anchorId: 'right' },
        { id: 'branch-anchor', kind: 'element-anchor', elementId: 'branch', anchorId: 'right' },
        { id: 'colliding-node', kind: 'node', x: 64, y: 32 },
      ],
      edges: [
        {
          id: 'main-edge',
          sourceNodeId: 'source-anchor',
          targetNodeId: 'target-anchor',
          routeNodeIds: ['colliding-node'],
          color: '#123456',
        },
        {
          id: 'branch-edge',
          sourceNodeId: 'branch-anchor',
          targetNodeId: 'colliding-node',
        },
      ],
    }
    const result = mergeCollidingConnectionPoints({
      networks: [anchored],
      routeWaypoints: [{ id: 'colliding-node', x: 64, y: 32 }],
      routedEdges: [{
        networkId: anchored.id,
        edgeId: 'main-edge',
        type: anchored.type,
        sourceNodeId: 'source-anchor',
        targetNodeId: 'target-anchor',
        points: [{ x: 64, y: 32 }, { x: 224, y: 32 }],
        order: 0,
      }],
      diagramId: 'diagram',
      elements: [
        element('source'),
        { ...element('target'), x: 160 },
        { ...element('branch'), x: 80, y: 80 },
      ],
      assets: [asset],
      movedJunctionIds: new Set(['colliding-node']),
    })

    expect(result).not.toBeNull()
    expect(result?.absorbedNodeIds).toEqual(['colliding-node'])
    expect(result?.routeWaypoints).toEqual([])
    expect(result?.networks[0].nodes.map((node) => node.id)).toEqual([
      'source-anchor',
      'target-anchor',
      'branch-anchor',
    ])
    expect(result?.networks[0].edges).toEqual([
      {
        id: 'main-edge',
        sourceNodeId: 'source-anchor',
        targetNodeId: 'target-anchor',
        color: '#123456',
      },
      {
        id: 'branch-edge',
        sourceNodeId: 'branch-anchor',
        targetNodeId: 'source-anchor',
      },
    ])
  })

  it('absorbs a coincident free node into the persisted busbar node', () => {
    const busbarNetwork: ConnectionNetwork = {
      id: 'busbar-network',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'tap', kind: 'busbar-tap', busbarId: electricalBusbar.id, offset: 40 },
        { id: 'anchor-a', kind: 'element-anchor', elementId: 'a', anchorId: 'power' },
      ],
      edges: [{ id: 'tap-edge', sourceNodeId: 'tap', targetNodeId: 'anchor-a' }],
    }
    const freeNetwork: ConnectionNetwork = {
      id: 'free-network',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'free', kind: 'node', x: 40, y: 0 },
        { id: 'anchor-b', kind: 'element-anchor', elementId: 'b', anchorId: 'power' },
      ],
      edges: [{ id: 'free-edge', sourceNodeId: 'free', targetNodeId: 'anchor-b' }],
    }
    const result = mergeCollidingConnectionPoints({
      networks: [busbarNetwork, freeNetwork],
      routeWaypoints: [],
      routedEdges: [],
      diagramId: 'diagram',
      busbars: [electricalBusbar],
      movedJunctionIds: new Set(['free']),
    })

    expect(result).not.toBeNull()
    expect(result?.networks).toHaveLength(1)
    expect(result?.absorbedNodeIds).toEqual(['free'])
    expect(result?.mergedJunctionIds).toEqual(['tap'])
    expect(result?.networks[0].nodes.map((node) => node.id)).toEqual([
      'tap',
      'anchor-a',
      'anchor-b',
    ])
    expect(result?.networks[0].edges).toEqual([
      { id: 'tap-edge', sourceNodeId: 'tap', targetNodeId: 'anchor-a' },
      { id: 'free-edge', sourceNodeId: 'tap', targetNodeId: 'anchor-b' },
    ])
  })

  it('attaches a moved subline endpoint to a bare position on its busbar', () => {
    const busbarNetwork: ConnectionNetwork = {
      id: 'busbar-network',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'existing-tap', kind: 'busbar-tap', busbarId: electricalBusbar.id, offset: 16 },
        { id: 'anchor-a', kind: 'element-anchor', elementId: 'a', anchorId: 'power' },
      ],
      edges: [{ id: 'tap-edge', sourceNodeId: 'existing-tap', targetNodeId: 'anchor-a' }],
    }
    const endpointNetwork: ConnectionNetwork = {
      id: 'endpoint-network',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'moved-endpoint', kind: 'node', x: 80, y: 0 },
        { id: 'anchor-b', kind: 'element-anchor', elementId: 'b', anchorId: 'power' },
      ],
      edges: [{ id: 'endpoint-edge', sourceNodeId: 'moved-endpoint', targetNodeId: 'anchor-b' }],
    }
    const result = mergeCollidingConnectionPoints({
      networks: [busbarNetwork, endpointNetwork],
      routeWaypoints: [],
      routedEdges: [],
      diagramId: 'diagram',
      busbars: [electricalBusbar],
      movedJunctionIds: new Set(['moved-endpoint']),
    })

    expect(result).not.toBeNull()
    expect(result?.networks).toHaveLength(1)
    expect(result?.mergedJunctionIds).toContain('moved-endpoint')
    expect(result?.absorbedNodeIds).toEqual([])
    expect(result?.networks[0].nodes).toContainEqual({
      id: 'moved-endpoint',
      kind: 'busbar-tap',
      busbarId: electricalBusbar.id,
      offset: 80,
    })
    expect(result?.networks[0].edges).toEqual(expect.arrayContaining([
      { id: 'tap-edge', sourceNodeId: 'existing-tap', targetNodeId: 'anchor-a' },
      { id: 'endpoint-edge', sourceNodeId: 'moved-endpoint', targetNodeId: 'anchor-b' },
    ]))
  })

  it('attaches a moved multi-subline node to a busbar without dropping its branches', () => {
    const branchedNetwork: ConnectionNetwork = {
      id: 'branched-network',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'moved-node', kind: 'node', x: 80, y: 0 },
        { id: 'left', kind: 'node', x: 48, y: 32 },
        { id: 'right', kind: 'node', x: 112, y: 32 },
      ],
      edges: [
        { id: 'left-edge', sourceNodeId: 'left', targetNodeId: 'moved-node' },
        { id: 'right-edge', sourceNodeId: 'moved-node', targetNodeId: 'right' },
      ],
    }
    const result = mergeCollidingConnectionPoints({
      networks: [branchedNetwork],
      routeWaypoints: [],
      routedEdges: [],
      diagramId: 'diagram',
      busbars: [electricalBusbar],
      movedJunctionIds: new Set(['moved-node']),
    })

    expect(result?.networks[0].nodes).toContainEqual({
      id: 'moved-node',
      kind: 'busbar-tap',
      busbarId: electricalBusbar.id,
      offset: 80,
    })
    expect(result?.networks[0].edges).toHaveLength(2)
  })

  it('does not connect a passive route crossing without a moved persisted node', () => {
    const result = mergeCollidingConnectionPoints({
      networks: [network],
      routeWaypoints: [{ id: 'route-point', x: 40, y: 0 }],
      routedEdges: [route],
      diagramId: 'diagram',
      busbars: [electricalBusbar],
      movedWaypointIds: new Set(['route-point']),
    })

    expect(result).not.toBeNull()
    expect(result?.networks[0].nodes.some((node) => node.kind === 'busbar-tap')).toBe(false)
    expect(result?.routeWaypoints).toEqual([{ id: 'route-point', x: 40, y: 0 }])
  })

  it('rejects automatic attachment at the ambiguous intersection of two busbars', () => {
    const verticalBusbar: Busbar = {
      ...electricalBusbar,
      id: 'vertical-busbar',
      orientation: 'vertical',
      x: 80,
      y: -80,
    }
    const endpointNetwork: ConnectionNetwork = {
      id: 'ambiguous-endpoint-network',
      diagramId: 'diagram',
      type: 'electrical',
      nodes: [
        { id: 'ambiguous-endpoint', kind: 'node', x: 80, y: 0 },
        { id: 'other', kind: 'node', x: 80, y: 32 },
      ],
      edges: [{ id: 'ambiguous-edge', sourceNodeId: 'ambiguous-endpoint', targetNodeId: 'other' }],
    }

    expect(mergeCollidingConnectionPoints({
      networks: [endpointNetwork],
      routeWaypoints: [],
      routedEdges: [],
      diagramId: 'diagram',
      busbars: [electricalBusbar, verticalBusbar],
      movedJunctionIds: new Set(['ambiguous-endpoint']),
    })).toBeNull()
  })

  it('removes both endpoint nodes when a dragged segment returns to its anchors', () => {
    const restored: ConnectionNetwork = {
      id: 'restored-segment-network',
      diagramId: 'diagram',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'source-anchor', kind: 'element-anchor', elementId: 'source', anchorId: 'right' },
        { id: 'target-anchor', kind: 'element-anchor', elementId: 'target', anchorId: 'right' },
        { id: 'source-route-node', kind: 'node', x: 64, y: 32 },
        { id: 'target-route-node', kind: 'node', x: 224, y: 32 },
      ],
      edges: [{
        id: 'restored-edge',
        sourceNodeId: 'source-anchor',
        targetNodeId: 'target-anchor',
        routeNodeIds: ['source-route-node', 'target-route-node'],
      }],
    }
    const result = mergeCollidingConnectionPoints({
      networks: [restored],
      routeWaypoints: [
        { id: 'source-route-node', x: 64, y: 32 },
        { id: 'target-route-node', x: 224, y: 32 },
      ],
      routedEdges: [],
      diagramId: 'diagram',
      elements: [element('source'), { ...element('target'), x: 160 }],
      assets: [asset],
      movedJunctionIds: new Set(['source-route-node', 'target-route-node']),
    })

    expect(result).not.toBeNull()
    expect(result?.absorbedNodeIds).toEqual(['source-route-node', 'target-route-node'])
    expect(result?.routeWaypoints).toEqual([])
    expect(result?.networks[0].nodes.map((node) => node.id)).toEqual([
      'source-anchor',
      'target-anchor',
    ])
    expect(result?.networks[0].edges).toEqual([{
      id: 'restored-edge',
      sourceNodeId: 'source-anchor',
      targetNodeId: 'target-anchor',
    }])
  })

  it('collapses a folded segment when it is dragged back onto an adjacent anchor', () => {
    const foldAsset: AssetDefinition = {
      key: 'fold-test',
      name: '折返测试',
      category: '冷却',
      source: 'fold-test.svg',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      anchors: [{
        id: 'bottom',
        name: '下方',
        x: 16,
        y: 32,
        direction: 'bottom',
        type: 'cooling-general',
      }],
    }
    const elements: DiagramElement[] = [
      {
        ...element('fold-source'),
        assetKey: foldAsset.key,
        x: 208,
        y: 208,
        width: 32,
        height: 32,
      },
      {
        ...element('fold-target'),
        assetKey: foldAsset.key,
        x: 608,
        y: 256,
        width: 32,
        height: 32,
        rotation: 90,
      },
    ]
    const folded: ConnectionNetwork = {
      id: 'fold-network',
      diagramId: 'diagram',
      type: 'cooling-general',
      nodes: [
        {
          id: 'fold-source-anchor',
          kind: 'element-anchor',
          elementId: 'fold-source',
          anchorId: 'bottom',
        },
        {
          id: 'fold-target-anchor',
          kind: 'element-anchor',
          elementId: 'fold-target',
          anchorId: 'bottom',
        },
        { id: 'fold-left-node', kind: 'node', x: 224, y: 296 },
        { id: 'fold-overshoot-node', kind: 'node', x: 608, y: 296 },
        { id: 'fold-return-node', kind: 'node', x: 600, y: 296 },
      ],
      edges: [{
        id: 'fold-edge',
        sourceNodeId: 'fold-source-anchor',
        targetNodeId: 'fold-target-anchor',
        routeNodeIds: ['fold-left-node', 'fold-overshoot-node', 'fold-return-node'],
      }],
    }
    const foldedRoute: RoutedConnectionEdge = {
      networkId: folded.id,
      edgeId: 'fold-edge',
      type: folded.type,
      sourceNodeId: 'fold-source-anchor',
      targetNodeId: 'fold-target-anchor',
      order: 0,
      points: [
        { x: 224, y: 240 },
        { x: 224, y: 296 },
        { x: 608, y: 296 },
        { x: 600, y: 296 },
        { x: 600, y: 272 },
        { x: 608, y: 272 },
      ],
    }
    const segment = atomicRouteSegments([foldedRoute]).find((candidate) => (
      candidate.orientation === 'vertical' && candidate.start.x === 600
    ))!
    const delta = snapDraggedRouteSegmentDelta(segment, [foldedRoute], 8, 8)
    const candidate = applyDraggedRouteSegment(
      [folded],
      folded.nodes.flatMap((node) => node.kind === 'node' ? [node] : []),
      [foldedRoute],
      segment,
      { x: segment.start.x + delta, y: segment.start.y },
      { x: segment.end.x + delta, y: segment.end.y },
      (prefix) => `${prefix}-created`,
    )
    const result = mergeCollidingConnectionPoints({
      networks: candidate.networks,
      routeWaypoints: candidate.routeWaypoints,
      routedEdges: [foldedRoute],
      diagramId: 'diagram',
      elements,
      assets: [foldAsset],
      movedWaypointIds: new Set(candidate.waypointIds),
    })

    expect(result).not.toBeNull()
    expect(result?.absorbedNodeIds).toEqual(['route-waypoint-created'])
    expect(result?.routeWaypoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 224, y: 296 },
      { x: 608, y: 296 },
    ])
    expect(result?.networks[0].edges[0].routeNodeIds).toEqual([
      'fold-left-node',
      'fold-overshoot-node',
    ])
  })

  it('rejects colliding points from incompatible cooling circuits', () => {
    const incompatible: ConnectionNetwork = {
      ...network,
      id: 'hot-network',
      type: 'cooling-primary-hot',
      nodes: network.nodes.map((node) => ({ ...node, id: `${node.id}-hot` })),
      edges: [{
        id: 'hot-edge',
        sourceNodeId: 'left-node-hot',
        targetNodeId: 'right-node-hot',
        routeNodeIds: ['hot-point'],
      }],
    }
    expect(mergeCollidingConnectionPoints({
      networks: [network, incompatible],
      routeWaypoints: [
        { id: 'route-point', x: 40, y: 0 },
        { id: 'hot-point', x: 40, y: 0 },
      ],
      routedEdges: [route, {
        ...route,
        networkId: incompatible.id,
        edgeId: 'hot-edge',
        type: incompatible.type,
        sourceNodeId: 'left-node-hot',
        targetNodeId: 'right-node-hot',
      }],
      diagramId: 'diagram',
      movedWaypointIds: new Set(['hot-point']),
    })).toBeNull()
  })
})
