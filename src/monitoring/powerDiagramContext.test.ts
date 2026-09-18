import { describe, expect, it } from 'vitest'

import type { ProjectDocument } from '../domain/project'
import { createDiagramRuntimeState } from '../runtime/runtimeState'
import { derivePowerFlowTopology } from './flowTopology'
import {
  derivePowerDiagramExternalSupply,
  isPowerDiagramExternallyEnergized,
} from './powerDiagramContext'

function documentWithParentFeed(sourceAssetKey = 'grid') {
  return {
    lineSystems: [{ id: 'power-line', type: 'power', name: '电力线路', rootDiagramId: 'pod' }],
    diagrams: [
      {
        id: 'pod', lineSystemId: 'power-line', name: 'POD A', level: 'pod',
        canvas: { gridSize: 8, viewport: { zoom: 1, tx: 0, ty: 0 } },
      },
      {
        id: 'tap-left', lineSystemId: 'power-line', parentId: 'pod',
        name: '分接单元 L', level: 'device',
        canvas: { gridSize: 8, viewport: { zoom: 1, tx: 0, ty: 0 } },
      },
    ],
    elements: [
      {
        id: 'source', diagramId: 'pod', assetKey: sourceAssetKey, name: 'Source',
        x: 0, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
      },
      {
        id: 'tap-a', diagramId: 'pod', assetKey: 'cabinet', name: 'Tap-off Unit A',
        x: 80, y: 0, width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
      },
    ],
    busbars: [],
    connections: [{
      id: 'parent-network', diagramId: 'pod', type: 'electrical',
      nodes: [
        { id: 'source-node', kind: 'element-anchor', elementId: 'source', anchorId: 'out' },
        { id: 'tap-node', kind: 'element-anchor', elementId: 'tap-a', anchorId: 'in' },
      ],
      edges: [{ id: 'parent-edge', sourceNodeId: 'source-node', targetNodeId: 'tap-node' }],
    }],
  } as unknown as ProjectDocument
}

function documentWithUpsGroupFeed() {
  const document = documentWithParentFeed()
  document.diagrams[1] = {
    ...document.diagrams[1],
    id: 'ups-left',
    name: 'UPS L',
  }
  document.elements[1] = {
    ...document.elements[1],
    id: 'ups-group-left',
    assetKey: 'ups-group',
    name: 'UPS-group',
  }
  const targetNode = document.connections[0].nodes[1]
  if (targetNode.kind !== 'element-anchor') {
    throw new Error('测试夹具的目标节点必须是图元锚点')
  }
  targetNode.elementId = 'ups-group-left'
  return document
}

function documentWithDualUpsGroupFeed(aAvailable = true) {
  const document = documentWithUpsGroupFeed()
  document.assets = [{
    key: 'ups-group', name: 'UPS-group', category: '电力', source: 'UPS-group.svg',
    intrinsicWidth: 48, intrinsicHeight: 48,
    anchors: [
      { id: 'a', name: '电路 1', x: 0, y: 24, direction: 'left', type: 'electrical', powerSupplyChannel: 'a' },
      { id: 'b', name: '电路 2', x: 48, y: 24, direction: 'right', type: 'electrical', powerSupplyChannel: 'b' },
    ],
  }]
  document.elements = [
    {
      ...document.elements[0],
      id: 'source-a',
      assetKey: aAvailable ? 'grid' : 'transformer',
    },
    {
      ...document.elements[0],
      id: 'source-b',
      assetKey: 'generator',
    },
    {
      ...document.elements[1],
      properties: { drillDownDiagramId: 'ups-left' },
    },
  ]
  document.connections[0].nodes = [
    { id: 'source-a-node', kind: 'element-anchor', elementId: 'source-a', anchorId: 'out' },
    { id: 'source-b-node', kind: 'element-anchor', elementId: 'source-b', anchorId: 'out' },
    { id: 'ups-a', kind: 'element-anchor', elementId: 'ups-group-left', anchorId: 'a' },
    { id: 'ups-b', kind: 'element-anchor', elementId: 'ups-group-left', anchorId: 'b' },
  ]
  document.connections[0].edges = [
    { id: 'feed-a', sourceNodeId: 'source-a-node', targetNodeId: 'ups-a' },
    { id: 'feed-b', sourceNodeId: 'source-b-node', targetNodeId: 'ups-b' },
  ]
  return document
}

