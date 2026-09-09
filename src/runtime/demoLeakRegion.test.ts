import { expect, it } from 'vitest'
import type { ConnectionNetwork, DiagramElement } from '../domain/project'
import { demoLeakRegion } from './demoLeakRegion'

it('restricts leaks to the two named diagrams and associates connected MP sensors', () => {
  const sensor: DiagramElement = { id: 'mp', assetKey: 'mp', diagramId: 'd', name: 'MP', x: 0, y: 0,
    width: 32, height: 32, rotation: 0, properties: {}, extensions: {} }
  const network: ConnectionNetwork = { id: 'b', diagramId: 'd', type: 'cooling-general',
    nodes: [{ id: 'port', kind: 'element-anchor', elementId: 'mp', anchorId: 'a' }, { id: 'end', kind: 'node', x: 80, y: 0 }],
    edges: [{ id: 'edge', sourceNodeId: 'port', targetNodeId: 'end' }] }
  const unrelated: ConnectionNetwork = { ...network, id: 'a', nodes: [{ id: 'port', kind: 'node', x: 0, y: 0 }, { id: 'end', kind: 'node', x: 80, y: 0 }] }
  for (const name of ['TMU到FM 01', 'TMU到FM 02']) {
    expect(demoLeakRegion(name, [unrelated, network], [sensor])).toEqual({ networkId: 'b', sensorIds: ['mp'] })
    expect(demoLeakRegion(name, [network, unrelated], [sensor])).toEqual({ networkId: 'b', sensorIds: ['mp'] })
  }
  expect(demoLeakRegion('POD A', [network], [sensor])).toBeUndefined()
  expect(demoLeakRegion('TMU到FM 03', [network], [sensor])).toBeUndefined()
  expect(demoLeakRegion('TMU到FM 01', [], [sensor])).toBeUndefined()
})
