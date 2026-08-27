import { create } from 'zustand'

import {
  createDefaultProject,
  elementUsesOnOffState,
  getFirstDiagramId,
  touchDocument,
  type AssetDefinition,
  type Busbar,
  type ConnectionNetwork,
  type DiagramElement,
  type ProjectDocument,
  type RouteWaypoint,
  type SymbolAnchor,
} from '../domain/project'
import { symbolAssets } from '../editor/symbolCatalog'
import { normalizeConnectionNetworks } from '../editor/connections'

interface AppState {
  document: ProjectDocument
  documentEpoch: number
  currentDiagramId: string
  selectedElementIds: string[]
  dirty: boolean
  replaceDocument: (document: ProjectDocument, options?: { dirty?: boolean }) => void
  createProject: (name?: string) => void
  setCurrentDiagram: (diagramId: string) => void
  setSelectedElementIds: (ids: string[]) => void
  replaceDiagramElements: (diagramId: string, elements: DiagramElement[]) => void
  syncElementOnOffStates: (states: Record<string, boolean>) => void
  replaceDiagramContent: (
    diagramId: string,
    elements: DiagramElement[],
    busbars: Busbar[],
    connections: ConnectionNetwork[],
    routeWaypoints: RouteWaypoint[],
  ) => void
  replaceAssetAnchors: (assetKey: string, anchors: SymbolAnchor[]) => void
  replaceAssetDefinition: (
    assetKey: string,
    configuration: Pick<AssetDefinition, 'anchors' | 'coolingDeviceRole'>,
  ) => void
  renameProject: (name: string) => void
  markSaved: () => void
}

const initialDocument = createDefaultProject(undefined, symbolAssets)

function updateDocument(
  document: ProjectDocument,
  updater: (document: ProjectDocument) => ProjectDocument,
) {
  return touchDocument(updater(document))
}

