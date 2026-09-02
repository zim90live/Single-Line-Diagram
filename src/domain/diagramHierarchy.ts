import {
  EDITOR_GRID_SIZE,
  type Diagram,
  type DiagramLevel,
  type ProjectDocument,
} from './project'

export const DIAGRAM_LEVELS: DiagramLevel[] = ['campus', 'building', 'pod', 'device']

export type DiagramDropPosition = 'before' | 'inside' | 'after'

export interface DiagramHierarchyMutationResult {
  ok: boolean
  changed: boolean
  diagrams?: Diagram[]
  diagramId?: string
  removedDiagramIds?: string[]
  message?: string
}

const newDiagramBaseNames: Record<DiagramLevel, string> = {
  campus: '新园区图',
  building: '新楼宇',
  pod: '新 POD',
  device: '新设备图',
}

function failure(message: string): DiagramHierarchyMutationResult {
  return { ok: false, changed: false, message }
}

function diagramDepth(diagramsById: Map<string, Diagram>, diagramId: string) {
  let depth = 0
  let current = diagramsById.get(diagramId)
  const visited = new Set<string>()
  while (current?.parentId) {
    if (visited.has(current.id)) return null
    visited.add(current.id)
    current = diagramsById.get(current.parentId)
    if (!current) return null
    depth += 1
  }
  return current ? depth : null
}

function childIdsByParent(diagrams: Diagram[]) {
  const result = new Map<string | null, string[]>()
  for (const diagram of diagrams) {
    const siblings = result.get(diagram.parentId) ?? []
    siblings.push(diagram.id)
    result.set(diagram.parentId, siblings)
  }
  return result
}

function collectSubtreeIds(childrenByParent: Map<string | null, string[]>, rootId: string) {
  const result = new Set<string>()
  const pending = [rootId]
  while (pending.length) {
    const diagramId = pending.pop()!
    if (result.has(diagramId)) continue
    result.add(diagramId)
    pending.push(...(childrenByParent.get(diagramId) ?? []))
  }
  return result
}

function subtreeHeight(childrenByParent: Map<string | null, string[]>, rootId: string) {
  let height = 0
  const pending: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }]
  while (pending.length) {
    const current = pending.pop()!
    height = Math.max(height, current.depth)
    for (const childId of childrenByParent.get(current.id) ?? []) {
      pending.push({ id: childId, depth: current.depth + 1 })
    }
  }
  return height
}

function orderAndNormalizeLevels(
  document: ProjectDocument,
  diagramsById: Map<string, Diagram>,
  childrenByParent: Map<string | null, string[]>,
) {
  const ordered: Diagram[] = []
  const visited = new Set<string>()

  const visit = (diagramId: string, depth: number) => {
    const diagram = diagramsById.get(diagramId)
    const level = DIAGRAM_LEVELS[depth]
    if (!diagram || !level || visited.has(diagramId)) return false
    visited.add(diagramId)
    ordered.push(diagram.level === level ? diagram : { ...diagram, level })
    for (const childId of childrenByParent.get(diagramId) ?? []) {
      if (!visit(childId, depth + 1)) return false
    }
    return true
  }

  for (const lineSystem of document.lineSystems) {
    if (!visit(lineSystem.rootDiagramId, 0)) return null
  }
  return visited.size === document.diagrams.length ? ordered : null
}

function nextDiagramName(document: ProjectDocument, parentId: string, level: DiagramLevel) {
  const siblingNames = new Set(document.diagrams
    .filter((diagram) => diagram.parentId === parentId)
    .map((diagram) => diagram.name))
  const baseName = newDiagramBaseNames[level]
  if (!siblingNames.has(baseName)) return baseName
  let suffix = 2
  while (siblingNames.has(`${baseName} ${suffix}`)) suffix += 1
  return `${baseName} ${suffix}`
}

