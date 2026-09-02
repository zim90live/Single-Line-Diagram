import { describe, expect, it } from 'vitest'

import type {
  Busbar,
  ConnectionNetwork,
  DiagramElement,
  DiagramViewport,
} from '../domain/project'
import {
  busbarInsideRect,
  diagramContentBounds,
  diagramObjectsBounds,
  elementInsideRect,
  elementsBounds,
  elementsEqual,
  fitViewportToBounds,
  rotatePointOnGrid,
  screenToWorld,
  snap,
  translateDiagramSelection,
  worldToScreen,
  worldDeltaToLocal,
  zoomAroundPoint,
} from './geometry'

const viewport: DiagramViewport = { zoom: 2, tx: 100, ty: -40 }

function createElement(patch: Partial<DiagramElement> = {}): DiagramElement {
  return {
    id: 'element-1',
    diagramId: 'diagram-1',
    assetKey: 'pump',
    name: '泵',
    x: 10,
    y: 20,
    width: 40,
    height: 20,
    rotation: 0,
    properties: {},
    extensions: {},
    ...patch,
  }
}

describe('editor geometry', () => {
  it('round-trips world and screen coordinates', () => {
    const world = { x: 35, y: 80 }
    expect(screenToWorld(worldToScreen(world, viewport), viewport)).toEqual(world)
  })

  it('keeps the world point under the cursor fixed while zooming', () => {
    const cursor = { x: 420, y: 260 }
    const worldBefore = screenToWorld(cursor, viewport)
    const next = zoomAroundPoint(viewport, cursor, 3.2)
    expect(screenToWorld(cursor, next)).toEqual(worldBefore)
  })

  it('snaps movement to the configured grid', () => {
    expect(snap(26, 10)).toBe(30)
    expect(snap(-14, 10)).toBe(-10)
  })

  it('keeps rotated points on-grid when the group center is between grid lines', () => {
    const rotated = rotatePointOnGrid(
      { x: 8, y: 0 },
      { x: 4, y: 0 },
      90,
      8,
    )

    expect(rotated).toEqual({ x: 8, y: 8 })
    expect(rotated.x % 8).toBe(0)
    expect(rotated.y % 8).toBe(0)
  })

  it('strict marquee selection accounts for rotation', () => {
    const rotated = createElement({ rotation: 45 })
    expect(elementInsideRect(rotated, { x: 0, y: 0, width: 60, height: 60 })).toBe(true)
    expect(elementInsideRect(rotated, { x: 10, y: 20, width: 40, height: 20 })).toBe(false)
  })

  it('computes an axis-aligned group bound from every rotated element', () => {
    const bounds = elementsBounds([
      createElement({ x: 0, y: 0, width: 40, height: 20 }),
      createElement({ id: 'element-2', x: 80, y: 0, width: 40, height: 20, rotation: 90 }),
    ])
    expect(bounds).toEqual({ x: 0, y: -10, width: 110, height: 40 })
  })

  it('treats label visibility as an element history change', () => {
    expect(elementsEqual([createElement()], [createElement({ labelVisible: false })])).toBe(false)
  })

  it('treats monitoring visibility and metric configuration as element history changes', () => {
    expect(elementsEqual(
      [createElement()],
      [createElement({ monitorDataVisible: true })],
    )).toBe(false)
    expect(elementsEqual(
      [createElement()],
      [createElement({ monitorMetricLabelsVisible: false })],
    )).toBe(false)
    expect(elementsEqual(
      [createElement()],
      [createElement({
        monitorMetrics: [{
          id: 'load',
          name: '负载率',
          valueType: 'number',
          unit: '%',
          precision: 1,
          simulationMin: 0,
          simulationMax: 100,
          alarm: { mode: 'upper', minor: 70, major: 85, critical: 95 },
        }],
      })],
    )).toBe(false)
  })

  it('includes complete busbars in marquee selection and mixed bounds', () => {
    const busbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 64,
      y: 80,
      length: 96,
    }

    expect(busbarInsideRect(busbar, { x: 56, y: 72, width: 112, height: 16 })).toBe(true)
    expect(busbarInsideRect(busbar, { x: 72, y: 72, width: 96, height: 16 })).toBe(false)
    expect(diagramObjectsBounds([createElement({ x: 0, y: 0 })], [busbar])).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 80,
    })
  })

  it('includes free connection nodes in complete diagram bounds', () => {
    const network: ConnectionNetwork = {
      id: 'network-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      nodes: [
        { id: 'node-1', kind: 'node', x: -80, y: 120 },
        { id: 'node-2', kind: 'node', x: 240, y: 360 },
      ],
      edges: [{
        id: 'edge-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
      }],
    }

    expect(diagramContentBounds([], [], [network])).toEqual({
      x: -80,
      y: 120,
      width: 320,
      height: 240,
    })
  })

  it('fits and centers complete diagram bounds with screen-space padding', () => {
    expect(fitViewportToBounds(
      { x: 100, y: 200, width: 1000, height: 500 },
      { width: 500, height: 300 },
      50,
    )).toEqual({
      zoom: 0.4,
      tx: 10,
      ty: -30,
    })
  })

  it('does not enlarge small diagrams beyond 100%', () => {
    expect(fitViewportToBounds(
      { x: 100, y: 200, width: 40, height: 20 },
      { width: 500, height: 300 },
    )).toEqual({
      zoom: 1,
      tx: 130,
      ty: -60,
    })
  })

  it('keeps selected elements, busbars and nodes in one relative translation', () => {
    const element = createElement({ x: 16, y: 24 })
    const busbar: Busbar = {
      id: 'busbar-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      orientation: 'horizontal',
      x: 64,
      y: 80,
      length: 96,
    }
    const network: ConnectionNetwork = {
      id: 'network-1',
      diagramId: 'diagram-1',
      type: 'electrical',
      nodes: [
        { id: 'node-1', kind: 'node', x: 104, y: 112 },
        { id: 'node-2', kind: 'node', x: 160, y: 112 },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
    }
    const translated = translateDiagramSelection(
      [element],
      [busbar],
      [network],
      [],
      {
        elementIds: new Set([element.id]),
        busbarIds: new Set([busbar.id]),
        nodeIds: new Set(['node-1']),
        routeWaypointIds: new Set(),
      },
      { x: 16, y: -8 },
      8,
    )

    expect(translated.elements[0]).toMatchObject({ x: 32, y: 16 })
    expect(translated.busbars[0]).toMatchObject({ x: 80, y: 72 })
    expect(translated.connections[0].nodes).toEqual([
      expect.objectContaining({ id: 'node-1', x: 120, y: 104 }),
      expect.objectContaining({ id: 'node-2', x: 160, y: 112 }),
    ])
  })

  it('moves a selected busbar node only along its host while preserving a mixed selection', () => {
    const element = createElement({ x: 16, y: 24 })
    const busbar: Busbar = {
      id: 'busbar-1', diagramId: 'diagram-1', type: 'electrical',
      orientation: 'horizontal', x: 64, y: 80, length: 96,
    }
    const network: ConnectionNetwork = {
      id: 'network-1', diagramId: 'diagram-1', type: 'electrical',
      nodes: [{ id: 'tap-1', kind: 'busbar-tap', busbarId: busbar.id, offset: 32 }],
      edges: [],
    }
    const translated = translateDiagramSelection(
      [element], [busbar], [network], [],
      {
        elementIds: new Set([element.id]),
        busbarIds: new Set(),
        nodeIds: new Set(['tap-1']),
        routeWaypointIds: new Set(),
      },
      { x: 16, y: -8 },
      8,
    )

    expect(translated.elements[0]).toMatchObject({ x: 32, y: 24 })
    expect(translated.connections[0].nodes[0]).toMatchObject({ offset: 48 })
  })

  it('clamps selected busbar nodes at the host endpoints', () => {
    const busbar: Busbar = {
      id: 'busbar-1', diagramId: 'diagram-1', type: 'electrical',
      orientation: 'horizontal', x: 64, y: 80, length: 96,
    }
    const network: ConnectionNetwork = {
      id: 'network-1', diagramId: 'diagram-1', type: 'electrical',
      nodes: [{ id: 'tap-1', kind: 'busbar-tap', busbarId: busbar.id, offset: 80 }],
      edges: [],
    }
    const translated = translateDiagramSelection(
      [], [busbar], [network], [],
      {
        elementIds: new Set(),
        busbarIds: new Set(),
        nodeIds: new Set(['tap-1']),
        routeWaypointIds: new Set(),
      },
      { x: 40, y: 0 },
      8,
    )

    expect(translated.connections[0].nodes[0]).toMatchObject({ offset: 96 })
  })

  it('lets a selected busbar carry its selected node through a free translation', () => {
    const element = createElement({ x: 16, y: 24 })
    const busbar: Busbar = {
      id: 'busbar-1', diagramId: 'diagram-1', type: 'electrical',
      orientation: 'horizontal', x: 64, y: 80, length: 96,
    }
    const network: ConnectionNetwork = {
      id: 'network-1', diagramId: 'diagram-1', type: 'electrical',
      nodes: [{ id: 'tap-1', kind: 'busbar-tap', busbarId: busbar.id, offset: 32 }],
      edges: [],
    }
    const translated = translateDiagramSelection(
      [element], [busbar], [network], [],
      {
        elementIds: new Set([element.id]),
        busbarIds: new Set([busbar.id]),
        nodeIds: new Set(['tap-1']),
        routeWaypointIds: new Set(),
      },
      { x: 16, y: -8 },
      8,
    )

    expect(translated.elements[0]).toMatchObject({ x: 32, y: 16 })
    expect(translated.busbars[0]).toMatchObject({ x: 80, y: 72 })
    expect(translated.connections[0].nodes[0]).toMatchObject({ offset: 32 })
  })

  it('converts rotated resize movement into element-local axes', () => {
    expect(worldDeltaToLocal({ x: 0, y: 20 }, 90).x).toBeCloseTo(20)
    expect(worldDeltaToLocal({ x: 0, y: 20 }, 90).y).toBeCloseTo(0)
  })
})
