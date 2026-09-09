import { describe, expect, it } from 'vitest'
import { parseProjectDocument } from '../domain/project'
import { symbolAssets } from './symbolCatalog'

const archives = import.meta.glob('../../scene-archives/*.json', { eager: true, import: 'default' })

describe('存档与当前图元兼容', () => {
  for (const [path, archive] of Object.entries(archives)) {
    it(`opens ${path} with installed symbols`, () => {
      expect(() => parseProjectDocument(archive, symbolAssets)).not.toThrow()
    })
  }
  it('preserves sensors attached to the two reported electrical networks when reopening', () => {
    const document = parseProjectDocument(archives['../../scene-archives/WuHu AIDC 0904.json'], symbolAssets)
    const mp = document.assets.find((asset) => asset.key === 'mp')!
    const networkIds = ['connection-network-7f1c0042-6561-4527-b096-500b429762d8',
      'connection-network-45aeb608-1aad-46e3-8ccf-78e1ffc9fe96']
    for (const networkId of networkIds) {
      const network = document.connections.find((item) => item.id === networkId)!
      const id = `mp-${networkId}`
      document.elements.push({ id, assetKey: 'mp', diagramId: network.diagramId, name: 'MP',
        x: 0, y: 0, width: 32, height: 32, rotation: 0, properties: {}, extensions: {} })
      network.nodes.push({ id, kind: 'element-anchor', elementId: id, anchorId: mp.anchors[0].id })
      network.edges.push({ id: `edge-${id}`, sourceNodeId: network.nodes[0].id, targetNodeId: id })
    }
    const reopened = parseProjectDocument(JSON.parse(JSON.stringify(document)), symbolAssets)
    expect(reopened.connections).toEqual(document.connections)
  })
})
