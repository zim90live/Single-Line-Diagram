import {
  resolveConnectionType,
  type AnchorType,
  type AssetDefinition,
  type ConnectionNode,
  type ConnectionNetwork,
  type DiagramElement,
} from '../domain/project'
import type { DirectedFlowEdge } from './flowTopology'
import {
  diagnoseCoolingPumpAsset,
  resolveCoolingCheckValvePorts,
  resolveCoolingPumpPorts,
  type CoolingRuntimeSnapshot,
} from './coolingRuntime'

type FlowDirection = DirectedFlowEdge['direction']
type CoolingCircuitFamily = 'primary' | 'secondary' | 'tertiary' | 'general'
type CoolingThermalSide = 'cold' | 'hot'
type AllowedDirection = 'both' | 'forward' | 'reverse'

interface CoolingHydraulicLink {
  id: string
  startNodeId: string
  endNodeId: string
  conductance: number
  allowedDirection: AllowedDirection
  edgeId?: string
  lineLinkId?: string
}

interface CoolingLineLink {
  id: string
  edgeId: string
  startNodeId: string
  endNodeId: string
}

interface ActivePump {
  elementId: string
  sourceNodeId: string
  targetNodeId: string
  targetFlow: number
}

export type CoolingFlowDiagnosticCode =
  | 'pump-configuration-invalid'
  | 'pump-port-unconnected'
  | 'pump-open-loop'
  | 'flow-direction-conflict'

export interface CoolingFlowDiagnostic {
  code: CoolingFlowDiagnosticCode
  message: string
  pumpElementId?: string
  edgeId?: string
}

export interface CoolingFlowTopology {
  edges: DirectedFlowEdge[]
  diagnostics: CoolingFlowDiagnostic[]
  activePumpElementIds: Set<string>
  pumpFlowRates: Record<string, number>
}

const FLOW_EPSILON = 1e-5
const COOLING_LINE_SOURCE_FLOW = 100
const VISUAL_CIRCULATION_FLOW = 1

/** Stable demo-only resistance diversity; independent of frame time and ordering. */
export function coolingDemoConductance(key: string) {
  let hash = 2166136261
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return 0.7 + (hash >>> 0) / 0xffffffff * 0.6
}

function directCoolingTypesCompatible(left: AnchorType, right: AnchorType) {
  return left !== 'electrical' &&
    right !== 'electrical' &&
    resolveConnectionType([left, right]) !== null
}

function coolingCircuitFamily(type: AnchorType): CoolingCircuitFamily | null {
  if (type === 'electrical') return null
  if (type === 'cooling-general') return 'general'
  if (type.startsWith('cooling-primary-')) return 'primary'
  return type.startsWith('cooling-tertiary-') ? 'tertiary' : 'secondary'
}

function coolingThermalSide(type: AnchorType | undefined): CoolingThermalSide | null {
  if (!type || type === 'electrical' || type === 'cooling-general') return null
  return type.endsWith('-cold') ? 'cold' : 'hot'
}

function isFmAsset(asset: AssetDefinition) {
  return asset.key === 'fm'
}

function isTmuAsset(asset: AssetDefinition) {
  return asset.key === 'tmu'
}

function numberedCoolingCircuitKeys(asset: AssetDefinition) {
  const keys = new Map<string, string>()
  const portsByFamily = new Map<
    Exclude<CoolingCircuitFamily, 'general'>,
    Array<{ anchorId: string; thermalSide: CoolingThermalSide; circuitNumber: string | null }>
  >()
  for (const anchor of asset.anchors) {
    const family = coolingCircuitFamily(anchor.type)
    const thermalSide = coolingThermalSide(anchor.type)
    if (!family || family === 'general' || !thermalSide) continue
    const circuitNumber = anchor.name.trim().match(/(?:^|\s)(\d+)$/)?.[1] ?? null
    const ports = portsByFamily.get(family) ?? []
    ports.push({ anchorId: anchor.id, thermalSide, circuitNumber })
    portsByFamily.set(family, ports)
  }

  for (const [family, ports] of portsByFamily) {
    const coldNumbers = ports
      .filter((port) => port.thermalSide === 'cold')
      .map((port) => port.circuitNumber)
    const hotNumbers = ports
      .filter((port) => port.thermalSide === 'hot')
      .map((port) => port.circuitNumber)
    if (
      coldNumbers.length < 2 ||
      hotNumbers.length < 2 ||
      coldNumbers.some((number) => number === null) ||
      hotNumbers.some((number) => number === null)
    ) continue
    const coldNumberSet = new Set(coldNumbers)
    const hotNumberSet = new Set(hotNumbers)
    if (
      coldNumberSet.size !== coldNumbers.length ||
      hotNumberSet.size !== hotNumbers.length ||
      coldNumberSet.size !== hotNumberSet.size ||
      [...coldNumberSet].some((number) => !hotNumberSet.has(number))
    ) continue
    for (const port of ports) {
      keys.set(port.anchorId, `${family}:${port.circuitNumber}`)
    }
  }
  return keys
}

