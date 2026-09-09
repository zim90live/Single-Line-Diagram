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

describe.each(['tmu', 'fm'] as const)('%s instance port placement', (assetKey) => {
  const swapKey = assetKey === 'tmu' ? 'tmuPortsSwapped' : 'fmPortsSwapped'
  const instanceAsset = { ...asset, key: assetKey }
  const instanceElement = { ...element, assetKey }
  it('preserves instance placement in project JSON and accepts v39 projects', () => {
    const document = createDefaultProject('TMU', [instanceAsset])
    document.elements = [{ ...instanceElement, diagramId: document.diagrams[0].id, [swapKey]: true }]
    expect(parseProjectDocument(JSON.parse(JSON.stringify(document))).elements[0][swapKey]).toBe(true)
    const legacy = { ...document, schemaVersion: 41, elements: [{ ...document.elements[0], [swapKey]: undefined }] }
    expect(parseProjectDocument(legacy).elements[0][swapKey]).toBeUndefined()
  })
  it('swaps top/bottom without changing x, anchor identity, circuit or the template', () => {
    const swapped = { ...instanceElement, [swapKey]: true }
    expect(resolveElementAnchor(swapped, instanceAsset, asset.anchors[0])).toMatchObject({
      anchorId: 'cold', point: { x: 16, y: 48 }, direction: 'bottom', type: 'cooling-secondary-cold',
    })
    expect(resolveElementAnchor(swapped, instanceAsset, asset.anchors[1])).toMatchObject({ point: { x: 32, y: 0 }, direction: 'top' })
    expect(resolveElementAnchor(instanceElement, instanceAsset, asset.anchors[0]).point).toEqual({ x: 16, y: 0 })
    expect(asset.anchors[0].y).toBe(0)
    expect(swapped.rotation).toBe(0)
    expect(elementsEqual([instanceElement], [swapped])).toBe(false)
    expect(diagramElementSchema.parse(JSON.parse(JSON.stringify(swapped)))[swapKey]).toBe(true)
    expect(diagramElementSchema.parse(instanceElement)[swapKey]).toBeUndefined()
  })

  it('composes local port placement with existing scale and rotation', () => {
    const transformed = resolveElementAnchor({ ...instanceElement, width: 96, height: 96, rotation: 90, [swapKey]: true }, instanceAsset, asset.anchors[0])
    expect(transformed.point.x).toBeCloseTo(0)
    expect(transformed.point.y).toBeCloseTo(32)
    expect(transformed.direction).toBe('left')
  })

  it('invalidates routing and restores the original endpoint when toggled back', () => {
    const previous: ConnectionRouteInput = {
      elements: [instanceElement], assets: [instanceAsset], busbars: [], gridSize: 8,
      networks: [{ id: 'net', diagramId: 'd', type: 'cooling-secondary-cold',
        nodes: [{ id: 'port', kind: 'element-anchor', elementId: element.id, anchorId: 'cold' }, { id: 'end', kind: 'node', x: 160, y: -64 }],
        edges: [{ id: 'edge', sourceNodeId: 'port', targetNodeId: 'end' }],
      }],
    }
    const routed = routeConnectionNetworks(previous.networks, previous.elements, previous.assets, 8)
    const next = { ...previous, elements: [{ ...instanceElement, [swapKey]: true }] }
    const changed = routeConnectionNetworksIncrementally(previous, routed, next)
    expect(changed.mode).not.toBe('reused')
    expect(changed.routed.edges[0].points[0]).toEqual({ x: 16, y: 48 })
    const restored = routeConnectionNetworksIncrementally(next, changed.routed, previous)
    expect(restored.routed.edges[0].points[0]).toEqual({ x: 16, y: 0 })
    expect(next.networks).toBe(previous.networks)
  })
})
