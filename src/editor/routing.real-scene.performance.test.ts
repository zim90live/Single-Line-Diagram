import { describe, expect, it } from 'vitest'

import realSceneArchive from '../../scene-archives/WuHu AIDC 0814.json'
import { parseProjectDocument } from '../domain/project'
import { symbolAssets } from './symbolCatalog'
import {
  routeConnectionNetworks,
  routeConnectionNetworksIncrementally,
  type ConnectionRouteInput,
} from './connections'

const benchmarkEnabled = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env?.RUN_ROUTING_BENCHMARK === '1'

const benchmark = benchmarkEnabled ? it : it.skip

describe('real scene routing performance', () => {
  benchmark('compares a complete route with an incremental connected-element move', () => {
    const document = parseProjectDocument(realSceneArchive, symbolAssets)
    const diagram = document.diagrams.find((candidate) => (
      document.connections.filter((network) => network.diagramId === candidate.id).length > 50
    ))
    expect(diagram).toBeDefined()

    const input: ConnectionRouteInput = {
      networks: document.connections.filter((network) => network.diagramId === diagram!.id),
      elements: document.elements.filter((element) => element.diagramId === diagram!.id),
      assets: document.assets,
      gridSize: diagram!.canvas.gridSize,
      busbars: document.busbars.filter((busbar) => busbar.diagramId === diagram!.id),
    }
    const connectedElementId = input.networks.flatMap((network) => network.nodes).find((node) => (
      node.kind === 'element-anchor'
    ))
    expect(connectedElementId?.kind).toBe('element-anchor')

    const fullStartedAt = performance.now()
    const routed = routeConnectionNetworks(
      input.networks,
      input.elements,
      input.assets,
      input.gridSize,
      input.busbars,
    )
    const fullDurationMs = performance.now() - fullStartedAt
    const movedInput = {
      ...input,
      elements: input.elements.map((element) => (
        connectedElementId?.kind === 'element-anchor' &&
        element.id === connectedElementId.elementId
          ? { ...element, x: element.x + input.gridSize }
          : element
      )),
    }
    const incrementalStartedAt = performance.now()
    const incremental = routeConnectionNetworksIncrementally(input, routed, movedInput)
    const incrementalDurationMs = performance.now() - incrementalStartedAt

    console.info('REAL_SCENE_ROUTING_PERF', JSON.stringify({
      elements: input.elements.length,
      busbars: input.busbars.length,
      networks: input.networks.length,
      edges: input.networks.reduce((total, network) => total + network.edges.length, 0),
      fullDurationMs: Number(fullDurationMs.toFixed(2)),
      incrementalDurationMs: Number(incrementalDurationMs.toFixed(2)),
      mode: incremental.mode,
      dirtyNetworkCount: incremental.dirtyNetworkCount,
      reusedEdgeCount: incremental.reusedEdgeCount,
    }))
    expect(incremental.routed.invalidEdgeIds).toEqual([])
    expect(incremental.reusedEdgeCount).toBeGreaterThan(0)
    expect(incrementalDurationMs).toBeLessThan(fullDurationMs)
  })
})