function resolveInternalPortFamily(
  networkType: AnchorType | undefined,
  anchorType: AnchorType | undefined,
): CoolingCircuitFamily | null {
  if (!networkType || !anchorType) return null
  const networkFamily = coolingCircuitFamily(networkType)
  const anchorFamily = coolingCircuitFamily(anchorType)
  if (!networkFamily || !anchorFamily) return null
  if (networkFamily === 'general') return anchorFamily
  if (anchorFamily === 'general') return networkFamily
  return networkFamily === anchorFamily ? networkFamily : null
}

function internalPortsCompatible(
  left: CoolingCircuitFamily | null,
  right: CoolingCircuitFamily | null,
  knownFamilies: Set<CoolingCircuitFamily>,
) {
  if (!left || !right) return false
  if (left === 'general' && right === 'general') return true
  if (left === 'general' || right === 'general') return knownFamilies.size <= 1
  return left === right
}

function connect(adjacency: Map<string, string[]>, from: string, to: string) {
  const links = adjacency.get(from)
  if (links) links.push(to)
  else adjacency.set(from, [to])
}

function directedAdjacency(
  links: CoolingHydraulicLink[],
  activeLinkIds: Set<string>,
) {
  const adjacency = new Map<string, string[]>()
  for (const link of links) {
    if (!activeLinkIds.has(link.id)) continue
    if (link.allowedDirection !== 'reverse') {
      connect(adjacency, link.startNodeId, link.endNodeId)
    }
    if (link.allowedDirection !== 'forward') {
      connect(adjacency, link.endNodeId, link.startNodeId)
    }
  }
  adjacency.forEach((targets) => targets.sort())
  return adjacency
}

function reversedAdjacency(adjacency: Map<string, string[]>) {
  const reversed = new Map<string, string[]>()
  for (const [sourceNodeId, targetNodeIds] of adjacency) {
    for (const targetNodeId of targetNodeIds) connect(reversed, targetNodeId, sourceNodeId)
  }
  reversed.forEach((sources) => sources.sort())
  return reversed
}

function findShortestNodePath({
  adjacency,
  starts,
  targets,
}: {
  adjacency: Map<string, string[]>
  starts: string[]
  targets: string[]
}) {
  const targetIds = new Set(targets)
  const queue: string[] = []
  const previous = new Map<string, string | null>()
  for (const start of [...starts].sort()) {
    if (previous.has(start)) continue
    previous.set(start, null)
    queue.push(start)
  }
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index]
    if (targetIds.has(nodeId)) {
      const path: string[] = []
      let cursor: string | null = nodeId
      while (cursor) {
        path.push(cursor)
        cursor = previous.get(cursor) ?? null
      }
      return path.reverse()
    }
    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      if (previous.has(nextNodeId)) continue
      previous.set(nextNodeId, nodeId)
      queue.push(nextNodeId)
    }
  }
  return null
}

function reachableNodeIds(adjacency: Map<string, string[]>, sourceNodeId: string) {
  const reachable = new Set<string>([sourceNodeId])
  const queue = [sourceNodeId]
  for (let index = 0; index < queue.length; index += 1) {
    for (const nextNodeId of adjacency.get(queue[index]) ?? []) {
      if (reachable.has(nextNodeId)) continue
      reachable.add(nextNodeId)
      queue.push(nextNodeId)
    }
  }
  return reachable
}

