import { describe, expect, it } from 'vitest'

import { createDefaultProject, type ConnectionNetwork } from '../domain/project'
import { symbolAssets } from '../scene/symbolCatalog'
import {
  createDiagramRuntimeView,
  routeWaypointsForNetworks,
} from './diagramRuntime'

describe('diagram runtime view', () => {
  it('selects one diagram and resolves its monitor navigation without editor state', () => {
    const document = createDefaultProject('运行时切片', symbolAssets)
    const lineSystem = document.lineSystems[0]
    const parent = document.diagrams.find((diagram) => diagram.id === lineSystem.rootDiagramId)!
    const child = {
      ...parent,
      id: 'runtime-child',
      parentId: parent.id,
      name: '运行时子图',
      level: 'building' as const,
    }
    document.diagrams.push(child)
    document.elements.push({
      id: 'runtime-link',
      diagramId: parent.id,
      assetKey: 'ups',
      name: '运行时入口',
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      properties: { drillDownDiagramId: child.id },
      extensions: {},
    })

    const view = createDiagramRuntimeView(document, parent.id)

    expect(view?.diagram.id).toBe(parent.id)
    expect(view?.lineSystem.id).toBe(lineSystem.id)
    expect(view?.elements.map((element) => element.id)).toContain('runtime-link')
    expect(view?.navigation['runtime-link']).toEqual({
      diagramId: child.id,
      diagramName: child.name,
    })
    expect(createDiagramRuntimeView(document, 'missing-diagram')).toBeNull()
  })

  it('derives legacy route waypoints from the current connection networks', () => {
    const network: ConnectionNetwork = {
      id: 'network-a',
      diagramId: 'diagram-a',
      type: 'electrical',
      nodes: [
        { id: 'source', kind: 'node', x: 0, y: 0 },
        { id: 'waypoint', kind: 'node', x: 8, y: 0 },
        { id: 'target', kind: 'node', x: 16, y: 0 },
      ],
      edges: [{
        id: 'edge-a',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        routeNodeIds: ['waypoint'],
      }],
    }

    expect(routeWaypointsForNetworks([network])).toEqual([
      { id: 'waypoint', x: 8, y: 0 },
    ])
  })
})
