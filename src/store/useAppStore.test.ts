import { beforeEach, describe, expect, it } from 'vitest'

import { createDefaultProject, getFirstDiagramId, projectDocumentSchema } from '../domain/project'
import { symbolAssets } from '../editor/symbolCatalog'
import { useAppStore } from './useAppStore'

describe('app document state', () => {
  beforeEach(() => {
    const document = createDefaultProject('状态测试', symbolAssets)
    useAppStore.setState({
      document,
      documentEpoch: 0,
      currentDiagramId: getFirstDiagramId(document),
      selectedElementIds: [],
      dirty: false,
    })
  })

  it('opens a saved project without marking it dirty', () => {
    const document = createDefaultProject('已保存项目', symbolAssets)
    useAppStore.getState().replaceDocument(document, { dirty: false })
    expect(useAppStore.getState().dirty).toBe(false)
  })

  it('keeps viewport mutation outside the business document store', () => {
    expect('updateDiagramViewport' in useAppStore.getState()).toBe(false)
    expect(useAppStore.getState().dirty).toBe(false)
  })

  it('synchronizes On/Off archive snapshots without marking the project dirty', () => {
    const current = useAppStore.getState()
    useAppStore.setState({
      document: {
        ...current.document,
        elements: [{
          id: 'switch-state-test',
          diagramId: current.currentDiagramId,
          assetKey: 'switch',
          name: 'Switch',
          x: 0,
          y: 0,
          width: 32,
          height: 32,
          rotation: 0,
          properties: { tag: 'SW-01' },
          extensions: {},
        }],
      },
    })
    const updatedAt = useAppStore.getState().document.project.updatedAt

    useAppStore.getState().syncElementOnOffStates({ 'switch-state-test': true })

    expect(useAppStore.getState().document.elements[0].onOffState).toBe('on')
    expect(useAppStore.getState().document.project.updatedAt).toBe(updatedAt)
    expect(useAppStore.getState().dirty).toBe(false)
  })

  it('applies asset anchors immediately and marks the project dirty', () => {
    useAppStore.getState().replaceAssetAnchors('chwp', [{
      id: 'anchor-1',
      name: '通用 1',
      x: 8,
      y: 0,
      direction: 'top',
      type: 'cooling-general',
    }])

    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp')?.anchors,
    ).toHaveLength(1)
    expect(useAppStore.getState().dirty).toBe(true)
  })

  it('applies a cooling role and pump-port roles atomically', () => {
    useAppStore.getState().replaceAssetDefinition('chwp', {
      coolingDeviceRole: 'pump',
      anchors: [
        {
          id: 'pump-inlet',
          name: '入口',
          x: 0,
          y: 32,
          direction: 'left',
          type: 'cooling-general',
          flowRole: 'inlet',
        },
        {
          id: 'pump-outlet',
          name: '出口',
          x: 64,
          y: 32,
          direction: 'right',
          type: 'cooling-general',
          flowRole: 'outlet',
        },
      ],
    })

    expect(
      useAppStore.getState().document.assets.find((asset) => asset.key === 'chwp'),
    ).toMatchObject({
      coolingDeviceRole: 'pump',
      anchors: [
        { id: 'pump-inlet', flowRole: 'inlet' },
        { id: 'pump-outlet', flowRole: 'outlet' },
      ],
    })
    expect(useAppStore.getState().dirty).toBe(true)
  })

  it('creates, renames, and moves diagrams as persisted project changes', () => {
    const initial = useAppStore.getState().document
    const coolingRoot = initial.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
    const originalBuilding = initial.diagrams.find((diagram) => diagram.parentId === coolingRoot)!
    const originalPod = initial.diagrams.find((diagram) => diagram.parentId === originalBuilding.id)!

    const created = useAppStore.getState().createDiagram(coolingRoot)
    expect(created).toMatchObject({ ok: true, changed: true })
    expect(useAppStore.getState().currentDiagramId).toBe(created.diagramId)
    expect(useAppStore.getState().dirty).toBe(true)

    const renamed = useAppStore.getState().renameDiagram(created.diagramId!, '  2 号楼  ')
    expect(renamed).toMatchObject({ ok: true, changed: true })
    expect(
      useAppStore.getState().document.diagrams.find((diagram) => diagram.id === created.diagramId)?.name,
    ).toBe('2 号楼')

    const moved = useAppStore.getState().moveDiagram(originalPod.id, created.diagramId!, 'inside')
    expect(moved).toMatchObject({ ok: true, changed: true })
    expect(
      useAppStore.getState().document.diagrams.find((diagram) => diagram.id === originalPod.id),
    ).toMatchObject({ parentId: created.diagramId, level: 'pod' })
    expect(useAppStore.getState().document.diagrams).not.toBe(initial.diagrams)
  })

  it('deletes a diagram subtree and all of its drawing content atomically', () => {
    const initial = useAppStore.getState().document
    const coolingRoot = initial.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
    const building = initial.diagrams.find((diagram) => diagram.parentId === coolingRoot)!
    const pod = initial.diagrams.find((diagram) => diagram.parentId === building.id)!
    const device = initial.diagrams.find((diagram) => diagram.parentId === pod.id)!
    useAppStore.setState({
      document: {
        ...initial,
        elements: [{
          id: 'deleted-element',
          diagramId: device.id,
          assetKey: 'chwp',
          name: 'CHWP',
          x: 0,
          y: 0,
          width: 64,
          height: 64,
          rotation: 0,
          properties: {},
          extensions: {},
        }],
        busbars: [{
          id: 'deleted-busbar',
          diagramId: device.id,
          type: 'electrical',
          orientation: 'horizontal',
          x: 0,
          y: 80,
          length: 8,
        }],
        connections: [{
          id: 'deleted-network',
          diagramId: device.id,
          type: 'cooling-general',
          nodes: [
            { id: 'deleted-node-a', kind: 'node', x: 0, y: 0 },
            { id: 'deleted-node-b', kind: 'node', x: 8, y: 0 },
          ],
          edges: [{
            id: 'deleted-edge',
            sourceNodeId: 'deleted-node-a',
            targetNodeId: 'deleted-node-b',
          }],
        }],
      },
      currentDiagramId: device.id,
      selectedElementIds: ['deleted-element'],
    })

    const result = useAppStore.getState().deleteDiagram(building.id)
    const state = useAppStore.getState()

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      diagramId: coolingRoot,
      removedDiagramIds: [building.id, pod.id, device.id],
    })
    expect(state.currentDiagramId).toBe(coolingRoot)
    expect(state.selectedElementIds).toEqual([])
    expect(state.document.elements).toEqual([])
    expect(state.document.busbars).toEqual([])
    expect(state.document.connections).toEqual([])
    expect(state.dirty).toBe(true)
    expect(projectDocumentSchema.safeParse(state.document).success).toBe(true)
  })
})
