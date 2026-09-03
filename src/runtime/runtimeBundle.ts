import { z } from 'zod'

import {
  projectDocumentSchema,
  withOnOffStateSnapshot,
  type ProjectDocument,
} from '../domain/project'
import { createDiagramRuntimeView, type DiagramRuntimeView } from './diagramRuntime'

export const DIAGRAM_RUNTIME_BUNDLE_FORMAT = 'aidc-diagram-runtime' as const
export const DIAGRAM_RUNTIME_BUNDLE_VERSION = 1 as const

const runtimeNavigationTargetSchema = z.object({
  diagramId: z.string().min(1),
  diagramName: z.string().min(1),
})

export const diagramRuntimeBundleSchema = z.object({
  format: z.literal(DIAGRAM_RUNTIME_BUNDLE_FORMAT),
  formatVersion: z.literal(DIAGRAM_RUNTIME_BUNDLE_VERSION),
  exportedAt: z.iso.datetime(),
  source: z.object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectSchemaVersion: z.number().int().positive(),
  }),
  entryDiagramIds: z.array(z.string().min(1)).min(1),
  document: projectDocumentSchema,
  navigation: z.record(
    z.string().min(1),
    z.record(z.string().min(1), runtimeNavigationTargetSchema),
  ),
  extensions: z.record(z.string(), z.unknown()),
}).superRefine((bundle, context) => {
  const diagramsById = new Map(bundle.document.diagrams.map((diagram) => [diagram.id, diagram]))
  const elementsById = new Map(bundle.document.elements.map((element) => [element.id, element]))
  if (bundle.source.projectId !== bundle.document.project.id) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'projectId'],
      message: '来源项目 ID 必须与运行时文档一致',
    })
  }
  if (bundle.source.projectName !== bundle.document.project.name) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'projectName'],
      message: '来源项目名称必须与运行时文档一致',
    })
  }
  if (bundle.source.projectSchemaVersion !== bundle.document.schemaVersion) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'projectSchemaVersion'],
      message: '来源项目 Schema 版本必须与运行时文档一致',
    })
  }
  if (new Set(bundle.entryDiagramIds).size !== bundle.entryDiagramIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['entryDiagramIds'],
      message: '入口图纸 ID 不能重复',
    })
  }
  bundle.entryDiagramIds.forEach((diagramId, index) => {
    if (diagramsById.has(diagramId)) return
    context.addIssue({
      code: 'custom',
      path: ['entryDiagramIds', index],
      message: '入口图纸必须存在于运行时图纸包中',
    })
  })
  Object.entries(bundle.navigation).forEach(([diagramId, targets]) => {
    if (!diagramsById.has(diagramId)) {
      context.addIssue({
        code: 'custom',
        path: ['navigation', diagramId],
        message: '下探映射引用了不存在的来源图纸',
      })
      return
    }
    Object.entries(targets).forEach(([elementId, target]) => {
      const element = elementsById.get(elementId)
      if (!element || element.diagramId !== diagramId) {
        context.addIssue({
          code: 'custom',
          path: ['navigation', diagramId, elementId],
          message: '下探映射必须引用来源图纸中的有效图元',
        })
      }
      const targetDiagram = diagramsById.get(target.diagramId)
      if (!targetDiagram) {
        context.addIssue({
          code: 'custom',
          path: ['navigation', diagramId, elementId, 'diagramId'],
          message: '下探映射必须指向运行时图纸包中的有效图纸',
        })
      } else if (targetDiagram.name !== target.diagramName) {
        context.addIssue({
          code: 'custom',
          path: ['navigation', diagramId, elementId, 'diagramName'],
          message: '下探目标名称必须与目标图纸一致',
        })
      }
    })
  })
})

export type DiagramRuntimeBundle = z.infer<typeof diagramRuntimeBundleSchema>

function descendantsOf(document: ProjectDocument, rootIds: Set<string>) {
  const retained = new Set(rootIds)
  let changed = true
  while (changed) {
    changed = false
    document.diagrams.forEach((diagram) => {
      if (!diagram.parentId || !retained.has(diagram.parentId) || retained.has(diagram.id)) return
      retained.add(diagram.id)
      changed = true
    })
  }
  return retained
}

