import { describe, expect, it } from 'vitest'

import type { Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
import { derivePowerFlowTopology } from './flowTopology'

const elements: DiagramElement[] = [
  { id: 'grid', diagramId: 'd', assetKey: 'grid', name: 'Grid', x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
  { id: 'switch', diagramId: 'd', assetKey: 'switch', name: 'Switch', x: 80, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {} },
  { id: 'pod', diagramId: 'd', assetKey: 'compute-pod', name: '算力 POD', x: 160, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
]

const network: ConnectionNetwork = {
  id: 'network',
  diagramId: 'd',
  type: 'electrical',
  nodes: [
    { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
    { id: 'switch-in', kind: 'element-anchor', elementId: 'switch', anchorId: 'in' },
    { id: 'switch-out', kind: 'element-anchor', elementId: 'switch', anchorId: 'out' },
    { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
  ],
  edges: [
    { id: 'upstream', sourceNodeId: 'switch-in', targetNodeId: 'grid-node' },
    { id: 'downstream', sourceNodeId: 'switch-out', targetNodeId: 'pod-node' },
  ],
}

describe('monitor power flow topology', () => {
  it('hides every line directly connected to an open Switch', () => {
    const flow = derivePowerFlowTopology({
      elements,
      busbars: [],
      networks: [network],
      switchStates: { switch: false },
    })

    expect(flow.edges).toEqual([])
    expect(flow.energizedElementIds).toEqual(new Set(['grid', 'switch']))
  })

  it('hides the whole source-side chain when an open Switch leaves no reachable target', () => {
    const feederElements: DiagramElement[] = [
      elements[0],
      { id: 'transformer', diagramId: 'd', assetKey: 'transformer', name: 'Transformer', x: 48, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {} },
      elements[1],
      elements[2],
    ]
    const feederNetwork: ConnectionNetwork = {
      id: 'feeder-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'transformer-in', kind: 'element-anchor', elementId: 'transformer', anchorId: 'in' },
        { id: 'transformer-out', kind: 'element-anchor', elementId: 'transformer', anchorId: 'out' },
        { id: 'switch-in', kind: 'element-anchor', elementId: 'switch', anchorId: 'in' },
        { id: 'switch-out', kind: 'element-anchor', elementId: 'switch', anchorId: 'out' },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
      ],
      edges: [
        { id: 'source-feeder', sourceNodeId: 'grid-node', targetNodeId: 'transformer-in' },
        { id: 'switch-upstream', sourceNodeId: 'transformer-out', targetNodeId: 'switch-in' },
        { id: 'switch-downstream', sourceNodeId: 'switch-out', targetNodeId: 'pod-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: feederElements,
      busbars: [],
      networks: [feederNetwork],
      switchStates: { switch: false },
    })

    expect(flow.edges).toEqual([])
  })

  it('does not animate a closed source chain without a business target', () => {
    const noTargetNetwork: ConnectionNetwork = {
      ...network,
      nodes: network.nodes.filter((node) => node.id !== 'pod-node'),
      edges: network.edges.filter((edge) => edge.id !== 'downstream'),
    }

    const flow = derivePowerFlowTopology({
      elements: elements.filter((element) => element.id !== 'pod'),
      busbars: [],
      networks: [noTargetNetwork],
      switchStates: { switch: true },
    })

    expect(flow.edges).toEqual([])
  })

  it('treats Generator and Battery as sources and FM as a terminating target', () => {
    const roleElements: DiagramElement[] = [
      { id: 'generator', diagramId: 'd', assetKey: 'generator', name: 'Generator', x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'battery', diagramId: 'd', assetKey: 'battery', name: 'Battery', x: 0, y: 80, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'fm', diagramId: 'd', assetKey: 'fm', name: 'FM', x: 80, y: 40, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
      { id: 'pod', diagramId: 'd', assetKey: 'compute-pod', name: '算力 POD', x: 160, y: 40, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
    ]
    const roleNetwork: ConnectionNetwork = {
      id: 'role-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'generator-node', kind: 'element-anchor', elementId: 'generator', anchorId: 'out' },
        { id: 'battery-node', kind: 'element-anchor', elementId: 'battery', anchorId: 'out' },
        { id: 'fm-in', kind: 'element-anchor', elementId: 'fm', anchorId: 'in' },
        { id: 'fm-out', kind: 'element-anchor', elementId: 'fm', anchorId: 'out' },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
      ],
      edges: [
        { id: 'generator-feed', sourceNodeId: 'generator-node', targetNodeId: 'fm-in' },
        { id: 'battery-feed', sourceNodeId: 'battery-node', targetNodeId: 'fm-in' },
        { id: 'fm-downstream', sourceNodeId: 'fm-out', targetNodeId: 'pod-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: roleElements,
      busbars: [],
      networks: [roleNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      { edgeId: 'generator-feed', direction: 'forward' },
      { edgeId: 'battery-feed', direction: 'forward' },
    ])
    expect(flow.energizedElementIds).toEqual(new Set(['generator', 'battery', 'fm']))
  })

  it('keeps each source shortest path when a nearby Battery is closer than Grid', () => {
    const sourceElements: DiagramElement[] = [
      { id: 'grid', diagramId: 'd', assetKey: 'grid', name: 'Grid', x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'relay', diagramId: 'd', assetKey: 'cabinet', name: 'Relay', x: 80, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'battery', diagramId: 'd', assetKey: 'battery', name: 'Battery', x: 80, y: 80, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'fm', diagramId: 'd', assetKey: 'fm', name: 'FM', x: 160, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
    ]
    const sourceNetwork: ConnectionNetwork = {
      id: 'source-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'relay-in', kind: 'element-anchor', elementId: 'relay', anchorId: 'in' },
        { id: 'relay-out', kind: 'element-anchor', elementId: 'relay', anchorId: 'out' },
        { id: 'battery-node', kind: 'element-anchor', elementId: 'battery', anchorId: 'out' },
        { id: 'fm-node', kind: 'element-anchor', elementId: 'fm', anchorId: 'in' },
      ],
      edges: [
        { id: 'grid-feed', sourceNodeId: 'grid-node', targetNodeId: 'relay-in' },
        { id: 'grid-target', sourceNodeId: 'relay-out', targetNodeId: 'fm-node' },
        { id: 'battery-target', sourceNodeId: 'battery-node', targetNodeId: 'fm-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: sourceElements,
      busbars: [],
      networks: [sourceNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      { edgeId: 'grid-feed', direction: 'forward' },
      { edgeId: 'grid-target', direction: 'forward' },
      { edgeId: 'battery-target', direction: 'forward' },
    ])
  })

  it('omits a line when independent source paths require opposite directions', () => {
    const conflictElements: DiagramElement[] = [
      { id: 'fm-left', diagramId: 'd', assetKey: 'fm', name: 'FM Left', x: 0, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
      { id: 'grid', diagramId: 'd', assetKey: 'grid', name: 'Grid', x: 80, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'battery', diagramId: 'd', assetKey: 'battery', name: 'Battery', x: 160, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'fm-right', diagramId: 'd', assetKey: 'fm', name: 'FM Right', x: 240, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
    ]
    const conflictNetwork: ConnectionNetwork = {
      id: 'conflict-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'fm-left-node', kind: 'element-anchor', elementId: 'fm-left', anchorId: 'in' },
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'battery-node', kind: 'element-anchor', elementId: 'battery', anchorId: 'out' },
        { id: 'fm-right-node', kind: 'element-anchor', elementId: 'fm-right', anchorId: 'in' },
      ],
      edges: [
        { id: 'left-target', sourceNodeId: 'grid-node', targetNodeId: 'fm-left-node' },
        { id: 'direction-conflict', sourceNodeId: 'grid-node', targetNodeId: 'battery-node' },
        { id: 'right-target', sourceNodeId: 'battery-node', targetNodeId: 'fm-right-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: conflictElements,
      busbars: [],
      networks: [conflictNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      { edgeId: 'left-target', direction: 'forward' },
      { edgeId: 'right-target', direction: 'forward' },
    ])
  })

  it('keeps a valid target path but removes a dead-end branch', () => {
    const branchElement: DiagramElement = {
      id: 'cabinet', diagramId: 'd', assetKey: 'cabinet', name: 'Cabinet',
      x: 160, y: 80, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
    }
    const branchedNetwork: ConnectionNetwork = {
      id: 'branched-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
        { id: 'cabinet-node', kind: 'element-anchor', elementId: 'cabinet', anchorId: 'in' },
      ],
      edges: [
        { id: 'target-feed', sourceNodeId: 'grid-node', targetNodeId: 'pod-node' },
        { id: 'dead-end', sourceNodeId: 'grid-node', targetNodeId: 'cabinet-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [elements[0], elements[2], branchElement],
      busbars: [],
      networks: [branchedNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([{ edgeId: 'target-feed', direction: 'forward' }])
  })

  it('keeps all equally short valid paths to a target', () => {
    const left: DiagramElement = {
      id: 'left', diagramId: 'd', assetKey: 'cabinet', name: 'Left',
      x: 80, y: -40, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
    }
    const right: DiagramElement = {
      ...left, id: 'right', name: 'Right', y: 40,
    }
    const parallelNetwork: ConnectionNetwork = {
      id: 'parallel-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'in' },
        { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'in' },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
      ],
      edges: [
        { id: 'left-in', sourceNodeId: 'grid-node', targetNodeId: 'left-node' },
        { id: 'left-out', sourceNodeId: 'left-node', targetNodeId: 'pod-node' },
        { id: 'right-in', sourceNodeId: 'grid-node', targetNodeId: 'right-node' },
        { id: 'right-out', sourceNodeId: 'right-node', targetNodeId: 'pod-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [elements[0], elements[2], left, right],
      busbars: [],
      networks: [parallelNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      { edgeId: 'left-in', direction: 'forward' },
      { edgeId: 'left-out', direction: 'forward' },
      { edgeId: 'right-in', direction: 'forward' },
      { edgeId: 'right-out', direction: 'forward' },
    ])
  })

  it('restores downstream flow when the Switch is closed', () => {
    const flow = derivePowerFlowTopology({
      elements,
      busbars: [],
      networks: [network],
      switchStates: { switch: true },
    })

    expect(flow.edges).toEqual([
      { edgeId: 'upstream', direction: 'reverse' },
      { edgeId: 'downstream', direction: 'forward' },
    ])
    expect(flow.energizedElementIds).toEqual(new Set(['grid', 'switch', 'pod']))
  })

  it('directs only the busbar spans that lead to a business target', () => {
    const busbars: Busbar[] = [{
      id: 'busbar', diagramId: 'd', type: 'electrical', orientation: 'horizontal',
      x: 0, y: 64, length: 192,
    }]
    const cabinet: DiagramElement = {
      id: 'cabinet', diagramId: 'd', assetKey: 'cabinet', name: 'Cabinet',
      x: 192, y: 64, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
    }
    const busbarNetwork: ConnectionNetwork = {
      id: 'busbar-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'tap-source', kind: 'busbar-tap', busbarId: 'busbar', offset: 32 },
        { id: 'tap-target', kind: 'busbar-tap', busbarId: 'busbar', offset: 128 },
        { id: 'tap-dead-end', kind: 'busbar-tap', busbarId: 'busbar', offset: 160 },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
        { id: 'cabinet-node', kind: 'element-anchor', elementId: 'cabinet', anchorId: 'in' },
      ],
      edges: [
        { id: 'feed', sourceNodeId: 'grid-node', targetNodeId: 'tap-source' },
        { id: 'load', sourceNodeId: 'tap-target', targetNodeId: 'pod-node' },
        { id: 'dead-end', sourceNodeId: 'tap-dead-end', targetNodeId: 'cabinet-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [...elements, cabinet],
      busbars,
      networks: [busbarNetwork],
      switchStates: {},
    })

    expect(flow.busbarSegments).toEqual([expect.objectContaining({
      busbarId: 'busbar',
      start: { x: 32, y: 64 },
      end: { x: 128, y: 64 },
    })])
    expect(flow.edges).toEqual([
      { edgeId: 'feed', direction: 'forward' },
      { edgeId: 'load', direction: 'forward' },
    ])
  })
})
