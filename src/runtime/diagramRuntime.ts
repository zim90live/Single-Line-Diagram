import {
  getDiagramPath,
  type AssetDefinition,
  type Busbar,
  type ConnectionNetwork,
  type Diagram,
  type DiagramElement,
  type LineSystem,
  type ProjectDocument,
  type RouteWaypoint,
} from '../domain/project'
import {
  resolveMonitorDrillDownTarget,
  type MonitorDrillDownTarget,
} from '../monitoring/diagramDrillDown'
import { sensorAssetsForSystem } from '../scene/sensorAssets'

export interface DiagramRuntimeView {
  circuitPalette?: ProjectDocument['circuitPalette']
  elementLabelScale?: number
  diagram: Diagram
  lineSystem: LineSystem
  path: Diagram[]
  assets: AssetDefinition[]
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
  routeWaypoints: RouteWaypoint[]
  navigation: Record<string, MonitorDrillDownTarget>
}

export function routeWaypointsForNetworks(networks: ConnectionNetwork[]): RouteWaypoint[] {
  const points = new Map<string, RouteWaypoint>()
  networks.forEach((network) => {
    const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
    network.edges.forEach((edge) => (edge.routeNodeIds ?? []).forEach((id) => {
      const node = nodesById.get(id)
      if (node?.kind === 'node') points.set(id, { id, x: node.x, y: node.y })
    }))
  })
  return [...points.values()]
}

export function createDiagramRuntimeView(
  document: ProjectDocument,
  diagramId: string,
): DiagramRuntimeView | null {
  const diagram = document.diagrams.find((candidate) => candidate.id === diagramId)
  if (!diagram) return null
  const lineSystem = document.lineSystems.find((candidate) => (
    candidate.id === diagram.lineSystemId
  ))
  if (!lineSystem) return null

  const elements = document.elements.filter((element) => element.diagramId === diagramId)
  const connections = document.connections.filter((network) => network.diagramId === diagramId)
  const navigation = Object.fromEntries(elements.flatMap((element) => {
    const target = resolveMonitorDrillDownTarget(document, diagramId, element)
    return target ? [[element.id, target] as const] : []
  }))

  return {
    diagram,
    circuitPalette: document.circuitPalette,
    elementLabelScale: document.elementLabelScale,
    lineSystem,
    path: getDiagramPath(document, diagramId),
    assets: sensorAssetsForSystem(document.assets, lineSystem.type),
    elements,
    busbars: document.busbars.filter((busbar) => busbar.diagramId === diagramId),
    connections,
    routeWaypoints: routeWaypointsForNetworks(connections),
    navigation,
  }
}
