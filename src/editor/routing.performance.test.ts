import { describe, expect, it } from 'vitest'

import type { AssetDefinition, Busbar, ConnectionNetwork, DiagramElement } from '../domain/project'
import {
  prepareConnectionPreview,
  previewConnectionRoutesForDiagram,
  previewConnectionRoutesForElements,
  routeConnectionNetworks,
  routeConnectionPreview,
  routeConnectionPreviewWithContext,
} from './connections'

const asset: AssetDefinition = {
  key: 'routing-performance',
  name: 'Routing performance fixture',
  category: '电力',
  source: 'routing-performance.svg',
  intrinsicWidth: 64,
  intrinsicHeight: 64,
  anchors: [
    {
      id: 'top', name: 'Top', x: 32, y: 0,
      direction: 'top', type: 'electrical',
    },
    {
      id: 'bottom', name: 'Bottom', x: 32, y: 64,
      direction: 'bottom', type: 'electrical',
    },
  ],
}

function element(id: string, x: number, y: number): DiagramElement {
  return {
    id,
    diagramId: 'performance-diagram',
    assetKey: asset.key,
    name: id,
    x,
    y,
    width: 64,
    height: 64,
    rotation: 0,
    properties: {},
    extensions: {},
  }
}

function fixture(sourceX = 448) {
  const source = element('source', sourceX, 0)
  const targets = Array.from({ length: 8 }, (_, index) => (
    element(`target-${index}`, index * 128, 512 + (index % 2) * 96)
  ))
  const network: ConnectionNetwork = {
    id: 'performance-network',
    diagramId: 'performance-diagram',
    type: 'electrical',
    nodes: [
      {
        id: 'source-node', kind: 'element-anchor',
        elementId: source.id, anchorId: 'bottom',
      },
      ...targets.map((target, index) => ({
        id: `target-node-${index}`,
        kind: 'element-anchor' as const,
        elementId: target.id,
        anchorId: 'top',
      })),
    ],
    edges: targets.map((_, index) => ({
      id: `edge-${index}`,
      sourceNodeId: 'source-node',
      targetNodeId: `target-node-${index}`,
    })),
  }
  return { elements: [source, ...targets], network }
}

function busbarFixture(length = 512) {
  const busbar: Busbar = {
    id: 'performance-busbar',
    diagramId: 'performance-diagram',
    type: 'electrical',
    orientation: 'horizontal',
    x: 0,
    y: 0,
    length,
  }
  const elements = Array.from({ length: 4 }, (_, index) => (
    element(`busbar-target-${index}`, 64 + index * 112, 256)
  ))
  const network: ConnectionNetwork = {
    id: 'performance-busbar-network',
    diagramId: 'performance-diagram',
    type: 'electrical',
    nodes: elements.flatMap((target, index) => [
      {
        id: `busbar-anchor-${index}`,
        kind: 'element-anchor' as const,
        elementId: target.id,
        anchorId: 'top',
      },
      {
        id: `busbar-tap-${index}`,
        kind: 'busbar-tap' as const,
        busbarId: busbar.id,
        offset: 96 + index * 112,
      },
    ]),
    edges: elements.map((_, index) => ({
      id: `busbar-edge-${index}`,
      sourceNodeId: `busbar-anchor-${index}`,
      targetNodeId: `busbar-tap-${index}`,
    })),
  }
  return { busbar, elements, network }
}

