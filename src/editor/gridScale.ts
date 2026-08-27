export const GRID_PRESENTATION = 'dots' as const
export const GRID_DOT_SCREEN_RADIUS = 0.8

const MIN_GRID_SCREEN_STEP = 8
const FLOATING_POINT_EPSILON = 1e-9

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
