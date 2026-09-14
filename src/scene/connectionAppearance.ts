import type { AnchorType, CoolingLineRole } from '../domain/project'
import type { Point } from './geometry'

export const COOLING_DIRECTION_ARROW_INSET_SCREEN = 6
export const COOLING_ROUTE_HIT_WIDTH_SCREEN = 20
export const DEFAULT_ROUTE_HIT_WIDTH_SCREEN = 12
export const COOLING_PIPE_SHELL_WIDTH = 8
export const COOLING_PIPE_CORE_WIDTH = 6
export const COOLING_AUXILIARY_PIPE_SHELL_WIDTH = 4
export const COOLING_AUXILIARY_PIPE_CORE_WIDTH = 2.4
export const COOLING_PIPE_SHELL_ENDPOINT_INSET = 0
export const COOLING_PIPE_BRIDGE_RADIUS = 6
export const COOLING_PIPE_CORNER_RADIUS = 8
export const COOLING_PIPE_WORLD_HIT_WIDTH = 16
export const COOLING_AUXILIARY_COLOR_NEUTRAL = '#70736F'
export const COOLING_AUXILIARY_COLOR_WEIGHT = 0.2

const COOLING_PIPE_FILTER_MARGIN = COOLING_PIPE_SHELL_WIDTH / 2 + 2

export interface CoolingPipeFilterRegion {
  x: number
  y: number
  width: number
  height: number
}

function compactPoints(points: Point[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1]
    return !previous || previous.x !== point.x || previous.y !== point.y
  })
}

function pointAtPolylineDistance(points: Point[], distance: number) {
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (traversed + length < distance) {
      traversed += length
      continue
    }
    const ratio = length ? (distance - traversed) / length : 0
    return {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    }
  }
  return points.at(-1) ?? { x: 0, y: 0 }
}

export function insetPolylineEndpoints(
  points: Point[],
  startInset: number,
  endInset: number,
) {
  const compact = compactPoints(points)
  if (compact.length < 2) return compact
  const segmentLengths = compact.slice(1).map((point, index) => (
    Math.hypot(point.x - compact[index].x, point.y - compact[index].y)
  ))
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0)
  if (!totalLength) return compact

  let resolvedStartInset = Math.max(0, Math.min(startInset, totalLength))
  let resolvedEndInset = Math.max(0, Math.min(endInset, totalLength))
  if (resolvedStartInset + resolvedEndInset > totalLength) {
    const scale = totalLength / (resolvedStartInset + resolvedEndInset)
    resolvedStartInset *= scale
    resolvedEndInset *= scale
  }
  const endDistance = totalLength - resolvedEndInset
  const startPoint = pointAtPolylineDistance(compact, resolvedStartInset)
  const endPoint = pointAtPolylineDistance(compact, endDistance)
  const result = [startPoint]
  let traversed = 0
  segmentLengths.forEach((length, index) => {
    traversed += length
    if (traversed > resolvedStartInset && traversed < endDistance) {
      result.push(compact[index + 1])
    }
  })
  result.push(endPoint)
  return result
}

export function coolingPipeFilterRegion(points: Point[]): CoolingPipeFilterRegion {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = xs.length ? Math.min(...xs) : 0
  const minY = ys.length ? Math.min(...ys) : 0
  const maxX = xs.length ? Math.max(...xs) : minX
  const maxY = ys.length ? Math.max(...ys) : minY

  return {
    x: minX - COOLING_PIPE_FILTER_MARGIN,
    y: minY - COOLING_PIPE_FILTER_MARGIN,
    width: Math.max(1, maxX - minX) + COOLING_PIPE_FILTER_MARGIN * 2,
    height: Math.max(1, maxY - minY) + COOLING_PIPE_FILTER_MARGIN * 2,
  }
}

export function isCoolingConnectionType(type: AnchorType) {
  return type !== 'electrical'
}

export function resolvedCoolingLineColor(
  color: string,
  role: CoolingLineRole | undefined,
) {
  if (role !== 'auxiliary') return color
  const source = color.match(/^#([0-9a-f]{6})$/i)?.[1]
  const neutral = COOLING_AUXILIARY_COLOR_NEUTRAL.slice(1)
  if (!source) return COOLING_AUXILIARY_COLOR_NEUTRAL
  const channel = (offset: number) => Math.round(
    Number.parseInt(source.slice(offset, offset + 2), 16) * COOLING_AUXILIARY_COLOR_WEIGHT +
    Number.parseInt(neutral.slice(offset, offset + 2), 16) *
      (1 - COOLING_AUXILIARY_COLOR_WEIGHT),
  ).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase()
}

export function coolingLineRoleRenderPriority(role: CoolingLineRole | undefined) {
  return role === 'auxiliary' ? 0 : 1
}

export function sortByCoolingLineRenderPriority<T>(
  items: readonly T[],
  roleFor: (item: T) => CoolingLineRole | undefined,
) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      coolingLineRoleRenderPriority(roleFor(left.item)) -
        coolingLineRoleRenderPriority(roleFor(right.item)) ||
      left.index - right.index
    ))
    .map(({ item }) => item)
}

export function coolingPipeCoreWidth(role: CoolingLineRole | undefined, lineWidth?: number) {
  if (lineWidth !== undefined) return lineWidth * (role === 'auxiliary' ? 0.6 : 0.75)
  return role === 'auxiliary'
    ? COOLING_AUXILIARY_PIPE_CORE_WIDTH
    : COOLING_PIPE_CORE_WIDTH
}

export function coolingPipeWidthStyle(lineWidth?: number) {
  if (lineWidth === undefined) return {}
  return {
    '--connection-cooling-pipe-shell-width': `${lineWidth}px`,
    '--connection-cooling-auxiliary-pipe-shell-width': `${lineWidth}px`,
    '--connection-cooling-pipe-width': `${lineWidth * 0.75}px`,
    '--connection-cooling-auxiliary-pipe-width': `${lineWidth * 0.6}px`,
    '--connection-cooling-selection-width': `${lineWidth + 2}px`,
    '--connection-cooling-auxiliary-selection-width': `${lineWidth + 2}px`,
  }
}

export function routeHitWidthForConnectionType(type: AnchorType) {
  return isCoolingConnectionType(type)
    ? COOLING_ROUTE_HIT_WIDTH_SCREEN
    : DEFAULT_ROUTE_HIT_WIDTH_SCREEN
}

export function routeHitWorldWidthForConnectionType(type: AnchorType, zoom: number) {
  const safeZoom = Math.max(zoom, 0.1)
  const fixedScreenWidth = routeHitWidthForConnectionType(type) / safeZoom
  return isCoolingConnectionType(type)
    ? Math.max(COOLING_PIPE_WORLD_HIT_WIDTH, fixedScreenWidth)
    : fixedScreenWidth
}
