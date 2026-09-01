import { z } from 'zod'

export const SCHEMA_VERSION = 28 as const
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
export const coolingDeviceRoleSchema = z.enum(['pump', 'valve', 'check-valve'])
export const coolingFlowRoleSchema = z.enum(['inlet', 'outlet'])
export const elementLabelPlacementSchema = z.enum(['top', 'right', 'bottom', 'left'])
export const elementOnOffStateSchema = z.enum(['off', 'on'])
export const connectionFlowDirectionSchema = z.enum(['forward', 'reverse'])
export const coolingLineRoleSchema = z.enum(['primary', 'auxiliary'])
export const connectionPointSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
})
// 仅供编辑器内部的点坐标快照使用；Schema v21 不再单独持久化途径点。
export const routeWaypointSchema = connectionPointSchema
export const monitorMetricPrecisionSchema = z.union([z.literal(0), z.literal(1), z.literal(2)])
export const monitorAlarmSeveritySchema = z.enum(['normal', 'minor', 'major', 'critical'])

const monitorMetricUpperThresholdSchema = z.object({
  mode: z.literal('upper'),
  minor: z.number().finite(),
  major: z.number().finite(),
  critical: z.number().finite(),
})

const monitorMetricLowerThresholdSchema = z.object({
  mode: z.literal('lower'),
  minor: z.number().finite(),
  major: z.number().finite(),
  critical: z.number().finite(),
})

const monitorMetricOutsideThresholdSchema = z.object({
  mode: z.literal('outside'),
  minorLow: z.number().finite(),
  minorHigh: z.number().finite(),
  majorLow: z.number().finite(),
  majorHigh: z.number().finite(),
  criticalLow: z.number().finite(),
  criticalHigh: z.number().finite(),
})

export const monitorMetricAlarmSchema = z.discriminatedUnion('mode', [
  monitorMetricUpperThresholdSchema,
  monitorMetricLowerThresholdSchema,
  monitorMetricOutsideThresholdSchema,
])

const monitorMetricNumberSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '指标名称不能为空').max(40, '指标名称不能超过 40 个字符'),
  valueType: z.literal('number'),
  unit: z.string().trim().max(12, '单位不能超过 12 个字符').optional(),
  precision: monitorMetricPrecisionSchema,
  simulationMin: z.number().finite(),
  simulationMax: z.number().finite(),
  alarm: monitorMetricAlarmSchema,
}).superRefine((metric, context) => {
  if (metric.simulationMin >= metric.simulationMax) {
    context.addIssue({
      code: 'custom',
      path: ['simulationMax'],
      message: '模拟最大值必须大于最小值',
    })
  }
  const alarm = metric.alarm
  if (alarm.mode === 'upper' && !(alarm.minor < alarm.major && alarm.major < alarm.critical)) {
    context.addIssue({
      code: 'custom',
      path: ['alarm'],
      message: '上限阈值必须满足：次要 < 重要 < 紧急',
    })
  }
  if (alarm.mode === 'lower' && !(alarm.critical < alarm.major && alarm.major < alarm.minor)) {
    context.addIssue({
      code: 'custom',
      path: ['alarm'],
      message: '下限阈值必须满足：紧急 < 重要 < 次要',
    })
  }
  if (alarm.mode === 'outside' && !(
    alarm.criticalLow < alarm.majorLow &&
    alarm.majorLow < alarm.minorLow &&
    alarm.minorLow < alarm.minorHigh &&
    alarm.minorHigh < alarm.majorHigh &&
    alarm.majorHigh < alarm.criticalHigh
  )) {
    context.addIssue({
      code: 'custom',
      path: ['alarm'],
      message: '区间阈值必须从紧急下界到紧急上界依次递增',
    })
  }
})

export const monitorMetricTextOptionSchema = z.object({
  id: z.string().min(1),
  value: z.string().trim().min(1, '状态内容不能为空').max(24, '状态内容不能超过 24 个字符'),
  severity: monitorAlarmSeveritySchema,
})

const monitorMetricTextSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '指标名称不能为空').max(40, '指标名称不能超过 40 个字符'),
  valueType: z.literal('text'),
  textOptions: z.array(monitorMetricTextOptionSchema).min(1, '文本指标至少需要一个候选状态'),
}).superRefine((metric, context) => {
  const optionIds = new Set<string>()
  metric.textOptions.forEach((option, index) => {
    if (optionIds.has(option.id)) {
      context.addIssue({
        code: 'custom',
        path: ['textOptions', index, 'id'],
        message: '状态标识不能重复',
      })
    }
    optionIds.add(option.id)
  })
})

export const monitorMetricSchema = z.union([
  monitorMetricNumberSchema,
  monitorMetricTextSchema,
])

export const symbolAnchorSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  direction: anchorDirectionSchema,
  type: anchorTypeSchema,
  flowRole: coolingFlowRoleSchema.optional(),
})

