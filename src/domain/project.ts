import { z } from 'zod'

export const SCHEMA_VERSION = 6 as const
export const EDITOR_GRID_SIZE = 8 as const
export const BUSBAR_MIN_LENGTH = 8 as const

export const lineSystemTypeSchema = z.enum(['cooling', 'power'])
export const diagramLevelSchema = z.enum(['campus', 'building', 'pod', 'device'])

export const anchorTypeSchema = z.enum([
  'electrical',
  'cooling-primary-cold',
  'cooling-primary-hot',
  'cooling-secondary-cold',
  'cooling-secondary-hot',
  'cooling-general',
])

export const anchorDirectionSchema = z.enum(['top', 'right', 'bottom', 'left'])

export const symbolAnchorSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  direction: anchorDirectionSchema,
  type: anchorTypeSchema,
})

export const assetDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  source: z.string().min(1),
  intrinsicWidth: z.number().positive(),
  intrinsicHeight: z.number().positive(),
  anchors: z.array(symbolAnchorSchema),
})

export const diagramElementSchema = z.object({
  id: z.string().min(1),
  diagramId: z.string().min(1),
  assetKey: z.string().min(1),
  name: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().finite(),
  properties: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  extensions: z.record(z.string(), z.unknown()),
})

export const busbarOrientationSchema = z.enum(['horizontal', 'vertical'])

export const busbarSchema = z.object({
  id: z.string().min(1),
  diagramId: z.string().min(1),
  type: z.literal('electrical'),
  orientation: busbarOrientationSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  length: z.number().positive(),
})

export const connectionNodeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('element-anchor'),
    elementId: z.string().min(1),
    anchorId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('busbar-tap'),
    busbarId: z.string().min(1),
    offset: z.number().finite(),
  }),
])

export const connectionEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
})

export const connectionNetworkSchema = z.object({
  id: z.string().min(1),
  diagramId: z.string().min(1),
  type: anchorTypeSchema,
  nodes: z.array(connectionNodeSchema).min(2),
  edges: z.array(connectionEdgeSchema).min(1),
})

export const diagramSchema = z.object({
  id: z.string().min(1),
  lineSystemId: z.string().min(1),
  parentId: z.string().nullable(),
  level: diagramLevelSchema,
  name: z.string().min(1),
  canvas: z.object({
    gridSize: z.number().int().min(2).max(100),
    viewport: z.object({
      zoom: z.number().min(0.1).max(8),
      tx: z.number().finite(),
      ty: z.number().finite(),
    }),
  }),
})

export const lineSystemSchema = z.object({
  id: z.string().min(1),
  type: lineSystemTypeSchema,
  name: z.string().min(1),
  rootDiagramId: z.string().min(1),
})

