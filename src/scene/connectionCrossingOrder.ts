import type {
  ConnectionCrossingLayer,
  ConnectionEdge,
} from '../domain/project'

export function connectionCrossingLayerPriority(
  layer: ConnectionCrossingLayer | undefined,
) {
  if (layer === 'lower') return 0
  if (layer === 'upper') return 2
  return 1
}

/**
 * Produces one total display priority for non-connected crossings.
 * Manual lower/upper layers bracket the automatic business hierarchy;
 * cooling primary/auxiliary remains the stable tie-breaker inside a layer.
 */
export function connectionEdgeCrossingPriority(
  edge: Pick<ConnectionEdge, 'crossingLayer' | 'coolingLineRole'> | undefined,
) {
  const layerPriority = connectionCrossingLayerPriority(edge?.crossingLayer)
  const rolePriority = edge?.coolingLineRole === 'auxiliary' ? 0 : 1
  return layerPriority * 2 + rolePriority
}

export function compareConnectionEdgeCrossingPriority(
  left: Pick<ConnectionEdge, 'crossingLayer' | 'coolingLineRole'> | undefined,
  right: Pick<ConnectionEdge, 'crossingLayer' | 'coolingLineRole'> | undefined,
) {
  return connectionEdgeCrossingPriority(left) - connectionEdgeCrossingPriority(right)
}

export function sortByConnectionCrossingPriority<T>(
  items: readonly T[],
  edgeFor: (item: T) => Pick<ConnectionEdge, 'crossingLayer' | 'coolingLineRole'> | undefined,
) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      compareConnectionEdgeCrossingPriority(
        edgeFor(left.item),
        edgeFor(right.item),
      ) || left.index - right.index
    ))
    .map(({ item }) => item)
}
