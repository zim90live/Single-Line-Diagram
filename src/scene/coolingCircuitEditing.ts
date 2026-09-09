import type { AnchorType, AssetDefinition, ConnectionNetwork, DiagramElement } from '../domain/project'

export function coolingCircuitLocked(
  network: ConnectionNetwork,
  elements: readonly DiagramElement[],
  assets: ReadonlyMap<string, AssetDefinition>,
) {
  return network.type === 'electrical' || network.nodes.some((node) => {
    if (node.kind !== 'element-anchor') return node.kind === 'busbar-tap'
    const element = elements.find((item) => item.id === node.elementId)
    const anchor = element && assets.get(element.assetKey)?.anchors.find((item) => item.id === node.anchorId)
    return !anchor || anchor.type !== 'cooling-general'
  })
}

export function changeCoolingCircuit(
  networks: ConnectionNetwork[], edgeIds: string[], type: AnchorType,
  elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>,
) {
  const ids = new Set(edgeIds)
  const selected = networks.filter((network) => network.edges.some((edge) => ids.has(edge.id)))
  if (type === 'electrical' || !selected.length || selected.some((network) => coolingCircuitLocked(network, elements, assets))) return null
  const selectedIds = new Set(selected.map((network) => network.id))
  return networks.map((network) => selectedIds.has(network.id) ? { ...network, type } : network)
}
