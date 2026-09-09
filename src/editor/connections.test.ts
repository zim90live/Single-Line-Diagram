import { describe, expect, it } from 'vitest'

import type {
  AssetDefinition,
  Busbar,
  ConnectionNetwork,
  DiagramElement,
} from '../domain/project'
import {
  bridgedPathData,
  bridgedPolylinePoints,
  connectTerminals,
  connectedRouteEndpointGeometry,
  connectionRouteBranchPointKeys,
  connectionTerminalArrowPath,
  connectionTypesCompatible,
  crossingPointKeys,
  deleteConnectionEdge,
  deleteBusbarConnections,
  normalizeConnectionNetworks,
  pathDataWithBridges,
  previewConnectionRoutesForDiagram,
  previewConnectionRoutesForElements,
  resolveElementAnchor,
  routeConnectionNetworks,
  routeConnectionPreview,
  routeOrthogonalGrid,
  roundedOrthogonalPathData,
  segmentConnectionEdgesAtNodes,
} from './connections'

const coolingAsset: AssetDefinition = {
  key: 'cooling-test',
  name: '冷却测试图元',
  category: '冷却',
  source: 'cooling-test.svg',
  intrinsicWidth: 64,
  intrinsicHeight: 64,
  anchors: [
    {
      id: 'left-general', name: '通用 1', x: 0, y: 32,
      direction: 'left', type: 'cooling-general',
    },
    {
      id: 'right-cold', name: '一次回路冷 1', x: 64, y: 32,
      direction: 'right', type: 'cooling-primary-cold',
    },
  ],
}

const directionalElectricalAsset: AssetDefinition = {
  key: 'directional-electrical-test',
  name: '方向测试图元',
  category: '电力',
  source: 'directional-electrical-test.svg',
  intrinsicWidth: 64,
  intrinsicHeight: 64,
  anchors: [
    {
      id: 'top-electrical', name: '电路上', x: 32, y: 0,
      direction: 'top', type: 'electrical',
    },
    {
      id: 'bottom-electrical', name: '电路下', x: 32, y: 64,
      direction: 'bottom', type: 'electrical',
    },
    {
      id: 'left-electrical', name: '电路左', x: 0, y: 32,
      direction: 'left', type: 'electrical',
    },
    {
      id: 'right-electrical', name: '电路右', x: 64, y: 32,
      direction: 'right', type: 'electrical',
    },
  ],
}

