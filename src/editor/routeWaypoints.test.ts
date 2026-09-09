import { describe, expect, it } from 'vitest'

import type { ConnectionNetwork, RouteWaypoint } from '../domain/project'
import type { RoutedConnectionEdge } from './connections'
import {
  applyDraggedRouteSegment,
  atomicRouteSegments,
  clearRouteWaypointsForEdges,
  deleteRouteWaypoints,
  draggedRouteSegmentAlignsWithExistingRoute,
  removeFoldbackRouteWaypoints,
  snapDraggedRouteSegmentDelta,
} from './routeWaypoints'

const route = (edgeId: string): RoutedConnectionEdge => ({
  networkId: 'network-a',
  edgeId,
  type: 'electrical',
  sourceNodeId: `${edgeId}-source`,
  targetNodeId: `${edgeId}-target`,
  order: edgeId === 'edge-a' ? 0 : 1,
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 80 },
    { x: 120, y: 80 },
  ],
})

const network = (routeNodeIds?: string[]): ConnectionNetwork => ({
  id: 'network-a',
  diagramId: 'diagram-a',
  type: 'electrical',
  nodes: [
    { id: 'edge-a-source', kind: 'busbar-tap', busbarId: 'source', offset: 0 },
    { id: 'edge-a-target', kind: 'busbar-tap', busbarId: 'target', offset: 0 },
    { id: 'edge-b-source', kind: 'busbar-tap', busbarId: 'source', offset: 8 },
    { id: 'edge-b-target', kind: 'busbar-tap', busbarId: 'target', offset: 8 },
  ],
  edges: [
    {
      id: 'edge-a',
      sourceNodeId: 'edge-a-source',
      targetNodeId: 'edge-a-target',
      routeNodeIds,
    },
    {
      id: 'edge-b',
      sourceNodeId: 'edge-b-source',
      targetNodeId: 'edge-b-target',
      routeNodeIds,
    },
  ],
})

