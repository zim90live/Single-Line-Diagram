import { forwardRef, memo, useMemo, useState } from 'react'

import { projectOnOffStates } from '../domain/project'
import type {
  DiagramMonitorCanvasHandle,
  DiagramMonitorRuntimePresentation,
} from './DiagramMonitorCanvas'
import { DiagramRuntimeViewer } from './DiagramRuntimeViewer'
import {
  createDemoSimulationManifest,
  createDiagramRuntimeViewFromBundle,
  type DiagramRuntimeBundle,
} from './runtimeBundle'
import { createDiagramRuntimeState } from './runtimeState'
import { DemoMonitorMetricDataProvider } from './demoMetricDataProvider'
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
  onRuntimePresentationChange?: (presentation: DiagramMonitorRuntimePresentation) => void
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
  onRuntimePresentationChange,
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
  const simulation = useMemo(
    () => bundle.simulation ?? createDemoSimulationManifest(bundle.document),
    [bundle.document, bundle.simulation],
  )
  const demoMetricProvider = useMemo(() => new DemoMonitorMetricDataProvider({
    seed: simulation.seed,
    anomalyAssignments: simulation.anomalyAssignments,
  }), [simulation.anomalyAssignments, simulation.seed])
  const resolvedProviders = useMemo<DiagramRuntimeProviders>(() => ({
    ...providers,
    metrics: providers?.metrics ?? demoMetricProvider,
  }), [demoMetricProvider, providers])
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
    return {
      ...derived,
      ...(stateOverrides?.powerExternalSupplyActive === undefined
        ? {}
        : { powerExternalSupplyActive: stateOverrides.powerExternalSupplyActive }),
      ...(stateOverrides?.powerExternalSupplyChannel === undefined
        ? {}
        : { powerExternalSupplyChannel: stateOverrides.powerExternalSupplyChannel }),
      ...(stateOverrides?.powerBatteryBackupActive === undefined
        ? {}
        : { powerBatteryBackupActive: stateOverrides.powerBatteryBackupActive }),
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
    providers: resolvedProviders,
  }), [resolvedProviders, runtimeState, view?.navigation])

  if (!view) return null

  return (
    <DiagramRuntimeViewer
      ref={ref}
      view={view}
      runtime={runtime}
      animationPlaying={animationPlaying}
      onSelectionChange={onSelectionChange}
      onRuntimePresentationChange={onRuntimePresentationChange}
      onNavigate={(target) => {
        if (diagramId === undefined) setInternalDiagramId(target.diagramId)
        onDiagramChange?.(target.diagramId)
      }}
    />
  )
}))