export const projectDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    project: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
    lineSystems: z.array(lineSystemSchema).length(2),
    diagrams: z.array(diagramSchema).min(1),
    elements: z.array(diagramElementSchema),
    busbars: z.array(busbarSchema),
    connections: z.array(connectionNetworkSchema),
    assets: z.array(assetDefinitionSchema),
    extensions: z.record(z.string(), z.unknown()),
  })
  .superRefine((document, context) => {
    const lineSystemIds = new Set(document.lineSystems.map((line) => line.id))
    const lineSystemTypes = new Set(document.lineSystems.map((line) => line.type))
    const diagramsById = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
    const assetKeys = new Set(document.assets.map((asset) => asset.key))
    const assetsByKey = new Map(document.assets.map((asset) => [asset.key, asset]))
    const elementsById = new Map(document.elements.map((element) => [element.id, element]))
    const busbarsById = new Map(document.busbars.map((busbar) => [busbar.id, busbar]))

    if (lineSystemIds.size !== document.lineSystems.length) {
      context.addIssue({
        code: 'custom',
        path: ['lineSystems'],
        message: '线路 ID 必须唯一',
      })
    }
    if (lineSystemTypes.size !== document.lineSystems.length) {
      context.addIssue({
        code: 'custom',
        path: ['lineSystems'],
        message: '冷却线路和电力线路必须各有一套',
      })
    }
    if (diagramsById.size !== document.diagrams.length) {
      context.addIssue({
        code: 'custom',
        path: ['diagrams'],
        message: '图纸 ID 必须唯一',
      })
    }
    if (assetKeys.size !== document.assets.length) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: '素材键必须唯一',
      })
    }

    for (const asset of document.assets) {
      const anchorIds = new Set<string>()
      const anchorCoordinates = new Set<string>()

      for (const anchor of asset.anchors) {
        const path = ['assets', asset.key, 'anchors', anchor.id]
        if (anchorIds.has(anchor.id)) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的锚点 ID 必须唯一`,
          })
        }
        anchorIds.add(anchor.id)

        const coordinateKey = `${anchor.x},${anchor.y}`
        if (anchorCoordinates.has(coordinateKey)) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的同一位置只能有一个锚点`,
          })
        }
        anchorCoordinates.add(coordinateKey)

        if (anchor.x % EDITOR_GRID_SIZE !== 0 || anchor.y % EDITOR_GRID_SIZE !== 0) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的锚点必须位于 8px 网格点`,
          })
        }

        const onLeft = anchor.x === 0
        const onRight = anchor.x === asset.intrinsicWidth
        const onTop = anchor.y === 0
        const onBottom = anchor.y === asset.intrinsicHeight
        const edgeCount = Number(onLeft) + Number(onRight) + Number(onTop) + Number(onBottom)

        if (
          anchor.x < 0 ||
          anchor.x > asset.intrinsicWidth ||
          anchor.y < 0 ||
          anchor.y > asset.intrinsicHeight
        ) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的锚点不能超出图元边界`,
          })
          continue
        }

        if (edgeCount === 2) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的角点不能添加锚点`,
          })
          continue
        }
        if (edgeCount !== 1) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的锚点只能位于图元边缘`,
          })
          continue
        }

        const expectedDirection = onTop
          ? 'top'
          : onRight
            ? 'right'
            : onBottom
              ? 'bottom'
              : 'left'
        if (anchor.direction !== expectedDirection) {
          context.addIssue({
            code: 'custom',
            path,
            message: `图元“${asset.name}”的锚点方向必须垂直边缘向外`,
          })
        }
      }
    }

    const elementIds = new Set(document.elements.map((element) => element.id))
    if (elementIds.size !== document.elements.length) {
      context.addIssue({
        code: 'custom',
        path: ['elements'],
        message: '图元 ID 必须唯一',
      })
    }

    for (const lineSystem of document.lineSystems) {
      const root = diagramsById.get(lineSystem.rootDiagramId)
      if (!root || root.lineSystemId !== lineSystem.id || root.parentId !== null) {
        context.addIssue({
          code: 'custom',
          path: ['lineSystems', lineSystem.id, 'rootDiagramId'],
          message: `线路“${lineSystem.name}”缺少有效的根图纸`,
        })
      }
    }

    for (const diagram of document.diagrams) {
      if (!lineSystemIds.has(diagram.lineSystemId)) {
        context.addIssue({
          code: 'custom',
          path: ['diagrams', diagram.id, 'lineSystemId'],
          message: `图纸“${diagram.name}”引用了不存在的线路`,
        })
      }

      if (diagram.parentId) {
        const parent = diagramsById.get(diagram.parentId)
        if (!parent || parent.lineSystemId !== diagram.lineSystemId) {
          context.addIssue({
            code: 'custom',
            path: ['diagrams', diagram.id, 'parentId'],
            message: `图纸“${diagram.name}”缺少有效的上级图纸`,
          })
        }

        const visited = new Set([diagram.id])
        let ancestor = parent
        while (ancestor) {
          if (visited.has(ancestor.id)) {
            context.addIssue({
              code: 'custom',
              path: ['diagrams', diagram.id, 'parentId'],
              message: `图纸“${diagram.name}”的层级关系存在循环`,
            })
            break
          }
          visited.add(ancestor.id)
          ancestor = ancestor.parentId ? diagramsById.get(ancestor.parentId) : undefined
        }
      }
    }

    for (const element of document.elements) {
      if (!diagramsById.has(element.diagramId)) {
        context.addIssue({
          code: 'custom',
          path: ['elements', element.id, 'diagramId'],
          message: `图元“${element.name}”引用了不存在的图纸`,
        })
      }
      if (!assetKeys.has(element.assetKey)) {
        context.addIssue({
          code: 'custom',
          path: ['elements', element.id, 'assetKey'],
          message: `图元“${element.name}”引用了不存在的素材`,
        })
      }
      if (
        element.properties.color !== undefined &&
        (
          typeof element.properties.color !== 'string' ||
          !/^#[0-9a-f]{6}$/i.test(element.properties.color)
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['elements', element.id, 'properties', 'color'],
          message: `图元“${element.name}”的颜色必须是六位十六进制值`,
        })
      }
    }

    if (busbarsById.size !== document.busbars.length) {
      context.addIssue({
        code: 'custom',
        path: ['busbars'],
        message: '母线 ID 必须唯一',
      })
    }
    for (const busbar of document.busbars) {
      const path = ['busbars', busbar.id]
      const diagram = diagramsById.get(busbar.diagramId)
      const lineSystem = diagram
        ? document.lineSystems.find((line) => line.id === diagram.lineSystemId)
        : undefined
      if (!diagram || lineSystem?.type !== 'power') {
        context.addIssue({
          code: 'custom',
          path: [...path, 'diagramId'],
          message: '母线必须属于有效的电力图纸',
        })
      }
      if (
        busbar.x % EDITOR_GRID_SIZE !== 0 ||
        busbar.y % EDITOR_GRID_SIZE !== 0 ||
        busbar.length % EDITOR_GRID_SIZE !== 0
      ) {
        context.addIssue({
          code: 'custom',
          path,
          message: '母线位置和长度必须贴合 8px 网格',
        })
      }
      if (busbar.length < BUSBAR_MIN_LENGTH) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'length'],
          message: `母线长度不能小于 ${BUSBAR_MIN_LENGTH}px`,
        })
      }
    }

    const networkIds = new Set<string>()
    const occupiedAnchors = new Set<string>()
    const occupiedBusbars = new Set<string>()
    for (const network of document.connections) {
      const networkPath = ['connections', network.id]
      if (networkIds.has(network.id)) {
        context.addIssue({
          code: 'custom',
          path: networkPath,
          message: '线路网络 ID 必须唯一',
        })
      }
      networkIds.add(network.id)

      const diagram = diagramsById.get(network.diagramId)
      if (!diagram) {
        context.addIssue({
          code: 'custom',
          path: [...networkPath, 'diagramId'],
          message: '线路网络引用了不存在的图纸',
        })
      }

      const nodeIds = new Set(network.nodes.map((node) => node.id))
      const nodesById = new Map(network.nodes.map((node) => [node.id, node]))
      if (nodeIds.size !== network.nodes.length) {
        context.addIssue({
          code: 'custom',
          path: [...networkPath, 'nodes'],
          message: '同一线路网络中的节点 ID 必须唯一',
        })
      }
      const edgeIds = new Set(network.edges.map((edge) => edge.id))
      if (edgeIds.size !== network.edges.length) {
        context.addIssue({
          code: 'custom',
          path: [...networkPath, 'edges'],
          message: '同一线路网络中的边 ID 必须唯一',
        })
      }

      const degree = new Map(network.nodes.map((node) => [node.id, 0]))
      const adjacency = new Map(network.nodes.map((node) => [node.id, new Set<string>()]))
      const edgePairs = new Set<string>()
      for (const edge of network.edges) {
        if (
          edge.sourceNodeId === edge.targetNodeId ||
          !nodeIds.has(edge.sourceNodeId) ||
          !nodeIds.has(edge.targetNodeId)
        ) {
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'edges', edge.id],
            message: '线路边必须引用两个不同的有效节点',
          })
          continue
        }
        const sourceNode = nodesById.get(edge.sourceNodeId)
        const targetNode = nodesById.get(edge.targetNodeId)
        if (
          sourceNode?.kind === 'busbar-tap' &&
          targetNode?.kind === 'busbar-tap' &&
          sourceNode.busbarId === targetNode.busbarId
        ) {
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'edges', edge.id],
            message: '同一母线不能通过普通子线连接自身',
          })
        }
        const pair = [edge.sourceNodeId, edge.targetNodeId].sort().join('::')
        if (edgePairs.has(pair)) {
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'edges', edge.id],
            message: '同一对拓扑节点之间只能有一条线路边',
          })
        }
        edgePairs.add(pair)
        degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1)
        degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1)
        adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId)
        adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId)
      }

      const anchorTypes: AnchorType[] = []
      const busbarTapIds = new Map<string, string[]>()
      const busbarTapOffsets = new Set<string>()
      for (const node of network.nodes) {
        const path = [...networkPath, 'nodes', node.id]
        if (node.kind === 'busbar-tap') {
          const busbar = busbarsById.get(node.busbarId)
          if (!busbar || busbar.diagramId !== network.diagramId) {
            context.addIssue({
              code: 'custom',
              path,
              message: '母线接入点必须引用同一图纸中的有效母线',
            })
            continue
          }
          if (
            node.offset < 0 ||
            node.offset > busbar.length ||
            node.offset % EDITOR_GRID_SIZE !== 0
          ) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'offset'],
              message: '母线接入点必须位于母线范围内的 8px 网格点',
            })
          }
          const offsetKey = `${node.busbarId}::${node.offset}`
          if (busbarTapOffsets.has(offsetKey)) {
            context.addIssue({
              code: 'custom',
              path,
              message: '同一母线位置只能保存一个接入节点',
            })
          }
          busbarTapOffsets.add(offsetKey)
          if ((degree.get(node.id) ?? 0) < 1) {
            context.addIssue({
              code: 'custom',
              path,
              message: '母线接入节点必须至少连接一条普通线路边',
            })
          }
          const tapIds = busbarTapIds.get(node.busbarId) ?? []
          tapIds.push(node.id)
          busbarTapIds.set(node.busbarId, tapIds)
          anchorTypes.push('electrical')
          continue
        }

        const element = elementsById.get(node.elementId)
        const asset = element ? assetsByKey.get(element.assetKey) : undefined
        const anchor = asset?.anchors.find((candidate) => candidate.id === node.anchorId)
        if (!element || element.diagramId !== network.diagramId || !anchor) {
          context.addIssue({
            code: 'custom',
            path,
            message: '线路端点必须引用同一图纸中的有效图元锚点',
          })
          continue
        }
        const occupationKey = `${node.elementId}::${node.anchorId}`
        if (occupiedAnchors.has(occupationKey)) {
          context.addIssue({
            code: 'custom',
            path,
            message: '同一图元锚点只能属于一个线路网络',
          })
        }
        occupiedAnchors.add(occupationKey)
        if ((degree.get(node.id) ?? 0) < 1) {
          context.addIssue({
            code: 'custom',
            path,
            message: '图元锚点必须至少连接一条线路边',
          })
        }
        anchorTypes.push(anchor.type)
      }

      for (const [busbarId, tapIds] of busbarTapIds) {
        if (occupiedBusbars.has(busbarId)) {
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'nodes'],
            message: '同一母线上的接入点必须属于一个线路网络',
          })
        }
        occupiedBusbars.add(busbarId)
        for (const left of tapIds) {
          for (const right of tapIds) {
            if (left !== right) adjacency.get(left)?.add(right)
          }
        }
      }

      const resolvedType = resolveConnectionType(anchorTypes)
      if (!resolvedType || resolvedType !== network.type) {
        context.addIssue({
          code: 'custom',
          path: [...networkPath, 'type'],
          message: '线路网络类型必须与其全部图元锚点兼容',
        })
      }

      if (diagram) {
        const lineSystem = document.lineSystems.find((line) => line.id === diagram.lineSystemId)
        if (
          (lineSystem?.type === 'power' && network.type !== 'electrical') ||
          (lineSystem?.type === 'cooling' && network.type === 'electrical')
        ) {
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'type'],
            message: '线路网络类型必须与当前冷却或电力图纸一致',
          })
        }
      }

      const firstNodeId = network.nodes[0]?.id
      if (firstNodeId) {
        const visited = new Set<string>([firstNodeId])
        const pending = [firstNodeId]
        while (pending.length) {
          const current = pending.shift()!
          for (const next of adjacency.get(current) ?? []) {
            if (!visited.has(next)) {
              visited.add(next)
              pending.push(next)
            }
          }
        }
        if (visited.size !== network.nodes.length) {
          context.addIssue({
            code: 'custom',
            path: networkPath,
            message: '一个线路网络中的所有节点必须连通',
          })
        }
      }
    }
  })