function openCoolingBoundaryNodeIds(
  links: CoolingHydraulicLink[],
  activeLinkIds: Set<string>,
  nodesById: Map<string, ConnectionNode>,
  excludedNodeIds: Set<string>,
) {
  const neighbors = new Map<string, Set<string>>()
  for (const link of links) {
    if (!activeLinkIds.has(link.id)) continue
    const startNeighbors = neighbors.get(link.startNodeId) ?? new Set<string>()
    startNeighbors.add(link.endNodeId)
    neighbors.set(link.startNodeId, startNeighbors)
    const endNeighbors = neighbors.get(link.endNodeId) ?? new Set<string>()
    endNeighbors.add(link.startNodeId)
    neighbors.set(link.endNodeId, endNeighbors)
  }
  return [...neighbors].flatMap(([nodeId, adjacentNodeIds]) => (
    adjacentNodeIds.size === 1 &&
    nodesById.get(nodeId)?.kind === 'node' &&
    !excludedNodeIds.has(nodeId)
      ? [nodeId]
      : []
  )).sort()
}

function undirectedBridgeLinkIds(
  links: CoolingHydraulicLink[],
  activeLinkIds: Set<string>,
) {
  const adjacency = new Map<string, Array<{ linkId: string; nodeId: string }>>()
  for (const link of links) {
    if (!activeLinkIds.has(link.id)) continue
    const startLinks = adjacency.get(link.startNodeId) ?? []
    startLinks.push({ linkId: link.id, nodeId: link.endNodeId })
    adjacency.set(link.startNodeId, startLinks)
    const endLinks = adjacency.get(link.endNodeId) ?? []
    endLinks.push({ linkId: link.id, nodeId: link.startNodeId })
    adjacency.set(link.endNodeId, endLinks)
  }
  adjacency.forEach((entries) => entries.sort((left, right) => (
    left.linkId.localeCompare(right.linkId) || left.nodeId.localeCompare(right.nodeId)
  )))

  const discovery = new Map<string, number>()
  const low = new Map<string, number>()
  const bridges = new Set<string>()
  let timestamp = 0
  const visit = (nodeId: string, parentLinkId: string | null) => {
    timestamp += 1
    discovery.set(nodeId, timestamp)
    low.set(nodeId, timestamp)
    for (const entry of adjacency.get(nodeId) ?? []) {
      if (entry.linkId === parentLinkId) continue
      if (!discovery.has(entry.nodeId)) {
        visit(entry.nodeId, entry.linkId)
        low.set(nodeId, Math.min(low.get(nodeId) ?? 0, low.get(entry.nodeId) ?? 0))
        if ((low.get(entry.nodeId) ?? 0) > (discovery.get(nodeId) ?? 0)) {
          bridges.add(entry.linkId)
        }
      } else {
        low.set(nodeId, Math.min(low.get(nodeId) ?? 0, discovery.get(entry.nodeId) ?? 0))
      }
    }
  }
  for (const nodeId of [...adjacency.keys()].sort()) {
    if (!discovery.has(nodeId)) visit(nodeId, null)
  }
  return bridges
}

function addHydraulicLink(
  links: CoolingHydraulicLink[],
  link: CoolingHydraulicLink,
) {
  if (link.startNodeId !== link.endNodeId) links.push(link)
}

function multiplyLaplacian(
  vector: Float64Array,
  links: Array<{ startIndex: number; endIndex: number; conductance: number }>,
) {
  const result = new Float64Array(vector.length)
  for (const link of links) {
    const flow = link.conductance * (vector[link.startIndex] - vector[link.endIndex])
    result[link.startIndex] += flow
    result[link.endIndex] -= flow
  }
  return result
}

function dot(left: Float64Array, right: Float64Array) {
  let result = 0
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index]
  return result
}

