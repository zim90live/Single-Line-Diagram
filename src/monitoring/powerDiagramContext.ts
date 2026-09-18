import type { PowerSupplyChannel, ProjectDocument } from '../domain/project'
import { parentElementsLinkedToDiagram } from './diagramDrillDown'
import { derivePowerFlowTopology } from './flowTopology'

export interface PowerDiagramExternalSupplyContext {
  active: boolean
  channels?: PowerSupplyChannel[]
  batteryBackupActive: boolean
}

function isPowerDiagram(document: ProjectDocument, diagramId: string) {
  const diagram = document.diagrams.find((candidate) => candidate.id === diagramId)
  const lineSystem = document.lineSystems.find((candidate) => candidate.id === diagram?.lineSystemId)
  return lineSystem?.type === 'power'
}

const INACTIVE_CONTEXT: PowerDiagramExternalSupplyContext = {
  active: false,
  batteryBackupActive: false,
}

export function derivePowerDiagramExternalSupply({
  document,
  diagramId,
  switchStates,
}: {
  document: ProjectDocument
  diagramId: string
  switchStates: Record<string, boolean>
}): PowerDiagramExternalSupplyContext {
  const visiting = new Set<string>()

  const visit = (childDiagramId: string): PowerDiagramExternalSupplyContext => {
    if (visiting.has(childDiagramId) || !isPowerDiagram(document, childDiagramId)) {
      return INACTIVE_CONTEXT
    }
    visiting.add(childDiagramId)

    const child = document.diagrams.find((diagram) => diagram.id === childDiagramId)
    if (!child?.parentId) {
      visiting.delete(childDiagramId)
      return INACTIVE_CONTEXT
    }
    const linkedParentElements = parentElementsLinkedToDiagram(document, childDiagramId)
    if (!linkedParentElements.length) {
      visiting.delete(childDiagramId)
      return INACTIVE_CONTEXT
    }

    const parentDiagramId = child.parentId
    const parentExternalSupply = visit(parentDiagramId)
    const parentTopology = derivePowerFlowTopology({
      elements: document.elements.filter((element) => element.diagramId === parentDiagramId),
      assets: document.assets,
      busbars: document.busbars.filter((busbar) => busbar.diagramId === parentDiagramId),
      networks: document.connections.filter((network) => network.diagramId === parentDiagramId),
      switchStates,
      externalSupply: parentExternalSupply.active,
      externalSupplyChannels: parentExternalSupply.channels,
      batteryBackup: parentExternalSupply.batteryBackupActive,
    })
    const energizedLinkedElements = linkedParentElements.filter((element) => (
      parentTopology.energizedElementIds.has(element.id)
    ))
    const channels = (['a', 'b'] as const).filter((channel) => (
      energizedLinkedElements.some((element) => (
        parentTopology.activeSupplyChannels[element.id]?.includes(channel)
      ))
    ))
    const active = energizedLinkedElements.length > 0
    const batteryBackupActive = !active && linkedParentElements.some((element) => (
      element.assetKey === 'ups-group'
    ))
    visiting.delete(childDiagramId)
    return {
      active,
      ...(channels.length ? { channels } : {}),
      batteryBackupActive,
    }
  }

  return visit(diagramId)
}

export function isPowerDiagramExternallyEnergized(args: {
  document: ProjectDocument
  diagramId: string
  switchStates: Record<string, boolean>
}) {
  return derivePowerDiagramExternalSupply(args).active
}