export type LineSystemType = z.infer<typeof lineSystemTypeSchema>
export type DiagramLevel = z.infer<typeof diagramLevelSchema>
export type AnchorType = z.infer<typeof anchorTypeSchema>
export type AnchorDirection = z.infer<typeof anchorDirectionSchema>
export type SymbolAnchor = z.infer<typeof symbolAnchorSchema>
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>
export type DiagramElement = z.infer<typeof diagramElementSchema>
export type BusbarOrientation = z.infer<typeof busbarOrientationSchema>
export type Busbar = z.infer<typeof busbarSchema>
export type ConnectionNode = z.infer<typeof connectionNodeSchema>
export type ConnectionEdge = z.infer<typeof connectionEdgeSchema>
export type ConnectionNetwork = z.infer<typeof connectionNetworkSchema>
export type Diagram = z.infer<typeof diagramSchema>
export type DiagramViewport = Diagram['canvas']['viewport']
export type LineSystem = z.infer<typeof lineSystemSchema>
export type ProjectDocument = z.infer<typeof projectDocumentSchema>

const LEVELS: Array<{ level: DiagramLevel; name: string }> = [
  { level: 'campus', name: '园区总图' },
  { level: 'building', name: '1 号楼' },
  { level: 'pod', name: 'POD A' },
  { level: 'device', name: '设备间' },
]

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function createLineTree(
  projectId: string,
  type: LineSystemType,
  name: string,
): { lineSystem: LineSystem; diagrams: Diagram[] } {
  const lineSystemId = `${projectId}-${type}`
  let parentId: string | null = null
  const diagrams = LEVELS.map(({ level, name: levelName }) => {
    const diagram: Diagram = {
      id: createId(`${type}-${level}`),
      lineSystemId,
      parentId,
      level,
      name: levelName,
      canvas: {
        gridSize: EDITOR_GRID_SIZE,
        viewport: { zoom: 1, tx: 0, ty: 0 },
      },
    }
    parentId = diagram.id
    return diagram
  })

  return {
    lineSystem: {
      id: lineSystemId,
      type,
      name,
      rootDiagramId: diagrams[0].id,
    },
    diagrams,
  }
}