export const assetDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  source: z.string().min(1),
  intrinsicWidth: z.number().positive(),
  intrinsicHeight: z.number().positive(),
  coolingDeviceRole: coolingDeviceRoleSchema.optional(),
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
  labelVisible: z.boolean().optional(),
  labelPlacement: elementLabelPlacementSchema.optional(),
  monitorDataVisible: z.boolean().optional(),
  monitorMetricLabelsVisible: z.boolean().optional(),
  monitorMetrics: z.array(monitorMetricSchema).max(5, '每个图元最多配置 5 项运行指标').optional(),
  onOffState: elementOnOffStateSchema.optional(),
  properties: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  extensions: z.record(z.string(), z.unknown()),
})

export const busbarOrientationSchema = z.enum(['horizontal', 'vertical'])
export const busbarLabelEndpointSchema = z.enum(['start', 'end'])

export const busbarSchema = z.object({
  id: z.string().min(1),
  diagramId: z.string().min(1),
  type: z.literal('electrical'),
  orientation: busbarOrientationSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  length: z.number().positive(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, '颜色必须是六位十六进制值').optional(),
  label: z.string().trim().min(1).optional(),
  labelVisible: z.boolean().optional(),
  labelEndpoint: busbarLabelEndpointSchema.optional(),
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
  z.object({
    id: z.string().min(1),
    kind: z.literal('node'),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
])

export const connectionEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  logicalConnectionId: z.string().min(1).optional(),
  flowDirection: connectionFlowDirectionSchema.optional(),
  coolingLineRole: coolingLineRoleSchema.optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, '颜色必须是六位十六进制值').optional(),
  label: z.string().trim().min(1).optional(),
  labelVisible: z.boolean().optional(),
  labelEndpoint: z.enum(['source', 'target']).optional(),
  labelSide: z.enum(['negative', 'positive']).optional(),
  monitorDataVisible: z.boolean().optional(),
  monitorMetricLabelsVisible: z.boolean().optional(),
  monitorMetrics: z.array(monitorMetricSchema).max(5, '每条子线最多配置 5 项运行指标').optional(),
  routeNodeIds: z.array(z.string().min(1)).optional(),
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
      const metricIds = new Set<string>()
      for (const metric of element.monitorMetrics ?? []) {
        if (metricIds.has(metric.id)) {
          context.addIssue({
            code: 'custom',
            path: ['elements', element.id, 'monitorMetrics', metric.id],
            message: `图元“${element.name}”的运行指标 ID 必须唯一`,
          })
        }
        metricIds.add(metric.id)
      }
      for (const [property, label] of [
        ['color', '颜色'],
        ['switchOffColor', '关状态颜色'],
        ['switchOnColor', '开状态颜色'],
        ['genericBackgroundColor', '背景颜色'],
      ] as const) {
        const value = element.properties[property]
        if (value === undefined) continue
        if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) continue
        context.addIssue({
          code: 'custom',
          path: ['elements', element.id, 'properties', property],
          message: `图元“${element.name}”的${label}必须是六位十六进制值`,
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
      for (const edge of network.edges) {
        const metricIds = new Set<string>()
        for (const metric of edge.monitorMetrics ?? []) {
          if (metricIds.has(metric.id)) {
            context.addIssue({
              code: 'custom',
              path: [...networkPath, 'edges', edge.id, 'monitorMetrics', metric.id],
              message: '子线的运行指标 ID 必须唯一',
            })
          }
          metricIds.add(metric.id)
        }
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
        const routeNodeIds = edge.routeNodeIds ?? []
        if (new Set(routeNodeIds).size !== routeNodeIds.length) {
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'edges', edge.id, 'routeNodeIds'],
            message: '同一逻辑边不能重复引用同一个节点',
          })
        }
        for (const routeNodeId of routeNodeIds) {
          const routeNode = nodesById.get(routeNodeId)
          if (routeNode?.kind === 'node') continue
          context.addIssue({
            code: 'custom',
            path: [...networkPath, 'edges', edge.id, 'routeNodeIds'],
            message: '逻辑边必须引用当前网络中的自由节点',
          })
        }
        const physicalNodeIds = [edge.sourceNodeId, ...routeNodeIds, edge.targetNodeId]
        for (let index = 1; index < physicalNodeIds.length; index += 1) {
          const sourceId = physicalNodeIds[index - 1]
          const targetId = physicalNodeIds[index]
          if (sourceId === targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
            context.addIssue({
              code: 'custom',
              path: [...networkPath, 'edges', edge.id, 'routeNodeIds'],
              message: '逻辑边的相邻物理节点必须有效且彼此不同',
            })
            continue
          }
          degree.set(sourceId, (degree.get(sourceId) ?? 0) + 1)
          degree.set(targetId, (degree.get(targetId) ?? 0) + 1)
          adjacency.get(sourceId)?.add(targetId)
          adjacency.get(targetId)?.add(sourceId)
        }
      }

      const anchorTypes: AnchorType[] = []
      const busbarTapIds = new Map<string, string[]>()
      const busbarTapOffsets = new Set<string>()
      for (const node of network.nodes) {
        const path = [...networkPath, 'nodes', node.id]
        if (node.kind === 'node') {
          if (
            node.x % EDITOR_GRID_SIZE !== 0 ||
            node.y % EDITOR_GRID_SIZE !== 0
          ) {
            context.addIssue({
              code: 'custom',
              path,
              message: '节点必须位于 8px 网格点',
            })
          }
          if ((degree.get(node.id) ?? 0) < 1) {
            context.addIssue({
              code: 'custom',
              path,
              message: '自由节点必须至少连接一个物理子线段',
            })
          }
          anchorTypes.push(network.type)
          continue
        }
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
export type CoolingDeviceRole = z.infer<typeof coolingDeviceRoleSchema>
export type CoolingFlowRole = z.infer<typeof coolingFlowRoleSchema>
export type ElementLabelPlacement = z.infer<typeof elementLabelPlacementSchema>
export type ElementOnOffState = z.infer<typeof elementOnOffStateSchema>
export type MonitorMetricPrecision = z.infer<typeof monitorMetricPrecisionSchema>
export type MonitorAlarmSeverity = z.infer<typeof monitorAlarmSeveritySchema>
export type MonitorMetricAlarm = z.infer<typeof monitorMetricAlarmSchema>
export type MonitorMetricTextOption = z.infer<typeof monitorMetricTextOptionSchema>
export type MonitorMetric = z.infer<typeof monitorMetricSchema>
export type SymbolAnchor = z.infer<typeof symbolAnchorSchema>
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>
export type DiagramElement = z.infer<typeof diagramElementSchema>
export type BusbarOrientation = z.infer<typeof busbarOrientationSchema>
export type BusbarLabelEndpoint = z.infer<typeof busbarLabelEndpointSchema>
export type Busbar = z.infer<typeof busbarSchema>
export type ConnectionNode = z.infer<typeof connectionNodeSchema>
export type ConnectionEdge = z.infer<typeof connectionEdgeSchema>
export type ConnectionFlowDirection = NonNullable<ConnectionEdge['flowDirection']>
export type CoolingLineRole = NonNullable<ConnectionEdge['coolingLineRole']>
export type ConnectionLabelEndpoint = NonNullable<ConnectionEdge['labelEndpoint']>
export type ConnectionLabelSide = NonNullable<ConnectionEdge['labelSide']>
export type ConnectionNetwork = z.infer<typeof connectionNetworkSchema>
export type RouteWaypoint = z.infer<typeof connectionPointSchema>
export type Diagram = z.infer<typeof diagramSchema>
export type DiagramViewport = Diagram['canvas']['viewport']
export type LineSystem = z.infer<typeof lineSystemSchema>
export type ProjectDocument = z.infer<typeof projectDocumentSchema>

export const ON_OFF_STATE_ASSET_KEYS = new Set(['switch', '2-wv', 'cv'])

export function elementUsesOnOffState(element: Pick<DiagramElement, 'assetKey'>) {
  return ON_OFF_STATE_ASSET_KEYS.has(element.assetKey)
}

export function projectOnOffStates(document: ProjectDocument) {
  return Object.fromEntries(document.elements.flatMap((element) => (
    elementUsesOnOffState(element)
      ? [[element.id, element.onOffState === 'on'] as const]
      : []
  )))
}

export function withOnOffStateSnapshot(
  document: ProjectDocument,
  states: Record<string, boolean> = {},
): ProjectDocument {
  let changed = false
  const elements = document.elements.map((element) => {
    if (!elementUsesOnOffState(element)) return element
    const on = Object.prototype.hasOwnProperty.call(states, element.id)
      ? states[element.id]
      : element.onOffState === 'on'
    const onOffState: ElementOnOffState = on ? 'on' : 'off'
    if (element.onOffState === onOffState) return element
    changed = true
    return { ...element, onOffState }
  })
  return changed ? { ...document, elements } : document
}

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

function migrateOnOffStateColors(input: Record<string, unknown>) {
  if (!Array.isArray(input.elements)) return input
  return {
    ...input,
    elements: input.elements.map((element) => {
      if (
        !isRecord(element) ||
        typeof element.assetKey !== 'string' ||
        !ON_OFF_STATE_ASSET_KEYS.has(element.assetKey) ||
        !isRecord(element.properties)
      ) return element
      const legacyColor = element.properties.color
      if (typeof legacyColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(legacyColor)) {
        return element
      }
      const properties = { ...element.properties }
      properties.switchOffColor ??= legacyColor.toUpperCase()
      properties.switchOnColor ??= legacyColor.toUpperCase()
      delete properties.color
      return { ...element, properties }
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

function repairLegacyConnectionReferences(connections: unknown[]) {
  return connections.flatMap((value) => {
    if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
      return [value]
    }
    const nodes = value.nodes.filter((node): node is Record<string, unknown> => (
      isRecord(node) && typeof node.id === 'string'
    ))
    const nodeIds = new Set(nodes.map((node) => node.id as string))
    const edges = value.edges.filter((edge): edge is Record<string, unknown> => (
      isRecord(edge) &&
      typeof edge.sourceNodeId === 'string' &&
      typeof edge.targetNodeId === 'string' &&
      edge.sourceNodeId !== edge.targetNodeId &&
      nodeIds.has(edge.sourceNodeId) &&
      nodeIds.has(edge.targetNodeId)
    ))
    const referencedNodeIds = new Set(edges.flatMap((edge) => [
      edge.sourceNodeId as string,
      edge.targetNodeId as string,
      ...(Array.isArray(edge.routeNodeIds)
        ? edge.routeNodeIds.filter((id): id is string => typeof id === 'string')
        : []),
    ]))
    const retainedNodes = nodes.filter((node) => referencedNodeIds.has(node.id as string))
    return retainedNodes.length >= 2 && edges.length >= 1
      ? [{ ...value, nodes: retainedNodes, edges }]
      : []
  })
}

function migrateUnifiedConnectionNodes(
  input: Record<string, unknown>,
  preserveFreeEndpoints = false,
) {
  if (!Array.isArray(input.diagrams) || !Array.isArray(input.connections)) return input
  const routePointsByDiagram = new Map<string, Map<string, Record<string, unknown>>>()
  const diagrams = input.diagrams.map((value) => {
    if (!isRecord(value)) return value
    const routePoints = new Map<string, Record<string, unknown>>()
    if (Array.isArray(value.routeWaypoints)) {
      value.routeWaypoints.forEach((point) => {
        if (isRecord(point) && typeof point.id === 'string') routePoints.set(point.id, point)
      })
    }
    if (typeof value.id === 'string') routePointsByDiagram.set(value.id, routePoints)
    const { routeWaypoints: _routeWaypoints, ...diagram } = value
    return diagram
  })

  const connections = input.connections.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.diagramId !== 'string' ||
      !Array.isArray(value.nodes) ||
      !Array.isArray(value.edges)
    ) return [value]
    const routePoints = routePointsByDiagram.get(value.diagramId) ?? new Map()
    const nodes: Record<string, unknown>[] = value.nodes.flatMap((node) => {
      if (!isRecord(node)) return []
      return [{ ...node, ...(node.kind === 'junction' ? { kind: 'node' } : {}) }]
    })
    const nodeIds = new Set(nodes.flatMap((node) => (
      typeof node.id === 'string' ? [node.id] : []
    )))
    const edges: Record<string, unknown>[] = value.edges.flatMap((edge) => {
      if (!isRecord(edge)) return []
      const legacyIds = Array.isArray(edge.routeWaypointIds)
        ? edge.routeWaypointIds.filter((id): id is string => typeof id === 'string')
        : []
      const currentIds = Array.isArray(edge.routeNodeIds)
        ? edge.routeNodeIds.filter((id): id is string => typeof id === 'string')
        : []
      const routeNodeIds = [...new Set([...currentIds, ...legacyIds])]
      routeNodeIds.forEach((id) => {
        if (nodeIds.has(id)) return
        const point = routePoints.get(id)
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return
        nodes.push({ id, kind: 'node', x: point.x, y: point.y })
        nodeIds.add(id)
      })
      const validRouteNodeIds = routeNodeIds.filter((id) => nodeIds.has(id))
      const { routeWaypointIds: _legacy, routeNodeIds: _current, ...rest } = edge
      return [{
        ...rest,
        ...(validRouteNodeIds.length ? { routeNodeIds: validRouteNodeIds } : {}),
      }]
    })

    let retainedNodes = nodes
    let retainedEdges = edges
    let changed = true
    while (changed) {
      changed = false
      const degree = new Map<string, number>()
      retainedEdges.forEach((edge) => {
        if (!isRecord(edge)) return
        const routeNodeIds = Array.isArray(edge.routeNodeIds)
          ? edge.routeNodeIds.filter((id): id is string => typeof id === 'string')
          : []
        const chain = [edge.sourceNodeId, ...routeNodeIds, edge.targetNodeId]
          .filter((id): id is string => typeof id === 'string')
        for (let index = 1; index < chain.length; index += 1) {
          degree.set(chain[index - 1], (degree.get(chain[index - 1]) ?? 0) + 1)
          degree.set(chain[index], (degree.get(chain[index]) ?? 0) + 1)
        }
      })
      const danglingIds = new Set(retainedNodes.flatMap((node) => (
        node.kind === 'node' &&
        typeof node.id === 'string' &&
        (degree.get(node.id) ?? 0) < (preserveFreeEndpoints ? 1 : 2)
          ? [node.id]
          : []
      )))
      if (!danglingIds.size) break
      retainedNodes = retainedNodes.filter((node) => (
        typeof node.id !== 'string' || !danglingIds.has(node.id)
      ))
      retainedEdges = retainedEdges.filter((edge) => {
        if (!isRecord(edge)) return false
        if (
          typeof edge.sourceNodeId === 'string' && danglingIds.has(edge.sourceNodeId) ||
          typeof edge.targetNodeId === 'string' && danglingIds.has(edge.targetNodeId)
        ) return false
        return !Array.isArray(edge.routeNodeIds) ||
          !edge.routeNodeIds.some((id) => typeof id === 'string' && danglingIds.has(id))
      })
      changed = true
    }
    const referencedIds = new Set(retainedEdges.flatMap((edge) => (
      isRecord(edge)
        ? [edge.sourceNodeId, edge.targetNodeId, ...(Array.isArray(edge.routeNodeIds) ? edge.routeNodeIds : [])]
            .filter((id): id is string => typeof id === 'string')
        : []
    )))
    retainedNodes = retainedNodes.filter((node) => (
      typeof node.id === 'string' && referencedIds.has(node.id)
    ))
    return retainedNodes.length >= 2 && retainedEdges.length >= 1
      ? [{ ...value, nodes: retainedNodes, edges: retainedEdges }]
      : []
  })
  return { ...input, diagrams, connections }
}

function migrateNodeBoundedConnectionEdges(input: Record<string, unknown>) {
  if (!Array.isArray(input.connections)) return input
  return {
    ...input,
    connections: input.connections.map((value) => {
      if (!isRecord(value) || !Array.isArray(value.edges)) return value
      const usedEdgeIds = new Set(value.edges.flatMap((edge) => (
        isRecord(edge) && typeof edge.id === 'string' ? [edge.id] : []
      )))
      const nextSegmentId = (edgeId: string, segmentIndex: number) => {
        const base = `${edgeId}:segment:${segmentIndex + 1}`
        let candidate = base
        let suffix = 2
        while (usedEdgeIds.has(candidate)) {
          candidate = `${base}:${suffix}`
          suffix += 1
        }
        usedEdgeIds.add(candidate)
        return candidate
      }
      return {
        ...value,
        edges: value.edges.flatMap((edge) => {
          if (
            !isRecord(edge) ||
            typeof edge.id !== 'string' ||
            typeof edge.sourceNodeId !== 'string' ||
            typeof edge.targetNodeId !== 'string'
          ) return [edge]
          const routeNodeIds = Array.isArray(edge.routeNodeIds)
            ? edge.routeNodeIds.filter((id): id is string => typeof id === 'string')
            : []
          if (!routeNodeIds.length) return [edge]
          const edgeId = edge.id
          const sourceNodeId = edge.sourceNodeId
          const targetNodeId = edge.targetNodeId
          const chain = [sourceNodeId, ...routeNodeIds, targetNodeId]
          const logicalConnectionId = typeof edge.logicalConnectionId === 'string'
            ? edge.logicalConnectionId
            : edgeId
          const labelSegmentIndex = edge.labelEndpoint === 'source' ? 0 : chain.length - 2
          const {
            routeNodeIds: _routeNodeIds,
            label: _label,
            labelVisible: _labelVisible,
            labelEndpoint: _labelEndpoint,
            labelSide: _labelSide,
            monitorDataVisible: _monitorDataVisible,
            monitorMetricLabelsVisible: _monitorMetricLabelsVisible,
            monitorMetrics: _monitorMetrics,
            ...edgeWithoutRouteAndDisplayData
          } = edge
          const hasDisplayData = (
            typeof edge.label === 'string' && Boolean(edge.label.trim())
          ) || (
            Array.isArray(edge.monitorMetrics) && edge.monitorMetrics.length > 0
          )
          const retainedIdSegmentIndex = hasDisplayData ? labelSegmentIndex : 0
          return chain.slice(1).map((targetNodeId, segmentIndex) => ({
            ...edgeWithoutRouteAndDisplayData,
            id: segmentIndex === retainedIdSegmentIndex
              ? edgeId
              : nextSegmentId(edgeId, segmentIndex),
            sourceNodeId: chain[segmentIndex],
            targetNodeId,
            logicalConnectionId,
            ...(segmentIndex === labelSegmentIndex ? {
              ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
              ...(typeof edge.labelVisible === 'boolean'
                ? { labelVisible: edge.labelVisible }
                : {}),
              ...(edge.labelEndpoint === 'source' || edge.labelEndpoint === 'target'
                ? { labelEndpoint: edge.labelEndpoint }
                : {}),
              ...(edge.labelSide === 'negative' || edge.labelSide === 'positive'
                ? { labelSide: edge.labelSide }
                : {}),
              ...(typeof edge.monitorDataVisible === 'boolean'
                ? { monitorDataVisible: edge.monitorDataVisible }
                : {}),
              ...(typeof edge.monitorMetricLabelsVisible === 'boolean'
                ? { monitorMetricLabelsVisible: edge.monitorMetricLabelsVisible }
                : {}),
              ...(Array.isArray(edge.monitorMetrics)
                ? { monitorMetrics: edge.monitorMetrics }
                : {}),
            } : {}),
          }))
        }),
      }
    }),
  }
}

const EDITOR_CONNECTION_NODE_ID_PREFIXES = [
  'route-waypoint-',
  'connection-node-',
] as const

function repairEditorGeneratedOffGridConnectionNodes(input: Record<string, unknown>) {
  if (!Array.isArray(input.connections)) return input
  return {
    ...input,
    connections: input.connections.map((value) => {
      if (!isRecord(value) || !Array.isArray(value.nodes)) return value
      return {
        ...value,
        nodes: value.nodes.map((node) => {
          const nodeId = isRecord(node) && typeof node.id === 'string' ? node.id : null
          if (
            !isRecord(node) ||
            node.kind !== 'node' ||
            nodeId === null ||
            !EDITOR_CONNECTION_NODE_ID_PREFIXES.some((prefix) => nodeId.startsWith(prefix)) ||
            typeof node.x !== 'number' ||
            !Number.isFinite(node.x) ||
            typeof node.y !== 'number' ||
            !Number.isFinite(node.y) ||
            node.x % EDITOR_GRID_SIZE === 0 && node.y % EDITOR_GRID_SIZE === 0
          ) return node
          return {
            ...node,
            x: snapToGrid(node.x),
            y: snapToGrid(node.y),
          }
        }),
      }
    }),
  }
}

function migrateProjectDocument(
  input: unknown,
  installedAssets: AssetDefinition[],
): unknown {
  if (!isRecord(input) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, SCHEMA_VERSION].includes(Number(input.schemaVersion))) return input

  const sourceSchemaVersion = Number(input.schemaVersion)

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

  const withCvCheckValve = sourceSchemaVersion < 24 && Array.isArray(withCurrentAssetShape.assets)
    ? {
        ...withCurrentAssetShape,
        assets: withCurrentAssetShape.assets.map((value) => {
          if (!isRecord(value) || value.key !== 'cv' || !Array.isArray(value.anchors)) return value
          const width = typeof value.intrinsicWidth === 'number' ? value.intrinsicWidth : 32
          const height = typeof value.intrinsicHeight === 'number' ? value.intrinsicHeight : 32
          const configuredInlet = value.anchors.find((anchor) => (
            isRecord(anchor) && anchor.flowRole === 'inlet'
          ))
          const configuredOutlet = value.anchors.find((anchor) => (
            isRecord(anchor) && anchor.flowRole === 'outlet'
          ))
          const canonicalInlet = configuredInlet ?? value.anchors.find((anchor) => (
            isRecord(anchor) &&
            anchor.type !== 'electrical' &&
            anchor.x === width / 2 &&
            anchor.y === 0 &&
            anchor.direction === 'top'
          ))
          const canonicalOutlet = configuredOutlet ?? value.anchors.find((anchor) => (
            isRecord(anchor) &&
            anchor.type !== 'electrical' &&
            anchor.x === width / 2 &&
            anchor.y === height &&
            anchor.direction === 'bottom'
          ))
          return {
            ...value,
            coolingDeviceRole: 'check-valve',
            anchors: value.anchors.map((anchor) => {
              if (!isRecord(anchor)) return anchor
              const { flowRole: _legacyFlowRole, ...withoutFlowRole } = anchor
              if (anchor === canonicalInlet) return { ...withoutFlowRole, flowRole: 'inlet' }
              if (anchor === canonicalOutlet) return { ...withoutFlowRole, flowRole: 'outlet' }
              return withoutFlowRole
            }),
          }
        }),
      }
    : withCurrentAssetShape

  const withUnifiedConnections = migrateUnifiedConnectionNodes({
    ...withCvCheckValve,
    schemaVersion: SCHEMA_VERSION,
    busbars: Array.isArray(withCvCheckValve.busbars)
      ? withCvCheckValve.busbars
      : [],
    connections: Array.isArray(withCvCheckValve.connections)
      ? sourceSchemaVersion < SCHEMA_VERSION
        ? repairLegacyConnectionReferences(
            sourceSchemaVersion <= 5
              ? migrateLegacyConnectionJunctions(withCvCheckValve.connections)
              : withCvCheckValve.connections,
          )
        : withCvCheckValve.connections
      : [],
  }, sourceSchemaVersion >= 27)
  const withNodeBoundedConnectionEdges = sourceSchemaVersion < 26
    ? migrateNodeBoundedConnectionEdges(withUnifiedConnections)
    : withUnifiedConnections
  const migrated = migrateOnOffStateColors(migrateLegacySwitch(
    repairEditorGeneratedOffGridConnectionNodes(withNodeBoundedConnectionEdges),
    installedAssets,
  ))

  if (!isRecord(migrated) || !Array.isArray(migrated.elements)) return migrated
  const usedTagsByDiagram = new Map<string, Set<string>>()
  for (const value of migrated.elements) {
    if (!isRecord(value) || typeof value.diagramId !== 'string' || !isRecord(value.properties)) {
      continue
    }
    const tag = value.properties.tag
    if (typeof tag !== 'string' || !tag.trim()) continue
    const used = usedTagsByDiagram.get(value.diagramId) ?? new Set<string>()
    used.add(tag.trim())
    usedTagsByDiagram.set(value.diagramId, used)
  }

  return {
    ...migrated,
    elements: migrated.elements.map((value) => {
      if (!isRecord(value) || typeof value.diagramId !== 'string') return value
      const properties = isRecord(value.properties) ? value.properties : {}
      const currentTag = properties.tag
      const monitorMetrics = Array.isArray(value.monitorMetrics)
        ? value.monitorMetrics.map((metric) => (
          isRecord(metric) && metric.valueType === undefined
            ? { ...metric, valueType: 'number' }
            : metric
        ))
        : value.monitorMetrics
      if (typeof currentTag === 'string' && currentTag.trim()) {
        return { ...value, monitorMetrics }
      }
      const base = typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : typeof value.assetKey === 'string' && value.assetKey.trim()
          ? value.assetKey.trim()
          : '设备'
      const used = usedTagsByDiagram.get(value.diagramId) ?? new Set<string>()
      let index = 1
      let tag = `${base}-${String(index).padStart(2, '0')}`
      while (used.has(tag)) {
        index += 1
        tag = `${base}-${String(index).padStart(2, '0')}`
      }
      used.add(tag)
      usedTagsByDiagram.set(value.diagramId, used)
      return { ...value, monitorMetrics, properties: { ...properties, tag } }
    }),
  }
}

