import type { ConnectionNetwork } from '../domain/project'

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

export function minimumBusbarLengthForConnections(
  connections: ConnectionNetwork[],
  busbarId: string,
  gridSize: number,
) {
  return Math.max(gridSize, (busbarTapCount(connections, busbarId) - 1) * gridSize)
}

export function compressBusbarTapOffsets(
  connections: ConnectionNetwork[],
  busbarId: string,
  previousLength: number,
  nextLength: number,
  gridSize: number,
) {
  const taps = busbarTapEntries(connections, busbarId).sort((left, right) => (
    left.offset - right.offset ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.networkIndex - right.networkIndex ||
    left.nodeIndex - right.nodeIndex
  ))
  if (!taps.length || nextLength >= previousLength) return connections

  const availableUnits = Math.floor(nextLength / gridSize)
  if (taps.length > availableUnits + 1) {
    throw new RangeError('母线长度不足以容纳全部 8px 网格连接点')
  }

  const safePreviousLength = Math.max(gridSize, previousLength)
  const nextOffsets = new Map<string, number>()
  let previousUnit = -1

  taps.forEach((tap, index) => {
    const remainingTapCount = taps.length - index - 1
    const maximumUnit = availableUnits - remainingTapCount
    const projectedUnit = Math.round(
      (Math.max(0, Math.min(tap.offset, safePreviousLength)) / safePreviousLength) * availableUnits,
    )
    const unit = Math.max(previousUnit + 1, Math.min(projectedUnit, maximumUnit))
    nextOffsets.set(`${tap.networkIndex}:${tap.nodeIndex}`, unit * gridSize)
    previousUnit = unit
  })

  return connections.map((network, networkIndex) => {
    let changed = false
    const nodes = network.nodes.map((node, nodeIndex) => {
      const offset = nextOffsets.get(`${networkIndex}:${nodeIndex}`)
      if (offset === undefined || node.kind !== 'busbar-tap' || node.offset === offset) return node
      changed = true
      return { ...node, offset }
    })
    return changed ? { ...network, nodes } : network
  })
}
