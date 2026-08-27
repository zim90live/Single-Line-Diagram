import { describe, expect, it } from 'vitest'

import type { RoutedConnectionEdge } from './connections'
import { derivedRouteCornerCandidateAtPointer } from './routeCornerCandidates'

function route(
  edgeId: string,
  networkId: string,
  points: RoutedConnectionEdge['points'],
  order = 0,
): RoutedConnectionEdge {
  return {
    networkId,
    edgeId,
    type: 'cooling-primary-cold',
    sourceNodeId: `${edgeId}-source`,
    targetNodeId: `${edgeId}-target`,
    points,
    order,
  }
}

describe('derived route corner candidates', () => {
  it('finds a nearby orthogonal bend without treating straight points as candidates', () => {
    const bent = route('bent', 'network-a', [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 64 },
    ])
    const straight = route('straight', 'network-a', [
      { x: 0, y: 32 },
      { x: 40, y: 32 },
      { x: 80, y: 32 },
    ])

    expect(derivedRouteCornerCandidateAtPointer({
      routes: [bent, straight],
      networkId: 'network-a',
      edgeId: 'bent',
      pointer: { x: 77, y: 2 },
      maxDistance: 6,
    })).toEqual({
      networkId: 'network-a',
      point: { x: 80, y: 0 },
      edgeIds: ['bent'],
      type: 'cooling-primary-cold',
    })
    expect(derivedRouteCornerCandidateAtPointer({
      routes: [straight],
      networkId: 'network-a',
      edgeId: 'straight',
      pointer: { x: 40, y: 32 },
      maxDistance: 6,
    })).toBeNull()
  })

  it('groups only routes that share the same connected turn geometry', () => {
    const sharedA = route('shared-a', 'network-a', [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 64 },
    ], 2)
    const sharedB = route('shared-b', 'network-a', [
      { x: 16, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 48 },
    ], 1)
    const differentTurn = route('different-turn', 'network-a', [
      { x: 80, y: -32 },
      { x: 80, y: 0 },
      { x: 128, y: 0 },
    ])
    const otherNetwork = route('other-network', 'network-b', sharedA.points)

    expect(derivedRouteCornerCandidateAtPointer({
      routes: [sharedA, sharedB, differentTurn, otherNetwork],
      networkId: 'network-a',
      edgeId: 'shared-a',
      pointer: { x: 80, y: 0 },
      maxDistance: 6,
    })?.edgeIds).toEqual(['shared-b', 'shared-a'])
  })

  it('does not derive a candidate over an existing topological point', () => {
    const bent = route('bent', 'network-a', [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 64 },
    ])

    expect(derivedRouteCornerCandidateAtPointer({
      routes: [bent],
      networkId: 'network-a',
      edgeId: 'bent',
      pointer: { x: 80, y: 0 },
      maxDistance: 6,
      excludedPoints: [{ x: 80, y: 0 }],
    })).toBeNull()
  })
})
