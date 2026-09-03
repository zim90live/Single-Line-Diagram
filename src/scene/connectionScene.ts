import type {
  AnchorType,
  ConnectionCrossingLayer,
  ConnectionEdge,
  ConnectionNetwork,
  CoolingLineRole,
} from '../domain/project'
import {
  buildMonitorStaticFlowLineGroups,
  type MonitorFlowPath,
  type MonitorStaticFlowLineGroup,
} from '../monitoring/flowPresentation'
import {
  COOLING_PIPE_BRIDGE_RADIUS,
  COOLING_PIPE_CORNER_RADIUS,
  COOLING_PIPE_SHELL_ENDPOINT_INSET,
  coolingPipeCoreWidth,
  insetPolylineEndpoints,
  isCoolingConnectionType,
  resolvedCoolingLineColor,
} from './connectionAppearance'
import {
  connectionEdgeCrossingPriority,
  sortByConnectionCrossingPriority,
} from './connectionCrossingOrder'
import {
  bridgedPathData,
  bridgedPolylinePoints,
  type ConnectedRouteDisplayGeometry,
  type ConnectionCrossing,
  type ConnectionCrossingIndex,
  type RoutedConnectionEdge,
} from './connections'
import { defaultConnectionColor } from './objectColors'
import type { Point } from './geometry'

export interface ConnectionRouteRenderGroup {
  networkId: string
  type: AnchorType
  routes: RoutedConnectionEdge[]
  renderKey: string
  coolingLineRole?: CoolingLineRole
  crossingLayer?: ConnectionCrossingLayer
}

export interface DisplayedRoutePath {
  route: RoutedConnectionEdge
  path: MonitorFlowPath
}

export interface ConnectionRouteDisplayCacheEntry {
  route: RoutedConnectionEdge
  crossingKey: string
  gridSize: number
  bridgeRadius: number
  cornerRadius: number
  squareCornerPointKeys?: ReadonlySet<string>
  rendered: ReturnType<typeof bridgedPathData>
}

export interface CoolingPipeShellRouteCacheEntry {
  displayRoute: RoutedConnectionEdge
  endpointGeometry?: ConnectedRouteDisplayGeometry
  crossingKey: string
  gridSize: number
  squareCornerPointKeys?: ReadonlySet<string>
  sourceInset: number
  targetInset: number
  path: string
  points: Point[]
}

export interface CoolingPipeShellGroup {
  path: string
  points: Point[]
}

export function createConnectionRouteRenderGroups(
  routes: RoutedConnectionEdge[],
  edgesById: ReadonlyMap<string, ConnectionEdge>,
): ConnectionRouteRenderGroup[] {
  const routesByNetwork = new Map<string, RoutedConnectionEdge[]>()
  routes.forEach((route) => {
    const grouped = routesByNetwork.get(route.networkId) ?? []
    grouped.push(route)
    routesByNetwork.set(route.networkId, grouped)
  })

  const renderGroups: ConnectionRouteRenderGroup[] = []
  routesByNetwork.forEach((networkRoutes, networkId) => {
    const type = networkRoutes[0]?.type
    if (!type) return
    const buckets = new Map<string, {
      routes: RoutedConnectionEdge[]
      coolingLineRole?: CoolingLineRole
      crossingLayer?: ConnectionCrossingLayer
    }>()
    networkRoutes.forEach((route) => {
      const edge = edgesById.get(route.edgeId)
      const coolingLineRole = isCoolingConnectionType(type)
        ? edge?.coolingLineRole ?? 'primary'
        : undefined
      const crossingLayer = edge?.crossingLayer
      const key = `${coolingLineRole ?? 'line'}:${crossingLayer ?? 'auto'}`
      const bucket = buckets.get(key)
      if (bucket) bucket.routes.push(route)
      else buckets.set(key, { routes: [route], coolingLineRole, crossingLayer })
    })
    buckets.forEach((bucket, key) => renderGroups.push({
      networkId,
      type,
      renderKey: `${networkId}:${key}`,
      ...bucket,
    }))
  })

  return sortByConnectionCrossingPriority(renderGroups, (group) => ({
    crossingLayer: group.crossingLayer,
    coolingLineRole: group.coolingLineRole,
  }))
}