describe('routing interaction performance fixture', () => {
  it('measures lightweight shared-network drag previews', () => {
    const base = fixture()
    const routed = routeConnectionNetworks([base.network], base.elements, [asset], 8)
    const start = performance.now()
    let invalid = 0
    for (let step = 0; step < 6; step += 1) {
      const current = fixture(448 + step * 8)
      invalid += previewConnectionRoutesForElements(
        routed,
        [base.network],
        base.elements,
        current.elements,
        [asset],
        8,
      ).invalidEdgeIds.length
    }
    const duration = performance.now() - start
    console.info(`ROUTING_PREVIEW_PERF_MS=${duration.toFixed(2)}`)
    expect(invalid).toBe(0)
  })

  it('keeps repeated keyboard nudge previews cheaper than full-network reroutes', () => {
    const base = fixture()
    const routed = routeConnectionNetworks([base.network], base.elements, [asset], 8)
    const previewStart = performance.now()
    for (let step = 1; step <= 8; step += 1) {
      const current = fixture(448 + step * 8)
      previewConnectionRoutesForElements(
        routed,
        [base.network],
        base.elements,
        current.elements,
        [asset],
        8,
      )
    }
    const previewDuration = performance.now() - previewStart
    const rerouteStart = performance.now()
    for (let step = 1; step <= 8; step += 1) {
      const current = fixture(448 + step * 8)
      routeConnectionNetworks([base.network], current.elements, [asset], 8)
    }
    const rerouteDuration = performance.now() - rerouteStart
    console.info(
      `KEYBOARD_NUDGE_PREVIEW_PERF_MS=${previewDuration.toFixed(2)} ` +
      `KEYBOARD_NUDGE_FULL_REROUTE_MS=${rerouteDuration.toFixed(2)}`,
    )
    expect(previewDuration).toBeLessThan(rerouteDuration)
  })

  it('measures shared-network wiring previews', () => {
    const base = fixture()
    const routed = routeConnectionNetworks([base.network], base.elements, [asset], 8)
    const source = {
      kind: 'anchor' as const,
      elementId: 'source',
      anchorId: 'bottom',
      type: 'electrical' as const,
    }
    const context = prepareConnectionPreview(
      source,
      [base.network],
      base.elements,
      [asset],
      8,
      [],
      routed,
    )
    const start = performance.now()
    let valid = 0
    for (let step = 0; step < 6; step += 1) {
      const preview = routeConnectionPreviewWithContext(
        context,
        { x: 1040 + step * 8, y: 256 + step * 16 },
      )
      valid += Number(preview !== null)
    }
    const duration = performance.now() - start
    console.info(`WIRING_PREVIEW_PERF_MS=${duration.toFixed(2)}`)
    expect(valid).toBe(6)
  })

  it('measures a wiring preview while the pointer is inside a target obstacle', () => {
    const base = fixture()
    const routed = routeConnectionNetworks([base.network], base.elements, [asset], 8)
    const start = performance.now()
    const preview = routeConnectionPreview(
      {
        kind: 'anchor',
        elementId: 'source',
        anchorId: 'bottom',
        type: 'electrical',
      },
      { x: 928, y: 640 },
      [base.network],
      base.elements,
      [asset],
      8,
      [],
      routed,
    )
    const duration = performance.now() - start
    console.info(`TARGET_HOVER_PREVIEW_PERF_MS=${duration.toFixed(2)}`)
    expect(preview).not.toBeNull()
  })

  it('keeps busbar resize previews cheaper than repeated full-network reroutes', () => {
    const base = busbarFixture()
    const routed = routeConnectionNetworks(
      [base.network],
      base.elements,
      [asset],
      8,
      [base.busbar],
    )
    const previewStart = performance.now()
    for (let step = 1; step <= 4; step += 1) {
      const resized = { ...base.busbar, length: base.busbar.length + step * 8 }
      previewConnectionRoutesForDiagram(
        routed,
        [base.network],
        [base.network],
        base.elements,
        base.elements,
        [asset],
        8,
        [base.busbar],
        [resized],
      )
    }
    const previewDuration = performance.now() - previewStart
    const rerouteStart = performance.now()
    for (let step = 1; step <= 4; step += 1) {
      routeConnectionNetworks(
        [base.network],
        base.elements,
        [asset],
        8,
        [{ ...base.busbar, length: base.busbar.length + step * 8 }],
      )
    }
    const rerouteDuration = performance.now() - rerouteStart
    console.info(
      `BUSBAR_RESIZE_PREVIEW_PERF_MS=${previewDuration.toFixed(2)} ` +
      `FULL_REROUTE_MS=${rerouteDuration.toFixed(2)}`,
    )
    expect(previewDuration).toBeLessThan(rerouteDuration)
  })
})