export function createDefaultProject(
  name = 'AIDC 一次接线图',
  assets: AssetDefinition[] = [],
): ProjectDocument {
  const projectId = createId('project')
  const now = new Date().toISOString()
  const cooling = createLineTree(projectId, 'cooling', '冷却线路')
  const power = createLineTree(projectId, 'power', '电力线路')

  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      id: projectId,
      name,
      createdAt: now,
      updatedAt: now,
    },
    lineSystems: [cooling.lineSystem, power.lineSystem],
    diagrams: [...cooling.diagrams, ...power.diagrams],
    elements: [],
    busbars: [],
    connections: [],
    assets: assets.map((asset) => ({
      ...asset,
      anchors: asset.anchors.map((anchor) => ({ ...anchor })),
    })),
    extensions: {
      ports: [],
      edges: [],
      monitorBindings: [],
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveConnectionType(types: AnchorType[]): AnchorType | null {
  const uniqueTypes = new Set(types)
  if (uniqueTypes.has('electrical')) {
    return uniqueTypes.size === 1 ? 'electrical' : null
  }
  const specialized = [...uniqueTypes].filter((type) => type !== 'cooling-general')
  if (specialized.length > 1) return null
  return specialized[0] ?? 'cooling-general'
}

const LEGACY_SWITCH_KEYS = new Set(['switch-off', 'switch-on'])

function mergeLegacySwitchAnchors(assets: unknown[]) {
  const switchAssets = assets
    .filter((asset): asset is Record<string, unknown> => (
      isRecord(asset) && (
        asset.key === 'switch-off' || asset.key === 'switch-on' || asset.key === 'switch'
      )
    ))
    .sort((left, right) => {
      const priority = (key: unknown) => key === 'switch-off' ? 0 : key === 'switch' ? 1 : 2
      return priority(left.key) - priority(right.key)
    })
  const anchors = switchAssets.flatMap((asset) => (
    Array.isArray(asset.anchors) ? asset.anchors : []
  ))
  const seenCoordinates = new Set<string>()
  const seenIds = new Set<string>()

  return anchors.flatMap((anchor, index) => {
    if (!isRecord(anchor)) return [anchor]
    const coordinate = `${String(anchor.x)},${String(anchor.y)}`
    if (seenCoordinates.has(coordinate)) return []
    seenCoordinates.add(coordinate)

    if (typeof anchor.id !== 'string' || !seenIds.has(anchor.id)) {
      if (typeof anchor.id === 'string') seenIds.add(anchor.id)
      return [anchor]
    }

    const migratedId = `${anchor.id}-migrated-${index + 1}`
    seenIds.add(migratedId)
    return [{ ...anchor, id: migratedId }]
  })
}

function migrateLegacySwitch(
  input: Record<string, unknown>,
  installedAssets: AssetDefinition[],
) {
  if (!Array.isArray(input.assets) || !Array.isArray(input.elements)) return input
  const hasLegacySwitch = input.assets.some((asset) => (
    isRecord(asset) && typeof asset.key === 'string' && LEGACY_SWITCH_KEYS.has(asset.key)
  )) || input.elements.some((element) => (
    isRecord(element) && typeof element.assetKey === 'string' && LEGACY_SWITCH_KEYS.has(element.assetKey)
  ))
  if (!hasLegacySwitch) return input

  const installedSwitch = installedAssets.find((asset) => asset.key === 'switch')
  const switchAssets = input.assets.filter((asset): asset is Record<string, unknown> => (
    isRecord(asset) && (
      asset.key === 'switch-off' || asset.key === 'switch-on' || asset.key === 'switch'
    )
  ))
  const baseSwitch = switchAssets.find((asset) => asset.key === 'switch-off')
    ?? switchAssets.find((asset) => asset.key === 'switch')
    ?? switchAssets[0]
    ?? installedSwitch
  const firstSwitchIndex = input.assets.findIndex((asset) => (
    isRecord(asset) && (
      asset.key === 'switch-off' || asset.key === 'switch-on' || asset.key === 'switch'
    )
  ))
  const migratedSwitch = {
    ...baseSwitch,
    key: 'switch',
    name: 'Switch',
    category: installedSwitch?.category ?? baseSwitch?.category ?? '电力',
    source: installedSwitch?.source ?? 'src/assets/symbols/SwitchOff.svg',
    intrinsicWidth: installedSwitch?.intrinsicWidth ?? baseSwitch?.intrinsicWidth ?? 32,
    intrinsicHeight: installedSwitch?.intrinsicHeight ?? baseSwitch?.intrinsicHeight ?? 32,
    anchors: mergeLegacySwitchAnchors(input.assets),
  }

  return {
    ...input,
    assets: input.assets.flatMap((asset, index) => {
      const isSwitch = isRecord(asset) && (
        asset.key === 'switch-off' || asset.key === 'switch-on' || asset.key === 'switch'
      )
      if (!isSwitch) return [asset]
      return index === firstSwitchIndex ? [migratedSwitch] : []
    }),
    elements: input.elements.map((element) => {
      if (
        !isRecord(element) ||
        typeof element.assetKey !== 'string' ||
        !LEGACY_SWITCH_KEYS.has(element.assetKey)
      ) {
        return element
      }
      return {
        ...element,
        assetKey: 'switch',
        name: element.name === 'Switch On' || element.name === 'Switch Off'
          ? 'Switch'
          : element.name,
      }
    }),
  }
}

function migrateLegacyConnectionJunctions(connections: unknown[]) {
  return connections.map((value) => {
    if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
      return value
    }
    const nodes = value.nodes.filter(isRecord)
    if (!nodes.some((node) => node.kind === 'junction')) return value

    const terminals = nodes.filter((node) => (
      node.kind === 'element-anchor' || node.kind === 'busbar-tap'
    ) && typeof node.id === 'string')
    const terminalIds = new Set(terminals.map((node) => node.id as string))
    const parent = new Map([...terminalIds].map((id) => [id, id]))
    const find = (id: string): string => {
      const current = parent.get(id) ?? id
      if (current === id) return id
      const root = find(current)
      parent.set(id, root)
      return root
    }
    const union = (left: string, right: string) => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
    }

    const directEdges = value.edges.filter((edge): edge is Record<string, unknown> => (
      isRecord(edge) &&
      typeof edge.sourceNodeId === 'string' &&
      typeof edge.targetNodeId === 'string' &&
      terminalIds.has(edge.sourceNodeId) &&
      terminalIds.has(edge.targetNodeId)
    ))
    directEdges.forEach((edge) => union(
      edge.sourceNodeId as string,
      edge.targetNodeId as string,
    ))

    const tapsByBusbar = new Map<string, string[]>()
    terminals.forEach((node) => {
      if (node.kind !== 'busbar-tap' || typeof node.busbarId !== 'string') return
      const tapIds = tapsByBusbar.get(node.busbarId) ?? []
      tapIds.push(node.id as string)
      tapsByBusbar.set(node.busbarId, tapIds)
    })
    tapsByBusbar.forEach((tapIds) => {
      tapIds.slice(1).forEach((id) => union(tapIds[0], id))
    })

    const componentRepresentatives = new Map<string, string>()
    terminals.forEach((node) => {
      const id = node.id as string
      const root = find(id)
      if (!componentRepresentatives.has(root)) componentRepresentatives.set(root, id)
    })
    const representatives = [...componentRepresentatives.values()]
    const migratedEdges = [...directEdges]
    const usedEdgeIds = new Set(migratedEdges.flatMap((edge) => (
      typeof edge.id === 'string' ? [edge.id] : []
    )))
    const networkId = typeof value.id === 'string' ? value.id : 'connection-network'
    const baseId = representatives[0]
    representatives.slice(1).forEach((targetId, index) => {
      if (!baseId) return
      let edgeId = `${networkId}-migrated-link-${index + 1}`
      while (usedEdgeIds.has(edgeId)) edgeId = `${edgeId}-next`
      usedEdgeIds.add(edgeId)
      migratedEdges.push({
        id: edgeId,
        sourceNodeId: baseId,
        targetNodeId: targetId,
      })
      union(baseId, targetId)
    })

    return {
      ...value,
      nodes: terminals,
      edges: migratedEdges,
    }
  })
}

