import { forwardRef, memo, useCallback } from 'react'

import type { DiagramViewport } from '../domain/project'
import type { MonitorDrillDownTarget } from '../monitoring/diagramDrillDown'
import {
  DiagramMonitorCanvas,
  type DiagramMonitorCanvasHandle,
  type DiagramMonitorRuntimePresentation,
} from './DiagramMonitorCanvas'
import type { DiagramRuntimeView } from './diagramRuntime'
import type { DiagramRuntimeContext } from './types'

export interface DiagramRuntimeViewerProps {
  view: DiagramRuntimeView
  runtime: DiagramRuntimeContext
  animationPlaying: boolean
  documentEpoch?: number
  viewport?: DiagramViewport
  onSelectionChange?: (elementIds: string[]) => void
  onNavigate?: (target: MonitorDrillDownTarget, elementId: string) => void
  onViewportChange?: (viewport: DiagramViewport) => void
  onRuntimePresentationChange?: (presentation: DiagramMonitorRuntimePresentation) => void
}

const noopSelection = () => undefined

export const DiagramRuntimeViewer = memo(forwardRef<
  DiagramMonitorCanvasHandle,
  DiagramRuntimeViewerProps
>(function DiagramRuntimeViewer({
  view,
  runtime,
  animationPlaying,
  documentEpoch = 0,
  viewport = view.diagram.canvas.viewport,
  onSelectionChange = noopSelection,
  onNavigate,
  onViewportChange,
  onRuntimePresentationChange,
}, ref) {
  const handleElementDrillDown = useCallback((elementId: string) => {
    const target = runtime.navigation[elementId]
    if (target) onNavigate?.(target, elementId)
  }, [onNavigate, runtime.navigation])

  return (
    <DiagramMonitorCanvas
      ref={ref}
      view={view}
      runtime={runtime}
      animationPlaying={animationPlaying}
      documentEpoch={documentEpoch}
      viewport={viewport}
      onSelectionChange={onSelectionChange}
      onElementDrillDown={handleElementDrillDown}
      onViewportChange={onViewportChange}
      onRuntimePresentationChange={onRuntimePresentationChange}
    />
  )
}))
