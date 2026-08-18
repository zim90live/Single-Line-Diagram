import type {
  Busbar,
  ConnectionEdge,
  ConnectionNetwork,
  DiagramElement,
} from '../domain/project'
import {
  DEFAULT_BUSBAR_COLOR,
  defaultConnectionColor,
  normalizeHexColor,
} from './objectColors'
import {
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  resolvedSymbolColorForSlot,
  symbolColorPropertyKey,
  symbolsByKey,
  type SymbolColorSlot,
} from './symbolCatalog'

export type CanvasColorCategory = 'element' | 'busbar' | 'connection'

export interface CanvasColorTarget {
  category: CanvasColorCategory
  color: string
  elementColorSlot?: SymbolColorSlot
}

export interface CanvasColorGroup extends CanvasColorTarget {
  count: number
  scopeLabel?: string
}

export interface CanvasColorGroups {
  element: CanvasColorGroup[]
  busbar: CanvasColorGroup[]
  connection: CanvasColorGroup[]
}

export interface CanvasColorSnapshot {
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
}

function incrementColor(counts: Map<string, number>, color: string) {
  counts.set(color, (counts.get(color) ?? 0) + 1)
}

function groupsFromCounts(
  category: CanvasColorCategory,
  counts: Map<string, number>,
) {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([color, count]) => ({ category, color, count }))
}

export function resolvedElementColor(
  element: DiagramElement,
  slot: SymbolColorSlot = 'default',
) {
  const symbol = symbolsByKey.get(element.assetKey)
  if (!symbol?.configurableColor) return null
  if (element.assetKey === 'switch' && slot === 'default') return null
  if (element.assetKey !== 'switch' && slot !== 'default') return null
  return resolvedSymbolColorForSlot(element, slot)
}

export function resolvedBusbarColor(busbar: Busbar) {
  return normalizeHexColor(busbar.color ?? DEFAULT_BUSBAR_COLOR, DEFAULT_BUSBAR_COLOR)
}

export function resolvedConnectionColor(
  network: ConnectionNetwork,
  edge: ConnectionEdge,
) {
  const fallback = defaultConnectionColor(network.type)
  return normalizeHexColor(edge.color ?? fallback, fallback)
}

export function collectCanvasColorGroups(
  elements: DiagramElement[],
  busbars: Busbar[],
  connections: ConnectionNetwork[],
): CanvasColorGroups {
  const elementGroups = new Map<string, CanvasColorGroup>()
  const busbarColors = new Map<string, number>()
  const connectionColors = new Map<string, number>()

  for (const element of elements) {
    const slots: Array<{ slot: SymbolColorSlot; scopeLabel?: string }> = element.assetKey === 'switch'
      ? [
          { slot: 'switch-off', scopeLabel: 'Switch 关' },
          { slot: 'switch-on', scopeLabel: 'Switch 开' },
        ]
      : [{ slot: 'default' }]
    for (const { slot, scopeLabel } of slots) {
      const color = resolvedElementColor(element, slot)
      if (!color) continue
      const key = `${slot}:${color}`
      const group = elementGroups.get(key)
      if (group) group.count += 1
      else elementGroups.set(key, {
        category: 'element',
        color,
        count: 1,
        ...(slot === 'default' ? {} : { elementColorSlot: slot }),
        ...(scopeLabel ? { scopeLabel } : {}),
      })
    }
  }
  for (const busbar of busbars) incrementColor(busbarColors, resolvedBusbarColor(busbar))
  for (const network of connections) {
    for (const edge of network.edges) {
      incrementColor(connectionColors, resolvedConnectionColor(network, edge))
    }
  }

  return {
    element: [...elementGroups.values()].sort((left, right) => (
      (left.scopeLabel ?? '').localeCompare(right.scopeLabel ?? '') ||
      left.color.localeCompare(right.color)
    )),
    busbar: groupsFromCounts('busbar', busbarColors),
    connection: groupsFromCounts('connection', connectionColors),
  }
}

export function replaceCanvasColor(
  snapshot: CanvasColorSnapshot,
  target: CanvasColorTarget,
  nextColor: string,
): CanvasColorSnapshot {
  if (target.category === 'element') {
    const normalized = normalizeHexColor(nextColor, DEFAULT_CONFIGURABLE_SYMBOL_COLOR)
    const slot = target.elementColorSlot ?? 'default'
    const property = symbolColorPropertyKey(slot)
    return {
      ...snapshot,
      elements: snapshot.elements.map((element) => {
        if (resolvedElementColor(element, slot) !== target.color) return element
        const properties = { ...element.properties, [property]: normalized }
        if (element.assetKey === 'switch') delete properties.color
        return {
          ...element,
          properties,
        }
      }),
    }
  }

  if (target.category === 'busbar') {
    const normalized = normalizeHexColor(nextColor, DEFAULT_BUSBAR_COLOR)
    return {
      ...snapshot,
      busbars: snapshot.busbars.map((busbar) => (
        resolvedBusbarColor(busbar) === target.color
          ? { ...busbar, color: normalized }
          : busbar
      )),
    }
  }

  return {
    ...snapshot,
    connections: snapshot.connections.map((network) => {
      const normalized = normalizeHexColor(nextColor, defaultConnectionColor(network.type))
      return {
        ...network,
        edges: network.edges.map((edge) => (
          resolvedConnectionColor(network, edge) === target.color
            ? { ...edge, color: normalized }
            : edge
        )),
      }
    }),
  }
}
