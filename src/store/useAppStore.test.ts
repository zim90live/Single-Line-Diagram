import { beforeEach, describe, expect, it } from 'vitest'

import { createDefaultProject, getFirstDiagramId } from '../domain/project'
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
})
