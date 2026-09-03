import type { Diagram, DiagramElement, ProjectDocument } from '../domain/project'

export interface MonitorDrillDownTarget {
  diagramId: string
  diagramName: string
}

type DrillDownDocument = Pick<ProjectDocument, 'diagrams' | 'elements'>
type DiagramSide = 'left' | 'right' | null

function diagramSide(name: string): DiagramSide {
  const normalized = name.trim()
  if (/(?:^|[\s_-])L$/i.test(normalized) || /左$/.test(normalized)) return 'left'
  if (/(?:^|[\s_-])R$/i.test(normalized) || /右$/.test(normalized)) return 'right'
  return null
}

function drillDownFamily(name: string) {
  if (/^UPS(?:\b|[\s_-])/i.test(name.trim())) return 'ups' as const
  if (/分接单元|tap[\s-]*off\s*unit/i.test(name)) return 'tap-off-unit' as const
  if (/^TMU\s*到\s*FM[\s_-]*\d+\s*$/i.test(name.trim())) return 'cdu' as const
  return null
}

function normalizedSequence(value: string) {
  return value.replace(/^0+(?=\d)/, '')
}

function namedSequence(value: unknown, pattern: RegExp) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(pattern)
  return match?.[1] ? normalizedSequence(match[1]) : null
}

function cduSequence(element: DiagramElement) {
  const pattern = /^CDU[\s_-]*(\d+)\s*$/i
  return namedSequence(element.properties.tag, pattern) ?? namedSequence(element.name, pattern)
}

function centerX(element: DiagramElement) {
  return element.x + element.width / 2
}

function elementsForNamedChild(
  elements: DiagramElement[],
  child: Diagram,
) {
  const family = drillDownFamily(child.name)
  const side = diagramSide(child.name)

  if (family === 'tap-off-unit') {
    const assetKeys = side === 'left'
      ? new Set(['cabinet'])
      : side === 'right'
        ? new Set(['cabinet-b'])
        : new Set(['cabinet', 'cabinet-b'])
    return elements.filter((element) => assetKeys.has(element.assetKey))
  }

  if (family === 'ups') {
    const candidates = elements.filter((element) => element.assetKey === 'ups')
    if (!side || candidates.length < 2) return candidates
    const distinctCenters = [...new Set(candidates.map(centerX))].sort((left, right) => left - right)
    const targetCenter = side === 'left' ? distinctCenters[0] : distinctCenters.at(-1)
    return candidates.filter((element) => centerX(element) === targetCenter)
  }

  if (family === 'cdu') {
    const sequence = namedSequence(child.name, /^TMU\s*到\s*FM[\s_-]*(\d+)\s*$/i)
    if (sequence === null) return []
    return elements.filter((element) => (
      element.assetKey === 'cdu' && cduSequence(element) === sequence
    ))
  }

  return []
}

function explicitChildId(element: DiagramElement) {
  const value = element.properties.drillDownDiagramId
  return typeof value === 'string' && value.trim() ? value : null
}

export function parentElementsLinkedToDiagram(
  document: DrillDownDocument,
  childDiagramId: string,
) {
  const child = document.diagrams.find((diagram) => diagram.id === childDiagramId)
  if (!child?.parentId) return []
  const parentElements = document.elements.filter((element) => element.diagramId === child.parentId)
  const explicit = parentElements.filter((element) => explicitChildId(element) === child.id)
  return explicit.length ? explicit : elementsForNamedChild(parentElements, child)
}

export function resolveMonitorDrillDownTarget(
  document: DrillDownDocument,
  parentDiagramId: string,
  element: DiagramElement,
): MonitorDrillDownTarget | null {
  const children = document.diagrams.filter((diagram) => diagram.parentId === parentDiagramId)
  const explicitId = explicitChildId(element)
  if (explicitId) {
    const child = children.find((diagram) => diagram.id === explicitId)
    if (child) return { diagramId: child.id, diagramName: child.name }
  }

  for (const child of children) {
    if (!elementsForNamedChild(
      document.elements.filter((candidate) => candidate.diagramId === parentDiagramId),
      child,
    ).some((candidate) => candidate.id === element.id)) continue
    return { diagramId: child.id, diagramName: child.name }
  }

  return null
}
