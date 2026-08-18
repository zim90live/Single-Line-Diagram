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

  it('keeps source-side feeder flow before the line adjacent to an open Switch', () => {
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

    expect(flow.edges).toEqual([{ edgeId: 'source-feeder', direction: 'forward' }])
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

  it('directs busbar spans away from the energized tap', () => {
    const busbars: Busbar[] = [{
      id: 'busbar', diagramId: 'd', type: 'electrical', orientation: 'horizontal',
      x: 0, y: 64, length: 160,
    }]
    const busbarNetwork: ConnectionNetwork = {
      id: 'busbar-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'tap-source', kind: 'busbar-tap', busbarId: 'busbar', offset: 32 },
        { id: 'tap-target', kind: 'busbar-tap', busbarId: 'busbar', offset: 128 },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
      ],
      edges: [
        { id: 'feed', sourceNodeId: 'grid-node', targetNodeId: 'tap-source' },
        { id: 'load', sourceNodeId: 'tap-target', targetNodeId: 'pod-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements,
      busbars,
      networks: [busbarNetwork],
      switchStates: {},
    })

    expect(flow.busbarSegments).toEqual([expect.objectContaining({
      busbarId: 'busbar',
      start: { x: 32, y: 64 },
      end: { x: 128, y: 64 },
    })])
  })
})
