import { describe, expect, it } from 'vitest'

import { createDefaultProject, SCHEMA_VERSION } from '../domain/project'
import { symbolAssets } from '../scene/symbolCatalog'
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

    expect(bundle.formatVersion).toBe(2)
    expect(bundle.simulation).toMatchObject({
      algorithmVersion: 'demo-runtime-1',
      profileVersion: 'aidc-demo-profile-2026-09-r4',
      clockMode: 'relative',
    })
    expect(bundle.simulation?.deviceProfiles['runtime-stateful-device']).toBe('valve')
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
    const legacyBundle = structuredClone(bundle) as Record<string, unknown>
    legacyBundle.formatVersion = 1
    delete legacyBundle.simulation
    expect(parseDiagramRuntimeBundle(legacyBundle).formatVersion).toBe(1)
    const schemaV33Bundle = structuredClone(bundle) as unknown as {
      source: { projectSchemaVersion: number }
      document: {
        schemaVersion: number
        elements: Array<{ monitorInteraction?: string }>
      }
    }
    schemaV33Bundle.source.projectSchemaVersion = 33
    schemaV33Bundle.document.schemaVersion = 33
    schemaV33Bundle.document.elements.forEach((element) => delete element.monitorInteraction)
    expect(parseDiagramRuntimeBundle(schemaV33Bundle).document.schemaVersion).toBe(SCHEMA_VERSION)
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

  it('carries persisted cooling pump controls into runtime bundles', () => {
    const document = createDefaultProject('水泵运行时快照', symbolAssets)
    document.assets = document.assets.map((asset) => asset.key === 'cwp'
      ? { ...asset, coolingDeviceRole: 'pump' as const }
      : asset)
    const diagram = document.diagrams.find((candidate) => (
      candidate.lineSystemId === document.lineSystems.find((line) => line.type === 'cooling')?.id
    ))!
    document.elements.push({
      id: 'runtime-cwp',
      diagramId: diagram.id,
      assetKey: 'cwp',
      name: 'CWP',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      rotation: 0,
      coolingPumpRunning: false,
      coolingPumpOutputPower: 45,
      properties: { tag: 'CWP-01' },
      extensions: {},
    })

    const bundle = createDiagramRuntimeBundle(document, [diagram.id], {
      exportedAt: '2026-09-03T08:00:00.000Z',
    })
    expect(bundle.document.elements[0]).toMatchObject({
      id: 'runtime-cwp',
      coolingPumpRunning: false,
      coolingPumpOutputPower: 45,
    })
    expect(parseDiagramRuntimeBundle(serializeDiagramRuntimeBundle(bundle)))
      .toEqual(bundle)
  })

  it('freezes broad severity coverage when enough safe page anomalies exist', () => {
    const document = createDefaultProject('完整演示异常覆盖', symbolAssets)
    const diagrams = document.diagrams.slice(0, 4)
    diagrams.forEach((diagram, index) => document.elements.push({
      id: `coverage-cabinet-${index}`,
      diagramId: diagram.id,
      assetKey: 'cabinet-device',
      name: `Cabinet-${index + 1}`,
      x: index * 64,
      y: 0,
      width: 48,
      height: 48,
      rotation: 0,
      properties: {},
      extensions: {},
    }))

    const bundle = createDiagramRuntimeBundle(document, diagrams.map((diagram) => diagram.id), {
      simulationSeed: 'coverage-seed',
    })
    const severities = new Set(Object.values(
      bundle.simulation!.anomalyAssignments,
    ).map((assignment) => assignment.severity))

    expect(severities).toEqual(new Set(['minor', 'major', 'critical', 'offline']))
  })
})
