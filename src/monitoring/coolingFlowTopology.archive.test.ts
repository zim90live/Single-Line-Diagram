import { describe, expect, it } from 'vitest'
import archivedProject from '../../scene-archives/WuHu AIDC 0831.json'
import { parseProjectDocument } from '../domain/project'
import { deriveCoolingFlowTopology } from './coolingFlowTopology'
import { MockCoolingRuntimeProvider } from './coolingRuntime'

describe('archived TMU to FM topology', () => {
  it('drives every FM branch and the middle loop without animating the open dead end', () => {
    const document = parseProjectDocument(archivedProject)
    const diagram = document.diagrams.find(({ name }) => name === 'TMU到FM 01')
    expect(diagram).toBeDefined()
    const elements = document.elements.filter(({ diagramId }) => diagramId === diagram?.id)
    const networks = Object.values(document.connections)
      .filter(({ diagramId }) => diagramId === diagram?.id)
    const runtime = new MockCoolingRuntimeProvider().getSnapshot({
      elements,
      assets: document.assets,
    })
    const topology = deriveCoolingFlowTopology({
      elements,
      assets: document.assets,
      networks,
      runtime,
    })
    const elementsById = new Map(elements.map((element) => [element.id, element]))
    const fmEdgeIds = networks.flatMap((network) => {
      const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
      return network.edges.flatMap((edge) => {
        const endpointNodes = [nodesById.get(edge.sourceNodeId), nodesById.get(edge.targetNodeId)]
        return endpointNodes.some((node) => (
          node?.kind === 'element-anchor' &&
          elementsById.get(node.elementId)?.assetKey === 'fm'
        )) ? [edge.id] : []
      })
    })
    const flowingEdgeIds = new Set(topology.edges.map(({ edgeId }) => edgeId))
    const middleLoopEdgeIds = [
      'connection-edge-6afa95c3-a939-4e96-84ba-08c158747817',
      'connection-edge-a78d920d-151a-496e-9160-723d2c16f59c',
      'connection-edge-1e70c443-d817-4479-99a9-133db13d2e7e',
      'connection-edge-7a291437-1a10-4f8e-9f93-4bb77b82475d',
    ]
    const openDeadEndEdgeId = 'connection-edge-453380a3-82da-44cb-893b-430437023793'

    expect(fmEdgeIds).toHaveLength(8)
    expect(fmEdgeIds.every((edgeId) => flowingEdgeIds.has(edgeId))).toBe(true)
    expect(middleLoopEdgeIds.every((edgeId) => flowingEdgeIds.has(edgeId))).toBe(true)
    expect(flowingEdgeIds.has(openDeadEndEdgeId)).toBe(false)
  })
})
