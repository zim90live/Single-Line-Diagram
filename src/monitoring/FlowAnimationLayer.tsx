import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, type RefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  Vector2,
} from 'three'

import type { DiagramViewport } from '../domain/project'
import type { Point } from '../editor/geometry'

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

const SEGMENT_EPSILON = 0.001

interface FlowSegment {
  start: Point
  end: Point
  lineWidth: number
  scalesWithZoom: boolean
  style: FlowAnimationStyle
}

function resolvedLineWidth(path: MonitorFlowPath) {
  return path.worldWidth !== undefined
    ? { lineWidth: path.worldWidth, scalesWithZoom: true }
    : {
        lineWidth: path.screenWidth ?? FLOW_CHILD_LINE_SCREEN_WIDTH,
        scalesWithZoom: false,
      }
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

function pointAtRatio(start: Point, end: Point, ratio: number): Point {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  }
}

function pointsEqual(left: Point, right: Point) {
  return Math.abs(left.x - right.x) <= SEGMENT_EPSILON &&
    Math.abs(left.y - right.y) <= SEGMENT_EPSILON
}

function segmentOverlapInterval(
  candidateStart: Point,
  candidateEnd: Point,
  activeStart: Point,
  activeEnd: Point,
): [number, number] | null {
  const dx = candidateEnd.x - candidateStart.x
  const dy = candidateEnd.y - candidateStart.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= SEGMENT_EPSILON ** 2) return null
  const length = Math.sqrt(lengthSquared)
  const distanceFromLine = (point: Point) => Math.abs(
    dx * (point.y - candidateStart.y) - dy * (point.x - candidateStart.x),
  ) / length
  if (
    distanceFromLine(activeStart) > SEGMENT_EPSILON ||
    distanceFromLine(activeEnd) > SEGMENT_EPSILON
  ) return null
  const project = (point: Point) => (
    (point.x - candidateStart.x) * dx + (point.y - candidateStart.y) * dy
  ) / lengthSquared
  const lower = Math.max(0, Math.min(project(activeStart), project(activeEnd)))
  const upper = Math.min(1, Math.max(project(activeStart), project(activeEnd)))
  return upper - lower > SEGMENT_EPSILON ? [lower, upper] : null
}

function flowSegments(paths: MonitorFlowPath[]): FlowSegment[] {
  return paths.flatMap((path) => {
    const style = path.style ?? 'power'
    const { lineWidth, scalesWithZoom } = resolvedLineWidth(path)
    return path.points.slice(1).flatMap((end, index) => {
      const start = path.points[index]
      return Math.hypot(end.x - start.x, end.y - start.y) > SEGMENT_EPSILON
        ? [{ start, end, lineWidth, scalesWithZoom, style }]
        : []
    })
  })
}

/**
 * Returns the portions of every displayed physical line that are not covered
 * by any active-flow segment. Active paths may start or end inside a sampled
 * bridge/corner segment, so subtraction is interval-based instead of relying
 * on exact endpoint keys.
 */
export function deriveInactiveFlowPaths(
  displayedPaths: MonitorFlowPath[],
  activePaths: MonitorFlowPath[],
): MonitorFlowPath[] {
  const activeSegments = flowSegments(activePaths)
  const inactive: MonitorFlowPath[] = []
  let fragmentIndex = 0
  for (const path of displayedPaths) {
    const style = path.style ?? 'power'
    const { lineWidth, scalesWithZoom } = resolvedLineWidth(path)
    let fragment: Point[] = []
    const flushFragment = () => {
      if (fragment.length < 2) {
        fragment = []
        return
      }
      inactive.push({
        id: `inactive:${path.id}:${fragmentIndex}`,
        ...(path.connectionEdgeId ? { connectionEdgeId: path.connectionEdgeId } : {}),
        points: fragment,
        screenWidth: path.screenWidth,
        worldWidth: path.worldWidth,
        style,
        animated: false,
        baseColor: path.baseColor,
        ...(path.renderPriority !== undefined
          ? { renderPriority: path.renderPriority }
          : {}),
      })
      fragmentIndex += 1
      fragment = []
    }
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]
      const end = path.points[index]
      if (Math.hypot(end.x - start.x, end.y - start.y) <= SEGMENT_EPSILON) continue
      const covered = activeSegments.flatMap((active) => {
        if (
          active.style !== style ||
          active.scalesWithZoom !== scalesWithZoom ||
          Math.abs(active.lineWidth - lineWidth) > SEGMENT_EPSILON
        ) {
          return []
        }
        const interval = segmentOverlapInterval(start, end, active.start, active.end)
        return interval ? [interval] : []
      }).sort((left, right) => left[0] - right[0])
      const merged: Array<[number, number]> = []
      covered.forEach(([lower, upper]) => {
        const previous = merged.at(-1)
        if (previous && lower <= previous[1] + SEGMENT_EPSILON) {
          previous[1] = Math.max(previous[1], upper)
        } else {
          merged.push([lower, upper])
        }
      })
      let cursor = 0
      const appendInactiveInterval = (lower: number, upper: number) => {
        if (upper - lower <= SEGMENT_EPSILON) return
        const intervalStart = pointAtRatio(start, end, lower)
        const intervalEnd = pointAtRatio(start, end, upper)
        if (!fragment.length) fragment.push(intervalStart, intervalEnd)
        else if (pointsEqual(fragment.at(-1)!, intervalStart)) fragment.push(intervalEnd)
        else {
          flushFragment()
          fragment.push(intervalStart, intervalEnd)
        }
      }
      merged.forEach(([lower, upper]) => {
        appendInactiveInterval(cursor, lower)
        if (lower > cursor + SEGMENT_EPSILON) flushFragment()
        cursor = Math.max(cursor, upper)
      })
      appendInactiveInterval(cursor, 1)
      if (cursor >= 1 - SEGMENT_EPSILON) flushFragment()
    }
    flushFragment()
  }
  return inactive
}

