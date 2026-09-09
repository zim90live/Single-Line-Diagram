import { describe, expect, it } from 'vitest'

import realSceneArchive from '../../scene-archives/WuHu AIDC 0904.json'
import { parseProjectDocument } from '../domain/project'
import { routeWaypointsForNetworks } from '../runtime/diagramRuntime'
import { mergeCollidingConnectionPoints } from './connectionJunctions'
import { syncRouteWaypointsToNetworks } from './routeWaypoints'
import { symbolAssets } from './symbolCatalog'
import {
  routeConnectionNetworks,
  routeConnectionNetworksForDirtyNetworks,
  routeConnectionNetworksIncrementally,
  manualRouteConstrainedEdgeIds,
  previewConnectionRoutesForDiagram,
  segmentConnectionEdgesAtNodes,
  type ConnectionRouteInput,
} from './connections'

const benchmarkEnabled = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env?.RUN_ROUTING_BENCHMARK === '1'

const benchmark = benchmarkEnabled ? it : it.skip

describe('real scene routing performance', () => {
  benchmark('profiles a connected-element move on TMU到FM 01', () => {
    const document = parseProjectDocument(realSceneArchive, symbolAssets)
    const diagram = document.diagrams.find((candidate) => candidate.name === 'TMU到FM 01')
    expect(diagram).toBeDefined()

    const input: ConnectionRouteInput = {
      networks: document.connections.filter((network) => network.diagramId === diagram!.id),
      elements: document.elements.filter((element) => element.diagramId === diagram!.id),
      assets: document.assets,
      gridSize: diagram!.canvas.gridSize,
      busbars: document.busbars.filter((busbar) => busbar.diagramId === diagram!.id),
      routeWaypoints: document.connections
        .filter((network) => network.diagramId === diagram!.id)
        .flatMap((network) => network.nodes.flatMap((node) => (
          node.kind === 'node' ? [{ id: node.id, x: node.x, y: node.y }] : []
        ))),
    }
    const connectedElementNode = input.networks.flatMap((network) => network.nodes).find((node) => (
      node.kind === 'element-anchor'
    ))
    expect(connectedElementNode?.kind).toBe('element-anchor')

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
        connectedElementNode?.kind === 'element-anchor' &&
        element.id === connectedElementNode.elementId
          ? { ...element, x: element.x + input.gridSize }
          : element
      )),
    }
    const incrementalStartedAt = performance.now()
    const incremental = routeConnectionNetworksIncrementally(input, routed, movedInput)
    const incrementalDurationMs = performance.now() - incrementalStartedAt
    const validationStartedAt = performance.now()
    const constrainedEdgeIds = manualRouteConstrainedEdgeIds(input.networks)
    const validationSkippedEdgeIds = new Set([
      ...routed.invalidEdgeIds,
      ...input.networks.flatMap((network) => network.edges.flatMap((edge) => (
        constrainedEdgeIds.has(edge.id) ? [] : [edge.id]
      ))),
    ])
    const validation = routeConnectionNetworksIncrementally(
      input,
      routed,
      movedInput,
      { skipDirtyEdgeIds: validationSkippedEdgeIds },
    )
    const validationDurationMs = performance.now() - validationStartedAt
    const validationBaseline = routed
    const connectedElementIds = [...new Set(input.networks.flatMap((network) => (
      network.nodes.flatMap((node) => node.kind === 'element-anchor' ? [node.elementId] : [])
    )))]
    const allElementValidationDurations = connectedElementIds.map((elementId) => {
      const candidateInput = {
        ...input,
        elements: input.elements.map((element) => element.id === elementId
          ? { ...element, x: element.x + input.gridSize }
          : element),
      }
      const startedAt = performance.now()
      const result = routeConnectionNetworksIncrementally(
        input,
        validationBaseline,
        candidateInput,
        { skipDirtyEdgeIds: validationSkippedEdgeIds },
      )
      return {
        durationMs: performance.now() - startedAt,
        dirtyEdgeCount: result.dirtyEdgeCount,
      }
    }).sort((left, right) => left.durationMs - right.durationMs)
    const validationP95 = allElementValidationDurations[
      Math.min(
        allElementValidationDurations.length - 1,
        Math.floor(allElementValidationDurations.length * 0.95),
      )
    ]
    const validationWorst = allElementValidationDurations.at(-1)

    const directlyAffectedNetworkIds = new Set(input.networks.flatMap((network) => (
      network.nodes.some((node) => (
        node.kind === 'element-anchor' &&
        connectedElementNode?.kind === 'element-anchor' &&
        node.elementId === connectedElementNode.elementId
      )) ? [network.id] : []
    )))
    const directStartedAt = performance.now()
    const directlyRouted = routeConnectionNetworksForDirtyNetworks(
      movedInput,
      routed,
      directlyAffectedNetworkIds,
    )
    const directDurationMs = performance.now() - directStartedAt

    const previewStartedAt = performance.now()
    const preview = previewConnectionRoutesForDiagram(
      routed,
      input.networks,
      movedInput.networks,
      input.elements,
      movedInput.elements,
      input.assets,
      input.gridSize,
      input.busbars,
      movedInput.busbars,
    )
    const previewDurationMs = performance.now() - previewStartedAt

    const mergeStartedAt = performance.now()
    const merged = mergeCollidingConnectionPoints({
      networks: input.networks,
      routeWaypoints: input.routeWaypoints ?? [],
      routedEdges: routed.edges,
      diagramId: diagram!.id,
      elements: movedInput.elements,
      assets: input.assets,
      busbars: input.busbars,
      movedElementIds: connectedElementNode?.kind === 'element-anchor'
        ? new Set([connectedElementNode.elementId])
        : new Set(),
    })
    const mergeDurationMs = performance.now() - mergeStartedAt

    const commitStartedAt = performance.now()
    const commitNetworks = segmentConnectionEdgesAtNodes(
      syncRouteWaypointsToNetworks(merged!.networks, merged!.routeWaypoints),
    )
    const commitWaypoints = routeWaypointsForNetworks(commitNetworks)
    JSON.stringify(input.networks)
    JSON.stringify(commitNetworks)
    JSON.stringify(input.routeWaypoints)
    JSON.stringify(commitWaypoints)
    const commitPreparationDurationMs = performance.now() - commitStartedAt

    console.info('REAL_SCENE_ROUTING_PERF', JSON.stringify({
      elements: input.elements.length,
      busbars: input.busbars.length,
      networks: input.networks.length,
      edges: input.networks.reduce((total, network) => total + network.edges.length, 0),
      routeWaypoints: input.routeWaypoints?.length ?? 0,
      movedElementId: connectedElementNode?.kind === 'element-anchor'
        ? connectedElementNode.elementId
        : null,
      directlyAffectedNetworkCount: directlyAffectedNetworkIds.size,
      fullDurationMs: Number(fullDurationMs.toFixed(2)),
      incrementalDurationMs: Number(incrementalDurationMs.toFixed(2)),
      validationDurationMs: Number(validationDurationMs.toFixed(2)),
      validationDirtyEdgeCount: validation.dirtyEdgeCount,
      validationReusedEdgeCount: validation.reusedEdgeCount,
      connectedElementCount: connectedElementIds.length,
      validationP95Ms: Number((validationP95?.durationMs ?? 0).toFixed(2)),
      validationWorstMs: Number((validationWorst?.durationMs ?? 0).toFixed(2)),
      validationWorstDirtyEdgeCount: validationWorst?.dirtyEdgeCount ?? 0,
      directDurationMs: Number(directDurationMs.toFixed(2)),
      previewDurationMs: Number(previewDurationMs.toFixed(2)),
      mergeDurationMs: Number(mergeDurationMs.toFixed(2)),
      commitPreparationDurationMs: Number(commitPreparationDurationMs.toFixed(2)),
      mode: incremental.mode,
      dirtyNetworkCount: incremental.dirtyNetworkCount,
      dirtyEdgeCount: incremental.dirtyEdgeCount,
      reusedEdgeCount: incremental.reusedEdgeCount,
      invalidEdgeCount: routed.invalidEdgeIds.length,
    }))
    expect(merged).not.toBeNull()
    expect(preview.edges.length).toBe(routed.edges.length)
    expect(directlyRouted.edges.length + directlyRouted.invalidEdgeIds.length).toBeGreaterThan(0)
    expect(incremental.routed.edges.length + incremental.routed.invalidEdgeIds.length).toBeGreaterThan(0)
    expect(incrementalDurationMs).toBeLessThan(fullDurationMs)
    expect(validation.reusedEdgeCount).toBeGreaterThan(0)
    expect(validationDurationMs).toBeLessThan(incrementalDurationMs / 4)
    expect(validationP95?.durationMs ?? Number.POSITIVE_INFINITY).toBeLessThan(100)
  }, 15_000)
})