describe('power detail external supply context', () => {
  it('inherits supply when the linked parent equipment is energized', () => {
    expect(isPowerDiagramExternallyEnergized({
      document: documentWithParentFeed(),
      diagramId: 'tap-left',
      switchStates: {},
    })).toBe(true)
  })

  it('does not invent supply when the parent diagram has no source', () => {
    expect(isPowerDiagramExternallyEnergized({
      document: documentWithParentFeed('transformer'),
      diagramId: 'tap-left',
      switchStates: {},
    })).toBe(false)
  })

  it('inherits supply through an UPS-group parent for an UPS L detail diagram', () => {
    expect(isPowerDiagramExternallyEnergized({
      document: documentWithUpsGroupFeed(),
      diagramId: 'ups-left',
      switchStates: {},
    })).toBe(true)
  })

  it('passes both available parent feeds to the child and removes only a lost feed', () => {
    expect(derivePowerDiagramExternalSupply({
      document: documentWithDualUpsGroupFeed(),
      diagramId: 'ups-left',
      switchStates: {},
    })).toEqual({ active: true, channels: ['a', 'b'], batteryBackupActive: false })
    expect(derivePowerDiagramExternalSupply({
      document: documentWithDualUpsGroupFeed(false),
      diagramId: 'ups-left',
      switchStates: {},
    })).toEqual({ active: true, channels: ['b'], batteryBackupActive: false })
  })

  it('enables UPS battery backup when neither parent feed is available', () => {
    const document = documentWithDualUpsGroupFeed(false)
    document.elements.find((element) => element.id === 'source-b')!.assetKey = 'transformer'
    expect(derivePowerDiagramExternalSupply({
      document,
      diagramId: 'ups-left',
      switchStates: {},
    })).toEqual({ active: false, batteryBackupActive: true })
  })

  it('propagates independent switch changes across two child levels and restores both feeds', () => {
    const document = documentWithDualUpsGroupFeed()
    document.diagrams.push({ ...document.diagrams[1], id: 'nested-ups', parentId: 'ups-left' })
    const parentGroup = document.elements.find((element) => element.id === 'ups-group-left')!
    document.elements.push({
      ...parentGroup, id: 'nested-group', diagramId: 'ups-left',
      properties: { drillDownDiagramId: 'nested-ups' },
    })
    for (const channel of ['a', 'b'] as const) {
      document.elements.push({
        ...parentGroup, id: `switch-${channel}`, assetKey: 'switch', properties: {},
      })
      document.connections[0].nodes.push(
        { id: `switch-${channel}-in`, kind: 'element-anchor', elementId: `switch-${channel}`, anchorId: 'in' },
        { id: `switch-${channel}-out`, kind: 'element-anchor', elementId: `switch-${channel}`, anchorId: 'out' },
      )
      document.connections[0].edges = document.connections[0].edges.filter((edge) => edge.id !== `feed-${channel}`)
      document.connections[0].edges.push(
        { id: `source-${channel}-feed`, sourceNodeId: `source-${channel}-node`, targetNodeId: `switch-${channel}-in` },
        { id: `feed-${channel}`, sourceNodeId: `switch-${channel}-out`, targetNodeId: `ups-${channel}` },
      )
      document.connections.push({
        id: `child-${channel}`, diagramId: 'ups-left', type: 'electrical', powerSupplyChannel: channel,
        nodes: [
          { id: `child-entry-${channel}`, kind: 'node', x: 0, y: channel === 'a' ? 0 : 80 },
          { id: `child-load-${channel}`, kind: 'element-anchor', elementId: 'nested-group', anchorId: channel },
        ],
        edges: [{
          id: `child-feed-${channel}`, sourceNodeId: `child-entry-${channel}`, targetNodeId: `child-load-${channel}`,
          flowDirection: 'forward', externalSupplyEndpoint: 'source',
        }],
      })
    }
    for (const channels of [['a', 'b'], ['b'], ['a'], [], ['a', 'b']] as const) {
      const onOffStates = {
        'switch-a': channels.some((channel) => channel === 'a'),
        'switch-b': channels.some((channel) => channel === 'b'),
      }
      for (const diagramId of ['ups-left', 'nested-ups']) {
        const state = createDiagramRuntimeState({ document, diagramId, active: true, onOffStates })
        expect(state.powerExternalSupplyActive).toBe(channels.length > 0)
        expect(state.powerExternalSupplyChannels ?? []).toEqual(channels)
        expect(state.powerBatteryBackupActive).toBe(channels.length === 0)
      }
      const context = derivePowerDiagramExternalSupply({ document, diagramId: 'ups-left', switchStates: onOffStates })
      const topology = derivePowerFlowTopology({
        elements: document.elements.filter((element) => element.diagramId === 'ups-left'),
        assets: document.assets, busbars: [],
        networks: document.connections.filter((network) => network.diagramId === 'ups-left'),
        switchStates: onOffStates, externalSupply: context.active, externalSupplyChannels: context.channels,
        batteryBackup: context.batteryBackupActive,
      })
      expect(topology.edges.map((edge) => edge.edgeId)).toEqual(channels.map((channel) => `child-feed-${channel}`))
    }
  })
})
