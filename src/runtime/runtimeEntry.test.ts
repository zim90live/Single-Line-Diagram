import { describe, expect, it } from 'vitest'

import editorCanvasSource from '../editor/DiagramCanvas.tsx?raw'
import scenePrimitivesSource from '../scene/DiagramScenePrimitives.tsx?raw'
import monitorCanvasSource from './DiagramMonitorCanvas.tsx?raw'
import runtimeViewerSource from './DiagramRuntimeViewer.tsx?raw'
import coreEntrySource from './index.ts?raw'
import reactEntrySource from './react.ts?raw'
import bundleViewerSource from './RuntimeBundleViewer.tsx?raw'

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

  it('keeps editor and runtime rendering on the same static scene primitives', () => {
    const sharedImport = "from '../scene/DiagramScenePrimitives'"

    expect(editorCanvasSource).toContain(sharedImport)
    expect(monitorCanvasSource).toContain(sharedImport)
    expect(scenePrimitivesSource).not.toContain('DiagramCanvas')
    expect(scenePrimitivesSource).not.toContain('EditorCommandState')
  })
})