function solveHydraulicPressures(
  links: CoolingHydraulicLink[],
  activeLinkIds: Set<string>,
  injections: Map<string, number>,
) {
  const nodeIds = [...new Set(links.flatMap((link) => activeLinkIds.has(link.id)
    ? [link.startNodeId, link.endNodeId]
    : []))].sort()
  const nodeIndex = new Map(nodeIds.map((nodeId, index) => [nodeId, index]))
  const indexedLinks = links.flatMap((link) => {
    if (!activeLinkIds.has(link.id)) return []
    const startIndex = nodeIndex.get(link.startNodeId)
    const endIndex = nodeIndex.get(link.endNodeId)
    return startIndex === undefined || endIndex === undefined
      ? []
      : [{ startIndex, endIndex, conductance: link.conductance }]
  })
  const rightHandSide = new Float64Array(nodeIds.length)
  injections.forEach((value, nodeId) => {
    const index = nodeIndex.get(nodeId)
    if (index !== undefined) rightHandSide[index] += value
  })
  if (!nodeIds.length || dot(rightHandSide, rightHandSide) <= FLOW_EPSILON ** 2) {
    return new Map(nodeIds.map((nodeId) => [nodeId, 0]))
  }

  const diagonal = new Float64Array(nodeIds.length)
  for (const link of indexedLinks) {
    diagonal[link.startIndex] += link.conductance
    diagonal[link.endIndex] += link.conductance
  }
  const pressure = new Float64Array(nodeIds.length)
  const residual = rightHandSide.slice()
  const preconditioned = new Float64Array(nodeIds.length)
  for (let index = 0; index < nodeIds.length; index += 1) {
    preconditioned[index] = diagonal[index] > 0 ? residual[index] / diagonal[index] : 0
  }
  const direction = preconditioned.slice()
  let residualDot = dot(residual, preconditioned)
  const initialNorm = Math.sqrt(dot(rightHandSide, rightHandSide))
  const tolerance = Math.max(1e-9, initialNorm * 1e-10)
  const maximumIterations = Math.max(80, nodeIds.length * 8)

  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const multiplied = multiplyLaplacian(direction, indexedLinks)
    const denominator = dot(direction, multiplied)
    if (Math.abs(denominator) <= Number.EPSILON) break
    const alpha = residualDot / denominator
    for (let index = 0; index < pressure.length; index += 1) {
      pressure[index] += alpha * direction[index]
      residual[index] -= alpha * multiplied[index]
    }
    if (Math.sqrt(dot(residual, residual)) <= tolerance) break
    for (let index = 0; index < nodeIds.length; index += 1) {
      preconditioned[index] = diagonal[index] > 0 ? residual[index] / diagonal[index] : 0
    }
    const nextResidualDot = dot(residual, preconditioned)
    if (Math.abs(residualDot) <= Number.EPSILON) break
    const beta = nextResidualDot / residualDot
    for (let index = 0; index < direction.length; index += 1) {
      direction[index] = preconditioned[index] + beta * direction[index]
    }
    residualDot = nextResidualDot
  }

  return new Map(nodeIds.map((nodeId, index) => [nodeId, pressure[index]]))
}

function linkFlow(link: CoolingHydraulicLink, pressures: Map<string, number>) {
  return link.conductance * (
    (pressures.get(link.startNodeId) ?? 0) - (pressures.get(link.endNodeId) ?? 0)
  )
}

function speedMultiplierForFlow(flowRate: number) {
  if (flowRate <= FLOW_EPSILON) return 0
  return Math.max(0.15, Math.min(2, Math.sqrt(flowRate / 100)))
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= FLOW_EPSILON
}

