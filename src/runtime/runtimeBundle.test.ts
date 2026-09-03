import { describe, expect, it } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { symbolAssets } from '../editor/symbolCatalog'
import {
  createDiagramRuntimeBundle,
  createDiagramRuntimeViewFromBundle,
  parseDiagramRuntimeBundle,
  serializeDiagramRuntimeBundle,
} from './runtimeBundle'

describe('diagram runtime bundle', () => {
  it('packages the selected subtree, required ancestors, used assets, and frozen navigation', () => {
    const document = createDefaultProject('可迁移监控图纸', symbolAssets)
    const power = document.lineSystems.find((lineSystem) => lineSystem.type === 'power')!
    const cooling = document.lineSystems.find((lineSystem) => lineSystem.type === 'cooling')!
    const selected = document.diagrams.find((diagram) => (
      diagram.lineSystemId === power.id && diagram.level === 'device'
    ))!
    const parent = document.diagrams.find((diagram) => diagram.id === selected.parentId)!
    const sibling = {
      ...selected,
      id: 'runtime-sibling',
      name: '未导出的同级图纸',
    }
    document.diagrams.push(sibling)
    document.elements.push(
      {
        id: 'runtime-link',
        diagramId: parent.id,
        assetKey: 'switch',
        name: '设备间入口',
        x: 0,
        y: 0,
        width: 48,
        height: 48,
        rotation: 0,
        onOffState: 'off',
        properties: { drillDownDiagramId: selected.id },
        extensions: {},
      },
      {
        id: 'runtime-stateful-device',
        diagramId: selected.id,
        assetKey: '2-wv',
        name: '运行状态快照',
        x: 80,
        y: 0,
        width: 48,
        height: 48,
        rotation: 0,
        onOffState: 'off',
        properties: {},
        extensions: {},
      },
      {
        id: 'runtime-excluded-device',
        diagramId: sibling.id,
        assetKey: 'cv',
        name: '不应导出的图元',
        x: 0,
        y: 0,
        width: 48,
        height: 48,
        rotation: 0,
        properties: {},
        extensions: {},
      },
    )

    const bundle = createDiagramRuntimeBundle(document, [selected.id], {
      exportedAt: '2026-09-03T08:00:00.000Z',
      onOffStates: { 'runtime-stateful-device': true },
    })

    expect(bundle.entryDiagramIds).toEqual([selected.id])
    expect(bundle.document.diagrams.map((diagram) => diagram.id)).toEqual(expect.arrayContaining([
      cooling.rootDiagramId,
      power.rootDiagramId,
      parent.id,
      selected.id,
    ]))
    expect(bundle.document.diagrams.map((diagram) => diagram.id)).not.toContain(sibling.id)
    expect(bundle.document.elements.map((element) => element.id)).toEqual([
      'runtime-link',
      'runtime-stateful-device',
    ])
    expect(bundle.document.assets.map((asset) => asset.key).sort()).toEqual(['2-wv', 'switch'])
    expect(bundle.document.extensions).toEqual({})
    expect(bundle.document.elements.find((element) => (
      element.id === 'runtime-stateful-device'
    ))?.onOffState).toBe('on')
    expect(bundle.navigation[parent.id]?.['runtime-link']).toEqual({
      diagramId: selected.id,
      diagramName: selected.name,
    })
    expect(createDiagramRuntimeViewFromBundle(bundle, parent.id)?.navigation).toEqual(
      bundle.navigation[parent.id],
    )
  })

  it('round-trips valid bundles and rejects invalid entry or navigation references', () => {
    const document = createDefaultProject('运行时图纸包校验', symbolAssets)
    const parent = document.diagrams[0]
    const child = document.diagrams.find((diagram) => diagram.parentId === parent.id)!
    document.elements.push({
      id: 'runtime-validation-link',
      diagramId: parent.id,
      assetKey: 'switch',
      name: '下探入口',
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      properties: { drillDownDiagramId: child.id },
      extensions: {},
    })
    const bundle = createDiagramRuntimeBundle(document, [parent.id], {
      exportedAt: '2026-09-03T08:00:00.000Z',
    })

    expect(parseDiagramRuntimeBundle(serializeDiagramRuntimeBundle(bundle))).toEqual(bundle)
    expect(() => createDiagramRuntimeBundle(document, ['missing-diagram'])).toThrow(
      '入口图纸不存在',
    )
    expect(() => parseDiagramRuntimeBundle({
      ...bundle,
      navigation: {
        ...bundle.navigation,
        [parent.id]: {
          'runtime-validation-link': {
            diagramId: 'missing-target',
            diagramName: '不存在的目标',
          },
        },
      },
    })).toThrow('运行时图纸包校验失败')
  })
})