function ancestorsOf(document: ProjectDocument, diagramIds: Set<string>) {
  const diagramsById = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
  const retained = new Set(diagramIds)
  diagramIds.forEach((diagramId) => {
    let current = diagramsById.get(diagramId)
    const visited = new Set<string>()
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id)
      retained.add(current.parentId)
      current = diagramsById.get(current.parentId)
    }
  })
  return retained
}

function normalizedEntryDiagramIds(document: ProjectDocument, diagramIds: string[]) {
  const knownIds = new Set(document.diagrams.map((diagram) => diagram.id))
  const result = [...new Set(diagramIds)]
  if (!result.length) throw new Error('至少选择一张入口图纸')
  const missingId = result.find((diagramId) => !knownIds.has(diagramId))
  if (missingId) throw new Error(`入口图纸不存在：${missingId}`)
  return result
}

export function createDiagramRuntimeBundle(
  document: ProjectDocument,
  entryDiagramIds: string[],
  options: {
    exportedAt?: string
    onOffStates?: Record<string, boolean>
  } = {},
): DiagramRuntimeBundle {
  const normalizedEntryIds = normalizedEntryDiagramIds(document, entryDiagramIds)
  const snapshot = withOnOffStateSnapshot(document, options.onOffStates)
  const selectedSubtrees = descendantsOf(snapshot, new Set(normalizedEntryIds))
  const contentDiagramIds = ancestorsOf(snapshot, selectedSubtrees)
  const retainedDiagramIds = new Set([
    ...contentDiagramIds,
    ...snapshot.lineSystems.map((lineSystem) => lineSystem.rootDiagramId),
  ])
  const elements = snapshot.elements.filter((element) => contentDiagramIds.has(element.diagramId))
  const usedAssetKeys = new Set(elements.map((element) => element.assetKey))
  const runtimeDocument = projectDocumentSchema.parse({
    ...snapshot,
    diagrams: snapshot.diagrams.filter((diagram) => retainedDiagramIds.has(diagram.id)),
    elements,
    busbars: snapshot.busbars.filter((busbar) => contentDiagramIds.has(busbar.diagramId)),
    connections: snapshot.connections.filter((network) => (
      contentDiagramIds.has(network.diagramId)
    )),
    assets: snapshot.assets.filter((asset) => usedAssetKeys.has(asset.key)),
    extensions: {},
  })
  const navigation = Object.fromEntries(runtimeDocument.diagrams.map((diagram) => {
    const view = createDiagramRuntimeView(runtimeDocument, diagram.id)
    return [diagram.id, view?.navigation ?? {}]
  }))

  return diagramRuntimeBundleSchema.parse({
    format: DIAGRAM_RUNTIME_BUNDLE_FORMAT,
    formatVersion: DIAGRAM_RUNTIME_BUNDLE_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    source: {
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      projectSchemaVersion: snapshot.schemaVersion,
    },
    entryDiagramIds: normalizedEntryIds,
    document: runtimeDocument,
    navigation,
    extensions: {},
  })
}

export function serializeDiagramRuntimeBundle(bundle: DiagramRuntimeBundle) {
  return JSON.stringify(diagramRuntimeBundleSchema.parse(bundle), null, 2)
}

export function parseDiagramRuntimeBundle(input: string | unknown) {
  let value = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      throw new Error('运行时图纸包不是有效的 JSON')
    }
  }
  try {
    return diagramRuntimeBundleSchema.parse(value)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`运行时图纸包校验失败：${error.message}`)
    }
    throw new Error('运行时图纸包校验失败')
  }
}

export function createDiagramRuntimeViewFromBundle(
  bundle: DiagramRuntimeBundle,
  diagramId: string,
): DiagramRuntimeView | null {
  const view = createDiagramRuntimeView(bundle.document, diagramId)
  return view ? {
    ...view,
    navigation: bundle.navigation[diagramId] ?? {},
  } : null
}
