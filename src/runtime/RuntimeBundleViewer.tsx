import { forwardRef, memo, useMemo, useState } from 'react'

import { projectOnOffStates } from '../domain/project'
import type { DiagramMonitorCanvasHandle } from './DiagramMonitorCanvas'
import { DiagramRuntimeViewer } from './DiagramRuntimeViewer'
import {
  createDiagramRuntimeViewFromBundle,
  type DiagramRuntimeBundle,
} from './runtimeBundle'
import { createDiagramRuntimeState } from './runtimeState'
import type {
  DiagramRuntimeProviders,
  DiagramRuntimeState,
} from './types'

export interface RuntimeBundleViewerProps {
  bundle: DiagramRuntimeBundle
  animationPlaying: boolean
  diagramId?: string
  defaultDiagramId?: string
  stateOverrides?: Partial<DiagramRuntimeState>
  providers?: DiagramRuntimeProviders
  onDiagramChange?: (diagramId: string) => void
  onSelectionChange?: (elementIds: string[]) => void
}

export const RuntimeBundleViewer = memo(forwardRef<
  DiagramMonitorCanvasHandle,
  RuntimeBundleViewerProps
>(function RuntimeBundleViewer({
  bundle,
  animationPlaying,
  diagramId,
  defaultDiagramId,
  stateOverrides,
  providers,
  onDiagramChange,
  onSelectionChange,
}, ref) {
  const initialDiagramId = defaultDiagramId ?? bundle.entryDiagramIds[0]
  const [internalDiagramId, setInternalDiagramId] = useState(initialDiagramId)
  const requestedDiagramId = diagramId ?? internalDiagramId
  const activeDiagramId = bundle.document.diagrams.some((diagram) => (
    diagram.id === requestedDiagramId
  )) ? requestedDiagramId : bundle.entryDiagramIds[0]
  const view = useMemo(
    () => createDiagramRuntimeViewFromBundle(bundle, activeDiagramId),
    [activeDiagramId, bundle],
  )
  const persistedOnOffStates = useMemo(
    () => projectOnOffStates(bundle.document),
    [bundle.document],
  )
  const runtimeState = useMemo(() => {
    const derived = createDiagramRuntimeState({
      document: bundle.document,
      diagramId: activeDiagramId,
      active: true,
      onOffStates: {
        ...persistedOnOffStates,
        ...stateOverrides?.onOffStates,
      },
      coolingPumpRunningStates: stateOverrides?.coolingPumpRunningStates,
      coolingPumpOutputPowerStates: stateOverrides?.coolingPumpOutputPowerStates,
      coolingValveOpenStates: stateOverrides?.coolingValveOpenStates,
    })
    return stateOverrides?.powerExternalSupplyActive === undefined
      ? derived
      : {
          ...derived,
          powerExternalSupplyActive: stateOverrides.powerExternalSupplyActive,
        }
  }, [
    activeDiagramId,
    bundle.document,
    persistedOnOffStates,
    stateOverrides,
  ])
  const runtime = useMemo(() => ({
    state: runtimeState,
    navigation: view?.navigation ?? {},
    providers,
  }), [providers, runtimeState, view?.navigation])

  if (!view) return null

  return (
    <DiagramRuntimeViewer
      ref={ref}
      view={view}
      runtime={runtime}
      animationPlaying={animationPlaying}
      onSelectionChange={onSelectionChange}
      onNavigate={(target) => {
        if (diagramId === undefined) setInternalDiagramId(target.diagramId)
        onDiagramChange?.(target.diagramId)
      }}
    />
  )
}))
