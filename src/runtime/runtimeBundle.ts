import { z } from 'zod'

import {
  parseProjectDocument,
  projectDocumentSchema,
  SCHEMA_VERSION,
  withOnOffStateSnapshot,
  type ProjectDocument,
} from '../domain/project'
import { createDiagramRuntimeView, type DiagramRuntimeView } from './diagramRuntime'
import {
  createDemoDeviceProfileRefs,
  createDemoMetricBindings,
} from './demoMetricDataProvider'
import {
  DEFAULT_DEMO_SIMULATION_SEED,
  DEMO_DEVICE_PROFILE_VERSION,
  DEMO_SIMULATION_ALGORITHM_VERSION,
  canDemoDeviceGoOffline,
  createDemoAnomalyAssignments,
  stableDemoHash,
  type DemoFaultAssignment,
} from './demoSimulationProfiles'

export const DIAGRAM_RUNTIME_BUNDLE_FORMAT = 'aidc-diagram-runtime' as const
export const DIAGRAM_RUNTIME_BUNDLE_VERSION = 2 as const

const runtimeNavigationTargetSchema = z.object({
  diagramId: z.string().min(1),
  diagramName: z.string().min(1),
})

const demoFaultAssignmentSchema = z.object({
  secondarySeverity: z.literal('minor').optional(),
  severity: z.enum(['minor', 'major', 'critical', 'offline']),
  faultCode: z.string().min(1),
})

export const demoSimulationManifestSchema = z.object({
  algorithmVersion: z.string().min(1),
  profileVersion: z.string().min(1),
  seed: z.string().min(1),
  clockMode: z.literal('relative'),
  metricBindings: z.record(z.string().min(1), z.object({
    ownerId: z.string().min(1),
    metricId: z.string().min(1),
    semanticKey: z.string().min(1),
    normalizedUnit: z.string(),
  })),
  deviceProfiles: z.record(z.string().min(1), z.string().min(1)),
  anomalyAssignments: z.record(z.string().min(1), demoFaultAssignmentSchema),
})

export const diagramRuntimeBundleSchema = z.object({
  format: z.literal(DIAGRAM_RUNTIME_BUNDLE_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(DIAGRAM_RUNTIME_BUNDLE_VERSION)]),
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
  simulation: demoSimulationManifestSchema.optional(),
  extensions: z.record(z.string(), z.unknown()),
}).superRefine((bundle, context) => {
  const diagramsById = new Map(bundle.document.diagrams.map((diagram) => [diagram.id, diagram]))
  const elementsById = new Map(bundle.document.elements.map((element) => [element.id, element]))
  if (bundle.formatVersion === DIAGRAM_RUNTIME_BUNDLE_VERSION && !bundle.simulation) {
    context.addIssue({
      code: 'custom',
      path: ['simulation'],
      message: 'RuntimeBundle v2 必须包含可复现模拟清单',
    })
  }
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
  if (bundle.simulation) {
    Object.keys(bundle.simulation.deviceProfiles).forEach((elementId) => {
      if (elementsById.has(elementId)) return
      context.addIssue({
        code: 'custom',
        path: ['simulation', 'deviceProfiles', elementId],
        message: '设备档案引用了不存在的图元',
      })
    })
    Object.keys(bundle.simulation.anomalyAssignments).forEach((elementId) => {
      if (elementsById.has(elementId)) return
      context.addIssue({
        code: 'custom',
        path: ['simulation', 'anomalyAssignments', elementId],
        message: '异常分配引用了不存在的图元',
      })
    })
  }
})

export type DiagramRuntimeBundle = z.infer<typeof diagramRuntimeBundleSchema>
export type DemoSimulationManifest = z.infer<typeof demoSimulationManifestSchema>

function ensureBundleSeverityCoverage(
  assignments: Record<string, DemoFaultAssignment>,
  seed: string,
  document: ProjectDocument,
) {
  const elementsById = new Map(document.elements.map((element) => [element.id, element]))
  if (Object.values(assignments).some((assignment) => assignment.secondarySeverity)) return assignments
  const ids = Object.keys(assignments).sort((left, right) => (
    stableDemoHash(`${seed}:${left}:coverage`) - stableDemoHash(`${seed}:${right}:coverage`)
      || left.localeCompare(right)
  ))
  const offlineId = ids.length >= 4 ? ids.find((elementId) => {
    const element = elementsById.get(elementId)
    return element ? canDemoDeviceGoOffline(element.assetKey) : false
  }) : undefined
  const coverage: DemoFaultAssignment['severity'][] = ['minor', 'major', 'critical']
  ids.filter((elementId) => elementId !== offlineId)
    .slice(0, coverage.length).forEach((elementId, index) => {
      const severity = coverage[index]
      assignments[elementId] = {
        severity,
        faultCode: 'profile-anomaly',
      }
    })
  if (offlineId) assignments[offlineId] = {
    severity: 'offline',
    faultCode: 'communication-offline',
  }
  return assignments
}

export function createDemoSimulationManifest(
  document: ProjectDocument,
  seed = `${DEFAULT_DEMO_SIMULATION_SEED}:${document.project.id}`,
): DemoSimulationManifest {
  const owners = document.elements.map((element) => ({
    id: element.id,
    diagramId: element.diagramId,
    assetKey: element.assetKey,
    monitorDataVisible: element.monitorDataVisible,
    monitorMetrics: element.monitorMetrics,
  }))
  const anomalyAssignments = ensureBundleSeverityCoverage(
    createDemoAnomalyAssignments(document.elements, seed),
    seed,
    document,
  )
  return {
    algorithmVersion: DEMO_SIMULATION_ALGORITHM_VERSION,
    profileVersion: DEMO_DEVICE_PROFILE_VERSION,
    seed,
    clockMode: 'relative',
    metricBindings: createDemoMetricBindings(owners),
    deviceProfiles: createDemoDeviceProfileRefs(owners),
    anomalyAssignments,
  }
}

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
    simulationSeed?: string
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
  const simulation = createDemoSimulationManifest(
    runtimeDocument,
    options.simulationSeed ?? `${DEFAULT_DEMO_SIMULATION_SEED}:${snapshot.project.id}`,
  )

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
    simulation,
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
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const bundleValue = value as Record<string, unknown>
      const rawDocument = bundleValue.document
      if (
        rawDocument && typeof rawDocument === 'object' && !Array.isArray(rawDocument) &&
        (rawDocument as Record<string, unknown>).schemaVersion !== SCHEMA_VERSION
      ) {
        const document = parseProjectDocument(rawDocument)
        const source = bundleValue.source && typeof bundleValue.source === 'object' &&
          !Array.isArray(bundleValue.source)
          ? bundleValue.source as Record<string, unknown>
          : bundleValue.source
        value = {
          ...bundleValue,
          document,
          source: source && typeof source === 'object'
            ? { ...source, projectSchemaVersion: document.schemaVersion }
            : source,
        }
      }
    }
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