describe('manual route waypoints', () => {
  it('prefers an adjacent route coordinate when snapping a dragged segment', () => {
    const foldedRoute: RoutedConnectionEdge = {
      networkId: 'network-a',
      edgeId: 'edge-a',
      type: 'cooling-general',
      sourceNodeId: 'source',
      targetNodeId: 'target',
      order: 0,
      points: [
        { x: 448, y: 656 },
        { x: 448, y: 712 },
        { x: 1008, y: 712 },
        { x: 1000, y: 712 },
        { x: 1000, y: 688 },
        { x: 1008, y: 688 },
      ],
    }
    const segment = atomicRouteSegments([foldedRoute]).find((candidate) => (
      candidate.orientation === 'vertical' && candidate.start.x === 1000
    ))!

    expect(snapDraggedRouteSegmentDelta(segment, [foldedRoute], 8, 16)).toBe(8)
    expect(snapDraggedRouteSegmentDelta(segment, [foldedRoute], 2, 16)).toBe(0)
    expect(draggedRouteSegmentAlignsWithExistingRoute(segment, [foldedRoute], 8)).toBe(true)
    expect(draggedRouteSegmentAlignsWithExistingRoute(segment, [foldedRoute], 16)).toBe(false)
  })

  it('removes an exclusive waypoint that makes the routed line reverse onto itself', () => {
    const foldedNetwork: ConnectionNetwork = {
      id: 'fold-network',
      diagramId: 'diagram-a',
      type: 'cooling-general',
      nodes: [
        { id: 'source', kind: 'element-anchor', elementId: 'source', anchorId: 'bottom' },
        { id: 'target', kind: 'element-anchor', elementId: 'target', anchorId: 'left' },
        { id: 'left-node', kind: 'node', x: 224, y: 296 },
        { id: 'overshoot-node', kind: 'node', x: 608, y: 296 },
      ],
      edges: [{
        id: 'fold-edge',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        routeNodeIds: ['left-node', 'overshoot-node'],
      }],
    }
    const foldedRoute: RoutedConnectionEdge = {
      networkId: foldedNetwork.id,
      edgeId: 'fold-edge',
      type: foldedNetwork.type,
      sourceNodeId: 'source',
      targetNodeId: 'target',
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

    const result = removeFoldbackRouteWaypoints(
      [foldedNetwork],
      [
        { id: 'left-node', x: 224, y: 296 },
        { id: 'overshoot-node', x: 608, y: 296 },
      ],
      [foldedRoute],
    )

    expect(result.removedWaypointIds).toEqual(['overshoot-node'])
    expect('routeNodeIds' in result.networks[0].edges[0]
      ? result.networks[0].edges[0].routeNodeIds
      : undefined).toEqual(['left-node'])
    expect(result.networks[0].nodes.map((node) => node.id)).toEqual([
      'source',
      'target',
      'left-node',
    ])
    expect(result.routeWaypoints).toEqual([{ id: 'left-node', x: 224, y: 296 }])
  })

  it('turns an overlapping displayed segment into one shared draggable segment', () => {
    const shared = atomicRouteSegments([route('edge-a'), route('edge-b')]).find((segment) => (
      segment.start.x === 40 && segment.start.y === 0 &&
      segment.end.x === 40 && segment.end.y === 80
    ))

    expect(shared?.edgeIds).toEqual(['edge-a', 'edge-b'])
    expect(shared?.orientation).toBe('vertical')
  })

  it('creates one shared waypoint pair and preserves its source-to-target order', () => {
    let id = 0
    const vertical = atomicRouteSegments([route('edge-a'), route('edge-b')]).find((segment) => (
      segment.orientation === 'vertical'
    ))!
    const result = applyDraggedRouteSegment(
      [network()],
      [],
      [route('edge-a'), route('edge-b')],
      vertical,
      { x: 56, y: 0 },
      { x: 56, y: 80 },
      () => `waypoint-${id++}`,
    )

    expect(result.routeWaypoints).toEqual([
      { id: 'waypoint-0', x: 56, y: 0 },
      { id: 'waypoint-1', x: 56, y: 80 },
    ])
    expect(result.networks[0].edges.map((edge) => (
      'routeNodeIds' in edge ? edge.routeNodeIds : undefined
    ))).toEqual([
      ['waypoint-0', 'waypoint-1'],
      ['waypoint-0', 'waypoint-1'],
    ])
  })

  it('moves existing node-bounded segment endpoints without creating duplicate nodes', () => {
    const nodeBoundedNetwork: ConnectionNetwork = {
      id: 'network-a',
      diagramId: 'diagram-a',
      type: 'electrical',
      nodes: [
        { id: 'left-node', kind: 'node', x: 40, y: 80 },
        { id: 'right-node', kind: 'node', x: 120, y: 80 },
      ],
      edges: [{ id: 'edge-a', sourceNodeId: 'left-node', targetNodeId: 'right-node' }],
    }
    const nodeBoundedRoute: RoutedConnectionEdge = {
      networkId: 'network-a',
      edgeId: 'edge-a',
      type: 'electrical',
      sourceNodeId: 'left-node',
      targetNodeId: 'right-node',
      order: 0,
      points: [{ x: 40, y: 80 }, { x: 120, y: 80 }],
    }
    const segment = atomicRouteSegments([nodeBoundedRoute])[0]
    let generated = 0
    const result = applyDraggedRouteSegment(
      [nodeBoundedNetwork],
      [],
      [nodeBoundedRoute],
      segment,
      { x: 40, y: 40 },
      { x: 120, y: 40 },
      () => `unexpected-node-${++generated}`,
    )

    expect(generated).toBe(0)
    expect(result.waypointIds).toEqual(['left-node', 'right-node'])
    expect(result.networks[0].nodes).toEqual([
      { id: 'left-node', kind: 'node', x: 40, y: 40 },
      { id: 'right-node', kind: 'node', x: 120, y: 40 },
    ])
    expect(result.networks[0].edges).toEqual([
      { id: 'edge-a', sourceNodeId: 'left-node', targetNodeId: 'right-node' },
    ])
  })

  it('deletes shared points from every reference and garbage-collects them', () => {
    const waypoints: RouteWaypoint[] = [
      { id: 'shared', x: 40, y: 0 },
      { id: 'retained', x: 40, y: 80 },
    ]
    const deleted = deleteRouteWaypoints(
      [network(['shared', 'retained'])],
      waypoints,
      new Set(['shared']),
    )

    expect(deleted.networks[0].edges.map((edge) => (
      'routeNodeIds' in edge ? edge.routeNodeIds : undefined
    ))).toEqual([
      ['retained'],
      ['retained'],
    ])
    expect(deleted.routeWaypoints).toEqual([{ id: 'retained', x: 40, y: 80 }])
  })

  it('restores only selected edges to automatic routing and retains shared points still in use', () => {
    const waypoints: RouteWaypoint[] = [{ id: 'shared', x: 40, y: 0 }]
    const cleared = clearRouteWaypointsForEdges(
      [network(['shared'])],
      waypoints,
      new Set(['edge-a']),
    )

    expect('routeNodeIds' in cleared.networks[0].edges[0]
      ? cleared.networks[0].edges[0].routeNodeIds
      : undefined).toBeUndefined()
    expect('routeNodeIds' in cleared.networks[0].edges[1]
      ? cleared.networks[0].edges[1].routeNodeIds
      : undefined).toEqual(['shared'])
    expect(cleared.routeWaypoints).toEqual(waypoints)
  })
})
