import { expect, it } from 'vitest'
import { createDefaultProject, parseProjectDocument, projectDocumentSchema } from '../domain/project'

it('reopens a project with MP connected in both power and cooling diagrams without losing wires', () => {
  const document = createDefaultProject('MP compatibility', symbolAssets)
  const mp = symbolAssets.find((asset) => asset.key === 'mp')!
  for (const system of document.lineSystems) {
    const diagram = document.diagrams.find((item) => item.lineSystemId === system.id)!
    const id = `sensor-${system.type}`
    document.elements.push({ id, assetKey: 'mp', diagramId: diagram.id, name: 'MP',
      x: 0, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {} })
    document.connections.push({ id: `network-${id}`, diagramId: diagram.id,
      type: system.type === 'power' ? 'electrical' : 'cooling-primary-cold',
      nodes: [{ id: `${id}-a`, kind: 'element-anchor', elementId: id, anchorId: mp.anchors[0].id },
        { id: `${id}-b`, kind: 'node', x: 80, y: 32 }],
      edges: [{ id: `${id}-edge`, sourceNodeId: `${id}-a`, targetNodeId: `${id}-b` }] })
  }
  expect(() => projectDocumentSchema.parse(document)).not.toThrow()
  const reopened = parseProjectDocument(JSON.parse(JSON.stringify(document)), symbolAssets)
  expect(reopened.connections).toEqual(document.connections)
  expect(projectDocumentSchema.safeParse(reopened).success).toBe(true)
  const invalid = structuredClone(document)
  invalid.connections.find((network) => network.type === 'electrical')!.type = 'cooling-primary-cold'
  expect(projectDocumentSchema.safeParse(invalid).success).toBe(false)
  const missingAnchor = structuredClone(document)
  const node = missingAnchor.connections[0].nodes[0]
  if (node.kind === 'element-anchor') node.anchorId = 'missing'
  expect(projectDocumentSchema.safeParse(missingAnchor).success).toBe(false)
})
import { sensorAssetsForSystem } from './sensorAssets'
import { symbolAssets } from './symbolCatalog'
import { normalizeConnectionNetworks } from './connections'
import type { DiagramElement, ConnectionNetwork } from '../domain/project'

it('adapts the shared MP anchor per system without modifying saved templates or electrical connections', () => {
  const original = symbolAssets.find((asset) => asset.key === 'mp')!
  const power = sensorAssetsForSystem(symbolAssets, 'power').find((asset) => asset.key === 'mp')!
  const cooling = sensorAssetsForSystem(symbolAssets, 'cooling').find((asset) => asset.key === 'mp')!
  expect(power.anchors[0].type).toBe('electrical')
  expect(cooling.anchors[0].type).toBe('cooling-general')
  expect(original.anchors[0].type).toBe('cooling-general')
  expect(power.anchors[0].id).toBe(original.anchors[0].id)
  const sensor: DiagramElement = { id: 'sensor', assetKey: 'mp', diagramId: 'd', name: 'MP',
    x: 0, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {} }
  const network: ConnectionNetwork = { id: 'n', diagramId: 'd', type: 'electrical',
    nodes: [{ id: 'a', kind: 'element-anchor', elementId: sensor.id, anchorId: original.anchors[0].id },
      { id: 'b', kind: 'node', x: 80, y: 32 }],
    edges: [{ id: 'e', sourceNodeId: 'a', targetNodeId: 'b' }] }
  const normalized = normalizeConnectionNetworks([network], [sensor], symbolAssets)
  expect(normalized[0].type).toBe('electrical')
  expect(normalized[0].edges).toHaveLength(1)
})