export function createCoolingPipeFilterIds(
  groups: ConnectionRouteRenderGroup[],
  idForIndex: (index: number) => string,
) {
  return new Map(groups.flatMap((group, index) => (
    isCoolingConnectionType(group.type)
      ? [[group.renderKey, idForIndex(index)] as const]
      : []
  )))
}

export function createRenderedConnectionPaths(
  visibleRoutes: RoutedConnectionEdge[],
  allRoutes: RoutedConnectionEdge[],
  geometryByEdgeId: ReadonlyMap<string, ConnectedRouteDisplayGeometry>,
  crossingsByEdgeId: ConnectionCrossingIndex,
  branchPointKeysByNetworkId: ReadonlyMap<string, ReadonlySet<string>>,
  gridSize: number,
  cache?: Map<string, ConnectionRouteDisplayCacheEntry>,
) {
  pruneRouteCache(cache, allRoutes)
  return new Map(visibleRoutes.map((route) => {
    const cooling = isCoolingConnectionType(route.type)
    const endpointGeometry = cooling ? geometryByEdgeId.get(route.edgeId) : undefined
    const displayRoute = endpointGeometry?.route ?? route
    const bridgeRadius = cooling ? COOLING_PIPE_BRIDGE_RADIUS : gridSize * 0.5
    const cornerRadius = cooling ? COOLING_PIPE_CORNER_RADIUS : 0
    const squareCornerPointKeys = cooling
      ? branchPointKeysByNetworkId.get(route.networkId)
      : undefined
    const crossingKey = connectionCrossingKey(crossingsByEdgeId.get(route.edgeId) ?? [])
    const cached = cache?.get(route.edgeId)
    if (
      cached?.route === displayRoute &&
      cached.gridSize === gridSize &&
      cached.bridgeRadius === bridgeRadius &&
      cached.cornerRadius === cornerRadius &&
      cached.squareCornerPointKeys === squareCornerPointKeys &&
      cached.crossingKey === crossingKey
    ) return [route.edgeId, cached.rendered] as const

    const rendered = bridgedPathData(displayRoute, crossingsByEdgeId, gridSize, {
      bridgeRadius,
      cornerRadius,
      squareCornerPointKeys,
      sourceEndpointArc: endpointGeometry?.sourceEndpointArc,
      targetEndpointArc: endpointGeometry?.targetEndpointArc,
    })
    cache?.set(route.edgeId, {
      route: displayRoute,
      crossingKey,
      gridSize,
      bridgeRadius,
      cornerRadius,
      squareCornerPointKeys,
      rendered,
    })
    return [route.edgeId, rendered] as const
  }))
}