export function buildFlowLineGeometry(paths: MonitorFlowPath[]) {
  const positions: number[] = []
  const ends: number[] = []
  const sides: number[] = []
  const alongs: number[] = []
  const widths: number[] = []
  const speeds: number[] = []
  const distances: number[] = []
  const widthScales: number[] = []
  const seenSegments = new Set<string>()
  const quadVertices = [
    { along: 0, side: -1 },
    { along: 0, side: 1 },
    { along: 1, side: 1 },
    { along: 0, side: -1 },
    { along: 1, side: 1 },
    { along: 1, side: -1 },
  ] as const
  for (const path of paths) {
    const { lineWidth, scalesWithZoom } = resolvedLineWidth(path)
    const speedMultiplier = path.speedMultiplier ?? 1
    let accumulated = 0
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]
      const end = path.points[index]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length < 0.001) continue
      const segmentKey = [
        start.x,
        start.y,
        end.x,
        end.y,
        lineWidth,
        scalesWithZoom ? 1 : 0,
        speedMultiplier,
      ]
        .map((value) => value.toFixed(3))
        .join(',')
      if (seenSegments.has(segmentKey)) {
        accumulated += length
        continue
      }
      seenSegments.add(segmentKey)
      for (const vertex of quadVertices) {
        positions.push(start.x, start.y, 0)
        ends.push(end.x, end.y)
        sides.push(vertex.side)
        alongs.push(vertex.along)
        widths.push(lineWidth)
        speeds.push(speedMultiplier)
        distances.push(accumulated + length * vertex.along)
        widthScales.push(scalesWithZoom ? 1 : 0)
      }
      accumulated += length
    }
  }
  return {
    positions: new Float32Array(positions),
    ends: new Float32Array(ends),
    sides: new Float32Array(sides),
    alongs: new Float32Array(alongs),
    widths: new Float32Array(widths),
    speeds: new Float32Array(speeds),
    distances: new Float32Array(distances),
    widthScales: new Float32Array(widthScales),
  }
}

