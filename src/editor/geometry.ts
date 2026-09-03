import type {
  Busbar,
  ConnectionNetwork,
  DiagramElement,
  RouteWaypoint,
} from '../domain/project'
import { snap, type Point } from '../scene/geometry'

export * from '../scene/geometry'

export interface DiagramObjectSelection {
  elementIds: ReadonlySet<string>
  busbarIds: ReadonlySet<string>
  nodeIds: ReadonlySet<string>
  routeWaypointIds: ReadonlySet<string>
}

export function constrainSelectionTranslationToBusbarNodes(
  busbars: Busbar[],
  connections: ConnectionNetwork[],
  selection: DiagramObjectSelection,
  delta: Point,
  gridSize?: number,
) {
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  let constrainX = false
  let constrainY = false
  let minimumX = Number.NEGATIVE_INFINITY
  let maximumX = Number.POSITIVE_INFINITY
  let minimumY = Number.NEGATIVE_INFINITY
  let maximumY = Number.POSITIVE_INFINITY

  connections.forEach((network) => network.nodes.forEach((node) => {
    if (
      node.kind !== 'busbar-tap' ||
      !selection.nodeIds.has(node.id) ||
      selection.busbarIds.has(node.busbarId)
    ) return
    const busbar = busbarsById.get(node.busbarId)
    if (!busbar) return
    if (busbar.orientation === 'horizontal') {
      constrainY = true
      minimumX = Math.max(minimumX, -node.offset)
      maximumX = Math.min(maximumX, busbar.length - node.offset)
    } else {
      constrainX = true
      minimumY = Math.max(minimumY, -node.offset)
      maximumY = Math.min(maximumY, busbar.length - node.offset)
    }
  }))

  const snappedX = gridSize === undefined ? delta.x : snap(delta.x, gridSize)
  const snappedY = gridSize === undefined ? delta.y : snap(delta.y, gridSize)
  return {
    x: constrainX ? 0 : Math.max(minimumX, Math.min(maximumX, snappedX)),
    y: constrainY ? 0 : Math.max(minimumY, Math.min(maximumY, snappedY)),
  }
}

export function translateDiagramSelection(
  elements: DiagramElement[],
  busbars: Busbar[],
  connections: ConnectionNetwork[],
  routeWaypoints: RouteWaypoint[],
  selection: DiagramObjectSelection,
  delta: Point,
  gridSize?: number,
) {
  const effectiveDelta = constrainSelectionTranslationToBusbarNodes(
    busbars,
    connections,
    selection,
    delta,
    gridSize,
  )
  const busbarsById = new Map(busbars.map((busbar) => [busbar.id, busbar]))
  const translated = (value: number, offset: number) => (
    gridSize === undefined ? value + offset : snap(value + offset, gridSize)
  )
  const translatedElements = selection.elementIds.size
    ? elements.map((element) => selection.elementIds.has(element.id)
        ? {
            ...element,
            x: translated(element.x, effectiveDelta.x),
            y: translated(element.y, effectiveDelta.y),
          }
        : element)
    : elements
  const translatedBusbars = selection.busbarIds.size
    ? busbars.map((busbar) => selection.busbarIds.has(busbar.id)
        ? {
            ...busbar,
            x: translated(busbar.x, effectiveDelta.x),
            y: translated(busbar.y, effectiveDelta.y),
          }
        : busbar)
    : busbars
  const translatedConnections = selection.nodeIds.size
    ? connections.map((network) => {
        let changed = false
        const nodes = network.nodes.map((node) => {
          if (!selection.nodeIds.has(node.id)) return node
          if (node.kind === 'node') {
            changed = true
            return {
              ...node,
              x: translated(node.x, effectiveDelta.x),
              y: translated(node.y, effectiveDelta.y),
            }
          }
          if (node.kind !== 'busbar-tap' || selection.busbarIds.has(node.busbarId)) return node
          const busbar = busbarsById.get(node.busbarId)
          if (!busbar) return node
          const axisDelta = busbar.orientation === 'horizontal'
            ? effectiveDelta.x
            : effectiveDelta.y
          changed = true
          return { ...node, offset: translated(node.offset, axisDelta) }
        })
        return changed ? { ...network, nodes } : network
      })
    : connections
  const translatedRouteWaypoints = selection.routeWaypointIds.size
    ? routeWaypoints.map((waypoint) => (
        selection.routeWaypointIds.has(waypoint.id)
          ? {
              ...waypoint,
              x: translated(waypoint.x, effectiveDelta.x),
              y: translated(waypoint.y, effectiveDelta.y),
            }
          : waypoint
      ))
    : routeWaypoints
  return {
    elements: translatedElements,
    busbars: translatedBusbars,
    connections: translatedConnections,
    routeWaypoints: translatedRouteWaypoints,
  }
}
