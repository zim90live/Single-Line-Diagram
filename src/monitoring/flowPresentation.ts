import type { Point } from '../scene/geometry'

export const FLOW_DASH_COLOR = '#303238'
export const FLOW_DASH_OPACITY = 0.5
export const FLOW_INACTIVE_BLACK_MIX = 0.5
export const FLOW_CHILD_LINE_SCREEN_WIDTH = 2
export const FLOW_BUSBAR_SCREEN_WIDTH = 4.5
export const FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH = 2.25
export const FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH = 6
export type FlowAnimationMode = 'wave' | 'dots' | 'dashes'
export type FlowAnimationStyle = 'power' | 'cooling'

/** 流量只决定冷却路径是否流动；动画速度由各模式 baseSpeed 独立控制。 */
export function flowAnimationSpeedMultiplier(path: { style?: FlowAnimationStyle; speedMultiplier?: number }) {
  const multiplier = path.speedMultiplier ?? 1
  if (multiplier <= 0) return 0
  return path.style === 'cooling' ? 1 : multiplier
}

export const DEFAULT_FLOW_ANIMATION_MODES: Record<FlowAnimationStyle, FlowAnimationMode> = {
  power: 'dots',
  cooling: 'wave',
}

/** 圆点直径与圆心间距为图纸单位，速度为图纸单位/秒。 */
export const FLOW_DOT_ANIMATION_STYLES = {
  power: { dotSize: 6, dotSpacing: 24, baseSpeed: 48 },
  cooling: { dotSize: 6, dotSpacing: 24, baseSpeed: 48 },
} satisfies Record<FlowAnimationStyle, { dotSize: number; dotSpacing: number; baseSpeed: number }>

/** 虚线专用参数：速度为图纸单位/秒；长度、间隔为图纸单位；gapOpacity 为间隔相对不透明度（0–1）。 */
export const FLOW_DASH_ANIMATION_STYLES = {
  power: {
    baseSpeed: 60,
    dashLength: 24,
    gapLength: 16,
    gapOpacity: 0.3,
  },
  cooling: {
    baseSpeed: 60,
    dashLength: 24,
    gapLength: 16,
    gapOpacity: 0.4,
  },
} satisfies Record<FlowAnimationStyle, { baseSpeed: number; dashLength: number; gapLength: number; gapOpacity: number }>

export const FLOW_ANIMATION_STYLES: Record<FlowAnimationStyle, {
  color: string
  opacity: number
  dashLength: number
  gapLength: number
  baseSpeed: number
  waveWidthRatio: number
}> = {
  power: {
    waveWidthRatio: 1,
    color: '#FFFFFF',
    opacity: 1,
    dashLength: 80,
    gapLength: 1,
    baseSpeed: 160,
  },
  // Both systems use diagram units for wave length and speed.
  cooling: {
    waveWidthRatio: 0.6,
    color: '#FFFFFF',
    opacity: 1,
    dashLength: 200,
    gapLength: 1,
    baseSpeed: 120,
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
  animationPhaseDistance?: number
  /** Uncut directed path and topology endpoints, retained across visual masks. */
  phasePath?: {
    id: string
    networkId: string
    startNodeId: string
    endNodeId: string
    points: Point[]
  }
}

export interface MonitorStaticFlowLineGroup {
  id: string
  kind: 'busbar' | 'connection'
  color: string
  lineWidth: number
  widthSpace: 'screen' | 'world'
  lineCap: 'round' | 'square' | 'butt'
  lineJoin: 'round' | 'miter'
  renderPriority: number
  paths: Point[][]
}

export function darkenFlowColor(
  color: string,
  blackMix = FLOW_INACTIVE_BLACK_MIX,
) {
  const normalized = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!normalized) return /^var\(--[a-z0-9-]+\)$/i.test(color.trim())
    ? `color-mix(in srgb, ${color} ${(1 - Math.max(0, Math.min(1, blackMix))) * 100}%, #000)`
    : '#000000'
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
      lineCap: path.style === 'cooling' ? 'butt' as const : 'round' as const,
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
  animationMode: FlowAnimationMode = 'wave',
): MonitorStaticFlowLineGroup[] {
  const groups = new Map<string, MonitorStaticFlowLineGroup>()
  const append = (path: MonitorFlowPath, active: boolean) => {
    if (path.points.length < 2) return
    const base = path.baseColor ?? '#000000'
    const inactiveBlackMix = path.style === 'cooling' ? 0.875 : 0.3
    const color = darkenFlowColor(base, active && animationMode !== 'dots' ? 0.75 : inactiveBlackMix)
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