function migrateProjectDocument(
  input: unknown,
  installedAssets: AssetDefinition[],
): unknown {
  if (!isRecord(input) || ![1, 2, 3, 4, 5, SCHEMA_VERSION].includes(Number(input.schemaVersion))) return input

  const installedByKey = new Map(installedAssets.map((asset) => [asset.key, asset]))
  const withCurrentAssetShape = input.schemaVersion === 1 && Array.isArray(input.assets) ? {
    ...input,
    assets: input.assets.map((value) => {
      if (!isRecord(value) || typeof value.key !== 'string') return value
      const installed = installedByKey.get(value.key)
      return {
        ...value,
        intrinsicWidth: value.intrinsicWidth ?? installed?.intrinsicWidth,
        intrinsicHeight: value.intrinsicHeight ?? installed?.intrinsicHeight,
        anchors: [],
      }
    }),
  } : input

  return migrateLegacySwitch({
    ...withCurrentAssetShape,
    schemaVersion: SCHEMA_VERSION,
    busbars: Array.isArray(withCurrentAssetShape.busbars)
      ? withCurrentAssetShape.busbars
      : [],
    connections: Array.isArray(withCurrentAssetShape.connections)
      ? migrateLegacyConnectionJunctions(withCurrentAssetShape.connections)
      : [],
  }, installedAssets)
}

