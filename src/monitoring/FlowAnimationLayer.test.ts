import { describe, expect, it } from 'vitest'

import {
  FLOW_DASH_COLOR,
  FLOW_ANIMATION_STYLES,
  FLOW_DASH_OPACITY,
  FLOW_INACTIVE_BLACK_MIX,
  buildFlowLineGeometry,
  buildMonitorStaticFlowLineGroups,
  darkenFlowColor,
  deriveInactiveFlowPaths,
} from './FlowAnimationLayer'

describe('monitor flow appearance tokens', () => {
  it.each(['power', 'cooling'] as const)('uses the inactive background for active %s dots', (style) => {
    const path = { id: 'line', style, baseColor: '#28A8E0', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] }
    const inactive = buildMonitorStaticFlowLineGroups([], [path])[0]
    const dots = buildMonitorStaticFlowLineGroups([path], [], 'dots')[0]
    const wave = buildMonitorStaticFlowLineGroups([path], [], 'wave')[0]
    expect(dots.color).toBe(inactive.color)
    expect(dots.lineWidth).toBe(inactive.lineWidth)
    expect(wave.color).not.toBe(inactive.color)
  })
  it('configures power and cooling wave widths independently', () => {
    expect(FLOW_ANIMATION_STYLES.power.waveWidthRatio).toBe(1)
    expect(FLOW_ANIMATION_STYLES.cooling.waveWidthRatio).toBe(0.6)
  })
  it('keeps moving dashes separate from the 50% black inactive color mix', () => {
    expect({ color: FLOW_DASH_COLOR, opacity: FLOW_DASH_OPACITY }).toEqual({
      color: '#303238',
      opacity: 0.5,
    })
    expect(FLOW_INACTIVE_BLACK_MIX).toBe(0.5)
    expect(darkenFlowColor('#00F074')).toBe('#00783A')
    expect(darkenFlowColor('#FFC800')).toBe('#806400')
  })
})

