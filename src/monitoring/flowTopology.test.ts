import { describe, expect, it } from 'vitest'

import type { AssetDefinition, Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
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
  it.each(['a', 'b'] as const)('keeps ordinary equipment conductive on a %s network', (powerSupplyChannel) => {
    const transformer = { ...elements[1], id: 'transformer', assetKey: 'transformer' }
    const typedNetwork: ConnectionNetwork = {
      ...network,
      powerSupplyChannel,
      nodes: [...network.nodes,
        { id: 'transformer-in', kind: 'element-anchor', elementId: transformer.id, anchorId: 'in' },
        { id: 'transformer-out', kind: 'element-anchor', elementId: transformer.id, anchorId: 'out' },
      ],
      edges: [network.edges[0],
        { id: 'middle', sourceNodeId: 'switch-out', targetNodeId: 'transformer-in' },
        { id: 'downstream', sourceNodeId: 'transformer-out', targetNodeId: 'pod-node' },
      ],
    }
    const args = { elements: [...elements, transformer], busbars: [], networks: [typedNetwork] }
    const flow = derivePowerFlowTopology({ ...args, switchStates: { switch: true } })
    expect(flow.edges.map(({ edgeId }) => edgeId).sort()).toEqual(['downstream', 'middle', 'upstream'])
    expect(flow.selectedSupplyChannels.pod).toBe(powerSupplyChannel)
    expect(flow.selectedSupplyChannels.switch).toBeUndefined()
    expect(flow.selectedSupplyChannels.transformer).toBeUndefined()
    expect(derivePowerFlowTopology({ ...args, switchStates: { switch: false } }).edges).toEqual([])
  })

  it('hides every line directly connected to an open Switch', () => {
    const flow = derivePowerFlowTopology({
      elements,
      busbars: [],
      networks: [network],
      switchStates: { switch: false },
    })

    expect(flow.edges).toEqual([])
    expect(flow.energizedElementIds).toEqual(new Set(['grid']))
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

  it('activates only the child entry matching the inherited supply channel', () => {
    const childTarget: DiagramElement = {
      id: 'child-target', diagramId: 'd', assetKey: 'fm', name: 'FM',
      x: 80, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const childNetwork: ConnectionNetwork = {
      id: 'child-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'entry-a', kind: 'node', x: 0, y: 0 },
        { id: 'entry-b', kind: 'node', x: 0, y: 16 },
        { id: 'junction', kind: 'node', x: 32, y: 8 },
        { id: 'target', kind: 'element-anchor', elementId: childTarget.id, anchorId: 'in' },
      ],
      edges: [
        { id: 'entry-a-edge', sourceNodeId: 'entry-a', targetNodeId: 'junction', externalSupplyEndpoint: 'source', externalSupplyChannel: 'a', flowDirection: 'forward' },
        { id: 'entry-b-edge', sourceNodeId: 'entry-b', targetNodeId: 'junction', externalSupplyEndpoint: 'source', externalSupplyChannel: 'b', flowDirection: 'forward' },
        { id: 'target-edge', sourceNodeId: 'junction', targetNodeId: 'target', flowDirection: 'forward' },
      ],
    }
    const flow = derivePowerFlowTopology({
      elements: [childTarget], busbars: [], networks: [childNetwork], switchStates: {},
      externalSupply: true, externalSupplyChannel: 'b',
    })
    expect(flow.edges).toEqual([
      { edgeId: 'entry-b-edge', direction: 'forward' },
      { edgeId: 'target-edge', direction: 'forward' },
    ])
  })

  it('uses Battery-group as a source only while UPS battery backup is active', () => {
    const battery: DiagramElement = {
      id: 'battery-group', diagramId: 'd', assetKey: 'battery-group', name: 'Battery-group',
      x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const ups: DiagramElement = {
      id: 'ups', diagramId: 'd', assetKey: 'ups', name: 'UPS',
      x: 64, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const backupNetwork: ConnectionNetwork = {
      id: 'backup-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'battery-out', kind: 'element-anchor', elementId: battery.id, anchorId: 'out' },
        { id: 'ups-in', kind: 'element-anchor', elementId: ups.id, anchorId: 'in' },
        { id: 'ups-out', kind: 'element-anchor', elementId: ups.id, anchorId: 'out' },
        { id: 'child-out', kind: 'node', x: 128, y: 0 },
      ],
      edges: [
        { id: 'battery-to-ups', sourceNodeId: 'battery-out', targetNodeId: 'ups-in', flowDirection: 'forward' },
        { id: 'ups-to-child', sourceNodeId: 'ups-out', targetNodeId: 'child-out', flowDirection: 'forward', externalSupplyEndpoint: 'target' },
      ],
    }
    expect(derivePowerFlowTopology({
      elements: [battery, ups], busbars: [], networks: [backupNetwork], switchStates: {},
    }).edges).toEqual([])
    expect(derivePowerFlowTopology({
      elements: [battery, ups], busbars: [], networks: [backupNetwork], switchStates: {},
      batteryBackup: true,
    }).edges).toEqual([
      { edgeId: 'battery-to-ups', direction: 'forward' },
      { edgeId: 'ups-to-child', direction: 'forward' },
    ])
  })

  it('injects an energized parent feed at a detail busbar and terminates at Cabinet', () => {
    const detailElements: DiagramElement[] = [
      { id: 'tap', diagramId: 'd', assetKey: 'tap-off-unit', name: 'Tap-off Unit', x: 0, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {} },
      { id: 'cabinet', diagramId: 'd', assetKey: 'cabinet-device', name: 'Cabinet', x: 0, y: 80, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
    ]
    const detailBusbar: Busbar = {
      id: 'detail-busbar', diagramId: 'd', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const detailNetwork: ConnectionNetwork = {
      id: 'detail-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'busbar-tap', kind: 'busbar-tap', busbarId: 'detail-busbar', offset: 16 },
        { id: 'tap-in', kind: 'element-anchor', elementId: 'tap', anchorId: 'top' },
        { id: 'tap-out', kind: 'element-anchor', elementId: 'tap', anchorId: 'bottom' },
        { id: 'cabinet-in', kind: 'element-anchor', elementId: 'cabinet', anchorId: 'top' },
      ],
      edges: [
        { id: 'detail-input', sourceNodeId: 'tap-in', targetNodeId: 'busbar-tap' },
        { id: 'detail-output', sourceNodeId: 'tap-out', targetNodeId: 'cabinet-in' },
      ],
    }

    expect(derivePowerFlowTopology({
      elements: detailElements,
      busbars: [detailBusbar],
      networks: [detailNetwork],
      switchStates: {},
    }).edges).toEqual([])

    const flow = derivePowerFlowTopology({
      elements: detailElements,
      busbars: [detailBusbar],
      networks: [detailNetwork],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.edges).toEqual([
      { edgeId: 'detail-input', direction: 'reverse' },
      { edgeId: 'detail-output', direction: 'forward' },
    ])
    expect(flow.energizedElementIds).toEqual(new Set(['tap', 'cabinet']))
  })

  it('uses only the A Cabinet incomer when both A and B are available', () => {
    const cabinet: DiagramElement = {
      id: 'dual-feed-cabinet',
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: 'Cabinet',
      x: 0,
      y: 80,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }
    const network: ConnectionNetwork = {
      id: 'dual-feed-network',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        { id: 'feed-a-source', kind: 'node', x: 0, y: 0 },
        { id: 'cabinet-a', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'a' },
        { id: 'feed-b-source', kind: 'node', x: 80, y: 0 },
        { id: 'feed-b-middle-1', kind: 'node', x: 80, y: 32 },
        { id: 'feed-b-middle-2', kind: 'node', x: 80, y: 64 },
        { id: 'cabinet-b', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'b' },
      ],
      edges: [
        {
          id: 'cabinet-feed-a',
          sourceNodeId: 'feed-a-source',
          targetNodeId: 'cabinet-a',
          flowDirection: 'forward',
          externalSupplyEndpoint: 'source',
        },
        {
          id: 'cabinet-feed-b-1',
          sourceNodeId: 'feed-b-source',
          targetNodeId: 'feed-b-middle-1',
          flowDirection: 'forward',
          externalSupplyEndpoint: 'source',
        },
        {
          id: 'cabinet-feed-b-2',
          sourceNodeId: 'feed-b-middle-1',
          targetNodeId: 'feed-b-middle-2',
          flowDirection: 'forward',
        },
        {
          id: 'cabinet-feed-b-3',
          sourceNodeId: 'feed-b-middle-2',
          targetNodeId: 'cabinet-b',
          flowDirection: 'forward',
        },
      ],
    }
    const cabinetAsset: AssetDefinition = {
      key: 'cabinet-device',
      name: 'Cabinet',
      category: '电力',
      source: 'Cabinet.svg',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
      anchors: [
        { id: 'a', name: '电路 1', x: 24, y: 0, direction: 'top', type: 'electrical', powerSupplyChannel: 'a' },
        { id: 'b', name: '电路 2', x: 24, y: 48, direction: 'bottom', type: 'electrical', powerSupplyChannel: 'b' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [cabinet],
      assets: [cabinetAsset],
      busbars: [],
      networks: [network],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.edges).toEqual([
      { edgeId: 'cabinet-feed-a', direction: 'forward' },
    ])
    expect(flow.energizedElementIds).toContain(cabinet.id)
    expect(flow.selectedSupplyChannels[cabinet.id]).toBe('a')
  })

  it('falls back to the B Cabinet incomer when A is unavailable', () => {
    const cabinet: DiagramElement = {
      id: 'fallback-cabinet', diagramId: 'd', assetKey: 'cabinet-device', name: 'Cabinet',
      x: 0, y: 80, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const asset: AssetDefinition = {
      key: 'cabinet-device', name: 'Cabinet', category: '电力', source: 'Cabinet.svg',
      intrinsicWidth: 48, intrinsicHeight: 48,
      anchors: [
        { id: 'a', name: '电路 1', x: 24, y: 0, direction: 'top', type: 'electrical', powerSupplyChannel: 'a' },
        { id: 'b', name: '电路 2', x: 24, y: 48, direction: 'bottom', type: 'electrical', powerSupplyChannel: 'b' },
      ],
    }
    const fallbackNetwork: ConnectionNetwork = {
      id: 'fallback-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'b-source', kind: 'node', x: 0, y: 0 },
        { id: 'cabinet-a', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'a' },
        { id: 'cabinet-b', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'b' },
      ],
      edges: [{
        id: 'b-feed', sourceNodeId: 'b-source', targetNodeId: 'cabinet-b',
        flowDirection: 'forward', externalSupplyEndpoint: 'source',
      }],
    }
    const flow = derivePowerFlowTopology({
      elements: [cabinet], assets: [asset], busbars: [], networks: [fallbackNetwork],
      switchStates: {}, externalSupply: true,
    })
    expect(flow.edges).toEqual([{ edgeId: 'b-feed', direction: 'forward' }])
    expect(flow.selectedSupplyChannels[cabinet.id]).toBe('b')
  })

  it('keeps an unavailable redundant Cabinet incomer inactive', () => {
    const cabinet: DiagramElement = {
      id: 'redundant-cabinet',
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: 'Cabinet',
      x: 0,
      y: 80,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }
    const busbars: Busbar[] = [
      {
        id: 'live-busbar', diagramId: 'd', type: 'electrical',
        orientation: 'horizontal', x: 0, y: 0, length: 80,
      },
      {
        id: 'dead-busbar', diagramId: 'd', type: 'electrical',
        orientation: 'horizontal', x: 0, y: 40, length: 80,
      },
    ]
    const network: ConnectionNetwork = {
      id: 'redundant-cabinet-network',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        { id: 'outside', kind: 'node', x: 0, y: 0 },
        { id: 'live-tap', kind: 'busbar-tap', busbarId: 'live-busbar', offset: 0 },
        { id: 'dead-tap', kind: 'busbar-tap', busbarId: 'dead-busbar', offset: 0 },
        { id: 'cabinet-a', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'a' },
        { id: 'cabinet-b', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'b' },
      ],
      edges: [
        {
          id: 'live-entry',
          sourceNodeId: 'outside',
          targetNodeId: 'live-tap',
          flowDirection: 'forward',
          externalSupplyEndpoint: 'source',
        },
        {
          id: 'live-cabinet-feed',
          sourceNodeId: 'live-tap',
          targetNodeId: 'cabinet-a',
          flowDirection: 'forward',
        },
        {
          id: 'dead-cabinet-feed',
          sourceNodeId: 'dead-tap',
          targetNodeId: 'cabinet-b',
          flowDirection: 'forward',
        },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [cabinet],
      busbars,
      networks: [network],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.edges).toEqual([
      { edgeId: 'live-entry', direction: 'forward' },
      { edgeId: 'live-cabinet-feed', direction: 'forward' },
    ])
    expect(flow.edges).not.toContainEqual(expect.objectContaining({
      edgeId: 'dead-cabinet-feed',
    }))
    expect(flow.energizedElementIds).toContain(cabinet.id)
  })

  it('treats Cabinet as a terminal target outside detail diagrams too', () => {
    const cabinet: DiagramElement = {
      id: 'top-level-cabinet',
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: 'Cabinet',
      x: 80,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }
    const topLevelNetwork: ConnectionNetwork = {
      id: 'top-level-cabinet-network',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        { id: 'grid-output', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'cabinet-input', kind: 'element-anchor', elementId: cabinet.id, anchorId: 'a' },
      ],
      edges: [{
        id: 'top-level-cabinet-feed',
        sourceNodeId: 'grid-output',
        targetNodeId: 'cabinet-input',
      }],
    }

    const flow = derivePowerFlowTopology({
      elements: [elements[0], cabinet],
      busbars: [],
      networks: [topLevelNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([{
      edgeId: 'top-level-cabinet-feed',
      direction: 'forward',
    }])
    expect(flow.energizedElementIds).toContain(cabinet.id)
  })

  it('uses explicit child-line entries instead of automatically energizing every busbar', () => {
    const cabinet: DiagramElement = {
      id: 'detail-cabinet', diagramId: 'd', assetKey: 'cabinet-device', name: 'Cabinet',
      x: 0, y: 80, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const busbar: Busbar = {
      id: 'detail-busbar', diagramId: 'd', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 40, length: 80,
    }
    const explicitEntryNetwork: ConnectionNetwork = {
      id: 'explicit-entry-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'explicit-outside', kind: 'node', x: 0, y: 0 },
        { id: 'explicit-inside', kind: 'node', x: 40, y: 0 },
      ],
      edges: [{
        id: 'explicit-entry',
        sourceNodeId: 'explicit-outside',
        targetNodeId: 'explicit-inside',
        flowDirection: 'forward',
        externalSupplyEndpoint: 'source',
      }],
    }
    const automaticBusbarNetwork: ConnectionNetwork = {
      id: 'automatic-busbar-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'automatic-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 0 },
        {
          id: 'automatic-cabinet',
          kind: 'element-anchor',
          elementId: cabinet.id,
          anchorId: 'top',
        },
      ],
      edges: [{
        id: 'automatic-busbar-feed',
        sourceNodeId: 'automatic-tap',
        targetNodeId: 'automatic-cabinet',
      }],
    }

    expect(derivePowerFlowTopology({
      elements: [cabinet],
      busbars: [busbar],
      networks: [explicitEntryNetwork, automaticBusbarNetwork],
      switchStates: {},
      externalSupply: true,
    }).edges).toEqual([{ edgeId: 'explicit-entry', direction: 'forward' }])

    expect(derivePowerFlowTopology({
      elements: [cabinet],
      busbars: [busbar],
      networks: [explicitEntryNetwork, automaticBusbarNetwork],
      switchStates: {},
      externalSupply: false,
    }).edges).toEqual([])
  })

  it('can inject external supply from the target endpoint of a child line', () => {
    const cabinet: DiagramElement = {
      id: 'reverse-entry-cabinet',
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: 'Cabinet',
      x: 0,
      y: 80,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }
    const network: ConnectionNetwork = {
      id: 'reverse-entry-network',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        {
          id: 'cabinet-anchor',
          kind: 'element-anchor',
          elementId: cabinet.id,
          anchorId: 'top',
        },
        { id: 'outside', kind: 'node', x: 0, y: 0 },
      ],
      edges: [{
        id: 'reverse-entry',
        sourceNodeId: 'cabinet-anchor',
        targetNodeId: 'outside',
        externalSupplyEndpoint: 'target',
      }],
    }

    expect(derivePowerFlowTopology({
      elements: [cabinet],
      busbars: [],
      networks: [network],
      switchStates: {},
      externalSupply: true,
    }).edges).toEqual([{ edgeId: 'reverse-entry', direction: 'reverse' }])
  })

  it('fills an explicitly supplied detail busbar from its entry tap to both physical ends', () => {
    const detailElements: DiagramElement[] = ['left-cabinet', 'right-cabinet'].map((id) => ({
      id,
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: id,
      x: 0,
      y: 80,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }))
    const busbar: Busbar = {
      id: 'explicit-busbar', diagramId: 'd', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 40, length: 160,
    }
    const network: ConnectionNetwork = {
      id: 'explicit-busbar-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'outside', kind: 'node', x: 80, y: 0 },
        { id: 'left-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 32 },
        { id: 'entry-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 80 },
        { id: 'right-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 128 },
        { id: 'left-load', kind: 'element-anchor', elementId: 'left-cabinet', anchorId: 'in' },
        { id: 'right-load', kind: 'element-anchor', elementId: 'right-cabinet', anchorId: 'in' },
      ],
      edges: [
        {
          id: 'explicit-entry',
          sourceNodeId: 'outside',
          targetNodeId: 'entry-tap',
          flowDirection: 'forward',
          externalSupplyEndpoint: 'source',
        },
        { id: 'left-load-edge', sourceNodeId: 'left-tap', targetNodeId: 'left-load' },
        { id: 'right-load-edge', sourceNodeId: 'right-tap', targetNodeId: 'right-load' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: detailElements,
      busbars: [busbar],
      networks: [network],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.busbarSegments).toEqual([
      expect.objectContaining({
        busbarId: busbar.id,
        start: { x: 80, y: 40 },
        end: { x: 32, y: 40 },
      }),
      expect.objectContaining({
        busbarId: busbar.id,
        start: { x: 80, y: 40 },
        end: { x: 128, y: 40 },
      }),
      {
        id: `busbar-flow:tail-start:${busbar.id}`,
        busbarId: busbar.id,
        start: { x: 32, y: 40 },
        end: { x: 0, y: 40 },
      },
      {
        id: `busbar-flow:tail-end:${busbar.id}`,
        busbarId: busbar.id,
        start: { x: 128, y: 40 },
        end: { x: 160, y: 40 },
      },
    ])
  })

  it('keeps explicitly directed parallel busbar incomers into an energized detail device', () => {
    const ups: DiagramElement = {
      id: 'ups', diagramId: 'd', assetKey: 'ups', name: 'UPS',
      x: 0, y: 80, width: 48, height: 48, rotation: 0,
      properties: {}, extensions: {},
    }
    const busbar: Busbar = {
      id: 'parallel-busbar', diagramId: 'd', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 40, length: 128,
    }
    const network: ConnectionNetwork = {
      id: 'parallel-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'outside', kind: 'node', x: 96, y: 0 },
        { id: 'bidirectional-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 16 },
        { id: 'left-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 32 },
        { id: 'right-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 48 },
        { id: 'entry-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 96 },
        { id: 'ups-left', kind: 'element-anchor', elementId: ups.id, anchorId: 'left-in' },
        { id: 'ups-right', kind: 'element-anchor', elementId: ups.id, anchorId: 'right-in' },
        { id: 'ups-out', kind: 'element-anchor', elementId: ups.id, anchorId: 'out' },
        { id: 'ups-bidirectional', kind: 'element-anchor', elementId: ups.id, anchorId: 'spare' },
        { id: 'load', kind: 'node', x: 40, y: 160 },
      ],
      edges: [
        {
          id: 'explicit-entry',
          sourceNodeId: 'outside',
          targetNodeId: 'entry-tap',
          flowDirection: 'forward',
          externalSupplyEndpoint: 'source',
        },
        {
          id: 'tr04-uos01',
          sourceNodeId: 'ups-left',
          targetNodeId: 'left-tap',
          flowDirection: 'reverse',
        },
        {
          id: 'capacity-line',
          sourceNodeId: 'ups-right',
          targetNodeId: 'right-tap',
          flowDirection: 'reverse',
        },
        {
          id: 'bidirectional-spare',
          sourceNodeId: 'bidirectional-tap',
          targetNodeId: 'ups-bidirectional',
        },
        {
          id: 'ups-output',
          sourceNodeId: 'ups-out',
          targetNodeId: 'load',
          flowDirection: 'forward',
        },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [ups],
      busbars: [busbar],
      networks: [network],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.edges).toEqual(expect.arrayContaining([
      { edgeId: 'tr04-uos01', direction: 'reverse' },
      { edgeId: 'capacity-line', direction: 'reverse' },
      { edgeId: 'ups-output', direction: 'forward' },
    ]))
    expect(flow.edges).not.toContainEqual({
      edgeId: 'bidirectional-spare',
      direction: 'forward',
    })
  })

  it('treats multiple detail busbar entries as one external source boundary', () => {
    const detailElements: DiagramElement[] = ['a-left', 'a-right', 'b-left', 'b-right'].map((id) => ({
      id,
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: id,
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }))
    const busbars: Busbar[] = [
      {
        id: 'busbar-a', diagramId: 'd', type: 'electrical',
        orientation: 'horizontal', x: 0, y: 0, length: 80,
      },
      {
        id: 'busbar-b', diagramId: 'd', type: 'electrical',
        orientation: 'horizontal', x: 0, y: 80, length: 80,
      },
    ]
    const network: ConnectionNetwork = {
      id: 'ring-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'a-0', kind: 'busbar-tap', busbarId: 'busbar-a', offset: 0 },
        { id: 'a-80', kind: 'busbar-tap', busbarId: 'busbar-a', offset: 80 },
        { id: 'b-0', kind: 'busbar-tap', busbarId: 'busbar-b', offset: 0 },
        { id: 'b-80', kind: 'busbar-tap', busbarId: 'busbar-b', offset: 80 },
        ...detailElements.map((element) => ({
          id: `${element.id}-anchor`,
          kind: 'element-anchor' as const,
          elementId: element.id,
          anchorId: 'power',
        })),
      ],
      edges: [
        { id: 'a-left-edge', sourceNodeId: 'a-0', targetNodeId: 'a-left-anchor' },
        { id: 'a-right-edge', sourceNodeId: 'a-80', targetNodeId: 'a-right-anchor' },
        { id: 'b-left-edge', sourceNodeId: 'b-0', targetNodeId: 'b-left-anchor' },
        { id: 'b-right-edge', sourceNodeId: 'b-80', targetNodeId: 'b-right-anchor' },
        { id: 'ring-link', sourceNodeId: 'a-80', targetNodeId: 'b-80' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: detailElements,
      busbars,
      networks: [network],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.busbarSegments).toEqual([
      expect.objectContaining({
        busbarId: 'busbar-a',
        start: { x: 0, y: 0 },
        end: { x: 80, y: 0 },
      }),
      expect.objectContaining({
        busbarId: 'busbar-b',
        start: { x: 0, y: 80 },
        end: { x: 80, y: 80 },
      }),
    ])
    expect(flow.edges).not.toContainEqual(expect.objectContaining({ edgeId: 'ring-link' }))
  })

  it('uses a free output node as the terminating load of an externally fed UPS detail', () => {
    const ups: DiagramElement = {
      id: 'ups-detail', diagramId: 'd', assetKey: 'ups', name: 'UPS',
      x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const detailBusbar: Busbar = {
      id: 'ups-busbar', diagramId: 'd', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const upsNetwork: ConnectionNetwork = {
      id: 'ups-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'ups-busbar-tap', kind: 'busbar-tap', busbarId: 'ups-busbar', offset: 16 },
        { id: 'ups-input', kind: 'element-anchor', elementId: 'ups-detail', anchorId: 'top' },
        { id: 'ups-output', kind: 'element-anchor', elementId: 'ups-detail', anchorId: 'bottom' },
        { id: 'free-output', kind: 'node', x: 24, y: 96 },
      ],
      edges: [
        {
          id: 'ups-input-line',
          sourceNodeId: 'ups-input',
          targetNodeId: 'ups-busbar-tap',
          flowDirection: 'reverse',
        },
        {
          id: 'ups-output-line',
          sourceNodeId: 'ups-output',
          targetNodeId: 'free-output',
          flowDirection: 'forward',
        },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [ups],
      busbars: [detailBusbar],
      networks: [upsNetwork],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.edges).toEqual([
      { edgeId: 'ups-input-line', direction: 'reverse' },
      { edgeId: 'ups-output-line', direction: 'forward' },
    ])
  })

  it('injects external power at a directed free input boundary', () => {
    const ups: DiagramElement = {
      id: 'detached-ups', diagramId: 'd', assetKey: 'ups', name: 'UPS',
      x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
    }
    const detachedNetwork: ConnectionNetwork = {
      id: 'detached-ups-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'free-input', kind: 'node', x: 24, y: -48 },
        { id: 'detached-ups-input', kind: 'element-anchor', elementId: 'detached-ups', anchorId: 'top' },
        { id: 'detached-ups-output', kind: 'element-anchor', elementId: 'detached-ups', anchorId: 'bottom' },
        { id: 'free-output', kind: 'node', x: 24, y: 96 },
      ],
      edges: [
        {
          id: 'detached-input-line',
          sourceNodeId: 'detached-ups-input',
          targetNodeId: 'free-input',
          flowDirection: 'reverse',
        },
        {
          id: 'detached-output-line',
          sourceNodeId: 'detached-ups-output',
          targetNodeId: 'free-output',
          flowDirection: 'forward',
        },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [ups],
      busbars: [],
      networks: [detachedNetwork],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.edges).toEqual([
      { edgeId: 'detached-input-line', direction: 'reverse' },
      { edgeId: 'detached-output-line', direction: 'forward' },
    ])
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

  it('traces every physical edge through a topological junction', () => {
    const junctionElements: DiagramElement[] = [
      elements[0],
      elements[2],
      { id: 'fm', diagramId: 'd', assetKey: 'fm', name: 'FM', x: 160, y: 80, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
    ]
    const junctionNetwork: ConnectionNetwork = {
      id: 'junction-network',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
        { id: 'fm-node', kind: 'element-anchor', elementId: 'fm', anchorId: 'in' },
        { id: 'node', kind: 'node', x: 80, y: 32 },
      ],
      edges: [
        { id: 'grid-junction', sourceNodeId: 'grid-node', targetNodeId: 'node' },
        { id: 'junction-pod', sourceNodeId: 'node', targetNodeId: 'pod-node' },
        { id: 'junction-fm', sourceNodeId: 'node', targetNodeId: 'fm-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: junctionElements,
      busbars: [],
      networks: [junctionNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      { edgeId: 'grid-junction', direction: 'forward' },
      { edgeId: 'junction-pod', direction: 'forward' },
      { edgeId: 'junction-fm', direction: 'forward' },
    ])
  })

  it('animates only the physical span of a logical line that reaches a branch node', () => {
    const cabinet: DiagramElement = {
      id: 'cabinet', diagramId: 'd', assetKey: 'cabinet', name: 'Cabinet',
      x: 160, y: 80, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
    }
    const routedBranch: ConnectionNetwork = {
      id: 'routed-branch',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'cabinet-node', kind: 'element-anchor', elementId: 'cabinet', anchorId: 'in' },
        { id: 'pod-node', kind: 'element-anchor', elementId: 'pod', anchorId: 'in' },
        { id: 'branch-node', kind: 'node', x: 80, y: 32 },
      ],
      edges: [
        {
          id: 'logical-trunk',
          sourceNodeId: 'grid-node',
          targetNodeId: 'cabinet-node',
          routeNodeIds: ['branch-node'],
        },
        { id: 'target-branch', sourceNodeId: 'branch-node', targetNodeId: 'pod-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: [elements[0], elements[2], cabinet],
      busbars: [],
      networks: [routedBranch],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      {
        edgeId: 'logical-trunk',
        direction: 'forward',
        startNodeId: 'grid-node',
        endNodeId: 'branch-node',
      },
      { edgeId: 'target-branch', direction: 'forward' },
    ])
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

  it('uses a configured child-line direction to resolve opposite source paths', () => {
    const conflictElements: DiagramElement[] = [
      { id: 'fm-left', diagramId: 'd', assetKey: 'fm', name: 'FM Left', x: 0, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
      { id: 'grid', diagramId: 'd', assetKey: 'grid', name: 'Grid', x: 80, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'battery', diagramId: 'd', assetKey: 'battery', name: 'Battery', x: 160, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {} },
      { id: 'fm-right', diagramId: 'd', assetKey: 'fm', name: 'FM Right', x: 240, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {} },
    ]
    const directedNetwork: ConnectionNetwork = {
      id: 'directed-network', diagramId: 'd', type: 'electrical',
      nodes: [
        { id: 'fm-left-node', kind: 'element-anchor', elementId: 'fm-left', anchorId: 'in' },
        { id: 'grid-node', kind: 'element-anchor', elementId: 'grid', anchorId: 'out' },
        { id: 'battery-node', kind: 'element-anchor', elementId: 'battery', anchorId: 'out' },
        { id: 'fm-right-node', kind: 'element-anchor', elementId: 'fm-right', anchorId: 'in' },
      ],
      edges: [
        { id: 'left-target', sourceNodeId: 'grid-node', targetNodeId: 'fm-left-node' },
        {
          id: 'directed-link',
          sourceNodeId: 'grid-node',
          targetNodeId: 'battery-node',
          flowDirection: 'forward',
        },
        { id: 'right-target', sourceNodeId: 'battery-node', targetNodeId: 'fm-right-node' },
      ],
    }

    const flow = derivePowerFlowTopology({
      elements: conflictElements,
      busbars: [],
      networks: [directedNetwork],
      switchStates: {},
    })

    expect(flow.edges).toEqual([
      { edgeId: 'left-target', direction: 'forward' },
      { edgeId: 'directed-link', direction: 'forward' },
      { edgeId: 'right-target', direction: 'forward' },
    ])
  })

  it('blocks a Source-to-Target path that approaches a child line against its arrow', () => {
    const directedNetwork: ConnectionNetwork = {
      ...network,
      edges: network.edges.map((edge) => edge.id === 'upstream'
        ? { ...edge, flowDirection: 'forward' as const }
        : edge),
    }

    const flow = derivePowerFlowTopology({
      elements,
      busbars: [],
      networks: [directedNetwork],
      switchStates: { switch: true },
    })

    expect(flow.edges).toEqual([])
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

  it('uses a manual busbar direction as the external entry and animates its full length', () => {
    const cabinet: DiagramElement = {
      id: 'detail-cabinet',
      diagramId: 'd',
      assetKey: 'cabinet-device',
      name: 'Cabinet',
      x: 0,
      y: 96,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }
    const busbar: Busbar = {
      id: 'manual-busbar',
      diagramId: 'd',
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 64,
      length: 192,
      monitorFlowDirection: 'end-to-start',
    }
    const network: ConnectionNetwork = {
      id: 'manual-busbar-network',
      diagramId: 'd',
      type: 'electrical',
      nodes: [
        { id: 'left-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 32 },
        { id: 'right-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 160 },
        {
          id: 'cabinet-input',
          kind: 'element-anchor',
          elementId: cabinet.id,
          anchorId: 'top',
        },
      ],
      edges: [{ id: 'cabinet-feed', sourceNodeId: 'left-tap', targetNodeId: 'cabinet-input' }],
    }

    expect(derivePowerFlowTopology({
      elements: [cabinet],
      busbars: [busbar],
      networks: [network],
      switchStates: {},
    }).busbarSegments).toEqual([])

    const flow = derivePowerFlowTopology({
      elements: [cabinet],
      busbars: [busbar],
      networks: [network],
      switchStates: {},
      externalSupply: true,
    })

    expect(flow.busbarSegments).toEqual([{
      id: `busbar-flow:manual:${busbar.id}`,
      busbarId: busbar.id,
      start: { x: 192, y: 64 },
      end: { x: 0, y: 64 },
    }])
    expect(flow.edges).toEqual([{ edgeId: 'cabinet-feed', direction: 'forward' }])
  })
})
