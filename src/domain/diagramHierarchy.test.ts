import { describe, expect, it } from 'vitest'

import { createDefaultProject, projectDocumentSchema, type ProjectDocument } from './project'
import { createChildDiagram, moveDiagram } from './diagramHierarchy'

function withMutation(document: ProjectDocument, diagrams: ProjectDocument['diagrams'] | undefined) {
  if (!diagrams) throw new Error('图纸层级变更失败')
  return { ...document, diagrams }
}

describe('diagram hierarchy management', () => {
  it('creates a named child at the next supported level', () => {
    const document = createDefaultProject('层级测试')
    const coolingRoot = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId

    const first = createChildDiagram(document, coolingRoot, 'new-building-a')
    expect(first).toMatchObject({ ok: true, changed: true, diagramId: 'new-building-a' })
    let changed = withMutation(document, first.diagrams)
    expect(changed.diagrams.find((diagram) => diagram.id === 'new-building-a')).toMatchObject({
      parentId: coolingRoot,
      level: 'building',
      name: '新楼宇',
    })

    const second = createChildDiagram(changed, coolingRoot, 'new-building-b')
    changed = withMutation(changed, second.diagrams)
    expect(changed.diagrams.find((diagram) => diagram.id === 'new-building-b')?.name)
      .toBe('新楼宇 2')
    expect(projectDocumentSchema.safeParse(changed).success).toBe(true)
  })

  it('moves a subtree to a new parent and normalizes all descendant levels', () => {
    let document = createDefaultProject('层级测试')
    const coolingRoot = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
    const originalBuilding = document.diagrams.find((diagram) => (
      diagram.lineSystemId.endsWith('-cooling') && diagram.level === 'building'
    ))!
    const originalPod = document.diagrams.find((diagram) => diagram.parentId === originalBuilding.id)!
    const originalDevice = document.diagrams.find((diagram) => diagram.parentId === originalPod.id)!

    const created = createChildDiagram(document, coolingRoot, 'second-building')
    document = withMutation(document, created.diagrams)
    const moved = moveDiagram(document, originalPod.id, 'second-building', 'inside')
    document = withMutation(document, moved.diagrams)

    expect(moved).toMatchObject({ ok: true, changed: true })
    expect(document.diagrams.find((diagram) => diagram.id === originalPod.id)).toMatchObject({
      parentId: 'second-building',
      level: 'pod',
    })
    expect(document.diagrams.find((diagram) => diagram.id === originalDevice.id)?.level)
      .toBe('device')
    expect(projectDocumentSchema.safeParse(document).success).toBe(true)
  })

  it('reorders siblings before and after one another', () => {
    let document = createDefaultProject('层级测试')
    const coolingRoot = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
    const firstBuilding = document.diagrams.find((diagram) => diagram.parentId === coolingRoot)!
    const created = createChildDiagram(document, coolingRoot, 'second-building')
    document = withMutation(document, created.diagrams)

    const moved = moveDiagram(document, 'second-building', firstBuilding.id, 'before')
    document = withMutation(document, moved.diagrams)
    expect(document.diagrams.filter((diagram) => diagram.parentId === coolingRoot).map((diagram) => diagram.id))
      .toEqual(['second-building', firstBuilding.id])

    const restored = moveDiagram(document, 'second-building', firstBuilding.id, 'after')
    document = withMutation(document, restored.diagrams)
    expect(document.diagrams.filter((diagram) => diagram.parentId === coolingRoot).map((diagram) => diagram.id))
      .toEqual([firstBuilding.id, 'second-building'])
  })

  it('rejects root, cross-line, cyclic, and over-depth moves', () => {
    let document = createDefaultProject('层级测试')
    const coolingRoot = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
    const powerRoot = document.lineSystems.find((line) => line.type === 'power')!.rootDiagramId
    const building = document.diagrams.find((diagram) => diagram.parentId === coolingRoot)!
    const pod = document.diagrams.find((diagram) => diagram.parentId === building.id)!
    const device = document.diagrams.find((diagram) => diagram.parentId === pod.id)!

    expect(moveDiagram(document, coolingRoot, building.id, 'inside')).toMatchObject({ ok: false })
    expect(moveDiagram(document, building.id, powerRoot, 'inside')).toMatchObject({ ok: false })
    expect(moveDiagram(document, building.id, pod.id, 'inside')).toMatchObject({ ok: false })

    document = withMutation(document, createChildDiagram(document, coolingRoot, 'alternate-building').diagrams)
    document = withMutation(document, createChildDiagram(document, 'alternate-building', 'alternate-pod').diagrams)
    document = withMutation(document, createChildDiagram(document, 'alternate-pod', 'alternate-device').diagrams)
    expect(moveDiagram(document, pod.id, 'alternate-device', 'inside')).toMatchObject({
      ok: false,
      message: expect.stringContaining('四层'),
    })
    expect(device.level).toBe('device')
  })
})
