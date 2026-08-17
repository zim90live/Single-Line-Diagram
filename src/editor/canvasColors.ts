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
  normalizeSymbolColor,
  symbolsByKey,
} from './symbolCatalog'

export type CanvasColorCategory = 'element' | 'busbar' | 'connection'

export interface CanvasColorTarget {
  category: CanvasColorCategory
  color: string
}

export interface CanvasColorGroup extends CanvasColorTarget {
  count: number
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

export function resolvedElementColor(element: DiagramElement) {
  const symbol = symbolsByKey.get(element.assetKey)
  if (!symbol?.configurableColor) return null
  return normalizeSymbolColor(element.properties.color)
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
  const elementColors = new Map<string, number>()
  const busbarColors = new Map<string, number>()
  const connectionColors = new Map<string, number>()

  for (const element of elements) {
    const color = resolvedElementColor(element)
    if (color) incrementColor(elementColors, color)
  }
  for (const busbar of busbars) incrementColor(busbarColors, resolvedBusbarColor(busbar))
  for (const network of connections) {
    for (const edge of network.edges) {
      incrementColor(connectionColors, resolvedConnectionColor(network, edge))
    }
  }

  return {
    element: groupsFromCounts('element', elementColors),
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
    return {
      ...snapshot,
      elements: snapshot.elements.map((element) => {
        if (resolvedElementColor(element) !== target.color) return element
        return {
          ...element,
          properties: { ...element.properties, color: normalized },
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
