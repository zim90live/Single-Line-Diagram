import type { ConnectionNetwork, DiagramElement } from '../domain/project'

export function demoLeakRegion(name: string, networks: readonly ConnectionNetwork[], elements: readonly DiagramElement[]) {
  if (!['TMU到FM 01', 'TMU到FM 02'].includes(name.trim())) return undefined
  const sensors = new Set(elements.filter((element) => element.assetKey === 'mp').map((element) => element.id))
  const candidates = networks.filter((network) => network.type !== 'electrical' && network.edges.length > 0)
    .map((network) => ({
      networkId: network.id,
      sensorIds: [...new Set(network.nodes.flatMap((node) => (
        node.kind === 'element-anchor' && sensors.has(node.elementId) &&
        network.edges.some((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
          ? [node.elementId] : []
      )))],
    }))
    .sort((a, b) => Number(b.sensorIds.length > 0) - Number(a.sensorIds.length > 0) || a.networkId.localeCompare(b.networkId))
  return candidates[0]
}
