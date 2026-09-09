import { describe, expect, it } from 'vitest'

import type { ConnectionNetwork } from '../domain/project'
import { COOLING_PIPE_BRIDGE_RADIUS } from './connectionAppearance'
import type { RoutedConnectionEdge } from './connections'
import {
  createConnectedAnchorIdsByElement,
  createConnectionRouteRenderGroups,
  createCoolingNodeIdsByNetwork,
  createCoolingPipeFilterIds,
  createCoolingPipeShellsByRenderKey,
  createDisplayedRoutePaths,
  createRenderedConnectionPaths,
  createStaticConnectionGroupsByRenderKey,
  createUnderpassAnimationExclusions,
} from './connectionScene'

const coolingNetwork: ConnectionNetwork = {
  id: 'cooling-network',
  diagramId: 'diagram-1',
  type: 'cooling-primary-hot',
  nodes: [
    { id: 'anchor-a', kind: 'element-anchor', elementId: 'pump-a', anchorId: 'out' },
    { id: 'node-a', kind: 'node', x: 80, y: 0 },
    { id: 'node-b', kind: 'node', x: 160, y: 0 },
    { id: 'anchor-unused', kind: 'element-anchor', elementId: 'pump-a', anchorId: 'in' },
  ],
  edges: [
    {
      id: 'cooling-primary',
      sourceNodeId: 'anchor-a',
      targetNodeId: 'node-a',
      coolingLineRole: 'primary',
    },
    {
      id: 'cooling-secondary',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      coolingLineRole: 'auxiliary',
      crossingLayer: 'upper',
    },
  ],
}

const routes: RoutedConnectionEdge[] = [
  {
    networkId: coolingNetwork.id,
    edgeId: 'cooling-primary',
    type: coolingNetwork.type,
    sourceNodeId: 'anchor-a',
    targetNodeId: 'node-a',
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
    order: 0,
  },
  {
    networkId: coolingNetwork.id,
    edgeId: 'cooling-secondary',
    type: coolingNetwork.type,
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    points: [{ x: 80, y: 0 }, { x: 160, y: 0 }],
    order: 1,
  },
]

const edgesById = new Map(coolingNetwork.edges.map((edge) => [edge.id, edge]))

describe('connection scene model', () => {
  it('keeps different configured pipe colors separate within one network', () => {
    const coloredEdges = new Map(coolingNetwork.edges.map((edge, index) => [edge.id, {
      ...edge,
      coolingLineRole: 'primary' as const,
      crossingLayer: undefined,
      color: index === 0 ? '#123456' : '#ABCDEF',
    }]))
    const groups = createConnectionRouteRenderGroups(routes, coloredEdges)
    expect(groups.map((group) => ({
      color: group.color,
      edges: group.routes.map((route) => route.edgeId),
    }))).toEqual([
      { color: '#123456', edges: ['cooling-primary'] },
      { color: '#ABCDEF', edges: ['cooling-secondary'] },
    ])
  })

  it('creates stable render buckets and cooling filter identities', () => {
    const groups = createConnectionRouteRenderGroups(routes, edgesById)

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.renderKey)).toEqual(expect.arrayContaining([
      'cooling-network:primary:auto',
      'cooling-network:auxiliary:upper',
    ]))
    expect(createCoolingPipeFilterIds(groups, (index) => `filter-${index}`))
      .toEqual(new Map(groups.map((group, index) => [group.renderKey, `filter-${index}`])))
  })

  it('derives roundable nodes, connected anchors, and bridge exclusions once', () => {
    expect(createCoolingNodeIdsByNetwork([coolingNetwork]).get(coolingNetwork.id))
      .toEqual(new Set(['node-a', 'node-b']))
    expect(createConnectedAnchorIdsByElement([coolingNetwork]).get('pump-a'))
      .toEqual(new Set(['out']))

    const exclusions = createUnderpassAnimationExclusions(routes, [{
      x: 40,
      y: 0,
      bridgeEdgeId: 'cooling-primary',
      underEdgeId: 'cooling-secondary',
    }], 8)
    expect(exclusions.get('cooling-secondary')).toEqual([{
      point: expect.objectContaining({ x: 40, y: 0 }),
      radius: COOLING_PIPE_BRIDGE_RADIUS,
    }])
  })

  it('builds matching displayed and static connection flow groups', () => {
    const groups = createConnectionRouteRenderGroups(routes, edgesById)
    const displayed = createDisplayedRoutePaths(
      routes,
      edgesById,
      new Map(),
      new Map(),
      new Map(),
      8,
    )
    const primary = displayed.get('cooling-primary')!.path
    const secondary = displayed.get('cooling-secondary')!.path

    expect(primary).toMatchObject({
      connectionEdgeId: 'cooling-primary',
      style: 'cooling',
      points: routes[0].points,
    })
    expect(primary.worldWidth).toBeGreaterThan(secondary.worldWidth!)

    const staticGroups = createStaticConnectionGroupsByRenderKey(
      groups,
      [primary],
      [secondary],
    )
    expect([...staticGroups.values()].flat()).toHaveLength(2)
    const dots = createStaticConnectionGroupsByRenderKey(groups, [primary, secondary], [], 'dots')
    const inactive = createStaticConnectionGroupsByRenderKey(groups, [], [primary, secondary])
    expect(dots).toEqual(inactive)
    expect(createStaticConnectionGroupsByRenderKey(groups, [primary, secondary], [], 'wave')).not.toEqual(dots)
    expect([...staticGroups.values()].flat().every((group) => (
      group.kind === 'connection'
    ))).toBe(true)
  })

  it('shares bridge and cooling-shell derivation while retaining optional caches', () => {
    const groups = createConnectionRouteRenderGroups(routes, edgesById)
    const renderedCache = new Map()
    const firstRendered = createRenderedConnectionPaths(
      routes,
      routes,
      new Map(),
      new Map(),
      new Map(),
      8,
      renderedCache,
    )
    const secondRendered = createRenderedConnectionPaths(
      routes,
      routes,
      new Map(),
      new Map(),
      new Map(),
      8,
      renderedCache,
    )

    expect(renderedCache).toHaveLength(2)
    expect(secondRendered.get('cooling-primary'))
      .toBe(firstRendered.get('cooling-primary'))

    const shellCache = new Map()
    const shells = createCoolingPipeShellsByRenderKey(
      groups,
      routes,
      new Map([[coolingNetwork.id, coolingNetwork]]),
      new Map(),
      new Map(),
      new Map(),
      8,
      shellCache,
    )
    const primaryShell = shells.get('cooling-network:primary:auto')!

    expect(shellCache).toHaveLength(2)
    expect(primaryShell.path).not.toBe('')
    expect(primaryShell.points.slice(0, 2)).toEqual(routes[0].points)
  })
})