describe('monitor flow geometry', () => {
  it('uses flat power child-line caps but retains square busbar caps', () => {
    const points = [{ x: 0, y: 0 }, { x: 80, y: 0 }]
    const child = { id: 'child', style: 'power' as const, points }
    const busbar = { ...child, id: 'bar', screenWidth: 4.5 }
    for (const active of [true, false]) {
      const groups = buildMonitorStaticFlowLineGroups(active ? [child, busbar] : [], active ? [] : [child, busbar])
      expect(groups.find(group => group.kind === 'connection')?.lineCap).toBe('butt')
      expect(groups.find(group => group.kind === 'busbar')?.lineCap).toBe('square')
    }
  })
  it('uses custom electrical width for static strokes and wave geometry', () => {
    const path = { id: 'custom', style: 'power' as const, powerLineWidth: 4.5, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] }
    expect([...buildFlowLineGeometry([path]).widths]).toEqual(Array(6).fill(4.5))
    expect(buildMonitorStaticFlowLineGroups([path], [])[0].lineWidth).toBe(4.5)
  })
  it('keeps the same wave phase at a cooling fork despite differing flow readings', () => {
    const path = (id: string, start: string, end: string, points: Array<{ x: number; y: number }>, speedMultiplier: number) => ({
      id, points, style: 'cooling' as const, speedMultiplier,
      phasePath: { id, networkId: 'water', startNodeId: start, endNodeId: end, points },
    })
    const paths = [
      path('trunk', 'source', 'fork', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 2),
      path('left', 'fork', 'left-end', [{ x: 100, y: 0 }, { x: 100, y: 80 }], 0.5),
      path('right', 'fork', 'right-end', [{ x: 100, y: 0 }, { x: 180, y: 0 }], 0.15),
    ]
    const geometry = buildFlowLineGeometry(paths)
    const trunkEnd = geometry.distances[2]
    expect(trunkEnd).toBe(100)
    expect(geometry.distances[6]).toBe(trunkEnd)
    expect(geometry.distances[12]).toBe(trunkEnd)
    for (const time of [0, 1, 10, 100]) {
      expect(geometry.distances[6] - time * geometry.speeds[6])
        .toBe(trunkEnd - time * geometry.speeds[2])
    }
    const refreshed = buildFlowLineGeometry(paths.map(p => ({ ...p, speedMultiplier: 0.75 })))
    expect([...refreshed.distances]).toEqual([...geometry.distances])
  })
  it('uses configured cooling speed regardless of positive flow, while retaining zero-flow gating', () => {
    for (const multiplier of [0, 0.15, 0.5, 1, 2]) {
      const geometry = buildFlowLineGeometry([{
        id: 'cooling', style: 'cooling', speedMultiplier: multiplier,
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
      }])
      expect([...geometry.speeds]).toEqual(Array(6).fill(multiplier > 0 ? 1 : 0))
    }
  })
  it('keeps cumulative distance through orthogonal and sampled bridge segments', () => {
    const geometry = buildFlowLineGeometry([{
      id: 'path',
      points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }],
    }])

    expect([...geometry.positions]).toHaveLength(36)
    expect([...geometry.ends]).toHaveLength(24)
    expect([...geometry.sides]).toEqual([
      -1, 1, 1, -1, 1, -1,
      -1, 1, 1, -1, 1, -1,
    ])
    expect([...geometry.alongs]).toEqual([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 0, 1, 1,
    ])
    expect([...geometry.widths]).toEqual(new Array(12).fill(2.25))
    expect([...geometry.speeds]).toEqual(new Array(12).fill(1))
    expect([...geometry.widthScales]).toEqual(new Array(12).fill(1))
    expect([...geometry.distances]).toEqual([
      0, 0, 8, 0, 8, 8,
      8, 8, 14, 8, 14, 14,
    ])
  })

  it('joins cooling strips without overlap at bends and preserves reversed travel', () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]
    for (const ordered of [points, [...points].reverse()]) {
      const geometry = buildFlowLineGeometry([{
        id: 'bend', points: ordered, style: 'cooling', worldWidth: 6,
      }])
      // Both segments meet at exactly the same two offset boundary positions.
      expect([...geometry.joins.slice(4, 6)]).toEqual([...geometry.joins.slice(14, 16)])
      expect([...geometry.joins.slice(10, 12)]).toEqual([...geometry.joins.slice(12, 14)])
      expect(geometry.distances[2]).toBe(20)
      expect(geometry.distances[8]).toBe(40)
      expect([...geometry.joins].every(Number.isFinite)).toBe(true)
    }
  })

  it('uploads the uncut distance to the shader after a crossing mask', () => {
    const geometry = buildFlowLineGeometry([{
      id: 'after-mask', style: 'cooling', worldWidth: 6,
      points: [{ x: 160, y: 0 }, { x: 300, y: 0 }],
      phasePath: {
        id: 'whole-pipe', networkId: 'water', startNodeId: 'in', endNodeId: 'out',
        points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      },
    }])
    expect([...geometry.distances]).toEqual([160, 160, 300, 160, 300, 300])
  })

  it('shares bend boundary vertices across separate connected pipes', () => {
    const a = [{ x: 0, y: 0 }, { x: 40, y: 0 }]
    const b = [{ x: 40, y: 0 }, { x: 40, y: 40 }]
    const paths = [
      { id: 'a', points: a, style: 'cooling' as const, worldWidth: 6,
        phasePath: { id: 'a', networkId: 'water', startNodeId: 'in', endNodeId: 'bend', points: a } },
      { id: 'b', points: b, style: 'cooling' as const, worldWidth: 6,
        phasePath: { id: 'b', networkId: 'water', startNodeId: 'bend', endNodeId: 'out', points: b } },
    ]
    const geometry = buildFlowLineGeometry(paths)
    expect([...geometry.joins.slice(4, 6)]).toEqual([-1, 1])
    expect([...geometry.joins.slice(4, 6)]).toEqual([...geometry.joins.slice(14, 16)])
    expect([...geometry.joins.slice(10, 12)]).toEqual([...geometry.joins.slice(12, 14)])
    // A visual mask clipping the first pipe must not grow it back to the node.
    const clipped = buildFlowLineGeometry([{ ...paths[0], points: [{ x: 0, y: 0 }, { x: 35, y: 0 }] }, paths[1]])
    expect([...clipped.joins.slice(4, 6)]).toEqual([-0, 1])
  })

  it('batches a shared directed segment only once', () => {
    const geometry = buildFlowLineGeometry([
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] },
      { id: 'b', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 16, y: 0 }] },
    ])

    expect(geometry.positions).toHaveLength(36)
    expect(geometry.distances).toHaveLength(12)
  })

  it('scales the wider busbar strip with the diagram', () => {
    const geometry = buildFlowLineGeometry([{
      id: 'busbar',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      screenWidth: 4.5,
    }])

    expect([...geometry.widths]).toEqual(new Array(6).fill(6))
    expect([...geometry.widthScales]).toEqual(new Array(6).fill(1))
  })

  it('keeps cooling-flow speed on every generated vertex', () => {
    const geometry = buildFlowLineGeometry([{
      id: 'cooling-path',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      worldWidth: 2,
      speedMultiplier: 1.5,
      style: 'cooling',
    }])

    expect([...geometry.widths]).toEqual(new Array(6).fill(2))
    expect([...geometry.widthScales]).toEqual(new Array(6).fill(1))
    expect([...geometry.speeds]).toEqual(new Array(6).fill(1))
  })

  it('keeps opposite directed flow strips distinct for animation phase', () => {
    const geometry = buildFlowLineGeometry([
      {
        id: 'forward',
        points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      },
      {
        id: 'reverse',
        points: [{ x: 16, y: 0 }, { x: 0, y: 0 }],
      },
    ])

    expect(geometry.positions).toHaveLength(36)
  })

  it('writes lower-priority animation strips before upper-priority strips', () => {
    const geometry = buildFlowLineGeometry([
      {
        id: 'upper',
        points: [{ x: 100, y: 0 }, { x: 116, y: 0 }],
        renderPriority: 5,
      },
      {
        id: 'lower',
        points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
        renderPriority: 0,
      },
    ])

    expect([...geometry.positions].slice(0, 3)).toEqual([0, 0, 0])
    expect([...geometry.positions].slice(-3)).toEqual([100, 0, 0])
  })
})

