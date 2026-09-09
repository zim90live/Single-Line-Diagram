import { describe, expect, it } from 'vitest'
import { createDefaultProject, parseProjectDocument, diagramElementSchema, type AssetDefinition, type DiagramElement } from '../domain/project'
import { resolveElementAnchor, routeConnectionNetworks, routeConnectionNetworksIncrementally, type ConnectionRouteInput } from './connections'
import { elementsEqual } from './geometry'

const asset: AssetDefinition = {
  key: 'tmu', name: 'TMU', category: '冷却', source: 'TMU.svg', intrinsicWidth: 48, intrinsicHeight: 48,
  anchors: [
    { id: 'cold', name: '二次冷', x: 16, y: 0, direction: 'top', type: 'cooling-secondary-cold' },
    { id: 'hot', name: '三次热', x: 32, y: 48, direction: 'bottom', type: 'cooling-tertiary-hot' },
  ],
}
const element: DiagramElement = {
  id: 'tmu-1', diagramId: 'd', assetKey: 'tmu', name: 'TMU', x: 0, y: 0,
  width: 48, height: 48, rotation: 0, properties: {}, extensions: {},
}

describe('TMU instance port placement', () => {
  it('preserves instance placement in project JSON and accepts v39 projects', () => {
    const document = createDefaultProject('TMU', [asset])
    document.elements = [{ ...element, diagramId: document.diagrams[0].id, tmuPortsSwapped: true }]
    expect(parseProjectDocument(JSON.parse(JSON.stringify(document))).elements[0].tmuPortsSwapped).toBe(true)
    const legacy = { ...document, schemaVersion: 39, elements: [{ ...document.elements[0], tmuPortsSwapped: undefined }] }
    expect(parseProjectDocument(legacy).elements[0].tmuPortsSwapped).toBeUndefined()
  })
  it('swaps top/bottom without changing x, anchor identity, circuit or the template', () => {
    const swapped = { ...element, tmuPortsSwapped: true }
    expect(resolveElementAnchor(swapped, asset, asset.anchors[0])).toMatchObject({
      anchorId: 'cold', point: { x: 16, y: 48 }, direction: 'bottom', type: 'cooling-secondary-cold',
    })
    expect(resolveElementAnchor(swapped, asset, asset.anchors[1])).toMatchObject({ point: { x: 32, y: 0 }, direction: 'top' })
    expect(resolveElementAnchor(element, asset, asset.anchors[0]).point).toEqual({ x: 16, y: 0 })
    expect(asset.anchors[0].y).toBe(0)
    expect(swapped.rotation).toBe(0)
    expect(elementsEqual([element], [swapped])).toBe(false)
    expect(diagramElementSchema.parse(JSON.parse(JSON.stringify(swapped))).tmuPortsSwapped).toBe(true)
    expect(diagramElementSchema.parse(element).tmuPortsSwapped).toBeUndefined()
  })

  it('composes local port placement with existing scale and rotation', () => {
    const transformed = resolveElementAnchor({ ...element, width: 96, height: 96, rotation: 90, tmuPortsSwapped: true }, asset, asset.anchors[0])
    expect(transformed.point.x).toBeCloseTo(0)
    expect(transformed.point.y).toBeCloseTo(32)
    expect(transformed.direction).toBe('left')
  })

  it('invalidates routing and restores the original endpoint when toggled back', () => {
    const previous: ConnectionRouteInput = {
      elements: [element], assets: [asset], busbars: [], gridSize: 8,
      networks: [{ id: 'net', diagramId: 'd', type: 'cooling-secondary-cold',
        nodes: [{ id: 'port', kind: 'element-anchor', elementId: element.id, anchorId: 'cold' }, { id: 'end', kind: 'node', x: 160, y: -64 }],
        edges: [{ id: 'edge', sourceNodeId: 'port', targetNodeId: 'end' }],
      }],
    }
    const routed = routeConnectionNetworks(previous.networks, previous.elements, previous.assets, 8)
    const next = { ...previous, elements: [{ ...element, tmuPortsSwapped: true }] }
    const changed = routeConnectionNetworksIncrementally(previous, routed, next)
    expect(changed.mode).not.toBe('reused')
    expect(changed.routed.edges[0].points[0]).toEqual({ x: 16, y: 48 })
    const restored = routeConnectionNetworksIncrementally(next, changed.routed, previous)
    expect(restored.routed.edges[0].points[0]).toEqual({ x: 16, y: 0 })
    expect(next.networks).toBe(previous.networks)
  })
})