const LEGACY_PHE_WIDTH = 80
const LEGACY_PHE_HEIGHT = 160
const CURRENT_PHE_WIDTH = 200
const CURRENT_PHE_HEIGHT = 80
const CURRENT_PHE_SCALE_STEP = 0.2
const LEGACY_TMU_WIDTH = 48
const LEGACY_TMU_HEIGHT = 64
const CURRENT_TMU_WIDTH = 72
const CURRENT_TMU_HEIGHT = 96

function normalizeRotation(value: number) {
  return ((value % 360) + 360) % 360
}

function snapToGrid(value: number) {
  return Math.round(value / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE
}

function rotateLegacyPheDirection(direction: SymbolAnchor['direction']): SymbolAnchor['direction'] {
  return {
    top: 'right',
    right: 'bottom',
    bottom: 'left',
    left: 'top',
  }[direction] as SymbolAnchor['direction']
}

function migrateLegacyPheAnchor(anchor: SymbolAnchor): SymbolAnchor {
  const isStandardSidePort =
    (anchor.x === 0 || anchor.x === LEGACY_PHE_WIDTH) &&
    (anchor.y === 8 || anchor.y === LEGACY_PHE_HEIGHT - 8)
  const x = isStandardSidePort
    ? anchor.y === 8 ? 144 : 64
    : snapToGrid(CURRENT_PHE_WIDTH * (1 - anchor.y / LEGACY_PHE_HEIGHT))
  const y = isStandardSidePort
    ? anchor.x === 0 ? 0 : CURRENT_PHE_HEIGHT
    : snapToGrid(CURRENT_PHE_HEIGHT * anchor.x / LEGACY_PHE_WIDTH)
  return {
    ...anchor,
    x: Math.min(CURRENT_PHE_WIDTH, Math.max(0, x)),
    y: Math.min(CURRENT_PHE_HEIGHT, Math.max(0, y)),
    direction: rotateLegacyPheDirection(anchor.direction),
  }
}

function rotatedBoundsOffset(width: number, height: number, rotation: number) {
  const radians = normalizeRotation(rotation) * Math.PI / 180
  const boundsWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
  const boundsHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  return {
    x: (width - boundsWidth) / 2,
    y: (height - boundsHeight) / 2,
  }
}

function migrateLegacyPheElement(element: DiagramElement): DiagramElement {
  const legacyScale = element.width / LEGACY_PHE_WIDTH
  const scale = Math.max(
    CURRENT_PHE_SCALE_STEP,
    Math.round(legacyScale / CURRENT_PHE_SCALE_STEP) * CURRENT_PHE_SCALE_STEP,
  )
  const width = CURRENT_PHE_WIDTH * scale
  const height = CURRENT_PHE_HEIGHT * scale
  const rotation = normalizeRotation(element.rotation - 90)
  const oldOffset = rotatedBoundsOffset(element.width, element.height, element.rotation)
  const newOffset = rotatedBoundsOffset(width, height, rotation)
  return {
    ...element,
    x: Number((element.x + oldOffset.x - newOffset.x).toFixed(8)),
    y: Number((element.y + oldOffset.y - newOffset.y).toFixed(8)),
    width,
    height,
    rotation,
  }
}

function migrateLegacyTmuAnchor(anchor: SymbolAnchor): SymbolAnchor {
  return {
    ...anchor,
    x: Math.min(
      CURRENT_TMU_WIDTH,
      Math.max(0, snapToGrid(CURRENT_TMU_WIDTH * anchor.x / LEGACY_TMU_WIDTH)),
    ),
    y: Math.min(
      CURRENT_TMU_HEIGHT,
      Math.max(0, snapToGrid(CURRENT_TMU_HEIGHT * anchor.y / LEGACY_TMU_HEIGHT)),
    ),
  }
}

function migrateLegacyTmuElement(element: DiagramElement): DiagramElement {
  if (element.width !== LEGACY_TMU_WIDTH || element.height !== LEGACY_TMU_HEIGHT) {
    return element
  }
  return {
    ...element,
    width: CURRENT_TMU_WIDTH,
    height: CURRENT_TMU_HEIGHT,
  }
}

export function parseProjectDocument(
  input: unknown,
  installedAssets: AssetDefinition[] = [],
): ProjectDocument {
  const document = projectDocumentSchema.parse(migrateProjectDocument(input, installedAssets))
  const installedByKey = new Map(installedAssets.map((asset) => [asset.key, asset]))
  const documentAssetKeys = new Set(document.assets.map((asset) => asset.key))
  const legacyPheAssetKeys = new Set(document.assets.flatMap((asset) => {
    const installed = installedByKey.get(asset.key)
    return asset.key === 'phe' &&
      asset.intrinsicWidth === 80 &&
      asset.intrinsicHeight === 160 &&
      installed?.source.endsWith('/PHE.png') &&
      installed.intrinsicWidth === 200 &&
      installed.intrinsicHeight === 80
      ? [asset.key]
      : []
  }))
  const legacyTmuAssetKeys = new Set(document.assets.flatMap((asset) => {
    const installed = installedByKey.get(asset.key)
    return asset.key === 'tmu' &&
      asset.intrinsicWidth === LEGACY_TMU_WIDTH &&
      asset.intrinsicHeight === LEGACY_TMU_HEIGHT &&
      installed?.source.endsWith('/TMU.png') &&
      installed.intrinsicWidth === CURRENT_TMU_WIDTH &&
      installed.intrinsicHeight === CURRENT_TMU_HEIGHT
      ? [asset.key]
      : []
  }))
  const synchronized = {
    ...document,
    lineSystems: document.lineSystems.map((lineSystem) => (
      lineSystem.type === 'power'
        ? { ...lineSystem, name: '电力线路' }
        : lineSystem
    )),
    assets: document.assets.map((asset) => {
      const installed = installedByKey.get(asset.key)
      return {
        ...asset,
        ...(installed ? {
          name: installed.name,
          category: installed.category,
          source: installed.source,
          intrinsicWidth: installed.intrinsicWidth,
          intrinsicHeight: installed.intrinsicHeight,
        } : {}),
        ...(legacyPheAssetKeys.has(asset.key) ? {
          anchors: asset.anchors.map(migrateLegacyPheAnchor),
        } : {}),
        ...(legacyTmuAssetKeys.has(asset.key) ? {
          anchors: asset.anchors.map(migrateLegacyTmuAnchor),
        } : {}),
        ...(asset.key === 'cv' ? { coolingDeviceRole: 'check-valve' as const } : {}),
      }
    }).concat(
      installedAssets
        .filter((asset) => !documentAssetKeys.has(asset.key))
        .map((asset) => ({
          ...asset,
          anchors: asset.anchors.map((anchor) => ({ ...anchor })),
        })),
    ),
    elements: document.elements.map((element) => {
      const withCurrentPheLayout = legacyPheAssetKeys.has(element.assetKey)
        ? migrateLegacyPheElement(element)
        : element
      const withCurrentTmuLayout = legacyTmuAssetKeys.has(withCurrentPheLayout.assetKey)
        ? migrateLegacyTmuElement(withCurrentPheLayout)
        : withCurrentPheLayout
      return withCurrentTmuLayout.assetKey === 'cabinet' && withCurrentTmuLayout.name === 'Cabinet'
        ? { ...withCurrentTmuLayout, name: 'Cabinet A' }
        : withCurrentTmuLayout
    }),
    diagrams: document.diagrams.map((diagram) => ({
      ...diagram,
      canvas: { ...diagram.canvas, gridSize: EDITOR_GRID_SIZE },
    })),
  }
  return projectDocumentSchema.parse(synchronized)
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
    schemaVersion: SCHEMA_VERSION,
    project: {
      ...document.project,
      updatedAt: new Date().toISOString(),
    },
  }
}
