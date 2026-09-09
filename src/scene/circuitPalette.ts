import type { CSSProperties } from 'react'
import type { AssetDefinition, Busbar, ConnectionNetwork, DiagramElement, PowerSupplyChannel, ProjectDocument } from '../domain/project'
import { defaultConnectionColor } from './objectColors'

export const DEFAULT_CIRCUIT_PALETTE = {
  a: '#1BA4FF', b: '#00B387',
  'cooling-primary-cold': '#FCBC00', 'cooling-primary-hot': '#FB7800',
  'cooling-secondary-cold': '#1BA4FF', 'cooling-secondary-hot': '#00B387',
  'cooling-tertiary-cold': '#A970FF', 'cooling-tertiary-hot': '#FF4D6D',
} as const
export type CircuitKey = keyof typeof DEFAULT_CIRCUIT_PALETTE
export type CircuitPalette = ProjectDocument['circuitPalette']

export function networkPowerChannels(network: ConnectionNetwork, elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>) {
  const channels = new Set<PowerSupplyChannel>()
  for (const node of network.nodes) {
    if (node.kind !== 'element-anchor') continue
    const element = elements.find((item) => item.id === node.elementId)
    const anchor = element && assets.get(element.assetKey)?.anchors.find((item) => item.id === node.anchorId)
    if (anchor?.powerSupplyChannel) channels.add(anchor.powerSupplyChannel)
  }
  return channels
}
export function circuitKey(network: ConnectionNetwork, elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>): CircuitKey | undefined {
  if (network.type === 'cooling-general') return undefined
  if (network.type !== 'electrical') return network.type
  const channels = networkPowerChannels(network, elements, assets)
  return channels.size === 1 ? [...channels][0] : channels.size ? undefined : network.powerSupplyChannel
}
export function circuitColor(key: CircuitKey, palette?: CircuitPalette) { return palette?.[key] ?? DEFAULT_CIRCUIT_PALETTE[key] }
export function circuitPaletteStyle(palette?: CircuitPalette): CSSProperties {
  return Object.fromEntries(Object.keys(DEFAULT_CIRCUIT_PALETTE).map((key) => [
    `--${key === 'a' || key === 'b' ? `power-${key}` : key}`, circuitColor(key as CircuitKey, palette),
  ])) as CSSProperties
}
export function circuitDisplayEdges(networks: ConnectionNetwork[], elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>, palette?: CircuitPalette) {
  return new Map(networks.flatMap((network) => {
    const key = circuitKey(network, elements, assets)
    return network.edges.map((edge) => [edge.id, key ? { ...edge, color: circuitColor(key, palette) } : edge] as const)
  }))
}
export function circuitNetworkColor(network: ConnectionNetwork, elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>, palette?: CircuitPalette) {
  const key = circuitKey(network, elements, assets)
  return key ? circuitColor(key, palette) : defaultConnectionColor(network.type)
}
export function circuitBusbarColor(busbar: Busbar, networks: ConnectionNetwork[], elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>, palette?: CircuitPalette) {
  const key = circuitBusbarKey(busbar, networks, elements, assets)
  return key ? circuitColor(key, palette) : busbar.color
}
export function circuitBusbarKey(busbar: Busbar, networks: ConnectionNetwork[], elements: readonly DiagramElement[], assets: ReadonlyMap<string, AssetDefinition>) {
  const network = networks.find((candidate) => candidate.nodes.some((node) => node.kind === 'busbar-tap' && node.busbarId === busbar.id))
  return network ? circuitKey(network, elements, assets) : busbar.powerSupplyChannel
}