function element(id: string, x: number, y: number, width = 64, height = 64): DiagramElement {
  return {
    id,
    diagramId: 'diagram-cooling',
    assetKey: coolingAsset.key,
    name: id,
    x,
    y,
    width,
    height,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

function powerElement(id: string, x: number, y: number): DiagramElement {
  return {
    ...element(id, x, y),
    diagramId: 'diagram-power',
    assetKey: directionalElectricalAsset.key,
  }
}

function gridSegmentKeys(points: Array<{ x: number; y: number }>, gridSize = 8) {
  const keys = new Set<string>()
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const steps = (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) / gridSize
    for (let step = 0; step < steps; step += 1) {
      const left = {
        x: start.x + Math.sign(end.x - start.x) * step * gridSize,
        y: start.y + Math.sign(end.y - start.y) * step * gridSize,
      }
      const right = {
        x: left.x + Math.sign(end.x - start.x) * gridSize,
        y: left.y + Math.sign(end.y - start.y) * gridSize,
      }
      const pair = [`${left.x},${left.y}`, `${right.x},${right.y}`].sort()
      keys.add(pair.join('::'))
    }
  }
  return keys
}

describe('connection topology and routing', () => {
  it('keeps open free-ended lines and permits an explicit closed loop', () => {
    const point = (
      nodeId: string,
      x: number,
      y: number,
      networkId = 'pending-direct-network',
    ) => ({
      kind: 'node' as const,
      networkId,
      nodeId,
      point: { x, y },
      type: 'electrical' as const,
    })
    const start = point('free-start', 0, 0)
    const middle = point('free-middle', 80, 0)
    const first = connectTerminals([], 'diagram-power', start, middle)

    expect(first).not.toBeNull()
    const networkId = first![0].id
    const normalizedOpen = normalizeConnectionNetworks(
      first!,
      [],
      [],
    )
    expect(normalizedOpen[0].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'free-start', kind: 'node' }),
      expect.objectContaining({ id: 'free-middle', kind: 'node' }),
    ]))

    const end = point('free-end', 80, 80, networkId)
    const extended = connectTerminals(
      first!,
      'diagram-power',
      point('free-middle', 80, 0, networkId),
      end,
    )
    const closed = connectTerminals(
      extended!,
      'diagram-power',
      end,
      point('free-start', 0, 0, networkId),
    )

    expect(closed).not.toBeNull()
    expect(closed![0].edges).toHaveLength(3)
    expect(normalizeConnectionNetworks(closed!, [], [])[0].edges).toHaveLength(3)
    expect(connectTerminals(
      closed!,
      'diagram-power',
      point('free-start', 0, 0, networkId),
      end,
    )).toBeNull()
  })

  it('segments a logical route at every persisted node and keeps per-span direction', () => {
    let generatedIndex = 0
    const segmented = segmentConnectionEdgesAtNodes([{
      id: 'segmented-network',
      diagramId: 'diagram-power',
      type: 'electrical',
      nodes: [
        { id: 'source', kind: 'busbar-tap', busbarId: 'left', offset: 0 },
        { id: 'middle-a', kind: 'node', x: 40, y: 0 },
        { id: 'middle-b', kind: 'node', x: 80, y: 0 },
        { id: 'target', kind: 'busbar-tap', busbarId: 'right', offset: 0 },
      ],
      edges: [{
        id: 'logical-edge',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        routeNodeIds: ['middle-a', 'middle-b'],
        flowDirection: 'forward',
        externalSupplyEndpoint: 'source',
        externalSupplyChannel: 'a',
        crossingLayer: 'upper',
        color: '#123456',
        label: '回路 A',
        labelEndpoint: 'target',
        monitorDataVisible: true,
        monitorMetrics: [{
          id: 'current',
          name: '电流',
          valueType: 'number',
          unit: 'A',
          precision: 1,
          simulationMin: 0,
          simulationMax: 100,
          alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
        }],
      }],
    }], () => `generated-edge-${++generatedIndex}`)[0]

    expect(segmented.edges).toEqual([
      expect.objectContaining({
        id: 'generated-edge-1',
        sourceNodeId: 'source',
        targetNodeId: 'middle-a',
        logicalConnectionId: 'logical-edge',
        flowDirection: 'forward',
        externalSupplyEndpoint: 'source',
        externalSupplyChannel: 'a',
        crossingLayer: 'upper',
        color: '#123456',
      }),
      expect.objectContaining({
        id: 'generated-edge-2',
        sourceNodeId: 'middle-a',
        targetNodeId: 'middle-b',
        logicalConnectionId: 'logical-edge',
        flowDirection: 'forward',
        crossingLayer: 'upper',
      }),
      expect.objectContaining({
        id: 'logical-edge',
        sourceNodeId: 'middle-b',
        targetNodeId: 'target',
        logicalConnectionId: 'logical-edge',
        crossingLayer: 'upper',
        label: '回路 A',
        labelEndpoint: 'target',
        monitorDataVisible: true,
        monitorMetrics: [expect.objectContaining({ id: 'current', name: '电流' })],
      }),
    ])
    expect(segmented.edges.every((edge) => !('routeNodeIds' in edge))).toBe(true)
    expect(segmented.edges.every((edge) => edge.crossingLayer === 'upper')).toBe(true)
    expect(segmented.edges.filter((edge) => edge.externalSupplyEndpoint)).toEqual([
      expect.objectContaining({
        sourceNodeId: 'source',
        externalSupplyEndpoint: 'source',
        externalSupplyChannel: 'a',
      }),
    ])
    expect(segmented.edges.filter((edge) => edge.label === '回路 A')).toHaveLength(1)
    expect(segmented.edges.filter((edge) => edge.monitorMetrics?.length)).toHaveLength(1)
  })

  it('removes a self-loop when connection topology is normalized', () => {
    const left = powerElement('normalize-left', 0, 0)
    const right = powerElement('normalize-right', 160, 0)
    const network: ConnectionNetwork = {
      id: 'normalize-network',
      diagramId: 'diagram-power',
      type: 'electrical',
      nodes: [
        {
          id: 'normalize-left-node',
          kind: 'element-anchor',
          elementId: left.id,
          anchorId: 'right-electrical',
        },
        {
          id: 'normalize-right-node',
          kind: 'element-anchor',
          elementId: right.id,
          anchorId: 'left-electrical',
        },
        { id: 'normalize-junction', kind: 'node', x: 112, y: 32 },
      ],
      edges: [
        {
          id: 'normalize-left-edge',
          sourceNodeId: 'normalize-left-node',
          targetNodeId: 'normalize-junction',
        },
        {
          id: 'normalize-self-loop',
          sourceNodeId: 'normalize-junction',
          targetNodeId: 'normalize-junction',
        },
        {
          id: 'normalize-right-edge',
          sourceNodeId: 'normalize-junction',
          targetNodeId: 'normalize-right-node',
        },
      ],
    }

    const normalized = normalizeConnectionNetworks(
      [network],
      [left, right],
      [directionalElectricalAsset],
    )

    expect(normalized).toHaveLength(1)
    expect(normalized[0].edges.map((edge) => edge.id)).toEqual([
      'normalize-left-edge',
      'normalize-right-edge',
    ])
  })

  it('places a fixed-screen arrow at the configured child-line terminal', () => {
    const points = [{ x: 0, y: 0 }, { x: 80, y: 0 }]

    expect(connectionTerminalArrowPath(points, 'forward')).toBe(
      'M 80 0 L 72 4 L 72 -4 Z',
    )
    expect(connectionTerminalArrowPath(points, 'reverse', 2)).toBe(
      'M 0 0 L 4 -2 L 4 2 Z',
    )
    expect(connectionTerminalArrowPath(points, 'forward', 2, 6)).toBe(
      'M 77 0 L 73 2 L 73 -2 Z',
    )
  })

  it('transforms asset anchors with instance scale and rotation', () => {
    const instance = { ...element('rotated', 80, 40, 128, 128), rotation: 90 }
    const resolved = resolveElementAnchor(instance, coolingAsset, coolingAsset.anchors[0])

    expect(resolved.point).toEqual({ x: 144, y: 40 })
    expect(resolved.direction).toBe('top')
  })

  it('uses a shortest orthogonal grid route around symbol obstacles', () => {
    const route = routeOrthogonalGrid(
      { x: 72, y: 32 },
      { x: 152, y: 32 },
      [{ x: 96, y: 0, width: 32, height: 64 }],
      new Set(),
      8,
    )

    expect(route).not.toBeNull()
    expect(route?.some((point) => point.y < 0 || point.y > 64)).toBe(true)
    expect(route?.every((point) => point.x % 8 === 0 && point.y % 8 === 0)).toBe(true)
    route?.slice(1).forEach((point, index) => {
      const previous = route[index]
      expect(point.x === previous.x || point.y === previous.y).toBe(true)
    })
  })

  it('places equal-cost dogleg bends near the midpoint between both endpoints', () => {
    expect(routeOrthogonalGrid(
      { x: 0, y: 0 },
      { x: 80, y: 80 },
      [],
      new Set(),
      8,
      { startDirection: 1, endDirection: 1 },
    )).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 80 },
    ])
  })

  it('treats ordered manual waypoints as hard routing constraints', () => {
    const source = powerElement('manual-source', 0, 0)
    const target = powerElement('manual-target', 240, 0)
    const network: ConnectionNetwork = {
      id: 'manual-network',
      diagramId: 'diagram-power',
      type: 'electrical',
      nodes: [
        {
          id: 'manual-source-node',
          kind: 'element-anchor',
          elementId: source.id,
          anchorId: 'right-electrical',
        },
        {
          id: 'manual-target-node',
          kind: 'element-anchor',
          elementId: target.id,
          anchorId: 'left-electrical',
        },
      ],
      edges: [{
        id: 'manual-edge',
        sourceNodeId: 'manual-source-node',
        targetNodeId: 'manual-target-node',
        routeNodeIds: ['manual-waypoint'],
      }],
    }
    const waypoint = { id: 'manual-waypoint', x: 120, y: 128 }
    const routed = routeConnectionNetworks(
      [network],
      [source, target],
      [directionalElectricalAsset],
      8,
      [],
      [waypoint],
    )
    const points = routed.edges[0].points
    const passesWaypoint = points.slice(1).some((end, index) => {
      const start = points[index]
      return waypoint.x >= Math.min(start.x, end.x) && waypoint.x <= Math.max(start.x, end.x) &&
        waypoint.y >= Math.min(start.y, end.y) && waypoint.y <= Math.max(start.y, end.y)
    })

    expect(routed.invalidEdgeIds).toEqual([])
    expect(passesWaypoint).toBe(true)
  })

  it('promotes a general network when a specialized cooling anchor joins', () => {
    const initial = connectTerminals([], 'diagram-cooling', {
      kind: 'anchor', elementId: 'left', anchorId: 'left-general', type: 'cooling-general',
    }, {
      kind: 'anchor', elementId: 'right', anchorId: 'left-general', type: 'cooling-general',
    })!
    const promoted = connectTerminals(initial, 'diagram-cooling', {
      kind: 'anchor', elementId: 'left', anchorId: 'left-general', type: 'cooling-general',
    }, {
      kind: 'anchor', elementId: 'cold', anchorId: 'right-cold', type: 'cooling-primary-cold',
    })!

    expect(initial[0].type).toBe('cooling-general')
    expect(promoted[0].type).toBe('cooling-primary-cold')
    expect(promoted[0].nodes).toHaveLength(3)
    expect(promoted[0].edges).toHaveLength(2)
    const sharedAnchorNode = promoted[0].nodes.find((node) => (
      node.kind === 'element-anchor' && node.elementId === 'left'
    ))!
    expect(promoted[0].edges.filter((edge) => (
      edge.sourceNodeId === sharedAnchorNode.id || edge.targetNodeId === sharedAnchorNode.id
    ))).toHaveLength(2)
    expect(connectionTypesCompatible(promoted[0].type, 'cooling-primary-hot')).toBe(false)

    const withoutSpecializedBranch = deleteConnectionEdge(
      promoted,
      promoted[0].edges.at(-1)!.id,
      [element('left', 0, 0), element('right', 160, 0), element('cold', 80, 120)],
      [coolingAsset],
    )
    expect(withoutSpecializedBranch).toHaveLength(1)
    // Removing the last typed port unlocks editing but preserves the network's circuit.
    expect(withoutSpecializedBranch[0].type).toBe('cooling-primary-cold')
    expect(withoutSpecializedBranch[0].edges).toHaveLength(1)
  })

  it('allows naturally overlapping paths and derives an unmarked branch for repeated anchor wiring', () => {
    const source = powerElement('shared-source', 64, -96)
    const left = powerElement('shared-left', 0, 80)
    const right = powerElement('shared-right', 128, 80)
    const first = connectTerminals([], 'diagram-power', {
      kind: 'anchor', elementId: source.id, anchorId: 'bottom-electrical', type: 'electrical',
    }, {
      kind: 'anchor', elementId: left.id, anchorId: 'top-electrical', type: 'electrical',
    })!
    const connected = connectTerminals(first, 'diagram-power', {
      kind: 'anchor', elementId: source.id, anchorId: 'bottom-electrical', type: 'electrical',
    }, {
      kind: 'anchor', elementId: right.id, anchorId: 'top-electrical', type: 'electrical',
    })!

    const routed = routeConnectionNetworks(
      connected,
      [source, left, right],
      [directionalElectricalAsset],
      8,
    )
    const [firstSegments, secondSegments] = routed.edges.map((edge) => gridSegmentKeys(edge.points))
    const sharedSegments = [...firstSegments].filter((segment) => secondSegments.has(segment))

    expect(connected).toHaveLength(1)
    expect(connected[0].nodes).toHaveLength(3)
    expect(connected[0].edges).toHaveLength(2)
    expect(sharedSegments.length).toBeGreaterThan(0)
    expect(routed.crossings).toEqual([])
    expect(routed.invalidEdgeIds).toEqual([])
  })

  it('keeps equal-length equal-turn doglegs centered beside an existing network trunk', () => {
    const trunkSource = powerElement('centered-trunk-source', 0, 0)
    const branchSource = powerElement('centered-branch-source', 128, 64)
    const target = powerElement('centered-target', 256, 0)
    const network: ConnectionNetwork = {
      id: 'centered-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'trunk-source-anchor', kind: 'element-anchor',
          elementId: trunkSource.id, anchorId: 'right-electrical',
        },
        {
          id: 'branch-source-anchor', kind: 'element-anchor',
          elementId: branchSource.id, anchorId: 'right-electrical',
        },
        {
          id: 'centered-target-anchor', kind: 'element-anchor',
          elementId: target.id, anchorId: 'left-electrical',
        },
      ],
      edges: [
        {
          id: 'centered-trunk-edge',
          sourceNodeId: 'trunk-source-anchor',
          targetNodeId: 'centered-target-anchor',
        },
        {
          id: 'centered-branch-edge',
          sourceNodeId: 'branch-source-anchor',
          targetNodeId: 'centered-target-anchor',
        },
      ],
    }

    const routed = routeConnectionNetworks(
      [network],
      [trunkSource, branchSource, target],
      [directionalElectricalAsset],
      8,
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.edges[0].points).toEqual([
      { x: 64, y: 32 },
      { x: 256, y: 32 },
    ])
    expect(routed.edges[1].points).toEqual([
      { x: 192, y: 96 },
      { x: 224, y: 96 },
      { x: 224, y: 32 },
      { x: 256, y: 32 },
    ])
  })

  it('prefers fewer turns before considering midpoint placement', () => {
    const left = powerElement('turn-priority-left', 0, 0)
    const middle = powerElement('turn-priority-middle', 128, 0)
    const target = {
      ...powerElement('turn-priority-target', 256, 64),
      rotation: 90,
    }
    const network: ConnectionNetwork = {
      id: 'turn-priority-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'left-anchor', kind: 'element-anchor',
          elementId: left.id, anchorId: 'bottom-electrical',
        },
        {
          id: 'middle-anchor', kind: 'element-anchor',
          elementId: middle.id, anchorId: 'bottom-electrical',
        },
        {
          id: 'target-anchor', kind: 'element-anchor',
          elementId: target.id, anchorId: 'bottom-electrical',
        },
      ],
      edges: [
        { id: 'existing-edge', sourceNodeId: 'middle-anchor', targetNodeId: 'target-anchor' },
        { id: 'later-edge', sourceNodeId: 'left-anchor', targetNodeId: 'target-anchor' },
      ],
    }

    const routed = routeConnectionNetworks(
      [network],
      [left, middle, target],
      [directionalElectricalAsset],
      8,
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.edges[0].points).toEqual([
      { x: 160, y: 64 },
      { x: 160, y: 96 },
      { x: 256, y: 96 },
    ])
    expect(routed.edges[1].points).toEqual([
      { x: 32, y: 64 },
      { x: 32, y: 96 },
      { x: 256, y: 96 },
    ])
  })

  it('keeps routed trunks stable while moved element endpoints follow a lightweight preview', () => {
    const source = powerElement('preview-source', 64, -96)
    const left = powerElement('preview-left', 0, 80)
    const right = powerElement('preview-right', 128, 80)
    const first = connectTerminals([], 'diagram-power', {
      kind: 'anchor', elementId: source.id, anchorId: 'bottom-electrical', type: 'electrical',
    }, {
      kind: 'anchor', elementId: left.id, anchorId: 'top-electrical', type: 'electrical',
    })!
    const connected = connectTerminals(first, 'diagram-power', {
      kind: 'anchor', elementId: source.id, anchorId: 'bottom-electrical', type: 'electrical',
    }, {
      kind: 'anchor', elementId: right.id, anchorId: 'top-electrical', type: 'electrical',
    })!
    const elements = [source, left, right]
    const routed = routeConnectionNetworks(
      connected,
      elements,
      [directionalElectricalAsset],
      8,
    )
    const movedSource = { ...source, x: source.x + 16, y: source.y + 8 }
    const preview = previewConnectionRoutesForElements(
      routed,
      connected,
      elements,
      [movedSource, left, right],
      [directionalElectricalAsset],
      8,
    )

    expect(preview.edges).toHaveLength(2)
    preview.edges.forEach((edge) => {
      const original = routed.edges.find((candidate) => candidate.edgeId === edge.edgeId)!
      expect(edge.points[0]).toEqual({ x: 112, y: -24 })
      const trunkPoint = original.points[1]
      expect(edge.points.slice(1).some((end, index) => {
        const start = edge.points[index]
        return start.x === end.x
          ? trunkPoint.x === start.x &&
              trunkPoint.y >= Math.min(start.y, end.y) &&
              trunkPoint.y <= Math.max(start.y, end.y)
          : trunkPoint.y === start.y &&
              trunkPoint.x >= Math.min(start.x, end.x) &&
              trunkPoint.x <= Math.max(start.x, end.x)
      })).toBe(true)
    })
    expect(preview.invalidEdgeIds).toEqual([])
  })

  it('uses lightweight endpoint attachment while a connected busbar is resized', () => {
    const busbar: Busbar = {
      id: 'preview-busbar', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const device = powerElement('preview-busbar-device', 48, 96)
    const network: ConnectionNetwork = {
      id: 'preview-busbar-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'preview-device-node', kind: 'element-anchor',
          elementId: device.id, anchorId: 'top-electrical',
        },
        {
          id: 'preview-tap-node', kind: 'busbar-tap',
          busbarId: busbar.id, offset: 80,
        },
      ],
      edges: [{
        id: 'preview-busbar-edge',
        sourceNodeId: 'preview-device-node',
        targetNodeId: 'preview-tap-node',
      }],
    }
    const routed = routeConnectionNetworks(
      [network],
      [device],
      [directionalElectricalAsset],
      8,
      [busbar],
    )
    const resized = { ...busbar, length: 40 }
    const previewNetwork = {
      ...network,
      nodes: network.nodes.map((node) => node.kind === 'busbar-tap'
        ? { ...node, offset: 40 }
        : node),
    }
    const preview = previewConnectionRoutesForDiagram(
      routed,
      [network],
      [previewNetwork],
      [device],
      [device],
      [directionalElectricalAsset],
      8,
      [busbar],
      [resized],
    )

    expect(preview.resolvedBusbarTapOffsets['preview-tap-node']).toBe(40)
    expect(preview.edges[0].points.at(-1)).toEqual({ x: 40, y: 0 })
  })

  it('attaches every incident route to a junction while it is moved', () => {
    const device = powerElement('junction-preview-device', 96, 0)
    const network: ConnectionNetwork = {
      id: 'junction-preview-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'junction-preview', kind: 'node', x: 40, y: 32 },
        {
          id: 'junction-preview-device-node', kind: 'element-anchor',
          elementId: device.id, anchorId: 'top-electrical',
        },
      ],
      edges: [{
        id: 'junction-preview-edge',
        sourceNodeId: 'junction-preview',
        targetNodeId: 'junction-preview-device-node',
      }],
    }
    const previewNetwork: ConnectionNetwork = {
      ...network,
      nodes: network.nodes.map((node) => node.kind === 'node'
        ? { ...node, x: 40, y: 48 }
        : node),
    }
    const preview = previewConnectionRoutesForDiagram(
      {
        edges: [{
          networkId: network.id,
          edgeId: 'junction-preview-edge',
          type: 'electrical',
          sourceNodeId: 'junction-preview',
          targetNodeId: 'junction-preview-device-node',
          points: [{ x: 40, y: 32 }, { x: 128, y: 32 }, { x: 128, y: 0 }],
          order: 0,
        }],
        crossings: [],
        invalidEdgeIds: [],
        resolvedBusbarTapOffsets: {},
      },
      [network],
      [previewNetwork],
      [device],
      [device],
      [directionalElectricalAsset],
      8,
    )

    expect(preview.edges[0].points[0]).toEqual({ x: 40, y: 48 })
    expect(preview.edges[0].points.slice(1)).toContainEqual({ x: 128, y: 48 })
  })

  it('keeps untouched route, crossing and tap-offset references during a junction preview', () => {
    const movedNetwork: ConnectionNetwork = {
      id: 'preview-moved-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'preview-moved-node', kind: 'node', x: 0, y: 0 },
        { id: 'preview-moved-target', kind: 'node', x: 32, y: 0 },
      ],
      edges: [{
        id: 'preview-moved-edge',
        sourceNodeId: 'preview-moved-node',
        targetNodeId: 'preview-moved-target',
      }],
    }
    const untouchedNetwork: ConnectionNetwork = {
      id: 'preview-untouched-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'preview-untouched-source', kind: 'node', x: 0, y: 64 },
        { id: 'preview-untouched-target', kind: 'node', x: 32, y: 64 },
      ],
      edges: [{
        id: 'preview-untouched-edge',
        sourceNodeId: 'preview-untouched-source',
        targetNodeId: 'preview-untouched-target',
      }],
    }
    const routed = {
      edges: [
        {
          networkId: movedNetwork.id,
          edgeId: 'preview-moved-edge',
          type: 'electrical' as const,
          sourceNodeId: 'preview-moved-node',
          targetNodeId: 'preview-moved-target',
          points: [{ x: 0, y: 0 }, { x: 32, y: 0 }],
          order: 0,
        },
        {
          networkId: untouchedNetwork.id,
          edgeId: 'preview-untouched-edge',
          type: 'electrical' as const,
          sourceNodeId: 'preview-untouched-source',
          targetNodeId: 'preview-untouched-target',
          points: [{ x: 0, y: 64 }, { x: 32, y: 64 }],
          order: 1,
        },
      ],
      crossings: [],
      invalidEdgeIds: [],
      resolvedBusbarTapOffsets: {},
    }
    const previewMovedNetwork: ConnectionNetwork = {
      ...movedNetwork,
      nodes: movedNetwork.nodes.map((node) => node.id === 'preview-moved-node'
        ? { ...node, x: 8 }
        : node),
    }
    const preview = previewConnectionRoutesForDiagram(
      routed,
      [movedNetwork, untouchedNetwork],
      [previewMovedNetwork, untouchedNetwork],
      [],
      [],
      [],
      8,
    )

    expect(preview.edges[0]).not.toBe(routed.edges[0])
    expect(preview.edges[1]).toBe(routed.edges[1])
    expect(preview.crossings).toBe(routed.crossings)
    expect(preview.resolvedBusbarTapOffsets).toBe(routed.resolvedBusbarTapOffsets)
  })

  it('routes a hovered target anchor directly without searching inside its symbol obstacle', () => {
    const source = powerElement('hover-source', 0, 0)
    const target = powerElement('hover-target', 160, 160)
    const preview = routeConnectionPreview(
      {
        kind: 'anchor', elementId: source.id,
        anchorId: 'bottom-electrical', type: 'electrical',
      },
      { x: 192, y: 160 },
      [],
      [source, target],
      [directionalElectricalAsset],
      8,
      [],
      undefined,
      {
        kind: 'anchor', elementId: target.id,
        anchorId: 'top-electrical', type: 'electrical',
      },
    )

    expect(preview?.at(-1)).toEqual({ x: 192, y: 160 })
  })

  it('keeps an interactive preview visible across a long diagram span', () => {
    const source = powerElement('long-preview-source', 0, 0)
    const target = powerElement('long-preview-target', 3200, 1600)
    const preview = routeConnectionPreview(
      {
        kind: 'anchor', elementId: source.id,
        anchorId: 'bottom-electrical', type: 'electrical',
      },
      { x: 3232, y: 1600 },
      [],
      [source, target],
      [directionalElectricalAsset],
      8,
      [],
      undefined,
      {
        kind: 'anchor', elementId: target.id,
        anchorId: 'top-electrical', type: 'electrical',
      },
    )

    expect(preview).not.toBeNull()
    expect(preview?.at(-1)).toEqual({ x: 3232, y: 1600 })
  })

  it('routes network edges from actual anchors without crossing the middle symbol', () => {
    const left = element('left', 0, 0)
    const middle = element('middle', 96, 0, 32, 64)
    const right = element('right', 160, 0)
    const network: ConnectionNetwork = {
      id: 'network',
      diagramId: 'diagram-cooling',
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'left-node', kind: 'element-anchor', elementId: left.id, anchorId: 'right-cold' },
        { id: 'right-node', kind: 'element-anchor', elementId: right.id, anchorId: 'left-general' },
      ],
      edges: [{ id: 'edge', sourceNodeId: 'left-node', targetNodeId: 'right-node' }],
    }
    const routed = routeConnectionNetworks(
      [network],
      [left, middle, right],
      [coolingAsset],
      8,
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.edges[0].points[0]).toEqual({ x: 64, y: 32 })
    expect(routed.edges[0].points.at(-1)).toEqual({ x: 160, y: 32 })
    expect(routed.edges[0].points.some((point) => point.y < 0 || point.y > 64)).toBe(true)
  })

  it('marks a later perpendicular edge as a bridge without creating topology', () => {
    const horizontalLeft = powerElement('horizontal-left', -64, -32)
    const horizontalRight = powerElement('horizontal-right', 80, -32)
    const verticalTop = powerElement('vertical-top', 8, -104)
    const verticalBottom = powerElement('vertical-bottom', 8, 40)
    const networks: ConnectionNetwork[] = [
      {
        id: 'horizontal-network', diagramId: 'diagram-power', type: 'electrical',
        nodes: [
          { id: 'h-left', kind: 'element-anchor', elementId: horizontalLeft.id, anchorId: 'right-electrical' },
          { id: 'h-right', kind: 'element-anchor', elementId: horizontalRight.id, anchorId: 'left-electrical' },
        ],
        edges: [{ id: 'horizontal', sourceNodeId: 'h-left', targetNodeId: 'h-right' }],
      },
      {
        id: 'vertical-network', diagramId: 'diagram-power', type: 'electrical',
        nodes: [
          { id: 'v-top', kind: 'element-anchor', elementId: verticalTop.id, anchorId: 'bottom-electrical' },
          { id: 'v-bottom', kind: 'element-anchor', elementId: verticalBottom.id, anchorId: 'top-electrical' },
        ],
        edges: [{ id: 'vertical', sourceNodeId: 'v-top', targetNodeId: 'v-bottom' }],
      },
    ]
    const routed = routeConnectionNetworks(
      networks,
      [horizontalLeft, horizontalRight, verticalTop, verticalBottom],
      [directionalElectricalAsset],
      8,
    )

    expect(routed.crossings).toEqual([{
      x: 40,
      y: 0,
      bridgeEdgeId: 'vertical',
      underEdgeId: 'horizontal',
    }])
    expect(crossingPointKeys(routed.crossings).has('40,0')).toBe(true)
    const renderedBridge = bridgedPathData(routed.edges[1], routed.crossings, 8)
    expect(renderedBridge.linePath).not.toContain(' A ')
    expect(renderedBridge.bridgeCasingPath).toContain('M ')
    expect(renderedBridge.bridgeCasingPath).toContain(' L ')
    expect(pathDataWithBridges(routed.edges[1], routed.crossings, 8))
      .toBe(renderedBridge.linePath)
    const sampledBridge = bridgedPolylinePoints(routed.edges[1], routed.crossings, 8)
    expect(sampledBridge[0]).toEqual(routed.edges[1].points[0])
    expect(sampledBridge.at(-1)).toEqual(routed.edges[1].points.at(-1))
    expect(sampledBridge.every((point) => point.x === 40)).toBe(true)
  })

  it('places a cooling bridge on a primary line when it crosses an auxiliary line', () => {
    const networks: ConnectionNetwork[] = [
      {
        id: 'primary-network', diagramId: 'diagram-cooling', type: 'cooling-primary-cold',
        nodes: [
          { id: 'primary-left', kind: 'node', x: -32, y: 0 },
          { id: 'primary-right', kind: 'node', x: 32, y: 0 },
        ],
        edges: [{
          id: 'primary-edge',
          sourceNodeId: 'primary-left',
          targetNodeId: 'primary-right',
        }],
      },
      {
        id: 'auxiliary-network', diagramId: 'diagram-cooling', type: 'cooling-primary-cold',
        nodes: [
          { id: 'auxiliary-top', kind: 'node', x: 0, y: -32 },
          { id: 'auxiliary-bottom', kind: 'node', x: 0, y: 32 },
        ],
        edges: [{
          id: 'auxiliary-edge',
          sourceNodeId: 'auxiliary-top',
          targetNodeId: 'auxiliary-bottom',
          coolingLineRole: 'auxiliary',
        }],
      },
    ]

    const routed = routeConnectionNetworks(networks, [], [], 8)

    expect(routed.crossings).toEqual([{
      x: 0,
      y: 0,
      bridgeEdgeId: 'primary-edge',
      underEdgeId: 'auxiliary-edge',
    }])
    expect(pathDataWithBridges(routed.edges[0], routed.crossings, 8))
      .not.toContain(' A ')
    expect(bridgedPathData(routed.edges[0], routed.crossings, 8).bridgeCasingPath)
      .not.toBe('')
    expect(pathDataWithBridges(routed.edges[1], routed.crossings, 8))
      .not.toContain(' A 4 4 0 0 1 ')
  })

  it('lets a whole child line manually override automatic crossing ownership', () => {
    const networks: ConnectionNetwork[] = [
      {
        id: 'primary-network', diagramId: 'diagram-cooling', type: 'cooling-primary-cold',
        nodes: [
          { id: 'primary-left', kind: 'node', x: -32, y: 0 },
          { id: 'primary-right', kind: 'node', x: 32, y: 0 },
        ],
        edges: [{
          id: 'primary-edge',
          sourceNodeId: 'primary-left',
          targetNodeId: 'primary-right',
          crossingLayer: 'lower',
        }],
      },
      {
        id: 'auxiliary-network', diagramId: 'diagram-cooling', type: 'cooling-primary-cold',
        nodes: [
          { id: 'auxiliary-top', kind: 'node', x: 0, y: -32 },
          { id: 'auxiliary-bottom', kind: 'node', x: 0, y: 32 },
        ],
        edges: [{
          id: 'auxiliary-edge',
          sourceNodeId: 'auxiliary-top',
          targetNodeId: 'auxiliary-bottom',
          coolingLineRole: 'auxiliary',
        }],
      },
    ]

    expect(routeConnectionNetworks(networks, [], [], 8).crossings).toEqual([{
      x: 0,
      y: 0,
      bridgeEdgeId: 'auxiliary-edge',
      underEdgeId: 'primary-edge',
    }])

    networks[1].edges[0].crossingLayer = 'upper'
    networks[0].edges[0].crossingLayer = undefined
    expect(routeConnectionNetworks(networks, [], [], 8).crossings[0]).toMatchObject({
      bridgeEdgeId: 'auxiliary-edge',
      underEdgeId: 'primary-edge',
    })
  })

  it('compresses adjacent straight crossing masks without adding topology', () => {
    const route = {
      networkId: 'bridge-network',
      edgeId: 'bridge-edge',
      type: 'electrical' as const,
      sourceNodeId: 'source',
      targetNodeId: 'target',
      points: [{ x: 0, y: 0 }, { x: 32, y: 0 }],
      order: 0,
    }
    const rendered = bridgedPathData(route, [
      { x: 8, y: 0, bridgeEdgeId: route.edgeId, underEdgeId: 'under-a' },
      { x: 16, y: 0, bridgeEdgeId: route.edgeId, underEdgeId: 'under-b' },
    ], 8)

    expect(rendered.linePath).toBe('M 0 0 L 32 0')
    expect(rendered.bridgeCasingPath.match(/M /g)).toHaveLength(2)
    expect(rendered.bridgeCasingPath).toBe('M 4 0 L 12 0 M 12 0 L 20 0')
  })

  it('supports a larger cooling crossing mask while SVG and animation stay straight', () => {
    const route = {
      networkId: 'cooling-bridge-network',
      edgeId: 'cooling-bridge-edge',
      type: 'cooling-primary-cold' as const,
      sourceNodeId: 'source',
      targetNodeId: 'target',
      points: [{ x: 0, y: 0 }, { x: 32, y: 0 }],
      order: 0,
    }
    const crossings = [{
      x: 16,
      y: 0,
      bridgeEdgeId: route.edgeId,
      underEdgeId: 'under-edge',
    }]

    expect(bridgedPathData(route, crossings, 8).bridgeCasingPath).toBe('M 12 0 L 20 0')
    const rendered = bridgedPathData(route, crossings, 8, { bridgeRadius: 8 })
    expect(rendered.linePath).toBe('M 0 0 L 32 0')
    expect(rendered.bridgeCasingPath).toBe('M 8 0 L 24 0')
    expect(bridgedPolylinePoints(route, crossings, 8, { bridgeRadius: 8 })).toEqual(route.points)
  })

  it('rounds ordinary orthogonal corners and compresses short elbows', () => {
    expect(roundedOrthogonalPathData([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 16 },
    ], 8)).toBe('M 0 0 L 8 0 A 8 8 0 0 1 16 8 L 16 16')
    expect(roundedOrthogonalPathData([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
    ], 8)).toBe('M 0 0 L 4 0 A 4 4 0 0 1 8 4 L 8 8')
  })

  it('rounds a cooling elbow split into two editable edges at a persisted node', () => {
    const horizontal = {
      networkId: 'split-elbow-network',
      edgeId: 'split-elbow-horizontal',
      type: 'cooling-primary-cold' as const,
      sourceNodeId: 'source',
      targetNodeId: 'shared-node',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      order: 0,
    }
    const vertical = {
      networkId: 'split-elbow-network',
      edgeId: 'split-elbow-vertical',
      type: 'cooling-primary-cold' as const,
      sourceNodeId: 'shared-node',
      targetNodeId: 'target',
      points: [{ x: 16, y: 0 }, { x: 16, y: 16 }],
      order: 1,
    }
    const geometry = connectedRouteEndpointGeometry(
      [horizontal, vertical],
      new Map([['split-elbow-network', new Set(['shared-node'])]]),
      [],
      8,
    )
    const horizontalGeometry = geometry.get(horizontal.edgeId)!
    const verticalGeometry = geometry.get(vertical.edgeId)!

    expect(horizontalGeometry.route.points).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ])
    expect(verticalGeometry.route.points).toEqual([
      { x: 16, y: 8 },
      { x: 16, y: 16 },
    ])
    expect(horizontalGeometry.targetEndpointArc?.midpoint)
      .toEqual(verticalGeometry.sourceEndpointArc?.midpoint)

    const horizontalPath = bridgedPathData(horizontalGeometry.route, [], 8, {
      cornerRadius: 8,
      targetEndpointArc: horizontalGeometry.targetEndpointArc,
    }).linePath
    const verticalPath = bridgedPathData(verticalGeometry.route, [], 8, {
      cornerRadius: 8,
      sourceEndpointArc: verticalGeometry.sourceEndpointArc,
    }).linePath
    expect(horizontalPath).toContain('A 8 8')
    expect(verticalPath).toContain('A 8 8')

    const horizontalPoints = bridgedPolylinePoints(horizontalGeometry.route, [], 8, {
      cornerRadius: 8,
      targetEndpointArc: horizontalGeometry.targetEndpointArc,
    })
    const verticalPoints = bridgedPolylinePoints(verticalGeometry.route, [], 8, {
      cornerRadius: 8,
      sourceEndpointArc: verticalGeometry.sourceEndpointArc,
    })
    expect(horizontalPoints.at(-1)).toEqual(verticalPoints[0])
  })

  it('keeps a persisted cooling branch square instead of rounding through it', () => {
    const routes = [
      {
        networkId: 'split-branch-network',
        edgeId: 'branch-left',
        type: 'cooling-primary-cold' as const,
        sourceNodeId: 'left',
        targetNodeId: 'branch-node',
        points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
        order: 0,
      },
      {
        networkId: 'split-branch-network',
        edgeId: 'branch-right',
        type: 'cooling-primary-cold' as const,
        sourceNodeId: 'branch-node',
        targetNodeId: 'right',
        points: [{ x: 16, y: 0 }, { x: 32, y: 0 }],
        order: 1,
      },
      {
        networkId: 'split-branch-network',
        edgeId: 'branch-down',
        type: 'cooling-primary-cold' as const,
        sourceNodeId: 'branch-node',
        targetNodeId: 'down',
        points: [{ x: 16, y: 0 }, { x: 16, y: 16 }],
        order: 2,
      },
    ]
    const geometry = connectedRouteEndpointGeometry(
      routes,
      new Map([['split-branch-network', new Set(['branch-node'])]]),
      [],
      8,
    )

    routes.forEach((route) => {
      expect(geometry.get(route.edgeId)).toEqual({ route })
    })
  })

  it('reuses unchanged branch-key sets across drag preview frames', () => {
    const routes = [
      {
        networkId: 'stable-branch-network',
        edgeId: 'stable-left',
        type: 'cooling-primary-cold' as const,
        sourceNodeId: 'left',
        targetNodeId: 'branch',
        points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
        order: 0,
      },
      {
        networkId: 'stable-branch-network',
        edgeId: 'stable-right',
        type: 'cooling-primary-cold' as const,
        sourceNodeId: 'branch',
        targetNodeId: 'right',
        points: [{ x: 16, y: 0 }, { x: 32, y: 0 }],
        order: 1,
      },
      {
        networkId: 'stable-branch-network',
        edgeId: 'stable-down',
        type: 'cooling-primary-cold' as const,
        sourceNodeId: 'branch',
        targetNodeId: 'down',
        points: [{ x: 16, y: 0 }, { x: 16, y: 16 }],
        order: 2,
      },
    ]
    const first = connectionRouteBranchPointKeys(routes)
    const second = connectionRouteBranchPointKeys(routes.map((route) => ({ ...route })), first)

    expect(second.get('stable-branch-network')).toBe(first.get('stable-branch-network'))
  })

  it('samples the same rounded cooling corner used by the SVG display path', () => {
    const route = {
      networkId: 'rounded-sample-network',
      edgeId: 'rounded-sample-edge',
      type: 'cooling-primary-cold' as const,
      sourceNodeId: 'source',
      targetNodeId: 'target',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }],
      order: 0,
    }

    const sampled = bridgedPolylinePoints(route, [], 8, { cornerRadius: 8 }, 8)
    expect(sampled[0]).toEqual({ x: 0, y: 0 })
    expect(sampled.at(-1)).toEqual({ x: 16, y: 16 })
    expect(sampled).toContainEqual({ x: 8, y: 0 })
    expect(sampled).toContainEqual({ x: 16, y: 8 })
    expect(sampled.some((point) => point.x > 8 && point.x < 16 && point.y > 0 && point.y < 8))
      .toBe(true)
  })

  it('derives physical branches and keeps their elbows square', () => {
    const elbow = {
      networkId: 'cooling-branch-network',
      edgeId: 'elbow-edge',
      type: 'cooling-primary-cold' as const,
      sourceNodeId: 'source',
      targetNodeId: 'target',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }],
      order: 0,
    }
    const branch = {
      ...elbow,
      edgeId: 'branch-edge',
      sourceNodeId: 'branch-source',
      points: [{ x: 16, y: 0 }, { x: 32, y: 0 }],
      order: 1,
    }
    const branchKeys = connectionRouteBranchPointKeys([elbow, branch])
      .get(elbow.networkId)!

    expect(branchKeys).toEqual(new Set(['16,0']))
    expect(roundedOrthogonalPathData(elbow.points, 8, branchKeys))
      .toBe('M 0 0 L 16 0 L 16 16')
    expect(bridgedPathData(elbow, [], 8, {
      cornerRadius: 8,
      squareCornerPointKeys: branchKeys,
    }).linePath).toBe('M 0 0 L 16 0 L 16 16')
  })

  it('keeps a shared two-direction elbow round instead of treating overlap as a branch', () => {
    const route = {
      networkId: 'shared-elbow-network',
      edgeId: 'shared-a',
      type: 'cooling-secondary-cold' as const,
      sourceNodeId: 'source-a',
      targetNodeId: 'target-a',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }],
      order: 0,
    }
    const overlapping = {
      ...route,
      edgeId: 'shared-b',
      sourceNodeId: 'source-b',
      targetNodeId: 'target-b',
      order: 1,
    }
    const branchKeys = connectionRouteBranchPointKeys([route, overlapping])
      .get(route.networkId)!

    expect(branchKeys.size).toBe(0)
    expect(bridgedPathData(route, [], 8, {
      cornerRadius: 8,
      squareCornerPointKeys: branchKeys,
    }).linePath).toContain('A 8 8')
  })

  it('keeps an elbow square when a bridge arc is immediately adjacent', () => {
    const route = {
      networkId: 'bridge-adjacent-elbow-network',
      edgeId: 'bridge-adjacent-elbow-edge',
      type: 'cooling-primary-hot' as const,
      sourceNodeId: 'source',
      targetNodeId: 'target',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }],
      order: 0,
    }
    const rendered = bridgedPathData(route, [{
      x: 8,
      y: 0,
      bridgeEdgeId: route.edgeId,
      underEdgeId: 'under-edge',
    }], 8, { cornerRadius: 8 })

    expect(rendered.linePath).toBe(
      'M 0 0 L 16 0 L 16 16',
    )
  })

  it('merges ordinary electrical branches through implicit taps on one busbar', () => {
    const first = connectTerminals([], 'diagram-power', {
      kind: 'anchor', elementId: 'power-left', anchorId: 'electrical-left', type: 'electrical',
    }, {
      kind: 'busbar', busbarId: 'busbar-1', offset: 16,
      point: { x: 16, y: 0 }, type: 'electrical',
    })!
    const second = connectTerminals(first, 'diagram-power', {
      kind: 'anchor', elementId: 'power-right', anchorId: 'electrical-right', type: 'electrical',
    }, {
      kind: 'busbar', busbarId: 'busbar-1', offset: 64,
      point: { x: 64, y: 0 }, type: 'electrical',
    })!

    expect(second).toHaveLength(1)
    expect(second[0].type).toBe('electrical')
    expect(second[0].edges).toHaveLength(2)
    expect(second[0].nodes.filter((node) => node.kind === 'busbar-tap')).toHaveLength(2)
  })

  it('connects different busbars with an explicit ordinary edge and rejects self or duplicate links', () => {
    const source = {
      kind: 'busbar', busbarId: 'busbar-a', offset: 120,
      point: { x: 120, y: 0 }, type: 'electrical',
    } as const
    const target = {
      kind: 'busbar', busbarId: 'busbar-b', offset: 40,
      point: { x: 40, y: 80 }, type: 'electrical',
    } as const
    const linked = connectTerminals([], 'diagram-power', source, target)!

    expect(linked).toHaveLength(1)
    expect(linked[0].type).toBe('electrical')
    expect(linked[0].nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'busbar-tap', busbarId: 'busbar-a', offset: 120 }),
      expect.objectContaining({ kind: 'busbar-tap', busbarId: 'busbar-b', offset: 40 }),
    ]))
    expect(linked[0].edges).toHaveLength(1)
    expect(connectTerminals(linked, 'diagram-power', source, target)).toBeNull()
    expect(connectTerminals([], 'diagram-power', source, {
      ...target,
      busbarId: source.busbarId,
    })).toBeNull()
  })

  it('starts a new branch from an existing node and permits one explicit same-network cycle', () => {
    const existing: ConnectionNetwork = {
      id: 'node-source-network',
      diagramId: 'diagram-power',
      type: 'electrical',
      nodes: [
        { id: 'left', kind: 'element-anchor', elementId: 'left-device', anchorId: 'right-electrical' },
        { id: 'right', kind: 'element-anchor', elementId: 'right-device', anchorId: 'left-electrical' },
        { id: 'middle', kind: 'node', x: 80, y: 32 },
      ],
      edges: [{
        id: 'trunk',
        sourceNodeId: 'left',
        targetNodeId: 'right',
        routeNodeIds: ['middle'],
      }],
    }
    const source = {
      kind: 'node',
      networkId: existing.id,
      nodeId: 'middle',
      point: { x: 80, y: 32 },
      type: 'electrical',
    } as const
    const branched = connectTerminals([existing], 'diagram-power', source, {
      kind: 'anchor',
      elementId: 'branch-device',
      anchorId: 'left-electrical',
      type: 'electrical',
    })!

    expect(branched[0].edges).toHaveLength(2)
    expect(branched[0].nodes).toContainEqual(expect.objectContaining({
      kind: 'element-anchor',
      elementId: 'branch-device',
    }))
    const cycled = connectTerminals(branched, 'diagram-power', source, {
      kind: 'anchor',
      elementId: 'right-device',
      anchorId: 'left-electrical',
      type: 'electrical',
    })!
    expect(cycled[0].edges).toHaveLength(3)
    expect(connectTerminals(cycled, 'diagram-power', source, {
      kind: 'anchor',
      elementId: 'right-device',
      anchorId: 'left-electrical',
      type: 'electrical',
    })).toBeNull()
  })

  it.each(['horizontal', 'vertical'] as const)('routes straight outward from both %s busbar ends in either edge direction', (orientation) => {
    const busbar: Busbar = {
      id: 'end-busbar', diagramId: 'diagram-power', type: 'electrical',
      orientation, x: 0, y: 0, length: 160,
    }
    for (const offset of [0, 160]) {
      const outside = offset === 0 ? -80 : 240
      const point = orientation === 'horizontal' ? { x: outside, y: 0 } : { x: 0, y: outside }
      const tap = orientation === 'horizontal' ? { x: offset, y: 0 } : { x: 0, y: offset }
      for (const reverse of [false, true]) {
        const network: ConnectionNetwork = {
          id: 'end-network', diagramId: 'diagram-power', type: 'electrical',
          nodes: [
            { id: 'tap', kind: 'busbar-tap', busbarId: busbar.id, offset },
            { id: 'free', kind: 'node', ...point },
          ],
          edges: [{ id: 'end-edge', sourceNodeId: reverse ? 'free' : 'tap', targetNodeId: reverse ? 'tap' : 'free' }],
        }
        const routed = routeConnectionNetworks([network], [], [], 8, [busbar])
        expect(routed.edges[0]?.points).toEqual(reverse ? [point, tap] : [tap, point])
      }
    }
  })

  it('merges busbar networks through a child line and splits them after that line is deleted', () => {
    const busbarA: Busbar = {
      id: 'busbar-network-a', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const busbarB: Busbar = {
      id: 'busbar-network-b', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 160, length: 160,
    }
    const deviceA = powerElement('network-device-a', 0, 48)
    const deviceB = powerElement('network-device-b', 96, 240)
    const withA = connectTerminals([], 'diagram-power', {
      kind: 'anchor', elementId: deviceA.id, anchorId: 'top-electrical', type: 'electrical',
    }, {
      kind: 'busbar', busbarId: busbarA.id, offset: 32,
      point: { x: 32, y: 0 }, type: 'electrical',
    })!
    const separate = connectTerminals(withA, 'diagram-power', {
      kind: 'anchor', elementId: deviceB.id, anchorId: 'top-electrical', type: 'electrical',
    }, {
      kind: 'busbar', busbarId: busbarB.id, offset: 128,
      point: { x: 128, y: 160 }, type: 'electrical',
    })!
    expect(separate).toHaveLength(2)

    const merged = connectTerminals(separate, 'diagram-power', {
      kind: 'busbar', busbarId: busbarA.id, offset: 80,
      point: { x: 80, y: 0 }, type: 'electrical',
    }, {
      kind: 'busbar', busbarId: busbarB.id, offset: 80,
      point: { x: 80, y: 160 }, type: 'electrical',
    })!
    expect(merged).toHaveLength(1)
    expect(merged[0].edges).toHaveLength(3)
    const nodesById = new Map(merged[0].nodes.map((node) => [node.id, node]))
    const childEdge = merged[0].edges.find((edge) => {
      const source = nodesById.get(edge.sourceNodeId)
      const target = nodesById.get(edge.targetNodeId)
      return source?.kind === 'busbar-tap' && target?.kind === 'busbar-tap' &&
        source.busbarId !== target.busbarId
    })
    expect(childEdge).toBeDefined()

    const split = deleteConnectionEdge(
      merged,
      childEdge!.id,
      [deviceA, deviceB],
      [directionalElectricalAsset],
      [busbarA, busbarB],
    )
    expect(split).toHaveLength(2)
    expect(split.every((network) => network.edges.length === 1)).toBe(true)
  })

  it('routes ordinary wires over a busbar with a bridge and avoids collinear overlap', () => {
    const busbar: Busbar = {
      id: 'busbar-bridge', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 80,
    }
    const crossingNetwork: ConnectionNetwork = {
      id: 'crossing-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'top', kind: 'element-anchor', elementId: 'busbar-top', anchorId: 'bottom-electrical' },
        { id: 'bottom', kind: 'element-anchor', elementId: 'busbar-bottom', anchorId: 'top-electrical' },
      ],
      edges: [{ id: 'crossing-edge', sourceNodeId: 'top', targetNodeId: 'bottom' }],
    }
    const top = powerElement('busbar-top', 8, -104)
    const bottom = powerElement('busbar-bottom', 8, 40)
    const crossing = routeConnectionNetworks(
      [crossingNetwork],
      [top, bottom],
      [directionalElectricalAsset],
      8,
      [busbar],
    )

    expect(crossing.crossings).toContainEqual({
      x: 40,
      y: 0,
      bridgeEdgeId: 'crossing-edge',
      underEdgeId: 'busbar:busbar-bridge',
    })
    expect(pathDataWithBridges(crossing.edges[0], crossing.crossings, 8))
      .not.toContain(' A ')
    expect(bridgedPathData(crossing.edges[0], crossing.crossings, 8).bridgeCasingPath)
      .not.toBe('')

    const collinearNetwork: ConnectionNetwork = {
      ...crossingNetwork,
      id: 'collinear-network',
      nodes: [
        { id: 'left', kind: 'element-anchor', elementId: 'busbar-left', anchorId: 'right-electrical' },
        { id: 'right', kind: 'element-anchor', elementId: 'busbar-right', anchorId: 'left-electrical' },
      ],
      edges: [{ id: 'collinear-edge', sourceNodeId: 'left', targetNodeId: 'right' }],
    }
    const left = powerElement('busbar-left', -64, -32)
    const right = powerElement('busbar-right', 80, -32)
    const collinear = routeConnectionNetworks(
      [collinearNetwork],
      [left, right],
      [directionalElectricalAsset],
      8,
      [busbar],
    )
    expect(collinear.invalidEdgeIds).toEqual([])
    expect(collinear.edges[0].points.some((point) => point.y !== 0)).toBe(true)
  })

  it('treats the persisted busbar node offset as its authoritative route endpoint', () => {
    const busbar: Busbar = {
      id: 'busbar-sliding', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const device = powerElement('device', 8, 80)
    const network: ConnectionNetwork = {
      id: 'sliding-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'device-anchor', kind: 'element-anchor',
          elementId: device.id, anchorId: 'top-electrical',
        },
        {
          id: 'sliding-tap', kind: 'busbar-tap',
          busbarId: busbar.id, offset: 120,
        },
      ],
      edges: [{ id: 'sliding-edge', sourceNodeId: 'device-anchor', targetNodeId: 'sliding-tap' }],
    }

    const routed = routeConnectionNetworks(
      [network],
      [device],
      [directionalElectricalAsset],
      8,
      [busbar],
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.resolvedBusbarTapOffsets['sliding-tap']).toBe(120)
    expect(routed.edges[0].points[0]).toEqual({ x: 40, y: 80 })
    expect(routed.edges[0].points.at(-1)).toEqual({ x: 120, y: 0 })
  })

  it('keeps distinct persisted nodes on opposite sides of a horizontal busbar', () => {
    const busbar: Busbar = {
      id: 'opposite-side-busbar', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 80, length: 160,
    }
    const upper = powerElement('upper-device', 8, 0)
    const lower = powerElement('lower-device', 8, 96)
    const network: ConnectionNetwork = {
      id: 'opposite-side-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'upper-anchor', kind: 'element-anchor',
          elementId: upper.id, anchorId: 'bottom-electrical',
        },
        { id: 'upper-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 16 },
        {
          id: 'lower-anchor', kind: 'element-anchor',
          elementId: lower.id, anchorId: 'top-electrical',
        },
        { id: 'lower-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 120 },
      ],
      edges: [
        { id: 'upper-edge', sourceNodeId: 'upper-anchor', targetNodeId: 'upper-tap' },
        { id: 'lower-edge', sourceNodeId: 'lower-anchor', targetNodeId: 'lower-tap' },
      ],
    }

    const routed = routeConnectionNetworks(
      [network],
      [upper, lower],
      [directionalElectricalAsset],
      8,
      [busbar],
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.resolvedBusbarTapOffsets).toMatchObject({
      'upper-tap': 16,
      'lower-tap': 120,
    })
    expect(routed.edges.map((edge) => edge.points.at(-1))).toEqual([
      { x: 16, y: 80 },
      { x: 120, y: 80 },
    ])
  })

  it('keeps distinct persisted nodes on opposite sides of a vertical busbar', () => {
    const busbar: Busbar = {
      id: 'vertical-opposite-side-busbar', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'vertical', x: 80, y: 0, length: 160,
    }
    const left = powerElement('left-device', 0, 8)
    const right = powerElement('right-device', 96, 8)
    const network: ConnectionNetwork = {
      id: 'vertical-opposite-side-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'left-anchor', kind: 'element-anchor',
          elementId: left.id, anchorId: 'right-electrical',
        },
        { id: 'left-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 16 },
        {
          id: 'right-anchor', kind: 'element-anchor',
          elementId: right.id, anchorId: 'left-electrical',
        },
        { id: 'right-tap', kind: 'busbar-tap', busbarId: busbar.id, offset: 120 },
      ],
      edges: [
        { id: 'left-edge', sourceNodeId: 'left-anchor', targetNodeId: 'left-tap' },
        { id: 'right-edge', sourceNodeId: 'right-anchor', targetNodeId: 'right-tap' },
      ],
    }

    const routed = routeConnectionNetworks(
      [network],
      [left, right],
      [directionalElectricalAsset],
      8,
      [busbar],
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.resolvedBusbarTapOffsets).toMatchObject({
      'left-tap': 16,
      'right-tap': 120,
    })
    expect(routed.edges.map((edge) => edge.points.at(-1))).toEqual([
      { x: 80, y: 16 },
      { x: 80, y: 120 },
    ])
  })

  it('routes between two busbars without changing either persisted node', () => {
    const sourceBusbar: Busbar = {
      id: 'joint-source', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const targetBusbar: Busbar = {
      id: 'joint-target', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 80, length: 160,
    }
    const network: ConnectionNetwork = {
      id: 'joint-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'joint-source-tap', kind: 'busbar-tap', busbarId: sourceBusbar.id, offset: 120 },
        { id: 'joint-target-tap', kind: 'busbar-tap', busbarId: targetBusbar.id, offset: 40 },
      ],
      edges: [{ id: 'joint-edge', sourceNodeId: 'joint-source-tap', targetNodeId: 'joint-target-tap' }],
    }

    const routed = routeConnectionNetworks(
      [network],
      [],
      [],
      8,
      [sourceBusbar, targetBusbar],
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.resolvedBusbarTapOffsets).toMatchObject({
      'joint-source-tap': 120,
      'joint-target-tap': 40,
    })
    expect(routed.edges[0].points[0]).toEqual({ x: 120, y: 0 })
    expect(routed.edges[0].points.at(-1)).toEqual({ x: 40, y: 80 })
  })

  it('keeps parallel child-line endpoints at their persisted offsets', () => {
    const sourceBusbar: Busbar = {
      id: 'parallel-source', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const targetBusbar: Busbar = {
      id: 'parallel-target', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 80, length: 160,
    }
    const network: ConnectionNetwork = {
      id: 'parallel-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'first-source', kind: 'busbar-tap', busbarId: sourceBusbar.id, offset: 16 },
        { id: 'first-target', kind: 'busbar-tap', busbarId: targetBusbar.id, offset: 80 },
        { id: 'second-source', kind: 'busbar-tap', busbarId: sourceBusbar.id, offset: 40 },
        { id: 'second-target', kind: 'busbar-tap', busbarId: targetBusbar.id, offset: 16 },
      ],
      edges: [
        { id: 'first-child', sourceNodeId: 'first-source', targetNodeId: 'first-target' },
        { id: 'second-child', sourceNodeId: 'second-source', targetNodeId: 'second-target' },
      ],
    }

    const routed = routeConnectionNetworks(
      [network],
      [],
      [],
      8,
      [sourceBusbar, targetBusbar],
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.edges[0].points[0].x).toBe(16)
    expect(routed.edges[1].points[0].x).toBe(40)
    expect(routed.edges[0].points[0].x).not.toBe(routed.edges[1].points[0].x)
  })

  it('enters each busbar perpendicularly when joint routing differently oriented busbars', () => {
    const horizontal: Busbar = {
      id: 'joint-horizontal', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 160,
    }
    const vertical: Busbar = {
      id: 'joint-vertical', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'vertical', x: 160, y: 80, length: 160,
    }
    const network: ConnectionNetwork = {
      id: 'joint-turn-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        { id: 'horizontal-tap', kind: 'busbar-tap', busbarId: horizontal.id, offset: 80 },
        { id: 'vertical-tap', kind: 'busbar-tap', busbarId: vertical.id, offset: 80 },
      ],
      edges: [{ id: 'joint-turn-edge', sourceNodeId: 'horizontal-tap', targetNodeId: 'vertical-tap' }],
    }

    const routed = routeConnectionNetworks([network], [], [], 8, [horizontal, vertical])

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.resolvedBusbarTapOffsets).toMatchObject({
      'horizontal-tap': 80,
      'vertical-tap': 80,
    })
    expect(routed.edges[0].points[0]).toEqual({ x: 80, y: 0 })
    expect(routed.edges[0].points.at(-1)).toEqual({ x: 160, y: 160 })
  })

  it('prefers an equal-length route that follows both anchor directions before meeting', () => {
    const source = powerElement('direction-source', 0, 0)
    const target = powerElement('direction-target', 160, 128)
    const network: ConnectionNetwork = {
      id: 'direction-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'source-anchor', kind: 'element-anchor',
          elementId: source.id, anchorId: 'bottom-electrical',
        },
        {
          id: 'target-anchor', kind: 'element-anchor',
          elementId: target.id, anchorId: 'left-electrical',
        },
      ],
      edges: [{ id: 'direction-edge', sourceNodeId: 'source-anchor', targetNodeId: 'target-anchor' }],
    }

    const routed = routeConnectionNetworks(
      [network],
      [source, target],
      [directionalElectricalAsset],
      8,
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.edges[0].points).toEqual([
      { x: 32, y: 64 },
      { x: 32, y: 160 },
      { x: 160, y: 160 },
    ])
  })

  it('allows a route to turn at an element anchor without a perpendicular lead segment', () => {
    const source = powerElement('free-turn-source', 0, 0)
    const target = powerElement('free-turn-target', 160, 32)
    const network: ConnectionNetwork = {
      id: 'free-turn-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'source-anchor', kind: 'element-anchor',
          elementId: source.id, anchorId: 'bottom-electrical',
        },
        {
          id: 'target-anchor', kind: 'element-anchor',
          elementId: target.id, anchorId: 'left-electrical',
        },
      ],
      edges: [{ id: 'free-turn-edge', sourceNodeId: 'source-anchor', targetNodeId: 'target-anchor' }],
    }

    const routed = routeConnectionNetworks(
      [network],
      [source, target],
      [directionalElectricalAsset],
      8,
    )

    expect(routed.invalidEdgeIds).toEqual([])
    expect(routed.edges[0].points).toEqual([
      { x: 32, y: 64 },
      { x: 160, y: 64 },
    ])
  })

  it('keeps an exactly overlapping non-endpoint element as a hard obstacle', () => {
    const source = powerElement('overlapped-source', 0, 0)
    const blocker = powerElement('exact-overlap-blocker', 0, 0)
    const target = powerElement('overlapped-target', 160, 32)
    const network: ConnectionNetwork = {
      id: 'exact-overlap-network', diagramId: 'diagram-power', type: 'electrical',
      nodes: [
        {
          id: 'source-anchor', kind: 'element-anchor',
          elementId: source.id, anchorId: 'bottom-electrical',
        },
        {
          id: 'target-anchor', kind: 'element-anchor',
          elementId: target.id, anchorId: 'left-electrical',
        },
      ],
      edges: [{ id: 'exact-overlap-edge', sourceNodeId: 'source-anchor', targetNodeId: 'target-anchor' }],
    }

    const routed = routeConnectionNetworks(
      [network],
      [source, blocker, target],
      [directionalElectricalAsset],
      8,
    )

    expect(routed.edges).toEqual([])
    expect(routed.invalidEdgeIds).toEqual(['exact-overlap-edge'])
  })

  it('removes busbar branches and cleans empty networks when the busbar is deleted', () => {
    const busbar: Busbar = {
      id: 'busbar-delete', diagramId: 'diagram-power', type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 80,
    }
    const network = connectTerminals([], 'diagram-power', {
      kind: 'anchor', elementId: 'power-device', anchorId: 'right-cold', type: 'electrical',
    }, {
      kind: 'busbar', busbarId: busbar.id, offset: 40,
      point: { x: 40, y: 0 }, type: 'electrical',
    })!
    const electricalAsset: AssetDefinition = {
      ...coolingAsset,
      anchors: [{ ...coolingAsset.anchors[1], type: 'electrical' }],
    }
    const powerDevice = {
      ...element('power-device', 120, 0),
      diagramId: 'diagram-power',
    }

    expect(deleteBusbarConnections(
      network,
      busbar.id,
      [powerDevice],
      [electricalAsset],
      [],
    )).toEqual([])
  })
})
