import { describe, expect, it } from 'vitest'

import type { Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
import {
  clipboardCanPasteInto,
  centeredSelectionOffset,
  copyConnectionsWithinSelection,
  createEmptySelectionClipboard,
  instantiateCopiedElement,
  instantiateCopiedConnections,
} from './selectionClipboard'

const network: ConnectionNetwork = {
  id: 'network-original',
  diagramId: 'diagram-original',
  type: 'electrical',
  nodes: [
    { id: 'node-a', kind: 'element-anchor', elementId: 'element-a', anchorId: 'right' },
    { id: 'tap-b', kind: 'busbar-tap', busbarId: 'busbar-b', offset: 24 },
    { id: 'node-c', kind: 'element-anchor', elementId: 'element-c', anchorId: 'left' },
  ],
  edges: [
    {
      id: 'edge-a-b',
      sourceNodeId: 'node-a',
      targetNodeId: 'tap-b',
      flowDirection: 'forward',
      color: '#77B4BF',
      label: '馈线 01',
      labelVisible: false,
      labelEndpoint: 'source',
      labelSide: 'positive',
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [{
        id: 'current-original',
        name: '电流',
        valueType: 'number',
        unit: 'A',
        precision: 1,
        simulationMin: 0,
        simulationMax: 100,
        alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
      }],
    },
    { id: 'edge-b-c', sourceNodeId: 'tap-b', targetNodeId: 'node-c' },
  ],
}

describe('selection clipboard topology', () => {
  it('starts empty and only permits the matching line system', () => {
    const clipboard = {
      ...createEmptySelectionClipboard(),
      sourceDiagramId: 'cooling-a',
      sourceLineSystemType: 'cooling' as const,
    }

    expect(clipboardCanPasteInto(clipboard, 'cooling')).toBe(true)
    expect(clipboardCanPasteInto(clipboard, 'power')).toBe(false)
    expect(createEmptySelectionClipboard()).toEqual(expect.objectContaining({
      operation: 'copy',
      sourceDiagramId: null,
      elements: [],
      busbars: [],
      connections: [],
      routeWaypoints: [],
    }))
  })

  it('centers mixed copied objects on the target viewport while preserving 8px geometry', () => {
    const element: DiagramElement = {
      id: 'element-a',
      diagramId: 'diagram-a',
      assetKey: 'switch',
      name: 'Switch',
      x: 16,
      y: 24,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }
    const busbar: Busbar = {
      id: 'busbar-a',
      diagramId: 'diagram-a',
      type: 'electrical',
      orientation: 'horizontal',
      x: 80,
      y: 80,
      length: 64,
    }

    expect(centeredSelectionOffset([element], [busbar], { x: 404, y: 300 }, 8))
      .toEqual({ x: 328, y: 248 })
  })

  it('copies only logical edges whose endpoint objects are both selected', () => {
    const copied = copyConnectionsWithinSelection(
      [network],
      new Set(['element-a']),
      new Set(['busbar-b']),
    )

    expect(copied).toHaveLength(1)
    expect(copied[0].nodes.map((node) => node.id)).toEqual(['node-a', 'tap-b'])
    expect(copied[0].edges.map((edge) => edge.id)).toEqual(['edge-a-b'])
  })

  it('does not copy a route that only passes through unselected objects', () => {
    const copied = copyConnectionsWithinSelection(
      [network],
      new Set(['element-a', 'element-c']),
      new Set(),
    )

    expect(copied).toEqual([])
  })

  it('creates fresh topology IDs and remaps element and busbar references', () => {
    const copied = copyConnectionsWithinSelection(
      [network],
      new Set(['element-a']),
      new Set(['busbar-b']),
    )
    let nextId = 0
    const instantiated = instantiateCopiedConnections(
      copied,
      'diagram-copy',
      new Map([['element-a', 'element-a-copy']]),
      new Map([['busbar-b', 'busbar-b-copy']]),
      (prefix) => `${prefix}-copy-${nextId++}`,
    )

    expect(instantiated).toHaveLength(1)
    expect(instantiated[0].id).not.toBe(network.id)
    expect(instantiated[0].diagramId).toBe('diagram-copy')
    expect(instantiated[0].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'element-anchor', elementId: 'element-a-copy' }),
      expect.objectContaining({ kind: 'busbar-tap', busbarId: 'busbar-b-copy', offset: 24 }),
    ]))
    expect(instantiated[0].nodes.every((node) => !['node-a', 'tap-b'].includes(node.id))).toBe(true)
    expect(instantiated[0].edges[0]).toEqual(expect.objectContaining({
      id: expect.not.stringMatching(/^edge-a-b$/),
      sourceNodeId: instantiated[0].nodes[0].id,
      targetNodeId: instantiated[0].nodes[1].id,
      flowDirection: 'forward',
      color: '#77B4BF',
      label: '馈线 01',
      labelVisible: false,
      labelEndpoint: 'source',
      labelSide: 'positive',
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
    }))
    expect(instantiated[0].edges[0].monitorMetrics).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(/^current-original$/),
        name: '电流',
      }),
    ])
  })

  it('remaps manual route waypoint references when copying internal topology', () => {
    const copied = copyConnectionsWithinSelection(
      [{
        ...network,
        nodes: [
          ...network.nodes,
          { id: 'waypoint-original', kind: 'node', x: 80, y: 80 },
        ],
        edges: [{ ...network.edges[0], routeNodeIds: ['waypoint-original'] }],
      }],
      new Set(['element-a']),
      new Set(['busbar-b']),
    )
    const instantiated = instantiateCopiedConnections(
      copied,
      'diagram-copy',
      new Map([['element-a', 'element-a-copy']]),
      new Map([['busbar-b', 'busbar-b-copy']]),
      () => crypto.randomUUID(),
      new Map([['waypoint-original', 'waypoint-copy']]),
    )

    expect(instantiated[0].edges[0].routeNodeIds).toEqual(['waypoint-copy'])
    expect(instantiated[0].nodes).toContainEqual(expect.objectContaining({
      id: 'waypoint-copy',
      kind: 'node',
      x: 80,
      y: 80,
    }))
  })

  it('retains and offsets junction topology between selected endpoint objects', () => {
    const branched: ConnectionNetwork = {
      id: 'branched',
      diagramId: 'diagram-original',
      type: 'electrical',
      nodes: [
        { id: 'a', kind: 'element-anchor', elementId: 'element-a', anchorId: 'right' },
        { id: 'b', kind: 'element-anchor', elementId: 'element-b', anchorId: 'left' },
        { id: 'c', kind: 'element-anchor', elementId: 'element-c', anchorId: 'left' },
        { id: 'j', kind: 'node', x: 80, y: 64 },
      ],
      edges: [
        {
          id: 'a-j',
          sourceNodeId: 'a',
          targetNodeId: 'j',
          logicalConnectionId: 'trunk-logical-edge',
          crossingLayer: 'upper',
        },
        {
          id: 'j-b',
          sourceNodeId: 'j',
          targetNodeId: 'b',
          logicalConnectionId: 'trunk-logical-edge',
        },
        { id: 'j-c', sourceNodeId: 'j', targetNodeId: 'c' },
      ],
    }
    const copied = copyConnectionsWithinSelection(
      [branched],
      new Set(['element-a', 'element-b']),
      new Set(),
    )

    expect(copied[0].edges.map((edge) => edge.id).sort()).toEqual(['a-j', 'j-b'])
    expect(copied[0].nodes.some((node) => node.kind === 'node')).toBe(true)

    let id = 0
    const instantiated = instantiateCopiedConnections(
      copied,
      'diagram-copy',
      new Map([['element-a', 'element-a-copy'], ['element-b', 'element-b-copy']]),
      new Map(),
      (prefix) => `${prefix}-${++id}`,
      new Map(),
      { x: 16, y: 24 },
    )
    expect(instantiated[0].nodes.find((node) => node.kind === 'node'))
      .toMatchObject({ x: 96, y: 88 })
    expect(instantiated[0].edges).toHaveLength(2)
    expect(instantiated[0].edges.find((edge) => edge.crossingLayer === 'upper')).toBeDefined()
    expect(new Set(instantiated[0].edges.map((edge) => edge.logicalConnectionId)).size).toBe(1)
    expect(instantiated[0].edges[0].logicalConnectionId).not.toBe('trunk-logical-edge')
  })

  it('copies monitoring configuration and generic border visibility with fresh metric IDs', () => {
    const source: DiagramElement = {
      id: 'source-element',
      diagramId: 'diagram-a',
      assetKey: 'generic',
      name: '通用图元',
      x: 0,
      y: 0,
      width: 96,
      height: 48,
      rotation: 0,
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [{
        id: 'source-temperature',
        name: '出水温度',
        valueType: 'number',
        unit: '°C',
        precision: 1,
        simulationMin: 0,
        simulationMax: 100,
        alarm: { mode: 'upper', minor: 60, major: 75, critical: 90 },
      }],
      properties: {
        tag: 'GEN-01',
        genericBorderVisible: false,
        genericBackgroundColor: '#334455',
      },
      extensions: {},
    }
    const copy = instantiateCopiedElement(source, {
      id: 'copy-element',
      diagramId: 'diagram-b',
      x: 80,
      y: 80,
    }, (prefix) => `${prefix}-copy`)

    expect(copy).toMatchObject({
      id: 'copy-element',
      diagramId: 'diagram-b',
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [{
        id: 'monitor-metric-copy',
        name: '出水温度',
        alarm: { mode: 'upper', minor: 60, major: 75, critical: 90 },
      }],
      properties: {
        tag: 'GEN-01',
        genericBorderVisible: false,
        genericBackgroundColor: '#334455',
      },
    })
    expect(copy.monitorMetrics?.[0]).not.toBe(source.monitorMetrics?.[0])
    const copiedMetric = copy.monitorMetrics?.[0]
    const sourceMetric = source.monitorMetrics?.[0]
    expect(copiedMetric?.valueType).toBe('number')
    if (copiedMetric?.valueType === 'number' && sourceMetric?.valueType === 'number') {
      expect(copiedMetric.alarm).not.toBe(sourceMetric.alarm)
    }
    expect(copy).not.toHaveProperty('monitorReadings')
  })
})