export function createChildDiagram(
  document: ProjectDocument,
  parentId: string,
  diagramId: string,
): DiagramHierarchyMutationResult {
  const diagramsById = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
  const parent = diagramsById.get(parentId)
  if (!parent) return failure('找不到新增图纸的上级图纸')
  if (diagramsById.has(diagramId)) return failure('图纸 ID 已存在')

  const parentDepth = diagramDepth(diagramsById, parentId)
  const level = parentDepth === null ? undefined : DIAGRAM_LEVELS[parentDepth + 1]
  if (!level) return failure('设备层不能继续新增下级图纸')

  const diagram: Diagram = {
    id: diagramId,
    lineSystemId: parent.lineSystemId,
    parentId,
    level,
    name: nextDiagramName(document, parentId, level),
    canvas: {
      gridSize: EDITOR_GRID_SIZE,
      viewport: { zoom: 1, tx: 0, ty: 0 },
    },
  }
  diagramsById.set(diagram.id, diagram)
  const childrenByParent = childIdsByParent([...document.diagrams, diagram])
  const ordered = orderAndNormalizeLevels(
    { ...document, diagrams: [...document.diagrams, diagram] },
    diagramsById,
    childrenByParent,
  )
  return ordered
    ? { ok: true, changed: true, diagrams: ordered, diagramId: diagram.id }
    : failure('当前图纸层级无效，无法新增图纸')
}

export function deleteDiagram(
  document: ProjectDocument,
  diagramId: string,
): DiagramHierarchyMutationResult {
  const diagramsById = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
  const diagram = diagramsById.get(diagramId)
  if (!diagram) return failure('找不到要删除的图纸')
  if (diagram.parentId === null) return failure('线路根图纸不能删除')

  const childrenByParent = childIdsByParent(document.diagrams)
  const removedDiagramIdSet = collectSubtreeIds(childrenByParent, diagramId)
  const removedDiagramIds = document.diagrams
    .filter((candidate) => removedDiagramIdSet.has(candidate.id))
    .map((candidate) => candidate.id)
  const remainingDiagrams = document.diagrams.filter(
    (candidate) => !removedDiagramIdSet.has(candidate.id),
  )
  const remainingById = new Map(remainingDiagrams.map((candidate) => [candidate.id, candidate]))
  const ordered = orderAndNormalizeLevels(
    { ...document, diagrams: remainingDiagrams },
    remainingById,
    childIdsByParent(remainingDiagrams),
  )
  if (!ordered) return failure('删除后的图纸层级无效')

  return {
    ok: true,
    changed: true,
    diagrams: ordered,
    diagramId: diagram.parentId,
    removedDiagramIds,
  }
}

export function moveDiagram(
  document: ProjectDocument,
  sourceId: string,
  targetId: string,
  position: DiagramDropPosition,
): DiagramHierarchyMutationResult {
  const diagramsById = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
  const source = diagramsById.get(sourceId)
  const target = diagramsById.get(targetId)
  if (!source || !target) return failure('找不到要移动的图纸或目标位置')
  if (source.id === target.id) return failure('不能把图纸拖到自身')
  if (source.parentId === null) return failure('线路根图纸不能移动')
  if (source.lineSystemId !== target.lineSystemId) {
    return failure('图纸不能跨冷却线路与电力线路移动')
  }

  const childrenByParent = childIdsByParent(document.diagrams)
  const subtreeIds = collectSubtreeIds(childrenByParent, sourceId)
  if (subtreeIds.has(targetId)) return failure('不能把图纸移动到自己的下级图纸中')

  const newParentId = position === 'inside' ? target.id : target.parentId
  if (!newParentId) return failure('线路根图纸只能接收下级图纸')
  const newParentDepth = diagramDepth(diagramsById, newParentId)
  if (newParentDepth === null) return failure('目标图纸层级无效')
  const nextDepth = newParentDepth + 1
  if (nextDepth + subtreeHeight(childrenByParent, sourceId) >= DIAGRAM_LEVELS.length) {
    return failure('移动后会超过设备层，图纸层级最多为四层')
  }

  const previousSiblings = childrenByParent.get(source.parentId) ?? []
  childrenByParent.set(source.parentId, previousSiblings.filter((id) => id !== source.id))
  const nextSiblings = (childrenByParent.get(newParentId) ?? []).filter((id) => id !== source.id)
  if (position === 'inside') {
    nextSiblings.push(source.id)
  } else {
    const targetIndex = nextSiblings.indexOf(target.id)
    if (targetIndex < 0) return failure('找不到目标图纸的同级顺序')
    nextSiblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source.id)
  }
  childrenByParent.set(newParentId, nextSiblings)

  diagramsById.set(source.id, { ...source, parentId: newParentId })
  const ordered = orderAndNormalizeLevels(document, diagramsById, childrenByParent)
  if (!ordered) return failure('移动后的图纸层级无效')

  const changed = ordered.some((diagram, index) => {
    const previous = document.diagrams[index]
    return !previous ||
      previous.id !== diagram.id ||
      previous.parentId !== diagram.parentId ||
      previous.level !== diagram.level
  })
  return { ok: true, changed, diagrams: ordered }
}