export function deriveCoolingFlowTopology({
  elements,
  assets,
  networks,
  runtime,
}: {
  elements: DiagramElement[]
  assets: AssetDefinition[]
  networks: ConnectionNetwork[]
  runtime: CoolingRuntimeSnapshot
}): CoolingFlowTopology {
  const coolingNetworks = networks.filter((network) => network.type !== 'electrical')
  const elementsById = new Map(elements.map((element) => [element.id, element]))
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
  const nodes = coolingNetworks.flatMap((network) => network.nodes)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const configuredSourceNodeIds = [...new Set(coolingNetworks.flatMap((network) => (
    network.edges.flatMap((edge) => {
      if (!edge.externalSupplyEndpoint) return []
      const nodeId = edge.externalSupplyEndpoint === 'source'
        ? edge.sourceNodeId
        : edge.targetNodeId
      return nodesById.has(nodeId) ? [nodeId] : []
    })
  )))].sort()
  const nodeTypesById = new Map(coolingNetworks.flatMap((network) => (
    network.nodes.map((node) => [node.id, network.type] as const)
  )))
  const variedDemoResistance = elements.some(element => {
    const asset = assetsByKey.get(element.assetKey)
    return asset ? isTmuAsset(asset) : false
  })
  const hydraulicLinks: CoolingHydraulicLink[] = []
  const lineLinks: CoolingLineLink[] = []
  const lineLinksByEdgeId = new Map<string, CoolingLineLink[]>()
  const intervalCountByLogicalConnection = new Map<string, number>()

  for (const network of coolingNetworks) {
    for (const edge of network.edges) {
      const chain = [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
        .filter((nodeId) => nodesById.has(nodeId))
      const key = `${network.id}:${edge.logicalConnectionId ?? edge.id}`
      intervalCountByLogicalConnection.set(
        key,
        (intervalCountByLogicalConnection.get(key) ?? 0) + Math.max(1, chain.length - 1),
      )
    }
  }

  for (const network of coolingNetworks) {
    for (const edge of network.edges) {
      const chain = [edge.sourceNodeId, ...(edge.routeNodeIds ?? []), edge.targetNodeId]
        .filter((nodeId) => nodesById.has(nodeId))
      const intervalCount = intervalCountByLogicalConnection.get(
        `${network.id}:${edge.logicalConnectionId ?? edge.id}`,
      ) ?? Math.max(1, chain.length - 1)
      for (let index = 1; index < chain.length; index += 1) {
        const startNodeId = chain[index - 1]
        const endNodeId = chain[index]
        const id = `cooling-line:${edge.id}:${startNodeId}:${endNodeId}`
        const lineLink = { id, edgeId: edge.id, startNodeId, endNodeId }
        lineLinks.push(lineLink)
        const edgeLinks = lineLinksByEdgeId.get(edge.id) ?? []
        edgeLinks.push(lineLink)
        lineLinksByEdgeId.set(edge.id, edgeLinks)
        addHydraulicLink(hydraulicLinks, {
          ...lineLink,
          lineLinkId: id,
          conductance: intervalCount * (variedDemoResistance
            ? coolingDemoConductance(`${network.id}:${edge.logicalConnectionId ?? edge.id}`) : 1),
          allowedDirection: edge.flowDirection === 'forward'
            ? 'forward'
            : edge.flowDirection === 'reverse'
              ? 'reverse'
              : 'both',
        })
      }
    }
  }

  const elementAnchorNodes = new Map<
    string,
    Array<Extract<ConnectionNode, { kind: 'element-anchor' }>>
  >()
  for (const node of nodes) {
    if (node.kind !== 'element-anchor') continue
    const group = elementAnchorNodes.get(node.elementId) ?? []
    group.push(node)
    elementAnchorNodes.set(node.elementId, group)
  }

  const tmuBoundaryCandidates: Array<{
    elementId: string
    starts: string[]
    targets: string[]
    targetFlow: number
  }> = []

  for (const [elementId, anchorNodes] of elementAnchorNodes) {
    const element = elementsById.get(elementId)
    const asset = element ? assetsByKey.get(element.assetKey) : undefined
    if (!element || !asset || asset.coolingDeviceRole === 'pump') continue
    if (
      (asset.coolingDeviceRole === 'valve' || asset.coolingDeviceRole === 'check-valve') &&
      runtime.valves[elementId]?.open !== true
    ) continue
    const circuitKeysByAnchorId = numberedCoolingCircuitKeys(asset)
    const internalPorts = anchorNodes.map((node) => ({
      node,
      family: resolveInternalPortFamily(
        nodeTypesById.get(node.id),
        asset.anchors.find((anchor) => anchor.id === node.anchorId)?.type,
      ),
      thermalSide: coolingThermalSide(
        asset.anchors.find((anchor) => anchor.id === node.anchorId)?.type ??
          nodeTypesById.get(node.id),
      ),
      circuitKey: circuitKeysByAnchorId.get(node.anchorId),
    }))
    const knownFamilies = new Set(internalPorts.flatMap(({ family }) => (
      family && family !== 'general' ? [family] : []
    )))
    if (isTmuAsset(asset)) {
      const portsByCircuitKey = new Map<string, typeof internalPorts>()
      for (const port of internalPorts) {
        if (!port.family) continue
        const key = port.circuitKey ?? port.family
        const ports = portsByCircuitKey.get(key) ?? []
        ports.push(port)
        portsByCircuitKey.set(key, ports)
      }
      for (const [circuitKey, ports] of portsByCircuitKey) {
        const coldPorts = ports.filter(({ thermalSide }) => thermalSide === 'cold')
        const hotPorts = ports.filter(({ thermalSide }) => thermalSide === 'hot')
        if (circuitKey === 'tertiary' || circuitKey.startsWith('tertiary:') ||
          circuitKey === 'secondary:2') {
          if (coldPorts.length && hotPorts.length) {
            tmuBoundaryCandidates.push({
              elementId,
              starts: coldPorts.map(({ node }) => node.id),
              targets: hotPorts.map(({ node }) => node.id),
              targetFlow: COOLING_LINE_SOURCE_FLOW,
            })
          }
          continue
        }
        for (const coldPort of coldPorts) {
          for (const hotPort of hotPorts) {
            if (!internalPortsCompatible(coldPort.family, hotPort.family, knownFamilies)) continue
            addHydraulicLink(hydraulicLinks, {
              id: `cooling-tmu:${elementId}:${coldPort.node.id}:${hotPort.node.id}`,
              startNodeId: coldPort.node.id,
              endNodeId: hotPort.node.id,
              conductance: 1,
              allowedDirection: 'both',
            })
          }
        }
      }
      continue
    }
    if (isFmAsset(asset)) {
      const coldPorts = internalPorts.filter(({ thermalSide }) => thermalSide === 'cold')
      const hotPorts = internalPorts.filter(({ thermalSide }) => thermalSide === 'hot')
      for (const coldPort of coldPorts) {
        for (const hotPort of hotPorts) {
          if (!internalPortsCompatible(coldPort.family, hotPort.family, knownFamilies)) continue
          if (
            coldPort.circuitKey &&
            hotPort.circuitKey &&
            coldPort.circuitKey !== hotPort.circuitKey
          ) continue
          addHydraulicLink(hydraulicLinks, {
            id: `cooling-fm:${elementId}:${coldPort.node.id}:${hotPort.node.id}`,
            startNodeId: coldPort.node.id,
            endNodeId: hotPort.node.id,
            conductance: variedDemoResistance ? coolingDemoConductance(`fm:${elementId}`) : 1,
            allowedDirection: 'forward',
          })
        }
      }
      continue
    }
    if (asset.coolingDeviceRole === 'check-valve') {
      const ports = resolveCoolingCheckValvePorts(asset)
      if (!ports) continue
      const inlets = internalPorts.filter(({ node }) => node.anchorId === ports.inlet.id)
      const outlets = internalPorts.filter(({ node }) => node.anchorId === ports.outlet.id)
      for (const inlet of inlets) {
        for (const outlet of outlets) {
          if (!internalPortsCompatible(inlet.family, outlet.family, knownFamilies)) continue
          addHydraulicLink(hydraulicLinks, {
            id: `cooling-check-valve:${elementId}:${inlet.node.id}:${outlet.node.id}`,
            startNodeId: inlet.node.id,
            endNodeId: outlet.node.id,
            conductance: 1,
            allowedDirection: 'forward',
          })
        }
      }
      continue
    }
    for (let leftIndex = 0; leftIndex < internalPorts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < internalPorts.length; rightIndex += 1) {
        const left = internalPorts[leftIndex]
        const right = internalPorts[rightIndex]
        if (!internalPortsCompatible(left.family, right.family, knownFamilies)) continue
        if (left.circuitKey && right.circuitKey && left.circuitKey !== right.circuitKey) continue
        addHydraulicLink(hydraulicLinks, {
          id: `cooling-device:${elementId}:${left.node.id}:${right.node.id}`,
          startNodeId: left.node.id,
          endNodeId: right.node.id,
          conductance: 1,
          allowedDirection: 'both',
        })
      }
    }
  }

  hydraulicLinks.sort((left, right) => left.id.localeCompare(right.id))
  const diagnostics: CoolingFlowDiagnostic[] = []
  const pumpCandidates: Array<{
    elementId: string
    starts: string[]
    targets: string[]
    targetFlow: number
  }> = []
  const allLinkIds = new Set(hydraulicLinks.map((link) => link.id))
  const initialAdjacency = directedAdjacency(hydraulicLinks, allLinkIds)

  for (const element of elements) {
    const asset = assetsByKey.get(element.assetKey)
    if (!asset || asset.coolingDeviceRole !== 'pump') continue
    const pumpRuntime = runtime.pumps[element.id]
    if (!pumpRuntime?.running || pumpRuntime.targetFlow <= FLOW_EPSILON) continue
    const assetDiagnostics = diagnoseCoolingPumpAsset(asset)
    const ports = resolveCoolingPumpPorts(asset)
    if (!ports || assetDiagnostics.length) {
      diagnostics.push(...assetDiagnostics.map((diagnostic) => ({
        code: 'pump-configuration-invalid' as const,
        pumpElementId: element.id,
        message: diagnostic.message,
      })))
      continue
    }
    const anchorNodes = elementAnchorNodes.get(element.id) ?? []
    const starts = anchorNodes.filter((node) => (
      node.anchorId === ports.outlet.id &&
      directCoolingTypesCompatible(nodeTypesById.get(node.id) ?? 'electrical', ports.outlet.type)
    )).map((node) => node.id)
    const targets = anchorNodes.filter((node) => (
      node.anchorId === ports.inlet.id &&
      directCoolingTypesCompatible(nodeTypesById.get(node.id) ?? 'electrical', ports.inlet.type)
    )).map((node) => node.id)
    if (!starts.length || !targets.length) {
      diagnostics.push({
        code: 'pump-port-unconnected',
        pumpElementId: element.id,
        message: `${element.name} 的水泵入口或出口尚未接入管路`,
      })
      continue
    }
    if (!findShortestNodePath({ adjacency: initialAdjacency, starts, targets })) {
      diagnostics.push({
        code: 'pump-open-loop',
        pumpElementId: element.id,
        message: `${element.name} 的出口无法通过有效管路返回同一水泵入口`,
      })
      continue
    }
    pumpCandidates.push({
      elementId: element.id,
      starts,
      targets,
      targetFlow: pumpRuntime.targetFlow,
    })
  }

  const activeLinkIds = new Set(allLinkIds)
  let pressures = new Map<string, number>()
  let activePumps: ActivePump[] = []
  let activeTmuBoundaries: ActivePump[] = []
  for (let pass = 0; pass <= hydraulicLinks.length; pass += 1) {
    const adjacency = directedAdjacency(hydraulicLinks, activeLinkIds)
    activePumps = pumpCandidates.flatMap((pump) => {
      const path = findShortestNodePath({ adjacency, starts: pump.starts, targets: pump.targets })
      return path?.length
        ? [{
            elementId: pump.elementId,
            sourceNodeId: path[0],
            targetNodeId: path[path.length - 1],
            targetFlow: pump.targetFlow,
          }]
        : []
    })
    activeTmuBoundaries = tmuBoundaryCandidates.flatMap((boundary) => {
      const path = findShortestNodePath({
        adjacency,
        starts: boundary.starts,
        targets: boundary.targets,
      })
      return path?.length
        ? [{
            elementId: boundary.elementId,
            sourceNodeId: path[0],
            targetNodeId: path[path.length - 1],
            targetFlow: boundary.targetFlow,
          }]
        : []
    })
    const injections = new Map<string, number>()
    for (const pump of [...activePumps, ...activeTmuBoundaries]) {
      injections.set(
        pump.sourceNodeId,
        (injections.get(pump.sourceNodeId) ?? 0) + pump.targetFlow,
      )
      injections.set(
        pump.targetNodeId,
        (injections.get(pump.targetNodeId) ?? 0) - pump.targetFlow,
      )
    }
    const openBoundaryNodeIds = openCoolingBoundaryNodeIds(
      hydraulicLinks,
      activeLinkIds,
      nodesById,
      new Set(configuredSourceNodeIds),
    )
    for (const sourceNodeId of configuredSourceNodeIds) {
      const reachable = reachableNodeIds(adjacency, sourceNodeId)
      const targets = openBoundaryNodeIds.filter((nodeId) => reachable.has(nodeId))
      if (!targets.length) continue
      injections.set(
        sourceNodeId,
        (injections.get(sourceNodeId) ?? 0) + COOLING_LINE_SOURCE_FLOW,
      )
      const targetFlow = COOLING_LINE_SOURCE_FLOW / targets.length
      for (const targetNodeId of targets) {
        injections.set(
          targetNodeId,
          (injections.get(targetNodeId) ?? 0) - targetFlow,
        )
      }
    }
    pressures = solveHydraulicPressures(hydraulicLinks, activeLinkIds, injections)
    const blocked = hydraulicLinks.filter((link) => {
      if (!activeLinkIds.has(link.id) || link.allowedDirection === 'both') return false
      const flow = linkFlow(link, pressures)
      return link.allowedDirection === 'forward'
        ? flow < -FLOW_EPSILON
        : flow > FLOW_EPSILON
    })
    if (!blocked.length) break
    blocked.forEach((link) => activeLinkIds.delete(link.id))
  }

  const activePumpElementIds = new Set(activePumps.map((pump) => pump.elementId))
  const pumpFlowRates = Object.fromEntries(elements.flatMap((element) => (
    assetsByKey.get(element.assetKey)?.coolingDeviceRole === 'pump'
      ? [[element.id, activePumpElementIds.has(element.id)
          ? runtime.pumps[element.id]?.targetFlow ?? 0
          : 0] as const]
      : []
  )))
  const finalAdjacency = directedAdjacency(hydraulicLinks, activeLinkIds)
  const finalReversedAdjacency = reversedAdjacency(finalAdjacency)
  const reachableFromTmuSources = new Set<string>()
  const canReachTmuTargets = new Set<string>()
  for (const boundary of activeTmuBoundaries) {
    for (const nodeId of reachableNodeIds(finalAdjacency, boundary.sourceNodeId)) {
      reachableFromTmuSources.add(nodeId)
    }
    for (const nodeId of reachableNodeIds(finalReversedAdjacency, boundary.targetNodeId)) {
      canReachTmuTargets.add(nodeId)
    }
  }
  const bridgeLinkIds = undirectedBridgeLinkIds(hydraulicLinks, activeLinkIds)
  const resolvedByLineLinkId = new Map<
    string,
    { direction: FlowDirection; speedMultiplier: number; flowRate: number }
  >()
  for (const link of hydraulicLinks) {
    if (!link.lineLinkId || !activeLinkIds.has(link.id)) continue
    const signedFlow = linkFlow(link, pressures)
    let direction: FlowDirection | null = signedFlow > FLOW_EPSILON
      ? 'forward'
      : signedFlow < -FLOW_EPSILON
        ? 'reverse'
        : null
    let flowRate = Math.abs(signedFlow)
    if (!direction && activeTmuBoundaries.length && !bridgeLinkIds.has(link.id)) {
      const supportsForward = link.allowedDirection !== 'reverse' &&
        reachableFromTmuSources.has(link.startNodeId) &&
        canReachTmuTargets.has(link.endNodeId)
      const supportsReverse = link.allowedDirection !== 'forward' &&
        reachableFromTmuSources.has(link.endNodeId) &&
        canReachTmuTargets.has(link.startNodeId)
      direction = supportsForward ? 'forward' : supportsReverse ? 'reverse' : null
      if (direction) flowRate = VISUAL_CIRCULATION_FLOW
    }
    if (!direction) continue
    flowRate = Math.round(flowRate * 1_000_000) / 1_000_000
    const speedMultiplier = Math.round(speedMultiplierForFlow(flowRate) * 1_000_000) / 1_000_000
    resolvedByLineLinkId.set(link.lineLinkId, {
      direction,
      speedMultiplier,
      flowRate,
    })
  }

  const edges: DirectedFlowEdge[] = []
  for (const network of coolingNetworks) {
    for (const edge of network.edges) {
      const edgeLinks = lineLinksByEdgeId.get(edge.id) ?? []
      const resolvedLinks = edgeLinks.flatMap((link) => {
        const resolved = resolvedByLineLinkId.get(link.id)
        return resolved ? [{ ...link, ...resolved }] : []
      })
      const first = resolvedLinks[0]
      const isUniformFullEdge = Boolean(
        first &&
        resolvedLinks.length === edgeLinks.length &&
        resolvedLinks.every((link) => (
          link.direction === first.direction &&
          nearlyEqual(link.speedMultiplier, first.speedMultiplier) &&
          nearlyEqual(link.flowRate, first.flowRate)
        )),
      )
      if (isUniformFullEdge && first) {
        edges.push({
          edgeId: edge.id,
          direction: first.direction,
          speedMultiplier: first.speedMultiplier,
          flowRate: first.flowRate,
        })
      } else {
        edges.push(...resolvedLinks.map((link) => ({
          edgeId: edge.id,
          direction: link.direction,
          startNodeId: link.startNodeId,
          endNodeId: link.endNodeId,
          speedMultiplier: link.speedMultiplier,
          flowRate: link.flowRate,
        })))
      }
    }
  }

  return { edges, diagnostics, activePumpElementIds, pumpFlowRates }
}
