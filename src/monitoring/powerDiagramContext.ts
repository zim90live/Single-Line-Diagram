import type { ProjectDocument } from '../domain/project'
import { derivePowerFlowTopology } from './flowTopology'
import { parentElementsLinkedToDiagram } from './diagramDrillDown'

function isPowerDiagram(document: ProjectDocument, diagramId: string) {
  const diagram = document.diagrams.find((candidate) => candidate.id === diagramId)
  const lineSystem = document.lineSystems.find((candidate) => candidate.id === diagram?.lineSystemId)
  return lineSystem?.type === 'power'
}

export function isPowerDiagramExternallyEnergized({
  document,
  diagramId,
  switchStates,
}: {
  document: ProjectDocument
  diagramId: string
  switchStates: Record<string, boolean>
}) {
  const visited = new Set<string>()

  const visit = (childDiagramId: string): boolean => {
    if (visited.has(childDiagramId) || !isPowerDiagram(document, childDiagramId)) return false
    visited.add(childDiagramId)

    const child = document.diagrams.find((diagram) => diagram.id === childDiagramId)
    if (!child?.parentId) return false
    const linkedParentElements = parentElementsLinkedToDiagram(document, childDiagramId)
    if (!linkedParentElements.length) return false

    const parentDiagramId = child.parentId
    const parentTopology = derivePowerFlowTopology({
      elements: document.elements.filter((element) => element.diagramId === parentDiagramId),
      busbars: document.busbars.filter((busbar) => busbar.diagramId === parentDiagramId),
      networks: document.connections.filter((network) => network.diagramId === parentDiagramId),
      switchStates,
      externalSupply: visit(parentDiagramId),
    })
    return linkedParentElements.some((element) => (
      parentTopology.energizedElementIds.has(element.id)
    ))
  }

  return visit(diagramId)
}