const vertexShader = `
  uniform vec2 uResolution;
  uniform vec2 uTranslation;
  uniform float uZoom;
  attribute vec2 aEnd;
  attribute float aSide;
  attribute float aAlong;
  attribute float aLineWidth;
  attribute float aDistance;
  attribute float aSpeed;
  attribute float aWidthScalesWithZoom;
  varying float vDistance;
  varying float vSpeed;

  void main() {
    vec2 startScreen = position.xy * uZoom + uTranslation;
    vec2 endScreen = aEnd * uZoom + uTranslation;
    vec2 delta = endScreen - startScreen;
    vec2 direction = delta / max(length(delta), 0.0001);
    vec2 normal = vec2(-direction.y, direction.x);
    float lineWidth = aLineWidth * mix(1.0, uZoom, aWidthScalesWithZoom);
    float capExtension = lineWidth * 0.5;
    vec2 screen = mix(startScreen, endScreen, aAlong)
      + direction * mix(-capExtension, capExtension, aAlong)
      + normal * aSide * lineWidth * 0.5;
    vec2 clip = vec2(
      screen.x / uResolution.x * 2.0 - 1.0,
      1.0 - screen.y / uResolution.y * 2.0
    );
    vDistance = aDistance;
    vSpeed = aSpeed;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uZoom;
  uniform float uMotion;
  uniform vec3 uDashColor;
  uniform float uDashOpacity;
  uniform float uDashLength;
  uniform float uDashPeriod;
  uniform float uBaseSpeed;
  varying float vDistance;
  varying float vSpeed;

  void main() {
    float screenDistance = vDistance * uZoom;
    float movingPhase = uTime * uBaseSpeed * max(vSpeed, 0.0) * uMotion;
    float phase = mod(screenDistance - movingPhase, uDashPeriod);
    if (phase > uDashLength) discard;
    gl_FragColor = vec4(uDashColor, uDashOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function FlowLines({
  paths,
  viewportRef,
  reducedMotion,
  style,
}: {
  paths: MonitorFlowPath[]
  viewportRef: RefObject<DiagramViewport>
  reducedMotion: boolean
  style: FlowAnimationStyle
}) {
  const { size } = useThree()
  const initialViewport = viewportRef.current
  const styleConfig = FLOW_ANIMATION_STYLES[style]
  const geometry = useMemo(() => {
    const data = buildFlowLineGeometry(paths)
    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(data.positions, 3))
    next.setAttribute('aEnd', new BufferAttribute(data.ends, 2))
    next.setAttribute('aSide', new BufferAttribute(data.sides, 1))
    next.setAttribute('aAlong', new BufferAttribute(data.alongs, 1))
    next.setAttribute('aLineWidth', new BufferAttribute(data.widths, 1))
    next.setAttribute('aSpeed', new BufferAttribute(data.speeds, 1))
    next.setAttribute('aDistance', new BufferAttribute(data.distances, 1))
    next.setAttribute('aWidthScalesWithZoom', new BufferAttribute(data.widthScales, 1))
    return next
  }, [paths])
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uResolution: { value: new Vector2(size.width, size.height) },
      uTranslation: { value: new Vector2(initialViewport.tx, initialViewport.ty) },
      uZoom: { value: initialViewport.zoom },
      uTime: { value: 0 },
      uMotion: { value: reducedMotion ? 0 : 1 },
      uDashColor: { value: new Color(styleConfig.color) },
      uDashOpacity: { value: styleConfig.opacity },
      uDashLength: { value: styleConfig.dashLength },
      uDashPeriod: { value: styleConfig.dashLength + styleConfig.gapLength },
      uBaseSpeed: { value: styleConfig.baseSpeed },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  }), [styleConfig])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ clock }) => {
    const viewport = viewportRef.current
    material.uniforms.uResolution.value.set(size.width, size.height)
    material.uniforms.uTranslation.value.set(viewport.tx, viewport.ty)
    material.uniforms.uZoom.value = viewport.zoom
    material.uniforms.uTime.value = clock.getElapsedTime()
    material.uniforms.uMotion.value = reducedMotion ? 0 : 1
  })

  return (
    <mesh frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

export function FlowAnimationLayer({
  paths,
  viewportRef,
  invalidateRef,
}: {
  paths: MonitorFlowPath[]
  viewportRef: RefObject<DiagramViewport>
  invalidateRef: RefObject<(() => void) | null>
}) {
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const hasPaths = paths.length > 0
  const pathsByStyle = useMemo(() => {
    const grouped = new Map<FlowAnimationStyle, MonitorFlowPath[]>()
    paths.forEach((path) => {
      const style = path.style ?? 'power'
      const group = grouped.get(style) ?? []
      group.push(path)
      grouped.set(style, group)
    })
    return grouped
  }, [paths])
  useEffect(() => {
    if (!hasPaths) invalidateRef.current = null
    return () => {
      invalidateRef.current = null
    }
  }, [hasPaths, invalidateRef])
  if (!hasPaths) return null
  return (
    <div className="monitor-flow-layer" data-testid="monitor-flow-layer" aria-hidden="true">
      <Canvas
        orthographic
        frameloop={reducedMotion ? 'demand' : 'always'}
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 1] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl, invalidate }) => {
          gl.setClearColor(0x000000, 0)
          invalidateRef.current = invalidate
        }}
      >
        {[...pathsByStyle].map(([style, stylePaths]) => (
          <FlowLines
            key={style}
            paths={stylePaths}
            viewportRef={viewportRef}
            reducedMotion={reducedMotion}
            style={style}
          />
        ))}
      </Canvas>
    </div>
  )
}