export function createCoolingPipeShellsByRenderKey(
  routeGroups: ConnectionRouteRenderGroup[],
  allRoutes: RoutedConnectionEdge[],
  networksById: ReadonlyMap<string, ConnectionNetwork>,
  geometryByEdgeId: ReadonlyMap<string, ConnectedRouteDisplayGeometry>,
  crossingsByEdgeId: ConnectionCrossingIndex,
  branchPointKeysByNetworkId: ReadonlyMap<string, ReadonlySet<string>>,
  gridSize: number,
  cache?: Map<string, CoolingPipeShellRouteCacheEntry>,
) {
  pruneRouteCache(cache, allRoutes)
  return new Map<string, CoolingPipeShellGroup>(routeGroups.flatMap((group) => {
    if (!isCoolingConnectionType(group.type)) return []
    const nodesById = new Map(
      networksById.get(group.networkId)?.nodes.map((node) => [node.id, node]) ?? [],
    )
    const shellRoutes = group.routes.map((route) => {
      const endpointGeometry = geometryByEdgeId.get(route.edgeId)
      const displayRoute = endpointGeometry?.route ?? route
      const sourceNode = nodesById.get(route.sourceNodeId)
      const targetNode = nodesById.get(route.targetNodeId)
      const sourceInset = sourceNode?.kind === 'element-anchor'
        ? COOLING_PIPE_SHELL_ENDPOINT_INSET
        : 0
      const targetInset = targetNode?.kind === 'element-anchor'
        ? COOLING_PIPE_SHELL_ENDPOINT_INSET
        : 0
      const squareCornerPointKeys = branchPointKeysByNetworkId.get(route.networkId)
      const crossingKey = connectionCrossingKey(crossingsByEdgeId.get(route.edgeId) ?? [])
      const cached = cache?.get(route.edgeId)
      if (
        cached?.displayRoute === displayRoute &&
        cached.endpointGeometry === endpointGeometry &&
        cached.crossingKey === crossingKey &&
        cached.gridSize === gridSize &&
        cached.squareCornerPointKeys === squareCornerPointKeys &&
        cached.sourceInset === sourceInset &&
        cached.targetInset === targetInset
      ) return cached

      const points = insetPolylineEndpoints(
        displayRoute.points,
        sourceInset,
        targetInset,
      )
      const shellRoute: CoolingPipeShellRouteCacheEntry = {
        displayRoute,
        endpointGeometry,
        crossingKey,
        gridSize,
        squareCornerPointKeys,
        sourceInset,
        targetInset,
        path: bridgedPathData(
          { ...displayRoute, points },
          crossingsByEdgeId,
          gridSize,
          {
            bridgeRadius: COOLING_PIPE_BRIDGE_RADIUS,
            cornerRadius: COOLING_PIPE_CORNER_RADIUS,
            squareCornerPointKeys,
            sourceEndpointArc: endpointGeometry?.sourceEndpointArc,
            targetEndpointArc: endpointGeometry?.targetEndpointArc,
          },
        ).linePath,
        points: [
          ...points,
          ...(endpointGeometry?.sourceEndpointArc
            ? [endpointGeometry.sourceEndpointArc.midpoint]
            : []),
          ...(endpointGeometry?.targetEndpointArc
            ? [endpointGeometry.targetEndpointArc.midpoint]
            : []),
        ],
      }
      cache?.set(route.edgeId, shellRoute)
      return shellRoute
    })
    return [[group.renderKey, {
      path: shellRoutes.map((route) => route.path).join(' '),
      points: shellRoutes.flatMap((route) => route.points),
    }] as const]
  }))
}

export function createCoolingNodeIdsByNetwork(connections: ConnectionNetwork[]) {
  return new Map(connections.flatMap((network) => (
    isCoolingConnectionType(network.type)
      ? [[network.id, new Set(network.nodes.flatMap((node) => (
          node.kind === 'node' ? [node.id] : []
        )))] as const]
      : []
  )))
}

export function createUnderpassAnimationExclusions(
  routes: RoutedConnectionEdge[],
  crossings: ConnectionCrossing[],
  gridSize: number,
) {
  const routesById = new Map(routes.map((route) => [route.edgeId, route]))
  const exclusions = new Map<string, Array<{ point: Point; radius: number }>>()
  crossings.forEach((crossing) => {
    if (!routesById.has(crossing.underEdgeId) && !crossing.underEdgeId.startsWith('busbar:')) {
      return
    }
    const bridge = routesById.get(crossing.bridgeEdgeId)
    const radius = bridge && isCoolingConnectionType(bridge.type)
      ? COOLING_PIPE_BRIDGE_RADIUS
      : gridSize * 0.5
    const edgeExclusions = exclusions.get(crossing.underEdgeId) ?? []
    edgeExclusions.push({ point: crossing, radius })
    exclusions.set(crossing.underEdgeId, edgeExclusions)
  })
  return exclusions
}

