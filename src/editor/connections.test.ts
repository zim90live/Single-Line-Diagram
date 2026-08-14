import { describe, expect, it } from 'vitest'

import type {
  AssetDefinition,
  Busbar,
  ConnectionNetwork,
  DiagramElement,
} from '../domain/project'
import {
  connectTerminals,
  connectionTypesCompatible,
  crossingPointKeys,
  deleteConnectionEdge,
  deleteBusbarConnections,
  pathDataWithBridges,
  previewConnectionRoutesForDiagram,
  previewConnectionRoutesForElements,
  resolveElementAnchor,
  routeConnectionNetworks,
  routeConnectionPreview,
  routeOrthogonalGrid,
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
    expect(withoutSpecializedBranch[0].type).toBe('cooling-general')
    expect(withoutSpecializedBranch[0].edges).toHaveLength(1)
  })

  it('reuses a shared path and derives an unmarked branch for repeated anchor wiring', () => {
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
      expect(edge.points.slice(1)).toContainEqual(original.points[1])
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
    expect(pathDataWithBridges(routed.edges[1], routed.crossings, 8)).toContain(' Q ')
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
    expect(pathDataWithBridges(crossing.edges[0], crossing.crossings, 8)).toContain(' Q ')

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

  it('slides a busbar tap to the shortest legal grid position by default', () => {
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
    expect(routed.resolvedBusbarTapOffsets['sliding-tap']).toBe(40)
    expect(routed.edges[0].points).toEqual([
      { x: 40, y: 80 },
      { x: 40, y: 0 },
    ])
  })

  it('jointly slides both child-line taps to the shortest stable busbar positions', () => {
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
      'joint-source-tap': 40,
      'joint-target-tap': 40,
    })
    expect(routed.edges[0].points).toEqual([
      { x: 40, y: 0 },
      { x: 40, y: 80 },
    ])
  })

  it('jointly repositions later child lines instead of overlapping an occupied route', () => {
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
    expect(routed.edges[1].points[0].x).toBe(24)
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
      'horizontal-tap': 152,
      'vertical-tap': 0,
    })
    expect(routed.edges[0].points).toEqual([
      { x: 152, y: 0 },
      { x: 152, y: 80 },
      { x: 160, y: 80 },
    ])
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
