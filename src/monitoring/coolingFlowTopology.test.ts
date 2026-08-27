import { describe, expect, it } from 'vitest'

import {
  resolveConnectionType,
  type AssetDefinition,
  type ConnectionNetwork,
  type DiagramElement,
} from '../domain/project'
import { deriveCoolingFlowTopology } from './coolingFlowTopology'
import { MockCoolingRuntimeProvider } from './coolingRuntime'

const coolingType = 'cooling-primary-cold' as const

const pumpAsset: AssetDefinition = {
  key: 'pump',
  name: '测试水泵',
  category: '冷却',
  source: 'pump.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  coolingDeviceRole: 'pump',
  anchors: [
    { id: 'pump-in', name: '入口', x: 8, y: 0, direction: 'top', type: coolingType, flowRole: 'inlet' },
    { id: 'pump-out', name: '出口', x: 24, y: 32, direction: 'bottom', type: coolingType, flowRole: 'outlet' },
  ],
}

const valveAsset: AssetDefinition = {
  key: 'valve',
  name: '测试阀门',
  category: '冷却',
  source: 'valve.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  coolingDeviceRole: 'valve',
  anchors: [
    { id: 'valve-a', name: 'A', x: 8, y: 0, direction: 'top', type: coolingType },
    { id: 'valve-b', name: 'B', x: 24, y: 32, direction: 'bottom', type: coolingType },
  ],
}

const checkValveAsset: AssetDefinition = {
  ...valveAsset,
  key: 'check-valve',
  name: '测试止回阀',
  coolingDeviceRole: 'check-valve',
  anchors: [
    { ...valveAsset.anchors[0], flowRole: 'inlet' },
    { ...valveAsset.anchors[1], flowRole: 'outlet' },
  ],
}

const coolingTowerAsset: AssetDefinition = {
  key: 'cooling-tower',
  name: '测试冷却塔',
  category: '冷却',
  source: 'cooling-tower.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  anchors: [
    { id: 'ct-hot', name: '热水入口', x: 8, y: 0, direction: 'top', type: 'cooling-primary-hot' },
    { id: 'ct-cold', name: '冷水出口', x: 24, y: 32, direction: 'bottom', type: 'cooling-primary-cold' },
  ],
}

const heatExchangerAsset: AssetDefinition = {
  key: 'heat-exchanger',
  name: '测试板式换热器',
  category: '冷却',
  source: 'heat-exchanger.svg',
  intrinsicWidth: 32,
  intrinsicHeight: 32,
  anchors: [
    { id: 'phe-primary-hot', name: '一次热', x: 0, y: 8, direction: 'left', type: 'cooling-primary-hot' },
    { id: 'phe-primary-cold', name: '一次冷', x: 32, y: 8, direction: 'right', type: 'cooling-primary-cold' },
    { id: 'phe-secondary-hot', name: '二次热', x: 0, y: 24, direction: 'left', type: 'cooling-secondary-hot' },
    { id: 'phe-secondary-cold', name: '二次冷', x: 32, y: 24, direction: 'right', type: 'cooling-secondary-cold' },
  ],
}

const generalPumpAsset: AssetDefinition = {
  ...pumpAsset,
  key: 'general-pump',
  anchors: pumpAsset.anchors.map((anchor) => ({
    ...anchor,
    type: 'cooling-general' as const,
  })),
}

