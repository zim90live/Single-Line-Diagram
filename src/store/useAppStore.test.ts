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

  it('persists viewport changes and marks the project dirty', () => {
    const { currentDiagramId } = useAppStore.getState()
    useAppStore.getState().updateDiagramViewport(currentDiagramId, {
      zoom: 1.5,
      tx: 120,
      ty: -30,
    })
    const diagram = useAppStore.getState().document.diagrams.find(
      (candidate) => candidate.id === currentDiagramId,
    )
    expect(diagram?.canvas.viewport).toEqual({ zoom: 1.5, tx: 120, ty: -30 })
    expect(useAppStore.getState().dirty).toBe(true)
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
})
