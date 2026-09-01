import { describe, expect, it } from 'vitest'

import {
  connectionEdgeSchema,
  createDefaultProject,
  EDITOR_GRID_SIZE,
  getDiagramPath,
  parseProjectDocument,
  projectOnOffStates,
  SCHEMA_VERSION,
  withOnOffStateSnapshot,
} from './project'

const asset = {
  key: 'test-symbol',
  name: '测试图元',
  category: '测试',
  source: 'test.svg',
  intrinsicWidth: 64,
  intrinsicHeight: 64,
  anchors: [],
}

describe('project document', () => {
  it('persists cooling line roles and treats legacy lines as primary', () => {
    expect(connectionEdgeSchema.parse({
      id: 'auxiliary-edge',
      sourceNodeId: 'source',
      targetNodeId: 'target',
      coolingLineRole: 'auxiliary',
    }).coolingLineRole).toBe('auxiliary')
    expect(connectionEdgeSchema.parse({
      id: 'primary-edge',
      sourceNodeId: 'source',
      targetNodeId: 'target',
    }).coolingLineRole).toBeUndefined()
    expect(() => connectionEdgeSchema.parse({
      id: 'invalid-edge',
      sourceNodeId: 'source',
      targetNodeId: 'target',
      coolingLineRole: 'secondary',
    })).toThrow()

    const legacy = createDefaultProject('v24 管路级别兼容', [asset]) as unknown as {
      schemaVersion: number
    }
    legacy.schemaVersion = 24
    const migrated = parseProjectDocument(legacy)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.connections.every((network) => network.edges.every((edge) => (
      edge.coolingLineRole === undefined
    )))).toBe(true)
  })

  it('creates two independent four-level line trees', () => {
    const document = createDefaultProject('测试项目', [asset])

    expect(document.lineSystems.map((line) => line.type)).toEqual(['cooling', 'power'])
    expect(document.lineSystems.map((line) => line.name)).toEqual(['冷却线路', '电力线路'])
    expect(document.diagrams).toHaveLength(8)
    expect(document.diagrams.every((diagram) => diagram.canvas.gridSize === EDITOR_GRID_SIZE)).toBe(true)

    const deviceDiagram = document.diagrams.find(
      (diagram) => diagram.lineSystemId === document.lineSystems[0].id && diagram.level === 'device',
    )
    expect(deviceDiagram).toBeDefined()
    expect(getDiagramPath(document, deviceDiagram!.id).map((diagram) => diagram.level)).toEqual([
      'campus',
      'building',
      'pod',
      'device',
    ])
  })

  it('round-trips through the versioned schema', () => {
    const document = createDefaultProject('往返测试', [{
      ...asset,
      anchors: [{
        id: 'anchor-round-trip',
        name: '电路 1',
        x: 8,
        y: 0,
        direction: 'top',
        type: 'electrical',
      }],
    }])
    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)))

    expect(parsed).toEqual(document)
  })

  it('migrates free-ended direct lines from schema v27', () => {
    const document = createDefaultProject('自由端点往返', [asset])
    const diagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.connections = [{
      id: 'direct-line-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'direct-start', kind: 'node', x: 0, y: 0 },
        { id: 'direct-end', kind: 'node', x: 80, y: 0 },
      ],
      edges: [{
        id: 'direct-edge',
        sourceNodeId: 'direct-start',
        targetNodeId: 'direct-end',
      }],
    }]

    const legacy = JSON.parse(JSON.stringify(document))
    legacy.schemaVersion = 27
    const parsed = parseProjectDocument(legacy)

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.connections).toEqual(document.connections)
  })

  it('persists independent monitoring metrics on child lines', () => {
    const document = createDefaultProject('子线运行指标', [asset])
    const diagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.connections = [{
      id: 'metric-line-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'metric-line-start', kind: 'node', x: 0, y: 0 },
        { id: 'metric-line-end', kind: 'node', x: 80, y: 0 },
      ],
      edges: [{
        id: 'metric-line-edge',
        sourceNodeId: 'metric-line-start',
        targetNodeId: 'metric-line-end',
        label: '馈线 01',
        labelVisible: false,
        monitorDataVisible: true,
        monitorMetricLabelsVisible: false,
        monitorMetrics: [{
          id: 'line-current',
          name: '电流',
          valueType: 'number',
          unit: 'A',
          precision: 1,
          simulationMin: 0,
          simulationMax: 100,
          alarm: { mode: 'upper', minor: 60, major: 80, critical: 95 },
        }],
      }],
    }]

    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)))
    expect(parsed.connections[0].edges[0]).toMatchObject({
      labelVisible: false,
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [{ id: 'line-current', name: '电流', unit: 'A' }],
    })

    const duplicateMetrics = structuredClone(document)
    duplicateMetrics.connections[0].edges[0].monitorMetrics!.push(
      structuredClone(duplicateMetrics.connections[0].edges[0].monitorMetrics![0]),
    )
    expect(() => parseProjectDocument(duplicateMetrics)).toThrow('子线的运行指标 ID 必须唯一')
  })

  it('round-trips explicit On/Off element states and fills export snapshots', () => {
    const statefulAsset = { ...asset, key: 'switch', name: 'Switch' }
    const document = createDefaultProject('开关状态往返', [statefulAsset])
    document.elements = [{
      id: 'switch-state-test',
      diagramId: document.diagrams[0].id,
      assetKey: 'switch',
      name: 'Switch',
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: { tag: 'SW-01' },
      extensions: {},
    }]

    const snapshot = withOnOffStateSnapshot(document, { 'switch-state-test': true })
    expect(snapshot.elements[0].onOffState).toBe('on')
    expect(projectOnOffStates(snapshot)).toEqual({ 'switch-state-test': true })
    expect(parseProjectDocument(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)

    const legacy = JSON.parse(JSON.stringify(snapshot))
    legacy.schemaVersion = 22
    delete legacy.elements[0].onOffState
    expect(parseProjectDocument(legacy).elements[0].onOffState).toBeUndefined()
  })

  it('round-trips cooling device and pump-port roles and keeps v21 assets unclassified', () => {
    const configured = createDefaultProject('冷却角色往返', [{
      ...asset,
      category: '冷却',
      coolingDeviceRole: 'pump' as const,
      anchors: [
        {
          id: 'pump-inlet',
          name: '入口',
          x: 0,
          y: 32,
          direction: 'left' as const,
          type: 'cooling-primary-cold' as const,
          flowRole: 'inlet' as const,
        },
        {
          id: 'pump-outlet',
          name: '出口',
          x: 64,
          y: 32,
          direction: 'right' as const,
          type: 'cooling-primary-cold' as const,
          flowRole: 'outlet' as const,
        },
      ],
    }])

    const roundTripped = parseProjectDocument(JSON.parse(JSON.stringify(configured)))
    expect(roundTripped.assets[0]).toMatchObject({
      coolingDeviceRole: 'pump',
      anchors: [
        { id: 'pump-inlet', flowRole: 'inlet' },
        { id: 'pump-outlet', flowRole: 'outlet' },
      ],
    })

    const schemaV21 = JSON.parse(JSON.stringify(createDefaultProject('旧版冷却角色', [{
      ...asset,
      category: '冷却',
      anchors: [{
        id: 'legacy-cooling-anchor',
        name: '冷却端口',
        x: 0,
        y: 32,
        direction: 'left',
        type: 'cooling-general',
      }],
    }])))
    schemaV21.schemaVersion = 21

    const migrated = parseProjectDocument(schemaV21)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.assets[0].coolingDeviceRole).toBeUndefined()
    expect(migrated.assets[0].anchors[0].flowRole).toBeUndefined()
  })

  it('migrates a v23 CV into a top-to-bottom check valve without changing anchor ids', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('CV 单向迁移', [{
      ...asset,
      key: 'cv',
      name: 'CV',
      category: '冷却',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      coolingDeviceRole: 'valve',
      anchors: [
        {
          id: 'legacy-cv-top',
          name: '通用 1',
          x: 16,
          y: 0,
          direction: 'top',
          type: 'cooling-general',
        },
        {
          id: 'legacy-cv-bottom',
          name: '通用 2',
          x: 16,
          y: 32,
          direction: 'bottom',
          type: 'cooling-general',
        },
      ],
    }])))
    legacy.schemaVersion = 23

    const migrated = parseProjectDocument(legacy)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.assets[0]).toMatchObject({
      key: 'cv',
      coolingDeviceRole: 'check-valve',
      anchors: [
        { id: 'legacy-cv-top', flowRole: 'inlet' },
        { id: 'legacy-cv-bottom', flowRole: 'outlet' },
      ],
    })

    const currentButMisclassified = JSON.parse(JSON.stringify(migrated))
    currentButMisclassified.assets[0].coolingDeviceRole = 'valve'
    expect(parseProjectDocument(currentButMisclassified).assets[0].coolingDeviceRole)
      .toBe('check-valve')
  })

  it('migrates schema v20 route waypoints into unified connection nodes', () => {
    const connectedAsset = {
      ...asset,
      anchors: [{
        id: 'electrical-anchor',
        name: '电路 1',
        x: 64,
        y: 32,
        direction: 'right' as const,
        type: 'electrical' as const,
      }],
    }
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('节点迁移', [connectedAsset])))
    const diagramId = legacy.lineSystems.find((line: { type: string }) => (
      line.type === 'power'
    )).rootDiagramId
    legacy.schemaVersion = 20
    legacy.diagrams.find((diagram: { id: string }) => diagram.id === diagramId).routeWaypoints = [
      { id: 'waypoint-a', x: 80, y: 96 },
    ]
    legacy.elements = ['left', 'right'].map((id, index) => ({
      id,
      diagramId,
      assetKey: connectedAsset.key,
      name: id,
      x: index * 160,
      y: 64,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    }))
    legacy.connections = [{
      id: 'route-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'electrical-anchor' },
        { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'electrical-anchor' },
      ],
      edges: [{
        id: 'route-edge',
        sourceNodeId: 'left-node',
        targetNodeId: 'right-node',
        routeWaypointIds: ['waypoint-a'],
      }],
    }]

    const migrated = parseProjectDocument(legacy, [connectedAsset])

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect('routeWaypoints' in migrated.diagrams.find((diagram) => diagram.id === diagramId)!).toBe(false)
    expect(migrated.connections[0].nodes).toContainEqual({
      id: 'waypoint-a',
      kind: 'node',
      x: 80,
      y: 96,
    })
    expect(migrated.connections[0].edges).toEqual([
      expect.objectContaining({
        id: 'route-edge',
        sourceNodeId: 'left-node',
        targetNodeId: 'waypoint-a',
        logicalConnectionId: 'route-edge',
      }),
      expect.objectContaining({
        sourceNodeId: 'waypoint-a',
        targetNodeId: 'right-node',
        logicalConnectionId: 'route-edge',
      }),
    ])
    expect(migrated.connections[0].edges.every((edge) => (
      edge.routeNodeIds === undefined
    ))).toBe(true)
  })

  it('migrates schema v25 route nodes into attributed node-bounded edges', () => {
    const connectedAsset = {
      ...asset,
      anchors: [{
        id: 'electrical-anchor',
        name: '电路 1',
        x: 64,
        y: 32,
        direction: 'right' as const,
        type: 'electrical' as const,
      }],
    }
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('v25 节点分段', [connectedAsset])))
    const diagramId = legacy.lineSystems.find((line: { type: string }) => (
      line.type === 'power'
    )).rootDiagramId
    legacy.schemaVersion = 25
    legacy.elements = ['left', 'right'].map((id, index) => ({
      id,
      diagramId,
      assetKey: connectedAsset.key,
      name: id,
      x: index * 160,
      y: 64,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    }))
    legacy.connections = [{
      id: 'v25-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'electrical-anchor' },
        { id: 'route-node', kind: 'node', x: 80, y: 96 },
        { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'electrical-anchor' },
      ],
      edges: [{
        id: 'v25-edge',
        sourceNodeId: 'left-node',
        targetNodeId: 'right-node',
        routeNodeIds: ['route-node'],
        color: '#123456',
        flowDirection: 'forward',
        label: '馈线 A',
        labelEndpoint: 'target',
      }],
    }]

    const migrated = parseProjectDocument(legacy, [connectedAsset])

    expect(migrated.connections[0].nodes).toContainEqual({
      id: 'route-node', kind: 'node', x: 80, y: 96,
    })
    expect(migrated.connections[0].edges).toHaveLength(2)
    expect(migrated.connections[0].edges.every((edge) => (
      edge.logicalConnectionId === 'v25-edge' &&
      edge.color === '#123456' &&
      edge.flowDirection === 'forward' &&
      edge.routeNodeIds === undefined
    ))).toBe(true)
    expect(migrated.connections[0].edges.filter((edge) => edge.label === '馈线 A')).toEqual([
      expect.objectContaining({
        id: 'v25-edge',
        sourceNodeId: 'route-node',
        targetNodeId: 'right-node',
        labelEndpoint: 'target',
      }),
    ])
  })

  it('round-trips topological junction nodes and enforces their 8px position', () => {
    const connectedAsset = {
      ...asset,
      anchors: [{
        id: 'electrical-anchor',
        name: '电路 1',
        x: 64,
        y: 32,
        direction: 'right' as const,
        type: 'electrical' as const,
      }],
    }
    const document = createDefaultProject('分流节点往返', [connectedAsset])
    const diagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.elements.push(...['left', 'right'].map((id, index) => ({
      id,
      diagramId,
      assetKey: connectedAsset.key,
      name: id,
      x: index * 160,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    })))
    document.connections.push({
      id: 'junction-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'electrical-anchor' },
        { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'electrical-anchor' },
        { id: 'junction', kind: 'node', x: 80, y: 32 },
      ],
      edges: [
        { id: 'left-edge', sourceNodeId: 'left-node', targetNodeId: 'junction' },
        { id: 'right-edge', sourceNodeId: 'junction', targetNodeId: 'right-node' },
      ],
    })

    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)))
    expect(parsed.connections[0].nodes).toContainEqual({
      id: 'junction',
      kind: 'node',
      x: 80,
      y: 32,
    })

    const offGrid = JSON.parse(JSON.stringify(document))
    offGrid.connections[0].nodes[2].x = 81
    expect(() => parseProjectDocument(offGrid)).toThrow(/8px/)
  })

  it('repairs off-grid editor-generated nodes in affected cached projects', () => {
    const connectedAsset = {
      ...asset,
      anchors: [{
        id: 'electrical-anchor',
        name: '电路 1',
        x: 64,
        y: 32,
        direction: 'right' as const,
        type: 'electrical' as const,
      }],
    }
    const document = createDefaultProject('旋转节点历史兼容', [connectedAsset])
    const diagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.elements.push(...['left', 'right'].map((id, index) => ({
      id,
      diagramId,
      assetKey: connectedAsset.key,
      name: id,
      x: index * 160,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    })))
    document.connections.push({
      id: 'rotation-bug-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'electrical-anchor' },
        { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'electrical-anchor' },
        {
          id: 'route-waypoint-1516e94d-1a7c-4b6c-bf8d-581b1015b986',
          kind: 'node',
          x: 84,
          y: 36,
        },
      ],
      edges: [
        {
          id: 'left-edge',
          sourceNodeId: 'left-node',
          targetNodeId: 'route-waypoint-1516e94d-1a7c-4b6c-bf8d-581b1015b986',
        },
        {
          id: 'right-edge',
          sourceNodeId: 'route-waypoint-1516e94d-1a7c-4b6c-bf8d-581b1015b986',
          targetNodeId: 'right-node',
        },
      ],
    })

    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)))

    expect(parsed.connections[0].nodes).toContainEqual({
      id: 'route-waypoint-1516e94d-1a7c-4b6c-bf8d-581b1015b986',
      kind: 'node',
      x: 88,
      y: 40,
    })
  })

  it('migrates schema v16 without inventing manual route constraints', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('途径点迁移', [asset])))
    legacy.schemaVersion = 16
    legacy.diagrams.forEach((diagram: Record<string, unknown>) => delete diagram.routeWaypoints)

    const migrated = parseProjectDocument(legacy, [asset])

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.diagrams.every((diagram) => !('routeWaypoints' in diagram))).toBe(true)
    expect(migrated.connections.every((network) => (
      network.edges.every((edge) => edge.routeNodeIds === undefined)
    ))).toBe(true)
  })

  it('repairs degenerate and dangling edges in schema v19 cached projects', () => {
    const connectedAsset = {
      ...asset,
      anchors: [{
        id: 'electrical-anchor',
        name: '电路 1',
        x: 64,
        y: 32,
        direction: 'right' as const,
        type: 'electrical' as const,
      }],
    }
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('v19 缓存修复', [connectedAsset])))
    const diagramId = legacy.lineSystems.find((line: { type: string }) => (
      line.type === 'power'
    )).rootDiagramId
    legacy.schemaVersion = 19
    legacy.elements = ['left', 'right'].map((id, index) => ({
      id,
      diagramId,
      assetKey: connectedAsset.key,
      name: id,
      x: index * 160,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    }))
    legacy.connections = [{
      id: 'legacy-v19-network',
      diagramId,
      type: 'electrical',
      nodes: [
        { id: 'left-node', kind: 'element-anchor', elementId: 'left', anchorId: 'electrical-anchor' },
        { id: 'right-node', kind: 'element-anchor', elementId: 'right', anchorId: 'electrical-anchor' },
        { id: 'merged-junction', kind: 'junction', x: 80, y: 32 },
      ],
      edges: [
        { id: 'left-edge', sourceNodeId: 'left-node', targetNodeId: 'merged-junction' },
        { id: 'degenerate-edge', sourceNodeId: 'merged-junction', targetNodeId: 'merged-junction' },
        { id: 'dangling-edge', sourceNodeId: 'right-node', targetNodeId: 'missing-node' },
        { id: 'right-edge', sourceNodeId: 'merged-junction', targetNodeId: 'right-node' },
      ],
    }]

    const migrated = parseProjectDocument(legacy, [connectedAsset])

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.connections[0].edges.map((edge) => edge.id)).toEqual([
      'left-edge',
      'right-edge',
    ])

    const invalidCurrent = structuredClone(migrated)
    invalidCurrent.connections[0].edges.push({
      id: 'current-self-loop',
      sourceNodeId: 'merged-junction',
      targetNodeId: 'merged-junction',
    })
    expect(() => parseProjectDocument(invalidCurrent, [connectedAsset]))
      .toThrow('线路边必须引用两个不同的有效节点')
  })

  it('migrates an older canvas grid to the active 8px grid', () => {
    const document = createDefaultProject('网格迁移', [asset])
    document.diagrams[0].canvas.gridSize = 10
    const parsed = parseProjectDocument(document)
    expect(parsed.diagrams[0].canvas.gridSize).toBe(8)
  })

  it('migrates schema v1 assets to dimensions and an empty anchor list', () => {
    const document = createDefaultProject('锚点迁移', [asset])
    const legacy = JSON.parse(JSON.stringify(document))
    legacy.schemaVersion = 1
    delete legacy.assets[0].intrinsicWidth
    delete legacy.assets[0].intrinsicHeight
    delete legacy.assets[0].anchors

    const parsed = parseProjectDocument(legacy, [asset])

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.busbars).toEqual([])
    expect(parsed.connections).toEqual([])
    expect(parsed.assets[0]).toMatchObject({
      intrinsicWidth: 64,
      intrinsicHeight: 64,
      anchors: [],
    })
  })

  it('migrates schema v4 projects to an empty busbar collection', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('母线迁移', [asset])))
    legacy.schemaVersion = 4
    delete legacy.busbars

    const parsed = parseProjectDocument(legacy, [asset])
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.busbars).toEqual([])
  })

  it('migrates schema v5 fixed junctions into endpoint-only logical links', () => {
    const connectedAsset = {
      ...asset,
      anchors: [{
        id: 'general-anchor',
        name: '通用 1',
        x: 0,
        y: 32,
        direction: 'left' as const,
        type: 'cooling-general' as const,
      }],
    }
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('固定分叉迁移', [connectedAsset])))
    const diagramId = legacy.lineSystems[0].rootDiagramId
    legacy.schemaVersion = 5
    legacy.elements = ['a', 'b', 'c'].map((id, index) => ({
      id,
      diagramId,
      assetKey: connectedAsset.key,
      name: id,
      x: index * 96,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    }))
    legacy.connections = [{
      id: 'legacy-network',
      diagramId,
      type: 'cooling-general',
      nodes: [
        { id: 'a-node', kind: 'element-anchor', elementId: 'a', anchorId: 'general-anchor' },
        { id: 'b-node', kind: 'element-anchor', elementId: 'b', anchorId: 'general-anchor' },
        { id: 'c-node', kind: 'element-anchor', elementId: 'c', anchorId: 'general-anchor' },
        { id: 'fixed-junction', kind: 'junction', x: 80, y: 32 },
      ],
      edges: [
        { id: 'a-edge', sourceNodeId: 'a-node', targetNodeId: 'fixed-junction' },
        { id: 'b-edge', sourceNodeId: 'b-node', targetNodeId: 'fixed-junction' },
        { id: 'c-edge', sourceNodeId: 'c-node', targetNodeId: 'fixed-junction' },
      ],
    }]

    const parsed = parseProjectDocument(legacy, [connectedAsset])

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.connections[0].nodes).toHaveLength(3)
    expect(parsed.connections[0].edges).toHaveLength(2)
    expect(parsed.connections[0].nodes.map((node) => node.kind)).not.toContain('junction')
  })

  it('migrates schema v6 documents to the color-capable schema', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('颜色迁移', [asset])))
    legacy.schemaVersion = 6

    const parsed = parseProjectDocument(legacy, [asset])

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.busbars).toEqual([])
    expect(parsed.connections).toEqual([])
  })

  it('migrates schema v7 elements to device identifiers and preserves label placement', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('标签迁移', [asset])))
    legacy.schemaVersion = 7
    legacy.elements = [
      {
        id: 'automatic-label',
        diagramId: legacy.diagrams[0].id,
        assetKey: asset.key,
        name: '测试图元',
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        rotation: 0,
        properties: {},
        extensions: {},
      },
      {
        id: 'manual-label',
        diagramId: legacy.diagrams[0].id,
        assetKey: asset.key,
        name: '测试图元',
        x: 80,
        y: 0,
        width: 64,
        height: 64,
        rotation: 90,
        labelPlacement: 'left',
        properties: { tag: 'CUSTOM-01' },
        extensions: {},
      },
    ]

    const parsed = parseProjectDocument(legacy, [asset])

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.elements[0].properties.tag).toBe('测试图元-01')
    expect(parsed.elements[0].labelPlacement).toBeUndefined()
    expect(parsed.elements[1].properties.tag).toBe('CUSTOM-01')
    expect(parsed.elements[1].labelPlacement).toBe('left')
  })

  it('migrates schema v8 busbars without labels and round-trips endpoint labels', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('母线标签迁移', [asset])))
    const powerDiagramId = legacy.lineSystems.find((line: { type: string }) => (
      line.type === 'power'
    )).rootDiagramId
    legacy.schemaVersion = 8
    legacy.busbars = [{
      id: 'busbar-without-label',
      diagramId: powerDiagramId,
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
    }]

    const migrated = parseProjectDocument(legacy, [asset])
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.busbars[0].label).toBeUndefined()

    const labelled = structuredClone(migrated)
    labelled.busbars[0].label = '市电母线'
    labelled.busbars[0].labelEndpoint = 'start'
    expect(parseProjectDocument(JSON.parse(JSON.stringify(labelled)), [asset]).busbars[0])
      .toMatchObject({ label: '市电母线', labelEndpoint: 'start' })
  })

  it('migrates schema v9 elements to visible labels and preserves per-element visibility', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('图元标签显隐迁移', [asset])))
    legacy.schemaVersion = 9
    legacy.elements = [{
      id: 'label-visibility-element',
      diagramId: legacy.diagrams[0].id,
      assetKey: asset.key,
      name: asset.name,
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: { tag: 'TEST-01' },
      extensions: {},
    }]

    const migrated = parseProjectDocument(legacy, [asset])
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.elements[0].labelVisible).toBeUndefined()

    migrated.elements[0].labelVisible = false
    const roundTripped = parseProjectDocument(JSON.parse(JSON.stringify(migrated)), [asset])
    expect(roundTripped.elements[0].labelVisible).toBe(false)
  })

  it('drops the superseded diagram-level label setting from interim schema v10 files', () => {
    const interim = JSON.parse(JSON.stringify(createDefaultProject('旧开关清理', [asset])))
    interim.schemaVersion = 10
    interim.diagrams[0].canvas.showElementLabels = false

    const parsed = parseProjectDocument(interim, [asset])

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect('showElementLabels' in parsed.diagrams[0].canvas).toBe(false)
  })

  it('migrates schema v10 busbars to visible labels and preserves hidden labels', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('母线标签显隐迁移', [asset])))
    const powerDiagramId = legacy.lineSystems.find((line: { type: string }) => (
      line.type === 'power'
    )).rootDiagramId
    legacy.schemaVersion = 10
    legacy.busbars = [{
      id: 'busbar-label-visibility',
      diagramId: powerDiagramId,
      type: 'electrical',
      orientation: 'horizontal',
      x: 0,
      y: 0,
      length: 160,
      label: '市电母线',
    }]

    const migrated = parseProjectDocument(legacy, [asset])
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.busbars[0].labelVisible).toBeUndefined()

    migrated.busbars[0].labelVisible = false
    const roundTripped = parseProjectDocument(JSON.parse(JSON.stringify(migrated)), [asset])
    expect(roundTripped.busbars[0]).toMatchObject({
      label: '市电母线',
      labelVisible: false,
    })
  })

  it('migrates legacy Switch On and Switch Off assets into one Switch asset', () => {
    const switchOff = {
      ...asset,
      key: 'switch-off',
      name: 'Switch Off',
      source: 'src/assets/symbols/SwitchOff.svg',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      anchors: [{
        id: 'switch-anchor-off',
        name: '电路 1',
        x: 16,
        y: 0,
        direction: 'top' as const,
        type: 'electrical' as const,
      }],
    }
    const switchOn = {
      ...asset,
      key: 'switch-on',
      name: 'Switch On',
      source: 'src/assets/symbols/SwitchOn.svg',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      anchors: [{
        id: 'switch-anchor-on',
        name: '电路 2',
        x: 16,
        y: 32,
        direction: 'bottom' as const,
        type: 'electrical' as const,
      }],
    }
    const installedSwitch = {
      ...switchOff,
      key: 'switch',
      name: 'Switch',
    }
    const document = createDefaultProject('Switch 迁移', [switchOff, switchOn])
    document.elements.push(
      {
        id: 'switch-off-instance',
        diagramId: document.diagrams[0].id,
        assetKey: 'switch-off',
        name: 'Switch Off',
        x: 0,
        y: 0,
        width: 32,
        height: 32,
        rotation: 0,
        properties: {},
        extensions: {},
      },
      {
        id: 'switch-on-instance',
        diagramId: document.diagrams[0].id,
        assetKey: 'switch-on',
        name: '保留的自定义名称',
        x: 40,
        y: 0,
        width: 32,
        height: 32,
        rotation: 0,
        properties: {},
        extensions: {},
      },
    )
    const legacy = JSON.parse(JSON.stringify(document))
    legacy.schemaVersion = 2

    const parsed = parseProjectDocument(legacy, [installedSwitch])

    expect(parsed.assets.filter((candidate) => candidate.key === 'switch')).toHaveLength(1)
    expect(parsed.assets.find((candidate) => candidate.key === 'switch')?.anchors).toHaveLength(2)
    expect(parsed.elements.map((element) => ({ key: element.assetKey, name: element.name })))
      .toEqual([
        { key: 'switch', name: 'Switch' },
        { key: 'switch', name: '保留的自定义名称' },
      ])
  })

  it('migrates a schema v12 Switch color into independent off/on colors', () => {
    const switchAsset = {
      ...asset,
      key: 'switch',
      name: 'Switch',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
    }
    const legacy = JSON.parse(JSON.stringify(createDefaultProject('Switch 颜色迁移', [switchAsset])))
    legacy.schemaVersion = 12
    legacy.elements = [{
      id: 'switch-colored',
      diagramId: legacy.diagrams[0].id,
      assetKey: 'switch',
      name: 'Switch',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      properties: { color: '#77b4bf' },
      extensions: {},
    }]

    const parsed = parseProjectDocument(legacy, [switchAsset])

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.elements[0].properties).toEqual({
      switchOffColor: '#77B4BF',
      switchOnColor: '#77B4BF',
      tag: 'Switch-01',
    })
    expect(parsed.elements[0].properties.color).toBeUndefined()
  })

  it.each(['2-wv', 'cv'])('migrates an existing %s color into independent off/on colors', (assetKey) => {
    const statefulAsset = {
      ...asset,
      key: assetKey,
      name: assetKey === '2-wv' ? '2WV' : 'CV',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
    }
    const legacy = createDefaultProject('阀门颜色迁移', [statefulAsset])
    legacy.elements = [{
      id: `${assetKey}-colored`,
      diagramId: legacy.diagrams[0].id,
      assetKey,
      name: statefulAsset.name,
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      properties: { color: '#556677', tag: `${statefulAsset.name}-01` },
      extensions: {},
    }]

    const parsed = parseProjectDocument(legacy, [statefulAsset])

    expect(parsed.elements[0].properties).toEqual({
      switchOffColor: '#556677',
      switchOnColor: '#556677',
      tag: `${statefulAsset.name}-01`,
    })
  })

  it('refreshes installed asset categories while preserving existing anchors', () => {
    const document = createDefaultProject('分类同步', [{
      ...asset,
      category: '旧分类',
      anchors: [{
        id: 'anchor-category-sync',
        name: '电路 1',
        x: 8,
        y: 0,
        direction: 'top',
        type: 'electrical',
      }],
    }])

    document.lineSystems[1].name = '供电线路'
    const parsed = parseProjectDocument(document, [{ ...asset, category: '电力' }])

    expect(parsed.lineSystems[1].name).toBe('电力线路')
    expect(parsed.assets[0].category).toBe('电力')
    expect(parsed.assets[0].anchors).toEqual(document.assets[0].anchors)
  })

  it('refreshes installed asset metadata, appends new catalog symbols, and preserves data', () => {
    const legacyCabinet = {
      ...asset,
      key: 'cabinet',
      name: 'Cabinet',
      category: '旧分类',
      source: 'src/assets/symbols/Cabinet.svg',
      intrinsicWidth: 48,
      intrinsicHeight: 48,
      anchors: [{
        id: 'cabinet-anchor',
        name: '电路 1',
        x: 0,
        y: 8,
        direction: 'left' as const,
        type: 'electrical' as const,
      }],
    }
    const cabinetA = {
      ...legacyCabinet,
      name: 'Cabinet A',
      category: '电力',
      source: 'src/assets/symbols/Cabinet A.svg',
      anchors: [],
    }
    const cabinetB = {
      ...cabinetA,
      key: 'cabinet-b',
      name: 'Cabinet B',
      source: 'src/assets/symbols/Cabinet B.svg',
    }
    const generic = {
      ...cabinetA,
      key: 'generic',
      name: '通用图元',
      category: '通用',
      source: 'src/assets/symbols/Generic.svg',
      intrinsicWidth: 96,
      intrinsicHeight: 48,
    }
    const tmu = {
      ...cabinetA,
      key: 'tmu',
      name: 'TMU',
      category: '冷却',
      source: 'src/assets/symbols/TMU.png',
      intrinsicWidth: 72,
      intrinsicHeight: 96,
    }
    const document = createDefaultProject('Cabinet 素材同步', [legacyCabinet])
    document.elements.push(
      {
        id: 'default-cabinet-name',
        diagramId: document.diagrams[0].id,
        assetKey: 'cabinet',
        name: 'Cabinet',
        x: 0,
        y: 0,
        width: 48,
        height: 48,
        rotation: 0,
        properties: {},
        extensions: {},
      },
      {
        id: 'custom-cabinet-name',
        diagramId: document.diagrams[0].id,
        assetKey: 'cabinet',
        name: '东侧机柜',
        x: 56,
        y: 0,
        width: 48,
        height: 48,
        rotation: 0,
        properties: {},
        extensions: {},
      },
    )

    const parsed = parseProjectDocument(document, [cabinetA, cabinetB, generic, tmu])

    expect(parsed.assets.find((candidate) => candidate.key === 'cabinet')).toMatchObject({
      name: 'Cabinet A',
      category: '电力',
      source: 'src/assets/symbols/Cabinet A.svg',
      anchors: legacyCabinet.anchors,
    })
    expect(parsed.assets.find((candidate) => candidate.key === 'cabinet-b')).toEqual(cabinetB)
    expect(parsed.assets.find((candidate) => candidate.key === 'generic')).toEqual(generic)
    expect(parsed.assets.find((candidate) => candidate.key === 'tmu')).toEqual(tmu)
    expect(parsed.elements.map((element) => element.name)).toEqual(['Cabinet A', '东侧机柜'])
  })

  it('migrates the old TMU default size and edge anchors to 72 by 96 once', () => {
    const legacyTmu = {
      ...asset,
      key: 'tmu',
      name: 'TMU',
      category: '冷却',
      source: 'src/assets/symbols/TMU.png',
      intrinsicWidth: 48,
      intrinsicHeight: 64,
      anchors: [
        {
          id: 'top-port',
          name: '顶部接口',
          x: 24,
          y: 0,
          direction: 'top' as const,
          type: 'cooling-general' as const,
        },
        {
          id: 'right-port',
          name: '右侧接口',
          x: 48,
          y: 32,
          direction: 'right' as const,
          type: 'cooling-general' as const,
        },
      ],
    }
    const currentTmu = {
      ...legacyTmu,
      intrinsicWidth: 72,
      intrinsicHeight: 96,
      anchors: [],
    }
    const document = createDefaultProject('TMU 尺寸兼容', [legacyTmu])
    document.elements.push(
      {
        id: 'legacy-default-tmu',
        diagramId: document.diagrams[0].id,
        assetKey: 'tmu',
        name: 'TMU-01',
        x: 0,
        y: 0,
        width: 48,
        height: 64,
        rotation: 0,
        properties: {},
        extensions: {},
      },
      {
        id: 'resized-tmu',
        diagramId: document.diagrams[0].id,
        assetKey: 'tmu',
        name: 'TMU-02',
        x: 104,
        y: 0,
        width: 96,
        height: 128,
        rotation: 0,
        properties: {},
        extensions: {},
      },
    )

    const parsed = parseProjectDocument(document, [currentTmu])
    const parsedTmu = parsed.assets.find((candidate) => candidate.key === 'tmu')

    expect(parsedTmu).toMatchObject({ intrinsicWidth: 72, intrinsicHeight: 96 })
    expect(parsedTmu?.anchors).toEqual([
      expect.objectContaining({ id: 'top-port', x: 40, y: 0, direction: 'top' }),
      expect.objectContaining({ id: 'right-port', x: 72, y: 48, direction: 'right' }),
    ])
    expect(parsed.elements.find((element) => element.id === 'legacy-default-tmu'))
      .toMatchObject({ width: 72, height: 96 })
    expect(parsed.elements.find((element) => element.id === 'resized-tmu'))
      .toMatchObject({ width: 96, height: 128 })
    expect(parseProjectDocument(parsed, [currentTmu])).toEqual(parsed)
  })

  it('migrates legacy portrait PHE assets and instances to the PNG landscape layout', () => {
    const legacyPhe = {
      ...asset,
      key: 'phe',
      name: 'PHE',
      category: '冷却',
      source: 'src/assets/symbols/PHE.svg',
      intrinsicWidth: 80,
      intrinsicHeight: 160,
      anchors: [
        { id: 'primary-hot', name: '一次回路热 1', x: 0, y: 8, direction: 'left' as const, type: 'cooling-primary-hot' as const },
        { id: 'primary-cold', name: '一次回路冷 1', x: 0, y: 152, direction: 'left' as const, type: 'cooling-primary-cold' as const },
        { id: 'secondary-cold', name: '二次回路冷 1', x: 80, y: 8, direction: 'right' as const, type: 'cooling-secondary-cold' as const },
        { id: 'secondary-hot', name: '二次回路热 1', x: 80, y: 152, direction: 'right' as const, type: 'cooling-secondary-hot' as const },
      ],
    }
    const currentPhe = {
      ...legacyPhe,
      source: 'src/assets/symbols/PHE.png',
      intrinsicWidth: 200,
      intrinsicHeight: 80,
      anchors: [],
    }
    const document = createDefaultProject('PHE 横版迁移', [legacyPhe])
    document.elements = [{
      id: 'legacy-phe-element',
      diagramId: document.diagrams[0].id,
      assetKey: 'phe',
      name: 'PHE',
      x: 712,
      y: 904,
      width: 80,
      height: 160,
      rotation: 90,
      labelPlacement: 'left',
      properties: { tag: 'HE1' },
      extensions: {},
    }]

    const parsed = parseProjectDocument(document, [currentPhe])

    expect(parsed.assets[0]).toMatchObject({
      source: 'src/assets/symbols/PHE.png',
      intrinsicWidth: 200,
      intrinsicHeight: 80,
      anchors: [
        { id: 'primary-hot', x: 144, y: 0, direction: 'top', type: 'cooling-primary-hot' },
        { id: 'primary-cold', x: 64, y: 0, direction: 'top', type: 'cooling-primary-cold' },
        { id: 'secondary-cold', x: 144, y: 80, direction: 'bottom', type: 'cooling-secondary-cold' },
        { id: 'secondary-hot', x: 64, y: 80, direction: 'bottom', type: 'cooling-secondary-hot' },
      ],
    })
    expect(parsed.elements[0]).toMatchObject({
      id: 'legacy-phe-element',
      x: 672,
      y: 944,
      width: 200,
      height: 80,
      rotation: 0,
      labelPlacement: 'left',
      properties: { tag: 'HE1' },
    })
    expect(parseProjectDocument(parsed, [currentPhe])).toEqual(parsed)
  })

  it('validates anchor grid, edge, corner, duplicate, and outward direction rules', () => {
    const valid = createDefaultProject('锚点校验', [{
      ...asset,
      anchors: [{
        id: 'anchor-1',
        name: '电路 1',
        x: 8,
        y: 0,
        direction: 'top' as const,
        type: 'electrical' as const,
      }],
    }])
    expect(parseProjectDocument(valid).assets[0].anchors).toHaveLength(1)

    const corner = structuredClone(valid)
    corner.assets[0].anchors[0] = { ...corner.assets[0].anchors[0], x: 0 }
    expect(() => parseProjectDocument(corner)).toThrow('角点不能添加锚点')

    const wrongDirection = structuredClone(valid)
    wrongDirection.assets[0].anchors[0] = {
      ...wrongDirection.assets[0].anchors[0],
      direction: 'left',
    }
    expect(() => parseProjectDocument(wrongDirection)).toThrow('方向必须垂直边缘向外')

    const outside = structuredClone(valid)
    outside.assets[0].anchors[0] = { ...outside.assets[0].anchors[0], x: 0, y: 72 }
    expect(() => parseProjectDocument(outside)).toThrow('锚点不能超出图元边界')

    const duplicate = structuredClone(valid)
    duplicate.assets[0].anchors.push({
      ...duplicate.assets[0].anchors[0],
      id: 'anchor-2',
    })
    expect(() => parseProjectDocument(duplicate)).toThrow('同一位置只能有一个锚点')
  })

  it('rejects an element whose asset reference is missing', () => {
    const document = createDefaultProject('错误引用测试', [asset])
    document.elements.push({
      id: 'element-1',
      diagramId: document.diagrams[0].id,
      assetKey: 'missing',
      name: '无效图元',
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: {},
      extensions: {},
    })

    expect(() => parseProjectDocument(document)).toThrow('不存在的素材')
  })

  it('round-trips a valid instance color and rejects malformed color values', () => {
    const document = createDefaultProject('图元颜色校验', [asset])
    document.elements.push({
      id: 'colored-element',
      diagramId: document.diagrams[0].id,
      assetKey: asset.key,
      name: asset.name,
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      properties: { color: '#77B4BF' },
      extensions: {},
    })

    expect(parseProjectDocument(document).elements[0].properties.color).toBe('#77B4BF')

    document.elements[0].properties.color = 'blue'
    expect(() => parseProjectDocument(document)).toThrow('颜色必须是六位十六进制值')

    document.elements[0].properties.color = '#77B4BF'
    document.elements[0].properties.switchOnColor = 'green'
    expect(() => parseProjectDocument(document)).toThrow('开状态颜色必须是六位十六进制值')
  })

  it('round-trips generic border visibility through the existing property container', () => {
    const genericAsset = {
      ...asset,
      key: 'generic',
      name: '通用图元',
      category: '通用',
      intrinsicWidth: 96,
      intrinsicHeight: 48,
    }
    const document = createDefaultProject('通用图元虚线显隐', [genericAsset])
    document.elements.push({
      id: 'generic-hidden-border',
      diagramId: document.diagrams[0].id,
      assetKey: genericAsset.key,
      name: genericAsset.name,
      x: 0,
      y: 0,
      width: 96,
      height: 48,
      rotation: 0,
      properties: {
        tag: 'GEN-01',
        genericBorderVisible: false,
        genericBackgroundColor: '#334455',
      },
      extensions: {},
    })

    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)), [genericAsset])

    expect(parsed.elements[0].properties).toMatchObject({
      tag: 'GEN-01',
      genericBorderVisible: false,
      genericBackgroundColor: '#334455',
    })

    document.elements[0].properties.genericBackgroundColor = 'black'
    expect(() => parseProjectDocument(document, [genericAsset]))
      .toThrow('背景颜色必须是六位十六进制值')
  })

  it('requires one cooling line and one power line', () => {
    const document = createDefaultProject('线路完整性测试', [asset])
    document.lineSystems[1] = {
      ...document.lineSystems[1],
      type: 'cooling',
    }

    expect(() => parseProjectDocument(document)).toThrow('必须各有一套')
  })

  it('round-trips a connected cooling network and validates its resolved type', () => {
    const connectedAsset = {
      ...asset,
      anchors: [
        {
          id: 'general-anchor',
          name: '通用 1',
          x: 0,
          y: 32,
          direction: 'left' as const,
          type: 'cooling-general' as const,
        },
        {
          id: 'cold-anchor',
          name: '一次回路冷 1',
          x: 64,
          y: 32,
          direction: 'right' as const,
          type: 'cooling-primary-cold' as const,
        },
      ],
    }
    const document = createDefaultProject('线路拓扑', [connectedAsset])
    const diagramId = document.lineSystems[0].rootDiagramId
    document.elements.push(
      {
        id: 'left-element', diagramId, assetKey: connectedAsset.key, name: '左侧',
        x: 0, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
      },
      {
        id: 'right-element', diagramId, assetKey: connectedAsset.key, name: '右侧',
        x: 160, y: 0, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
      },
    )
    document.connections.push({
      id: 'network-1',
      diagramId,
      type: 'cooling-primary-cold',
      nodes: [
        { id: 'node-left', kind: 'element-anchor', elementId: 'left-element', anchorId: 'general-anchor' },
        { id: 'node-right', kind: 'element-anchor', elementId: 'right-element', anchorId: 'cold-anchor' },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'node-left', targetNodeId: 'node-right' }],
    })

    expect(parseProjectDocument(document).connections[0].type).toBe('cooling-primary-cold')

    document.connections[0].type = 'cooling-general'
    expect(() => parseProjectDocument(document)).toThrow('类型必须与其全部图元锚点兼容')
  })

  it('round-trips an electrical busbar whose taps are implicitly connected', () => {
    const electricalAsset = {
      ...asset,
      category: '电力',
      anchors: [{
        id: 'electrical-anchor',
        name: '电路 1',
        x: 32,
        y: 64,
        direction: 'bottom' as const,
        type: 'electrical' as const,
      }],
    }
    const document = createDefaultProject('母线拓扑', [electricalAsset])
    const diagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.elements.push(
      {
        id: 'power-left', diagramId, assetKey: electricalAsset.key, name: '左侧设备',
        x: 0, y: -96, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
      },
      {
        id: 'power-right', diagramId, assetKey: electricalAsset.key, name: '右侧设备',
        x: 128, y: -96, width: 64, height: 64, rotation: 0, properties: {}, extensions: {},
      },
    )
    document.busbars.push({
      id: 'busbar-1', diagramId, type: 'electrical', orientation: 'horizontal',
      x: 0, y: 0, length: 192,
    })
    document.connections.push({
      id: 'busbar-network', diagramId, type: 'electrical',
      nodes: [
        { id: 'left-anchor-node', kind: 'element-anchor', elementId: 'power-left', anchorId: 'electrical-anchor' },
        { id: 'left-tap', kind: 'busbar-tap', busbarId: 'busbar-1', offset: 32 },
        { id: 'right-anchor-node', kind: 'element-anchor', elementId: 'power-right', anchorId: 'electrical-anchor' },
        { id: 'right-tap', kind: 'busbar-tap', busbarId: 'busbar-1', offset: 160 },
      ],
      edges: [
        { id: 'left-edge', sourceNodeId: 'left-anchor-node', targetNodeId: 'left-tap' },
        { id: 'right-edge', sourceNodeId: 'right-anchor-node', targetNodeId: 'right-tap' },
      ],
    })

    const parsed = parseProjectDocument(document)
    expect(parsed.busbars).toEqual(document.busbars)
    expect(parsed.connections[0].nodes.filter((node) => node.kind === 'busbar-tap')).toHaveLength(2)

    const invalidTap = document.connections[0].nodes.find((node) => node.kind === 'busbar-tap')
    if (invalidTap?.kind === 'busbar-tap') invalidTap.offset = 200
    expect(() => parseProjectDocument(document)).toThrow('必须位于母线范围内')
  })

  it('round-trips an explicit child line between different busbars and rejects self-links', () => {
    const document = createDefaultProject('母线子线', [asset])
    const diagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.busbars.push(
      {
        id: 'child-busbar-a', diagramId, type: 'electrical', orientation: 'horizontal',
        x: 0, y: 0, length: 160, color: '#77B4BF',
      },
      {
        id: 'child-busbar-b', diagramId, type: 'electrical', orientation: 'horizontal',
        x: 0, y: 80, length: 160,
      },
    )
    document.connections.push({
      id: 'child-network', diagramId, type: 'electrical',
      nodes: [
        { id: 'child-tap-a', kind: 'busbar-tap', busbarId: 'child-busbar-a', offset: 16 },
        { id: 'child-tap-b', kind: 'busbar-tap', busbarId: 'child-busbar-b', offset: 80 },
      ],
      edges: [{
        id: 'child-edge',
        sourceNodeId: 'child-tap-a',
        targetNodeId: 'child-tap-b',
        flowDirection: 'forward',
        color: '#D5B96F',
        label: '联络线 01',
        labelVisible: false,
        labelEndpoint: 'source',
        labelSide: 'positive',
      }],
    })

    const parsed = parseProjectDocument(document)
    expect(parsed.busbars[0].color).toBe('#77B4BF')
    expect(parsed.connections[0].edges[0].color).toBe('#D5B96F')
    expect(parsed.connections[0].edges[0]).toMatchObject({
      flowDirection: 'forward',
      label: '联络线 01',
      labelVisible: false,
      labelEndpoint: 'source',
      labelSide: 'positive',
    })

    const legacy = JSON.parse(JSON.stringify(document))
    legacy.schemaVersion = 11
    delete legacy.connections[0].edges[0].label
    delete legacy.connections[0].edges[0].labelVisible
    delete legacy.connections[0].edges[0].labelEndpoint
    delete legacy.connections[0].edges[0].labelSide
    delete legacy.connections[0].edges[0].flowDirection
    expect(parseProjectDocument(legacy).connections[0].edges[0]).toEqual({
      id: 'child-edge',
      sourceNodeId: 'child-tap-a',
      targetNodeId: 'child-tap-b',
      color: '#D5B96F',
    })

    const schemaV15 = JSON.parse(JSON.stringify(document))
    schemaV15.schemaVersion = 15
    delete schemaV15.connections[0].edges[0].flowDirection
    expect(parseProjectDocument(schemaV15).connections[0].edges[0].flowDirection)
      .toBeUndefined()

    const invalidFlowDirection = structuredClone(document)
    invalidFlowDirection.connections[0].edges[0].flowDirection = 'sideways' as 'forward'
    expect(() => parseProjectDocument(invalidFlowDirection)).toThrow()

    const invalidBusbarColor = structuredClone(document)
    invalidBusbarColor.busbars[0].color = 'blue'
    expect(() => parseProjectDocument(invalidBusbarColor)).toThrow('颜色必须是六位十六进制值')

    const invalidEdgeColor = structuredClone(document)
    invalidEdgeColor.connections[0].edges[0].color = 'blue'
    expect(() => parseProjectDocument(invalidEdgeColor)).toThrow('颜色必须是六位十六进制值')

    const targetTap = document.connections[0].nodes[1]
    if (targetTap.kind === 'busbar-tap') targetTap.busbarId = 'child-busbar-a'
    expect(() => parseProjectDocument(document)).toThrow('不能通过普通子线连接自身')
  })

  it('validates busbar professional scope, grid geometry, and tap range', () => {
    const document = createDefaultProject('母线校验', [asset])
    const powerDiagramId = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    document.busbars.push({
      id: 'busbar-invalid', diagramId: powerDiagramId, type: 'electrical',
      orientation: 'horizontal', x: 0, y: 0, length: 8,
    })
    expect(parseProjectDocument(document).busbars[0].length).toBe(8)

    document.busbars[0].x = 4
    expect(() => parseProjectDocument(document)).toThrow('必须贴合 8px 网格')

    document.busbars[0].x = 0
    document.busbars[0].diagramId = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
    expect(() => parseProjectDocument(document)).toThrow('必须属于有效的电力图纸')
  })

  it('migrates legacy numeric metrics and validates numeric and text monitoring metrics', () => {
    const document = createDefaultProject('运行指标', [asset])
    document.elements.push({
      id: 'metric-element',
      diagramId: document.diagrams[0].id,
      assetKey: asset.key,
      name: asset.name,
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
      labelVisible: false,
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [{
        id: 'temperature',
        name: '出水温度',
        valueType: 'number',
        unit: '°C',
        precision: 1,
        simulationMin: 0,
        simulationMax: 100,
        alarm: { mode: 'upper', minor: 60, major: 75, critical: 90 },
      }],
      properties: { tag: 'CHWP-01' },
      extensions: {},
    })

    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)))
    expect(parsed.elements[0]).toMatchObject({
      monitorDataVisible: true,
      monitorMetricLabelsVisible: false,
      monitorMetrics: [{ name: '出水温度', valueType: 'number', precision: 1 }],
    })

    const schemaV17 = JSON.parse(JSON.stringify(document))
    schemaV17.schemaVersion = 17
    delete schemaV17.elements[0].monitorMetricLabelsVisible
    expect(parseProjectDocument(schemaV17).elements[0].monitorMetricLabelsVisible)
      .toBeUndefined()

    const schemaV14 = JSON.parse(JSON.stringify(document))
    schemaV14.schemaVersion = 14
    delete schemaV14.elements[0].monitorMetrics[0].valueType
    expect(parseProjectDocument(schemaV14).elements[0].monitorMetrics?.[0])
      .toMatchObject({ name: '出水温度', valueType: 'number' })

    const textMetric = JSON.parse(JSON.stringify(document))
    textMetric.elements[0].monitorMetrics = [{
      id: 'running-state',
      name: '运行状态',
      valueType: 'text',
      textOptions: [
        { id: 'running', value: '运行', severity: 'normal' },
        { id: 'offline', value: '离线', severity: 'critical' },
      ],
    }]
    expect(parseProjectDocument(textMetric).elements[0].monitorMetrics?.[0])
      .toMatchObject({ name: '运行状态', valueType: 'text' })

    textMetric.elements[0].monitorMetrics[0].textOptions = []
    expect(() => parseProjectDocument(textMetric)).toThrow('文本指标至少需要一个候选状态')

    const legacy = JSON.parse(JSON.stringify(document))
    legacy.schemaVersion = 13
    delete legacy.elements[0].monitorDataVisible
    delete legacy.elements[0].monitorMetrics
    expect(parseProjectDocument(legacy).elements[0].monitorMetrics).toBeUndefined()

    const duplicateIds = JSON.parse(JSON.stringify(document))
    duplicateIds.elements[0].monitorMetrics.push({
      ...duplicateIds.elements[0].monitorMetrics[0],
    })
    expect(() => parseProjectDocument(duplicateIds)).toThrow('运行指标 ID 必须唯一')

    const invalidOrder = JSON.parse(JSON.stringify(document))
    invalidOrder.elements[0].monitorMetrics[0].alarm.major = 50
    expect(() => parseProjectDocument(invalidOrder)).toThrow('次要 < 重要 < 紧急')
  })

  it('rejects cyclic diagram hierarchy references', () => {
    const document = createDefaultProject('循环层级测试', [asset])
    const [campus, building] = document.diagrams
    campus.parentId = building.id

    expect(() => parseProjectDocument(document)).toThrow('存在循环')
  })
})
