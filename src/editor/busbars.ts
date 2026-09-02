import type { Busbar, ConnectionNetwork } from '../domain/project'

interface BusbarTapEntry {
  networkIndex: number
  nodeIndex: number
  nodeId: string
  offset: number
}

function busbarTapEntries(connections: ConnectionNetwork[], busbarId: string) {
  return connections.flatMap((network, networkIndex) => network.nodes.flatMap((node, nodeIndex) => (
    node.kind === 'busbar-tap' && node.busbarId === busbarId
      ? [{ networkIndex, nodeIndex, nodeId: node.id, offset: node.offset }]
      : []
  ))) satisfies BusbarTapEntry[]
}

export function busbarTapCount(connections: ConnectionNetwork[], busbarId: string) {
  return busbarTapEntries(connections, busbarId).length
}

export interface ResizeBusbarResult {
  busbar: Busbar
  connections: ConnectionNetwork[]
  blocked: boolean
}

/**
 * Resizes a busbar without moving any persisted tap in world space. A start
 * resize updates every tap offset by the inverse displacement; an end resize
 * keeps offsets unchanged. Requests that would exclude a tap are clamped.
 */
export function resizeBusbarPreservingTapPositions(
  connections: ConnectionNetwork[],
  busbar: Busbar,
  endpoint: 'start' | 'end',
  requestedCoordinate: number,
  gridSize: number,
  minimumLength = gridSize,
): ResizeBusbarResult {
  const snap = (value: number) => Math.round(value / gridSize) * gridSize
  const requested = snap(requestedCoordinate)
  const taps = busbarTapEntries(connections, busbar.id)
  const start = busbar.orientation === 'horizontal' ? busbar.x : busbar.y
  const end = start + busbar.length
  const safeMinimumLength = Math.max(gridSize, minimumLength)

  if (endpoint === 'end') {
    const furthestTap = taps.reduce((maximum, tap) => Math.max(maximum, tap.offset), 0)
    const constrainedEnd = Math.max(requested, start + safeMinimumLength, start + furthestTap)
    return {
      busbar: { ...busbar, length: constrainedEnd - start },
      connections,
      blocked: furthestTap > safeMinimumLength && requested < start + furthestTap,
    }
  }

  const nearestTapWorldCoordinate = taps.reduce(
    (minimum, tap) => Math.min(minimum, start + tap.offset),
    Number.POSITIVE_INFINITY,
  )
  const maximumStart = Math.min(end - safeMinimumLength, nearestTapWorldCoordinate)
  const constrainedStart = Math.min(requested, maximumStart)
  const displacement = constrainedStart - start
  const nextConnections = displacement === 0
    ? connections
    : connections.map((network) => {
        let changed = false
        const nodes = network.nodes.map((node) => {
          if (node.kind !== 'busbar-tap' || node.busbarId !== busbar.id) return node
          changed = true
          return { ...node, offset: node.offset - displacement }
        })
        return changed ? { ...network, nodes } : network
      })

  return {
    busbar: busbar.orientation === 'horizontal'
      ? { ...busbar, x: constrainedStart, length: end - constrainedStart }
      : { ...busbar, y: constrainedStart, length: end - constrainedStart },
    connections: nextConnections,
    blocked: nearestTapWorldCoordinate < end - safeMinimumLength &&
      requested > nearestTapWorldCoordinate,
  }
}