export function createDisplayedRoutePaths(
  routes: RoutedConnectionEdge[],
  edgesById: ReadonlyMap<string, ConnectionEdge>,
  geometryByEdgeId: ReadonlyMap<string, ConnectedRouteDisplayGeometry>,
  crossingsByEdgeId: ConnectionCrossingIndex,
  branchPointKeysByNetworkId: ReadonlyMap<string, ReadonlySet<string>>,
  gridSize: number,
) {
  return new Map(routes.map((route) => {
    const cooling = isCoolingConnectionType(route.type)
    const geometry = cooling ? geometryByEdgeId.get(route.edgeId) : undefined
    const displayRoute = geometry?.route ?? route
    const edge = edgesById.get(route.edgeId)
    const lineColor = edge?.color ?? defaultConnectionColor(route.type)
    const path: MonitorFlowPath = {
      id: `edge-display:${route.edgeId}`,
      connectionEdgeId: route.edgeId,
      points: bridgedPolylinePoints(displayRoute, crossingsByEdgeId, gridSize, cooling
        ? {
            bridgeRadius: COOLING_PIPE_BRIDGE_RADIUS,
            cornerRadius: COOLING_PIPE_CORNER_RADIUS,
            squareCornerPointKeys: branchPointKeysByNetworkId.get(route.networkId),
            sourceEndpointArc: geometry?.sourceEndpointArc,
            targetEndpointArc: geometry?.targetEndpointArc,
          }
        : {}),
      worldWidth: cooling ? coolingPipeCoreWidth(edge?.coolingLineRole) : undefined,
      style: cooling ? 'cooling' : 'power',
      renderPriority: connectionEdgeCrossingPriority(edge),
      baseColor: cooling
        ? resolvedCoolingLineColor(lineColor, edge?.coolingLineRole)
        : lineColor,
    }
    return [route.edgeId, { route, path } satisfies DisplayedRoutePath] as const
  }))
}

export function createStaticConnectionGroupsByRenderKey(
  routeGroups: ConnectionRouteRenderGroup[],
  activeFlowPaths: MonitorFlowPath[],
  inactiveFlowPaths: MonitorFlowPath[],
) {
  const activeByEdge = groupFlowPathsByConnectionEdge(activeFlowPaths)
  const inactiveByEdge = groupFlowPathsByConnectionEdge(inactiveFlowPaths)
  return new Map<string, MonitorStaticFlowLineGroup[]>(routeGroups.map((group) => [
    group.renderKey,
    buildMonitorStaticFlowLineGroups(
      group.routes.flatMap((route) => activeByEdge.get(route.edgeId) ?? []),
      group.routes.flatMap((route) => inactiveByEdge.get(route.edgeId) ?? []),
    ).filter((staticGroup) => staticGroup.kind === 'connection'),
  ]))
}

export function createConnectedAnchorIdsByElement(connections: ConnectionNetwork[]) {
  const connectedAnchorIds = new Map<string, Set<string>>()
  connections.forEach((network) => {
    const connectedNodeIds = new Set(network.edges.flatMap((edge) => [
      edge.sourceNodeId,
      edge.targetNodeId,
    ]))
    network.nodes.forEach((node) => {
      if (node.kind !== 'element-anchor' || !connectedNodeIds.has(node.id)) return
      const ids = connectedAnchorIds.get(node.elementId) ?? new Set<string>()
      ids.add(node.anchorId)
      connectedAnchorIds.set(node.elementId, ids)
    })
  })
  return connectedAnchorIds
}

function groupFlowPathsByConnectionEdge(paths: MonitorFlowPath[]) {
  const grouped = new Map<string, MonitorFlowPath[]>()
  paths.forEach((path) => {
    if (!path.connectionEdgeId) return
    const edgePaths = grouped.get(path.connectionEdgeId) ?? []
    edgePaths.push(path)
    grouped.set(path.connectionEdgeId, edgePaths)
  })
  return grouped
}

function connectionCrossingKey(crossings: ConnectionCrossing[]) {
  return crossings.map((crossing) => (
    `${crossing.x},${crossing.y}:${crossing.underEdgeId}`
  )).join('|')
}

function pruneRouteCache<T>(
  cache: Map<string, T> | undefined,
  activeRoutes: RoutedConnectionEdge[],
) {
  if (!cache) return
  const activeEdgeIds = new Set(activeRoutes.map((route) => route.edgeId))
  cache.forEach((_, edgeId) => {
    if (!activeEdgeIds.has(edgeId)) cache.delete(edgeId)
  })
}
