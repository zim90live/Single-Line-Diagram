import archivedProject from '../../scene-archives/WuHu AIDC 0904.json'
import { expect, it } from 'vitest'
import { parseProjectDocument } from '../domain/project'
import { derivePowerFlowTopology } from './flowTopology'

it('feeds all four FM loads through isolated tap-off A/B paths in the POD archive', () => {
  const document = parseProjectDocument(archivedProject)
  const diagram = document.diagrams.find((item) => item.name === '算力 POD-01')!
  const elements = document.elements.filter((item) => item.diagramId === diagram.id)
  const networks = document.connections.filter((item) => item.diagramId === diagram.id)
  const loads = elements.filter((item) => item.assetKey === 'fm')
  expect(loads).toHaveLength(4)
  const switches = Object.fromEntries(elements.filter((item) => item.assetKey === 'switch').map((item) => [item.id, item.onOffState === 'on']))
  const run = (side: 'a' | 'b' | 'both' | 'none') => derivePowerFlowTopology({
    elements,
    assets: document.assets,
    busbars: document.busbars.filter((item) => item.diagramId === diagram.id),
    networks: networks.filter((network) => {
      // Disconnect the incoming side of each group, retaining both downstream outputs.
      const input = network.nodes.find((node) => {
        if (node.kind !== 'element-anchor') return false
        const element = elements.find((item) => item.id === node.elementId)
        return element?.assetKey === 'cabinet' && document.assets.find((asset) => asset.key === 'cabinet')?.anchors
          .find((anchor) => anchor.id === node.anchorId)?.powerSupplyChannel
      })
      if (input?.kind !== 'element-anchor' || side === 'both') return true
      const channel = document.assets.find((asset) => asset.key === 'cabinet')!.anchors.find((anchor) => anchor.id === input.anchorId)!.powerSupplyChannel
      return channel === side
    }),
    switchStates: side === 'a' ? switches : Object.fromEntries(Object.keys(switches).map((id) => [id, true])),
  })
  for (const side of ['a', 'b', 'both'] as const) {
    const topology = run(side)
    for (const load of loads) {
      expect(topology.energizedElementIds.has(load.id), `${side}: ${load.properties.tag}`).toBe(true)
      expect(topology.selectedSupplyChannels[load.id]).toBe(side === 'both' ? 'a' : side)
      const inputNodes = networks.flatMap((network) => network.nodes).filter((node) => node.kind === 'element-anchor' && node.elementId === load.id)
      const inputIds = new Set(inputNodes.map((node) => node.id))
      const loadEdges = networks.flatMap((network) => network.edges).filter((edge) => inputIds.has(edge.sourceNodeId) || inputIds.has(edge.targetNodeId))
      expect(loadEdges.filter((edge) => topology.edges.some((active) => active.edgeId === edge.id))).toHaveLength(1)
    }
  }
  expect(loads.some((load) => run('none').energizedElementIds.has(load.id))).toBe(false)
})