function element(id: string, assetKey: string): DiagramElement {
  return {
    id,
    diagramId: 'diagram',
    assetKey,
    name: id,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

const elements = [element('pump-1', 'pump'), element('valve-1', 'valve')]
const assets = [pumpAsset, valveAsset]

function closedLoop(flowDirection?: 'forward' | 'reverse'): ConnectionNetwork[] {
  return [{
    id: 'network',
    diagramId: 'diagram',
    type: coolingType,
    nodes: [
      { id: 'out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
      { id: 'va', kind: 'element-anchor', elementId: 'valve-1', anchorId: 'valve-a' },
      { id: 'vb', kind: 'element-anchor', elementId: 'valve-1', anchorId: 'valve-b' },
      { id: 'in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
    ],
    edges: [
      { id: 'outlet-pipe', sourceNodeId: 'out', targetNodeId: 'va', flowDirection },
      { id: 'return-pipe', sourceNodeId: 'vb', targetNodeId: 'in', flowDirection },
    ],
  }]
}

function runtime(overrides?: {
  pumpRunningOverrides?: Record<string, boolean>
  pumpOutputPowerOverrides?: Record<string, number>
  valveOpenOverrides?: Record<string, boolean>
}) {
  return new MockCoolingRuntimeProvider().getSnapshot({ elements, assets, ...overrides })
}

describe('cooling closed-loop topology', () => {
  it('animates the complete pump outlet to inlet loop through an open valve', () => {
    const topology = deriveCoolingFlowTopology({
      elements,
      assets,
      networks: closedLoop(),
      runtime: runtime(),
    })
    expect(topology.edges).toEqual([
      { edgeId: 'outlet-pipe', direction: 'forward', speedMultiplier: 1, flowRate: 100 },
      { edgeId: 'return-pipe', direction: 'forward', speedMultiplier: 1, flowRate: 100 },
    ])
    expect(topology.pumpFlowRates).toEqual({ 'pump-1': 100 })
    expect(topology.activePumpElementIds).toEqual(new Set(['pump-1']))
    expect(topology.diagnostics).toEqual([])
  })

  it('stops the loop when the pump stops or the valve closes', () => {
    const stopped = deriveCoolingFlowTopology({
      elements,
      assets,
      networks: closedLoop(),
      runtime: runtime({ pumpRunningOverrides: { 'pump-1': false } }),
    })
    expect(stopped.edges).toEqual([])

    const closed = deriveCoolingFlowTopology({
      elements,
      assets,
      networks: closedLoop(),
      runtime: runtime({ valveOpenOverrides: { 'valve-1': false } }),
    })
    expect(closed.edges).toEqual([])
    expect(closed.diagnostics.map((item) => item.code)).toContain('pump-open-loop')
  })

  it('allows an open check valve only from inlet to outlet', () => {
    const directedElements = [element('pump-1', 'pump'), element('valve-1', 'check-valve')]
    const directedAssets = [pumpAsset, checkValveAsset]
    const provider = new MockCoolingRuntimeProvider()
    const allowed = deriveCoolingFlowTopology({
      elements: directedElements,
      assets: directedAssets,
      networks: closedLoop(),
      runtime: provider.getSnapshot({ elements: directedElements, assets: directedAssets }),
    })
    expect(new Set(allowed.edges.map((edge) => edge.edgeId))).toEqual(new Set([
      'outlet-pipe',
      'return-pipe',
    ]))

    const reverseNetworks = closedLoop()
    reverseNetworks[0].nodes = reverseNetworks[0].nodes.map((node) => {
      if (node.kind !== 'element-anchor' || node.elementId !== 'valve-1') return node
      return node.id === 'va'
        ? { ...node, anchorId: 'valve-b' }
        : { ...node, anchorId: 'valve-a' }
    })
    const blocked = deriveCoolingFlowTopology({
      elements: directedElements,
      assets: directedAssets,
      networks: reverseNetworks,
      runtime: provider.getSnapshot({ elements: directedElements, assets: directedAssets }),
    })
    expect(blocked.edges).toEqual([])
    expect(blocked.diagnostics.map((item) => item.code)).toContain('pump-open-loop')

    const bidirectional = deriveCoolingFlowTopology({
      elements,
      assets,
      networks: reverseNetworks,
      runtime: runtime(),
    })
    expect(new Set(bidirectional.edges.map((edge) => edge.edgeId))).toEqual(new Set([
      'outlet-pipe',
      'return-pipe',
    ]))
  })

  it('rejects a one-way pipe that points against the pump loop', () => {
    const topology = deriveCoolingFlowTopology({
      elements,
      assets,
      networks: closedLoop('reverse'),
      runtime: runtime(),
    })
    expect(topology.edges).toEqual([])
    expect(topology.diagnostics.map((item) => item.code)).toContain('pump-open-loop')
  })

  it('keeps all deterministic parallel outlet-to-inlet paths', () => {
    const networks = closedLoop()
    networks[0].nodes.push({ id: 'branch', kind: 'node', x: 16, y: 16 })
    networks[0].edges.push({
      id: 'parallel-pipe',
      sourceNodeId: 'out',
      targetNodeId: 'in',
      routeNodeIds: ['branch'],
    })
    const topology = deriveCoolingFlowTopology({
      elements,
      assets,
      networks,
      runtime: runtime(),
    })
    expect(new Set(topology.edges.map((edge) => edge.edgeId))).toEqual(new Set([
      'outlet-pipe',
      'return-pipe',
      'parallel-pipe',
    ]))
  })

  it('splits visual flow equally across equal-resistance parallel branches', () => {
    const networks: ConnectionNetwork[] = [{
      id: 'parallel-network',
      diagramId: 'diagram',
      type: coolingType,
      nodes: [
        { id: 'out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
        { id: 'in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
      ],
      edges: [
        { id: 'branch-a', sourceNodeId: 'out', targetNodeId: 'in' },
        { id: 'branch-b', sourceNodeId: 'out', targetNodeId: 'in' },
      ],
    }]
    const topology = deriveCoolingFlowTopology({
      elements: [element('pump-1', 'pump')],
      assets: [pumpAsset],
      networks,
      runtime: new MockCoolingRuntimeProvider().getSnapshot({
        elements: [element('pump-1', 'pump')],
        assets: [pumpAsset],
      }),
    })

    expect(topology.edges).toHaveLength(2)
    expect(topology.edges.map((edge) => edge.flowRate)).toEqual([50, 50])
    expect(topology.edges.every((edge) => edge.speedMultiplier! < 1)).toBe(true)
  })

  it('keeps one logical edge resistance stable when path nodes are added', () => {
    const network: ConnectionNetwork = {
      id: 'node-network',
      diagramId: 'diagram',
      type: coolingType,
      nodes: [
        { id: 'out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
        { id: 'waypoint-a', kind: 'node', x: 8, y: 0 },
        { id: 'waypoint-b', kind: 'node', x: 16, y: 0 },
        { id: 'in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
      ],
      edges: [{
        id: 'segmented-edge',
        sourceNodeId: 'out',
        targetNodeId: 'in',
        routeNodeIds: ['waypoint-a', 'waypoint-b'],
      }],
    }
    const topology = deriveCoolingFlowTopology({
      elements: [element('pump-1', 'pump')],
      assets: [pumpAsset],
      networks: [network],
      runtime: new MockCoolingRuntimeProvider().getSnapshot({
        elements: [element('pump-1', 'pump')],
        assets: [pumpAsset],
      }),
    })

    expect(topology.edges).toEqual([{
      edgeId: 'segmented-edge',
      direction: 'forward',
      speedMultiplier: 1,
      flowRate: 100,
    }])
  })

  it('uses the net flow direction when two pumps oppose on a shared pipe', () => {
    const pumpElements = [element('pump-1', 'pump'), element('pump-2', 'pump')]
    const network: ConnectionNetwork = {
      id: 'opposed-pumps',
      diagramId: 'diagram',
      type: coolingType,
      nodes: [
        { id: 'p1-out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
        { id: 'p1-in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
        { id: 'p2-out', kind: 'element-anchor', elementId: 'pump-2', anchorId: 'pump-out' },
        { id: 'p2-in', kind: 'element-anchor', elementId: 'pump-2', anchorId: 'pump-in' },
        { id: 'left', kind: 'node', x: 0, y: 0 },
        { id: 'right', kind: 'node', x: 24, y: 0 },
      ],
      edges: [
        { id: 'p1-supply', sourceNodeId: 'p1-out', targetNodeId: 'left' },
        { id: 'shared', sourceNodeId: 'left', targetNodeId: 'right' },
        { id: 'p1-return', sourceNodeId: 'right', targetNodeId: 'p1-in' },
        { id: 'p2-supply', sourceNodeId: 'p2-out', targetNodeId: 'right' },
        { id: 'p2-return', sourceNodeId: 'left', targetNodeId: 'p2-in' },
      ],
    }
    const runtimeSnapshot = new MockCoolingRuntimeProvider().getSnapshot({
      elements: pumpElements,
      assets: [pumpAsset],
      pumpOutputPowerOverrides: { 'pump-1': 100, 'pump-2': 50 },
    })
    const topology = deriveCoolingFlowTopology({
      elements: pumpElements,
      assets: [pumpAsset],
      networks: [network],
      runtime: runtimeSnapshot,
    })
    const shared = topology.edges.find((edge) => edge.edgeId === 'shared')

    expect(shared?.direction).toBe('forward')
    expect(shared?.flowRate).toBeCloseTo(50)
    expect(topology.diagnostics).toEqual([])
    expect(topology.pumpFlowRates).toEqual({ 'pump-1': 100, 'pump-2': 50 })
  })

  it('keeps direct hot/cold wiring incompatible but crosses thermal sides inside the same circuit', () => {
    expect(resolveConnectionType([
      'cooling-primary-hot',
      'cooling-primary-cold',
    ])).toBeNull()

    const thermalElements = [
      element('pump-1', 'pump'),
      element('ct-1', 'cooling-tower'),
      element('phe-1', 'heat-exchanger'),
    ]
    const thermalAssets = [pumpAsset, coolingTowerAsset, heatExchangerAsset]
    const networks: ConnectionNetwork[] = [
      {
        id: 'primary-cold',
        diagramId: 'diagram',
        type: 'cooling-primary-cold',
        nodes: [
          { id: 'pump-out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
          { id: 'phe-primary-cold', kind: 'element-anchor', elementId: 'phe-1', anchorId: 'phe-primary-cold' },
          { id: 'ct-primary-cold', kind: 'element-anchor', elementId: 'ct-1', anchorId: 'ct-cold' },
          { id: 'pump-in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
        ],
        edges: [
          { id: 'cold-supply', sourceNodeId: 'pump-out', targetNodeId: 'phe-primary-cold' },
          { id: 'cold-return', sourceNodeId: 'ct-primary-cold', targetNodeId: 'pump-in' },
        ],
      },
      {
        id: 'primary-hot',
        diagramId: 'diagram',
        type: 'cooling-primary-hot',
        nodes: [
          { id: 'phe-primary-hot', kind: 'element-anchor', elementId: 'phe-1', anchorId: 'phe-primary-hot' },
          { id: 'ct-primary-hot', kind: 'element-anchor', elementId: 'ct-1', anchorId: 'ct-hot' },
        ],
        edges: [
          { id: 'hot-return', sourceNodeId: 'phe-primary-hot', targetNodeId: 'ct-primary-hot' },
        ],
      },
    ]
    const topology = deriveCoolingFlowTopology({
      elements: thermalElements,
      assets: thermalAssets,
      networks,
      runtime: new MockCoolingRuntimeProvider().getSnapshot({
        elements: thermalElements,
        assets: thermalAssets,
      }),
    })

    expect(topology.activePumpElementIds).toEqual(new Set(['pump-1']))
    expect(new Set(topology.edges.map((edge) => edge.edgeId))).toEqual(new Set([
      'cold-supply',
      'hot-return',
      'cold-return',
    ]))
    expect(topology.diagnostics).toEqual([])
  })

  it('does not short the primary and secondary circuits through a heat exchanger', () => {
    const isolatedElements = [
      element('pump-1', 'general-pump'),
      element('phe-1', 'heat-exchanger'),
    ]
    const isolatedAssets = [generalPumpAsset, heatExchangerAsset]
    const networks: ConnectionNetwork[] = [
      {
        id: 'primary-cold',
        diagramId: 'diagram',
        type: 'cooling-primary-cold',
        nodes: [
          { id: 'pump-out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
          { id: 'phe-primary-cold', kind: 'element-anchor', elementId: 'phe-1', anchorId: 'phe-primary-cold' },
        ],
        edges: [
          { id: 'primary-pipe', sourceNodeId: 'pump-out', targetNodeId: 'phe-primary-cold' },
        ],
      },
      {
        id: 'secondary-hot',
        diagramId: 'diagram',
        type: 'cooling-secondary-hot',
        nodes: [
          { id: 'phe-secondary-hot', kind: 'element-anchor', elementId: 'phe-1', anchorId: 'phe-secondary-hot' },
          { id: 'pump-in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
        ],
        edges: [
          { id: 'secondary-pipe', sourceNodeId: 'phe-secondary-hot', targetNodeId: 'pump-in' },
        ],
      },
    ]
    const topology = deriveCoolingFlowTopology({
      elements: isolatedElements,
      assets: isolatedAssets,
      networks,
      runtime: new MockCoolingRuntimeProvider().getSnapshot({
        elements: isolatedElements,
        assets: isolatedAssets,
      }),
    })

    expect(topology.activePumpElementIds).toEqual(new Set())
    expect(topology.edges).toEqual([])
    expect(topology.diagnostics.map((item) => item.code)).toContain('pump-open-loop')
  })

  it('derives the union of a combinatorial parallel loop without enumerating every path', () => {
    const nodes: ConnectionNetwork['nodes'] = [
      { id: 'pump-out', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-out' },
      { id: 'pump-in', kind: 'element-anchor', elementId: 'pump-1', anchorId: 'pump-in' },
    ]
    const edges: ConnectionNetwork['edges'] = []
    let previousNodeId = 'pump-out'
    for (let index = 0; index < 14; index += 1) {
      const upperNodeId = `upper-${index}`
      const lowerNodeId = `lower-${index}`
      const mergeNodeId = `merge-${index}`
      nodes.push(
        { id: upperNodeId, kind: 'node', x: index * 24, y: 0 },
        { id: lowerNodeId, kind: 'node', x: index * 24, y: 16 },
        { id: mergeNodeId, kind: 'node', x: index * 24 + 8, y: 8 },
      )
      edges.push(
        { id: `upper-in-${index}`, sourceNodeId: previousNodeId, targetNodeId: upperNodeId },
        { id: `upper-out-${index}`, sourceNodeId: upperNodeId, targetNodeId: mergeNodeId },
        { id: `lower-in-${index}`, sourceNodeId: previousNodeId, targetNodeId: lowerNodeId },
        { id: `lower-out-${index}`, sourceNodeId: lowerNodeId, targetNodeId: mergeNodeId },
      )
      previousNodeId = mergeNodeId
    }
    edges.push({ id: 'loop-return', sourceNodeId: previousNodeId, targetNodeId: 'pump-in' })
    const networks: ConnectionNetwork[] = [{
      id: 'combinatorial-loop',
      diagramId: 'diagram',
      type: coolingType,
      nodes,
      edges,
    }]
    const topology = deriveCoolingFlowTopology({
      elements: [element('pump-1', 'pump')],
      assets: [pumpAsset],
      networks,
      runtime: new MockCoolingRuntimeProvider().getSnapshot({
        elements: [element('pump-1', 'pump')],
        assets: [pumpAsset],
      }),
    })

    expect(topology.activePumpElementIds).toEqual(new Set(['pump-1']))
    expect(new Set(topology.edges.map((edge) => edge.edgeId))).toEqual(new Set(
      edges.map((edge) => edge.id),
    ))
    expect(topology.edges.every((edge) => edge.direction === 'forward')).toBe(true)
    expect(topology.diagnostics).toEqual([])
  })
})