describe('monitor static flow lines', () => {
  it('draws active and inactive intervals as their final opaque SVG colors', () => {
    const groups = buildMonitorStaticFlowLineGroups([{
      id: 'active-cooling',
      points: [{ x: 8, y: 0 }, { x: 16, y: 0 }],
      worldWidth: 2,
      style: 'cooling',
      baseColor: '#00F074',
    }], [{
      id: 'inactive-cooling',
      points: [{ x: 0, y: 0 }, { x: 8, y: 0 }],
      worldWidth: 2,
      style: 'cooling',
      baseColor: '#00F074',
    }])

    expect(groups).toEqual([
      expect.objectContaining({
        kind: 'connection',
        color: '#001E0F',
        lineWidth: 2,
        widthSpace: 'world',
      }),
      expect.objectContaining({
        kind: 'connection',
        color: '#003C1D',
        lineWidth: 2,
        widthSpace: 'world',
      }),
    ])
  })

  it('restores the original static widths instead of the wider animation strips', () => {
    const groups = buildMonitorStaticFlowLineGroups([{
      id: 'active-busbar',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      screenWidth: 4.5,
      baseColor: '#0084FF',
    }, {
      id: 'active-connection',
      points: [{ x: 0, y: 8 }, { x: 16, y: 8 }],
      screenWidth: 2,
      baseColor: '#0084FF',
    }], [])

    expect(groups.map(({ kind, lineWidth, widthSpace }) => ({
      kind,
      lineWidth,
      widthSpace,
    }))).toEqual([
      { kind: 'busbar', lineWidth: 6, widthSpace: 'world' },
      { kind: 'connection', lineWidth: 2.25, widthSpace: 'world' },
    ])
  })

  it('draws primary cooling lines after auxiliary lines on shared geometry', () => {
    const groups = buildMonitorStaticFlowLineGroups([{
      id: 'primary',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      worldWidth: 2,
      baseColor: '#FFC800',
      renderPriority: 1,
    }, {
      id: 'auxiliary',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      worldWidth: 1,
      baseColor: '#8D8459',
      renderPriority: 0,
    }], [])

    expect(groups.map(({ color, lineWidth }) => ({ color, lineWidth }))).toEqual([
      { color: '#232116', lineWidth: 1 },
      { color: '#403200', lineWidth: 2 },
    ])
  })
})

describe('inactive monitor flow paths', () => {
  it('subtracts an active interval from the middle of one physical segment', () => {
    const inactive = deriveInactiveFlowPaths([{
      id: 'displayed',
      connectionEdgeId: 'edge-1',
      points: [{ x: 0, y: 0 }, { x: 24, y: 0 }],
      worldWidth: 2,
      style: 'cooling',
    }], [{
      id: 'active',
      points: [{ x: 8, y: 0 }, { x: 16, y: 0 }],
      worldWidth: 2,
      style: 'cooling',
    }])

    expect(inactive).toEqual([
      {
        id: 'inactive:displayed:0',
        connectionEdgeId: 'edge-1',
        points: [{ x: 0, y: 0 }, { x: 8, y: 0 }],
        screenWidth: undefined,
        worldWidth: 2,
        style: 'cooling',
        animated: false,
      },
      {
        id: 'inactive:displayed:1',
        connectionEdgeId: 'edge-1',
        points: [{ x: 16, y: 0 }, { x: 24, y: 0 }],
        screenWidth: undefined,
        worldWidth: 2,
        style: 'cooling',
        animated: false,
      },
    ])
  })

  it('treats an overlapping active path as flowing regardless of direction', () => {
    const inactive = deriveInactiveFlowPaths([{
      id: 'busbar',
      points: [{ x: 0, y: 0 }, { x: 32, y: 0 }],
      screenWidth: 4.5,
    }], [{
      id: 'active-busbar',
      points: [{ x: 24, y: 0 }, { x: 8, y: 0 }],
      screenWidth: 4.5,
    }])

    expect(inactive.map((path) => path.points)).toEqual([
      [{ x: 0, y: 0 }, { x: 8, y: 0 }],
      [{ x: 24, y: 0 }, { x: 32, y: 0 }],
    ])
  })

  it('does not let a different render style mask an inactive line', () => {
    const inactive = deriveInactiveFlowPaths([{
      id: 'cooling',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      style: 'cooling',
    }], [{
      id: 'power',
      points: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
      style: 'power',
    }])

    expect(inactive).toHaveLength(1)
    expect(inactive[0].points).toEqual([{ x: 0, y: 0 }, { x: 16, y: 0 }])
  })
})
