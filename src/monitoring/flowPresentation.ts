import type { Point } from '../scene/geometry'

export const FLOW_DASH_COLOR = '#303238'
export const FLOW_DASH_OPACITY = 0.5
export const FLOW_INACTIVE_BLACK_MIX = 0.5
export const FLOW_CHILD_LINE_SCREEN_WIDTH = 2
export const FLOW_BUSBAR_SCREEN_WIDTH = 4.5
export const FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH = 1.5
export const FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH = 4
export type FlowAnimationStyle = 'power' | 'cooling'

export const FLOW_ANIMATION_STYLES: Record<FlowAnimationStyle, {
  color: string
  opacity: number
  dashLength: number
  gapLength: number
  baseSpeed: number
}> = {
  power: {
    color: FLOW_DASH_COLOR,
    opacity: FLOW_DASH_OPACITY,
    dashLength: 6,
    gapLength: 6,
    baseSpeed: 34,
  },
  cooling: {
    color: FLOW_DASH_COLOR,
    opacity: FLOW_DASH_OPACITY,
    dashLength: 6,
    gapLength: 6,
    baseSpeed: 34,
  },
}

export interface MonitorFlowPath {
  id: string
  connectionEdgeId?: string
  points: Point[]
  screenWidth?: number
  worldWidth?: number
  speedMultiplier?: number
  style?: FlowAnimationStyle
  animated?: boolean
  baseColor?: string
  renderPriority?: number
}

export interface MonitorStaticFlowLineGroup {
  id: string
  kind: 'busbar' | 'connection'
  color: string
  lineWidth: number
  widthSpace: 'screen' | 'world'
  lineCap: 'round' | 'square'
  lineJoin: 'round' | 'miter'
  renderPriority: number
  paths: Point[][]
}

export function darkenFlowColor(
  color: string,
  blackMix = FLOW_INACTIVE_BLACK_MIX,
) {
  const normalized = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!normalized) return '#000000'
  const retained = 1 - Math.max(0, Math.min(1, blackMix))
  const channel = (offset: number) => Math.round(
    Number.parseInt(normalized.slice(offset, offset + 2), 16) * retained,
  ).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase()
}

function resolvedStaticLineAppearance(path: MonitorFlowPath) {
  if (path.worldWidth !== undefined) {
    return {
      kind: 'connection' as const,
      lineWidth: path.worldWidth,
      widthSpace: 'world' as const,
      lineCap: 'round' as const,
      lineJoin: 'miter' as const,
    }
  }
  const isBusbar = path.screenWidth === FLOW_BUSBAR_SCREEN_WIDTH
  return {
    kind: isBusbar ? 'busbar' as const : 'connection' as const,
    lineWidth: isBusbar
      ? FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH
      : FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH,
    widthSpace: 'screen' as const,
    lineCap: isBusbar ? 'square' as const : 'round' as const,
    lineJoin: 'round' as const,
  }
}

/**
 * Builds the final static SVG strokes for monitor mode. Inactive intervals
 * receive their final opaque color here; they are not drawn as a WebGL layer
 * over the original business-color stroke.
 */
export function buildMonitorStaticFlowLineGroups(
  activePaths: MonitorFlowPath[],
  inactivePaths: MonitorFlowPath[],
): MonitorStaticFlowLineGroup[] {
  const groups = new Map<string, MonitorStaticFlowLineGroup>()
  const append = (path: MonitorFlowPath, active: boolean) => {
    if (path.points.length < 2) return
    const color = active
      ? path.baseColor ?? '#000000'
      : darkenFlowColor(path.baseColor ?? '#000000')
    const appearance = resolvedStaticLineAppearance(path)
    const renderPriority = path.renderPriority ?? 1
    const key = [
      color.toUpperCase(),
      appearance.kind,
      appearance.lineWidth,
      appearance.widthSpace,
      appearance.lineCap,
      appearance.lineJoin,
      renderPriority,
    ].join(':')
    const group = groups.get(key) ?? {
      id: `monitor-static-flow:${key}`,
      color,
      ...appearance,
      renderPriority,
      paths: [],
    }
    group.paths.push(path.points)
    groups.set(key, group)
  }
  inactivePaths.forEach((path) => append(path, false))
  activePaths.forEach((path) => append(path, true))
  return [...groups.values()].sort((left, right) => (
    left.renderPriority - right.renderPriority
  ))
}