export const useAppStore = create<AppState>((set) => ({
  document: initialDocument,
  documentEpoch: 0,
  currentDiagramId: getFirstDiagramId(initialDocument),
  selectedElementIds: [],
  dirty: false,

  replaceDocument: (document, options) =>
    set((state) => ({
      document,
      documentEpoch: state.documentEpoch + 1,
      currentDiagramId: getFirstDiagramId(document),
      selectedElementIds: [],
      dirty: options?.dirty ?? true,
    })),

  createProject: (name) => {
    const document = createDefaultProject(name, symbolAssets)
    set((state) => ({
      document,
      documentEpoch: state.documentEpoch + 1,
      currentDiagramId: getFirstDiagramId(document),
      selectedElementIds: [],
      dirty: false,
    }))
  },

  setCurrentDiagram: (diagramId) =>
    set((state) => {
      if (!state.document.diagrams.some((diagram) => diagram.id === diagramId)) {
        return state
      }
      return { currentDiagramId: diagramId, selectedElementIds: [] }
    }),

  setSelectedElementIds: (selectedElementIds) => set({ selectedElementIds }),

  replaceDiagramElements: (diagramId, elements) =>
    set((state) => ({
      document: updateDocument(state.document, (document) => ({
        ...document,
        elements: [
          ...document.elements.filter((element) => element.diagramId !== diagramId),
          ...elements,
        ],
      })),
      dirty: true,
    })),

  syncElementOnOffStates: (states) =>
    set((state) => {
      let changed = false
      const elements = state.document.elements.map((element) => {
        if (
          !elementUsesOnOffState(element) ||
          !Object.prototype.hasOwnProperty.call(states, element.id)
        ) return element
        const onOffState = states[element.id] ? 'on' as const : 'off' as const
        if (element.onOffState === onOffState) return element
        changed = true
        return { ...element, onOffState }
      })
      return changed
        ? { document: { ...state.document, elements } }
        : state
    }),

  replaceDiagramContent: (diagramId, elements, busbars, connections, _routeWaypoints) =>
    set((state) => ({
      document: updateDocument(state.document, (document) => ({
        ...document,
        elements: [
          ...document.elements.filter((element) => element.diagramId !== diagramId),
          ...elements,
        ],
        busbars: [
          ...document.busbars.filter((busbar) => busbar.diagramId !== diagramId),
          ...busbars,
        ],
        connections: [
          ...document.connections.filter((network) => network.diagramId !== diagramId),
          ...connections,
        ],
      })),
      dirty: true,
    })),

  replaceAssetAnchors: (assetKey, anchors) =>
    set((state) => {
      const currentAsset = state.document.assets.find((asset) => asset.key === assetKey)
      const installedAsset = symbolAssets.find((asset) => asset.key === assetKey)
      const asset = currentAsset ?? installedAsset
      if (!asset) return state

      const unchanged =
        currentAsset?.anchors.length === anchors.length &&
        currentAsset.anchors.every((anchor, index) => {
          const candidate = anchors[index]
          return candidate && Object.keys(anchor).every(
            (key) => anchor[key as keyof SymbolAnchor] === candidate[key as keyof SymbolAnchor],
          )
        })
      if (unchanged) return state

      const nextAsset: AssetDefinition = {
        ...asset,
        anchors: anchors.map((anchor) => ({ ...anchor })),
      }
      const nextAssets = currentAsset
        ? state.document.assets.map((candidate) => candidate.key === assetKey ? nextAsset : candidate)
        : [...state.document.assets, nextAsset]
      return {
        document: updateDocument(state.document, (document) => ({
          ...document,
          assets: nextAssets,
          connections: normalizeConnectionNetworks(
            document.connections,
            document.elements,
            nextAssets,
            document.busbars,
          ),
        })),
        dirty: true,
      }
    }),

  replaceAssetDefinition: (assetKey, configuration) =>
    set((state) => {
      const currentAsset = state.document.assets.find((asset) => asset.key === assetKey)
      const installedAsset = symbolAssets.find((asset) => asset.key === assetKey)
      const asset = currentAsset ?? installedAsset
      if (!asset) return state
      const coolingDeviceRole = assetKey === 'cv'
        ? 'check-valve' as const
        : configuration.coolingDeviceRole

      const anchorsUnchanged =
        currentAsset?.anchors.length === configuration.anchors.length &&
        currentAsset.anchors.every((anchor, index) => {
          const candidate = configuration.anchors[index]
          return candidate && Object.keys(anchor).every(
            (key) => anchor[key as keyof SymbolAnchor] === candidate[key as keyof SymbolAnchor],
          ) && Object.keys(candidate).every(
            (key) => candidate[key as keyof SymbolAnchor] === anchor[key as keyof SymbolAnchor],
          )
        })
      if (
        anchorsUnchanged &&
        currentAsset?.coolingDeviceRole === coolingDeviceRole
      ) return state

      const { coolingDeviceRole: _previousRole, ...assetWithoutRole } = asset
      const nextAsset: AssetDefinition = {
        ...assetWithoutRole,
        ...(coolingDeviceRole
          ? { coolingDeviceRole }
          : {}),
        anchors: configuration.anchors.map((anchor) => ({ ...anchor })),
      }
      const nextAssets = currentAsset
        ? state.document.assets.map((candidate) => candidate.key === assetKey ? nextAsset : candidate)
        : [...state.document.assets, nextAsset]
      return {
        document: updateDocument(state.document, (document) => ({
          ...document,
          assets: nextAssets,
          connections: normalizeConnectionNetworks(
            document.connections,
            document.elements,
            nextAssets,
            document.busbars,
          ),
        })),
        dirty: true,
      }
    }),

  renameProject: (name) =>
    set((state) => ({
      document: updateDocument(state.document, (document) => ({
        ...document,
        project: { ...document.project, name },
      })),
      dirty: true,
    })),

  markSaved: () => set({ dirty: false }),
}))
