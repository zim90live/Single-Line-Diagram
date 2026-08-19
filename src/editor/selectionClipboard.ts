import type {
  Busbar,
  ConnectionNetwork,
  ConnectionNode,
  DiagramElement,
  LineSystemType,
} from '../domain/project'
import { diagramObjectsBounds, snap, type Point } from './geometry'

export type DiagramClipboardOperation = 'copy' | 'cut'

export interface DiagramSelectionClipboard {
  operation: DiagramClipboardOperation
  sourceDiagramId: string | null
  sourceLineSystemType: LineSystemType | null
  elements: DiagramElement[]
  busbars: Busbar[]
  connections: ConnectionNetwork[]
}

export function createEmptySelectionClipboard(): DiagramSelectionClipboard {
  return {
    operation: 'copy',
    sourceDiagramId: null,
    sourceLineSystemType: null,
    elements: [],
    busbars: [],
    connections: [],
  }
}

export function clipboardCanPasteInto(
  clipboard: DiagramSelectionClipboard,
  lineSystemType: LineSystemType,
) {
  return clipboard.sourceLineSystemType === lineSystemType
}

export function centeredSelectionOffset(
  elements: DiagramElement[],
  busbars: Busbar[],
  targetCenter: Point,
  gridSize: number,
): Point {
  const bounds = diagramObjectsBounds(elements, busbars)
  if (!bounds) return { x: 0, y: 0 }
  return {
    x: snap(targetCenter.x - (bounds.x + bounds.width / 2), gridSize),
    y: snap(targetCenter.y - (bounds.y + bounds.height / 2), gridSize),
  }
}

function nodeBelongsToSelection(
  node: ConnectionNode,
  selectedElementIds: Set<string>,
  selectedBusbarIds: Set<string>,
) {
  return node.kind === 'element-anchor'
    ? selectedElementIds.has(node.elementId)
    : selectedBusbarIds.has(node.busbarId)
}

export function copyConnectionsWithinSelection(
  networks: ConnectionNetwork[],
  selectedElementIds: Set<string>,
  selectedBusbarIds: Set<string>,
) {
  return networks.flatMap((network) => {
    const selectedNodeIds = new Set(network.nodes.flatMap((node) => (
      nodeBelongsToSelection(node, selectedElementIds, selectedBusbarIds)
        ? [node.id]
        : []
    )))
    const edges = network.edges.filter((edge) => (
      selectedNodeIds.has(edge.sourceNodeId) && selectedNodeIds.has(edge.targetNodeId)
    ))
    if (!edges.length) return []
    const connectedNodeIds = new Set(edges.flatMap((edge) => [
      edge.sourceNodeId,
      edge.targetNodeId,
    ]))
    return [{
      ...network,
      nodes: network.nodes
        .filter((node) => connectedNodeIds.has(node.id))
        .map((node) => ({ ...node })),
      edges: edges.map((edge) => ({ ...edge })),
    }]
  })
}

type ConnectionIdFactory = (prefix: string) => string

const createConnectionId: ConnectionIdFactory = (prefix) => (
  `${prefix}-${crypto.randomUUID()}`
)

export function instantiateCopiedConnections(
  networks: ConnectionNetwork[],
  diagramId: string,
  elementIdMap: Map<string, string>,
  busbarIdMap: Map<string, string>,
  createId: ConnectionIdFactory = createConnectionId,
) {
  return networks.flatMap((network) => {
    const nodeIdMap = new Map<string, string>()
    const nodes = network.nodes.flatMap((node) => {
      const ownerId = node.kind === 'element-anchor'
        ? elementIdMap.get(node.elementId)
        : busbarIdMap.get(node.busbarId)
      if (!ownerId) return []
      const id = createId(node.kind === 'element-anchor'
        ? 'connection-node'
        : 'connection-busbar-tap')
      nodeIdMap.set(node.id, id)
      return [{
        ...node,
        id,
        ...(node.kind === 'element-anchor'
          ? { elementId: ownerId }
          : { busbarId: ownerId }),
      } as ConnectionNode]
    })
    const edges = network.edges.flatMap((edge) => {
      const sourceNodeId = nodeIdMap.get(edge.sourceNodeId)
      const targetNodeId = nodeIdMap.get(edge.targetNodeId)
      return sourceNodeId && targetNodeId
        ? [{
            ...edge,
            id: createId('connection-edge'),
            sourceNodeId,
            targetNodeId,
          }]
        : []
    })
    if (!edges.length) return []
    const connectedNodeIds = new Set(edges.flatMap((edge) => [
      edge.sourceNodeId,
      edge.targetNodeId,
    ]))
    return [{
      ...network,
      id: createId('connection-network'),
      diagramId,
      nodes: nodes.filter((node) => connectedNodeIds.has(node.id)),
      edges,
    }]
  })
}
