import { expect, it } from 'vitest'
import type { ConnectionNetwork, DiagramElement } from '../domain/project'
import { demoLeakRegion } from './demoLeakRegion'

it('selects one TMU–FM network in diagram 01, excluding upstream networks and other diagrams', () => {
  const sensor: DiagramElement = { id: 'mp', assetKey: 'mp', diagramId: 'd', name: 'MP', x: 0, y: 0,
    width: 32, height: 32, rotation: 0, properties: {}, extensions: {} }
  const network: ConnectionNetwork = { id: 'b', diagramId: 'd', type: 'cooling-general',
    nodes: [{ id: 'port', kind: 'element-anchor', elementId: 'mp', anchorId: 'a' }, { id: 'end', kind: 'node', x: 80, y: 0 }],
    edges: [{ id: 'edge', sourceNodeId: 'port', targetNodeId: 'end' }] }
  const unrelated: ConnectionNetwork = { ...network, id: 'a', nodes: [{ id: 'port', kind: 'node', x: 0, y: 0 }, { id: 'end', kind: 'node', x: 80, y: 0 }] }
  const elements = [sensor, { ...sensor, id: 'tmu', assetKey: 'tmu' }, { ...sensor, id: 'fm', assetKey: 'fm' }]
  const loop: ConnectionNetwork = { ...network, id: 'loop', nodes: [...network.nodes,
    { id: 'tmu-port', kind: 'element-anchor', elementId: 'tmu', anchorId: 'cold' },
    { id: 'fm-port', kind: 'element-anchor', elementId: 'fm', anchorId: 'cold' }],
    edges: [...network.edges,
      { id: 'tmu-edge', sourceNodeId: 'tmu-port', targetNodeId: 'end' },
      { id: 'fm-edge', sourceNodeId: 'end', targetNodeId: 'fm-port' }] }
  const secondLoop = { ...loop, id: 'second-loop' }
  expect(demoLeakRegion('TMU到FM 01', [network, loop, secondLoop], elements)).toEqual({ networkId: 'loop', sensorIds: ['mp'] })
  expect(demoLeakRegion('TMU到FM 01', [secondLoop, loop, network], elements)).toEqual({ networkId: 'loop', sensorIds: ['mp'] })
  expect(demoLeakRegion('TMU到FM 01', [network, unrelated], elements)).toBeUndefined()
  expect(demoLeakRegion('TMU到FM 01', [{ ...loop, edges: network.edges }], elements)).toBeUndefined()
  expect(demoLeakRegion('TMU到FM 02', [loop], elements)).toBeUndefined()
  expect(demoLeakRegion('POD A', [network], [sensor])).toBeUndefined()
  expect(demoLeakRegion('TMU到FM 03', [network], [sensor])).toBeUndefined()
  expect(demoLeakRegion('TMU到FM 01', [], [sensor])).toBeUndefined()
})
