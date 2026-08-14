import { create } from 'zustand'

import {
  createDefaultProject,
  getFirstDiagramId,
  touchDocument,
  type AssetDefinition,
  type Busbar,
  type ConnectionNetwork,
  type DiagramElement,
  type DiagramViewport,
  type ProjectDocument,
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
  replaceDiagramContent: (
    diagramId: string,
    elements: DiagramElement[],
    busbars: Busbar[],
    connections: ConnectionNetwork[],
  ) => void
  replaceAssetAnchors: (assetKey: string, anchors: SymbolAnchor[]) => void
  updateDiagramViewport: (diagramId: string, viewport: DiagramViewport) => void
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

  replaceDiagramContent: (diagramId, elements, busbars, connections) =>
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

  updateDiagramViewport: (diagramId, viewport) =>
    set((state) => {
      const diagram = state.document.diagrams.find((candidate) => candidate.id === diagramId)
      if (
        !diagram ||
        (diagram.canvas.viewport.zoom === viewport.zoom &&
          diagram.canvas.viewport.tx === viewport.tx &&
          diagram.canvas.viewport.ty === viewport.ty)
      ) {
        return state
      }
      return {
        document: updateDocument(state.document, (document) => ({
          ...document,
          diagrams: document.diagrams.map((candidate) =>
            candidate.id === diagramId
              ? { ...candidate, canvas: { ...candidate.canvas, viewport } }
              : candidate,
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
