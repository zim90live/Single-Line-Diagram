import { describe, expect, it } from 'vitest'

import appSource from '../App.tsx?raw'
import editorCanvasSource from '../editor/DiagramCanvas.tsx?raw'
import flowPresentationSource from '../monitoring/flowPresentation.ts?raw'
import busbarLabelsSource from '../scene/busbarLabels.ts?raw'
import connectionAppearanceSource from '../scene/connectionAppearance.ts?raw'
import connectionCrossingOrderSource from '../scene/connectionCrossingOrder.ts?raw'
import connectionLabelsSource from '../scene/connectionLabels.ts?raw'
import connectionSceneSource from '../scene/connectionScene.ts?raw'
import connectionsSource from '../scene/connections.ts?raw'
import scenePrimitivesSource from '../scene/DiagramScenePrimitives.tsx?raw'
import elementLabelsSource from '../scene/elementLabels.ts?raw'
import genericSymbolSource from '../scene/genericSymbol.ts?raw'
import geometrySource from '../scene/geometry.ts?raw'
import gridScaleSource from '../scene/gridScale.ts?raw'
import objectColorsSource from '../scene/objectColors.ts?raw'
import symbolCatalogSource from '../scene/symbolCatalog.ts?raw'
import wheelGesturesSource from '../scene/wheelGestures.ts?raw'
import monitorCanvasSource from './DiagramMonitorCanvas.tsx?raw'
import runtimeViewerSource from './DiagramRuntimeViewer.tsx?raw'
import coreEntrySource from './index.ts?raw'
import reactEntrySource from './react.ts?raw'
import routeEngineSource from './routeEngine.ts?raw'
import bundleViewerSource from './RuntimeBundleViewer.tsx?raw'
import routedConnectionsHookSource from './useRoutedConnections.ts?raw'

const portableImplementationSources = import.meta.glob<string>([
  '../runtime/**/*.ts',
  '../runtime/**/*.tsx',
  '../scene/**/*.ts',
  '../scene/**/*.tsx',
  '../monitoring/**/*.ts',
  '../monitoring/**/*.tsx',
  '!../runtime/**/*.test.ts',
  '!../runtime/**/*.test.tsx',
  '!../scene/**/*.test.ts',
  '!../scene/**/*.test.tsx',
  '!../monitoring/**/*.test.ts',
  '!../monitoring/**/*.test.tsx',
], {
  eager: true,
  query: '?raw',
  import: 'default',
})

describe('runtime public entries', () => {
  it('keeps the React runtime viewer independent from the editor canvas module', () => {
    const reactRuntimeSources = [
      reactEntrySource,
      monitorCanvasSource,
      runtimeViewerSource,
      bundleViewerSource,
    ].join('\n')

    expect(reactRuntimeSources).not.toContain("from '../editor/DiagramCanvas'")
    expect(reactRuntimeSources).not.toContain('EditorCommandState')
    expect(coreEntrySource).not.toContain("from './react'")
  })

  it('uses the dedicated monitor canvas in the application monitor workspace', () => {
    expect(appSource).toContain("from './runtime/DiagramMonitorCanvas'")
    expect(appSource).toContain('<DiagramMonitorCanvas')
    expect(appSource).toContain('<DiagramCanvas')
    expect(appSource).toContain('mode="edit"')
  })

  it('keeps portable runtime, scene, and monitoring implementations out of editor', () => {
    Object.entries(portableImplementationSources).forEach(([path, source]) => {
      expect(source, path).not.toMatch(/from\s+['"]\.\.\/editor\//)
    })
  })

  it('keeps editor and runtime rendering on the same static scene primitives', () => {
    const sharedImport = "from '../scene/DiagramScenePrimitives'"
    const sharedConnectionImport = "from '../scene/connectionScene'"

    expect(editorCanvasSource).toContain(sharedImport)
    expect(monitorCanvasSource).toContain(sharedImport)
    expect(editorCanvasSource).toContain(sharedConnectionImport)
    expect(monitorCanvasSource).toContain(sharedConnectionImport)
    const monitorSceneModules = [
      'geometry',
      'gridScale',
      'wheelGestures',
      'connectionAppearance',
      'objectColors',
      'genericSymbol',
      'GridSurface',
      'connections',
      'busbarLabels',
      'connectionLabels',
      'elementLabels',
      'symbolCatalog',
    ]
    monitorSceneModules.forEach((moduleName) => {
      expect(monitorCanvasSource).toContain(`from '../scene/${moduleName}'`)
    })
    expect(scenePrimitivesSource).not.toContain('DiagramCanvas')
    expect(scenePrimitivesSource).not.toContain('EditorCommandState')
    expect(scenePrimitivesSource).not.toContain("from '../editor/")
    expect(connectionSceneSource).not.toContain('FlowAnimationLayer')
    expect(connectionSceneSource).not.toContain("from '../editor/")
    expect(connectionSceneSource).not.toContain("from 'three'")
    expect(connectionSceneSource).not.toContain("from '@react-three/fiber'")
    expect(flowPresentationSource).not.toContain("from 'react'")
    expect(flowPresentationSource).not.toContain("from 'three'")
    expect(flowPresentationSource).not.toContain("from '@react-three/fiber'")
    const pureSceneFoundation = [
      connectionAppearanceSource,
      connectionCrossingOrderSource,
      genericSymbolSource,
      geometrySource,
      gridScaleSource,
      objectColorsSource,
      wheelGesturesSource,
    ].join('\n')
    expect(pureSceneFoundation).not.toContain("from '../editor/")
    expect(pureSceneFoundation).not.toContain("from 'react'")
    expect(pureSceneFoundation).not.toContain("from 'three'")
    expect(pureSceneFoundation).not.toContain("from '@react-three/fiber'")
    const sharedSceneImplementation = [
      busbarLabelsSource,
      connectionLabelsSource,
      connectionsSource,
      elementLabelsSource,
      symbolCatalogSource,
    ].join('\n')
    expect(sharedSceneImplementation).not.toContain("from '../editor/")
    expect(sharedSceneImplementation).not.toContain("from 'react'")
    expect(sharedSceneImplementation).not.toContain("from 'three'")
    expect(sharedSceneImplementation).not.toContain("from '@react-three/fiber'")
    expect(routeEngineSource).not.toContain("from '../editor/")
    expect(routeEngineSource).not.toContain("from 'react'")
    expect(routedConnectionsHookSource).not.toContain("from '../editor/")
    expect(monitorCanvasSource).toContain("from './useRoutedConnections'")
  })
})
