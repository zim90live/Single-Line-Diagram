import { describe, expect, it } from 'vitest'

import {
  createDefaultProject,
  EDITOR_GRID_SIZE,
  getDiagramPath,
  parseProjectDocument,
  SCHEMA_VERSION,
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
    expect(parseProjectDocument(legacy).connections[0].edges[0]).toEqual({
      id: 'child-edge',
      sourceNodeId: 'child-tap-a',
      targetNodeId: 'child-tap-b',
      color: '#D5B96F',
    })

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

  it('rejects cyclic diagram hierarchy references', () => {
    const document = createDefaultProject('循环层级测试', [asset])
    const [campus, building] = document.diagrams
    campus.parentId = building.id

    expect(() => parseProjectDocument(document)).toThrow('存在循环')
  })
})
