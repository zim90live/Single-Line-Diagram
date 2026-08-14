import type { DiagramViewport } from '../domain/project'

export const GRID_PRESENTATION = 'dots' as const
export const GRID_DOT_SCREEN_RADIUS = 0.8

const MIN_GRID_SCREEN_STEP = 8
const MIN_LABEL_SCREEN_STEP = 40
const FLOATING_POINT_EPSILON = 1e-9

export interface RulerTick {
  key: string
  position: number
  value: number
  major: boolean
  labeled: boolean
}

export function getAdaptiveGridScale(gridSize: number, zoom: number) {
  const density = Math.max(
    1,
    Math.ceil((MIN_GRID_SCREEN_STEP - FLOATING_POINT_EPSILON) / (gridSize * zoom)),
  )
  const worldStep = gridSize * density

  return {
    density,
    worldStep,
    screenStep: worldStep * zoom,
    dotScreenRadius: GRID_DOT_SCREEN_RADIUS,
  }
}

export function getRulerScale(gridSize: number, zoom: number) {
  const gridScale = getAdaptiveGridScale(gridSize, zoom)
  const labelInterval = Math.max(1, Math.ceil(MIN_LABEL_SCREEN_STEP / gridScale.screenStep))
  const labelWorldStep = gridScale.worldStep * labelInterval

  return {
    gridWorldStep: gridScale.worldStep,
    gridScreenStep: gridScale.screenStep,
    density: gridScale.density,
    labelInterval,
    labelWorldStep,
  }
}

function isMultipleOf(value: number, step: number) {
  const ratio = value / step
  return Math.abs(ratio - Math.round(ratio)) < 1e-6
}

export function createRulerTicks(
  viewport: DiagramViewport,
  size: number,
  axis: 'x' | 'y',
  gridSize: number,
) {
  const translation = axis === 'x' ? viewport.tx : viewport.ty
  const scale = getRulerScale(gridSize, viewport.zoom)
  const worldStart = -translation / viewport.zoom
  const worldEnd = (size - translation) / viewport.zoom
  const first = Math.floor(worldStart / scale.gridWorldStep) * scale.gridWorldStep
  const ticks: RulerTick[] = []

  for (
    let value = first;
    value <= worldEnd + scale.gridWorldStep;
    value += scale.gridWorldStep
  ) {
    const rounded = Math.round(value * 100) / 100
    ticks.push({
      key: `${axis}-${rounded}`,
      position: rounded * viewport.zoom + translation,
      value: rounded,
      major: isMultipleOf(rounded, scale.labelWorldStep),
      labeled: isMultipleOf(rounded, scale.labelWorldStep),
    })
  }

  return ticks
}