export function parseProjectDocument(
  input: unknown,
  installedAssets: AssetDefinition[] = [],
): ProjectDocument {
  const document = projectDocumentSchema.parse(migrateProjectDocument(input, installedAssets))
  const installedByKey = new Map(installedAssets.map((asset) => [asset.key, asset]))
  return {
    ...document,
    lineSystems: document.lineSystems.map((lineSystem) => (
      lineSystem.type === 'power'
        ? { ...lineSystem, name: '电力线路' }
        : lineSystem
    )),
    assets: document.assets.map((asset) => ({
      ...asset,
      category: installedByKey.get(asset.key)?.category ?? asset.category,
    })),
    diagrams: document.diagrams.map((diagram) => ({
      ...diagram,
      canvas: { ...diagram.canvas, gridSize: EDITOR_GRID_SIZE },
    })),
  }
}

export function getDiagramPath(document: ProjectDocument, diagramId: string) {
  const byId = new Map(document.diagrams.map((diagram) => [diagram.id, diagram]))
  const path: Diagram[] = []
  let current = byId.get(diagramId)
  const visited = new Set<string>()

  while (current && !visited.has(current.id)) {
    path.unshift(current)
    visited.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return path
}

export function getFirstDiagramId(document: ProjectDocument) {
  return document.lineSystems[0]?.rootDiagramId ?? document.diagrams[0]?.id ?? ''
}

export function touchDocument(document: ProjectDocument): ProjectDocument {
  return {
    ...document,
    project: {
      ...document.project,
      updatedAt: new Date().toISOString(),
    },
  }
}
