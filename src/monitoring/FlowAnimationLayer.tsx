import { FLOW_DOT_ANIMATION_STYLES, flowAnimationSpeedMultiplier } from './flowPresentation'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  Vector2,
} from 'three'

import type { DiagramViewport } from '../domain/project'
import type { Point } from '../scene/geometry'
import {
  FLOW_ANIMATION_STYLES,
  FLOW_DASH_ANIMATION_STYLES,
  FLOW_CHILD_LINE_SCREEN_WIDTH,
  FLOW_BUSBAR_SCREEN_WIDTH,
  FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH,
  FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH,
  type FlowAnimationMode,
  type FlowAnimationStyle,
  type MonitorFlowPath,
} from './flowPresentation'
export {
  buildMonitorStaticFlowLineGroups,
  darkenFlowColor,
  FLOW_ANIMATION_STYLES,
  FLOW_BUSBAR_SCREEN_WIDTH,
  FLOW_CHILD_LINE_SCREEN_WIDTH,
  FLOW_DASH_COLOR,
  FLOW_DASH_OPACITY,
  FLOW_INACTIVE_BLACK_MIX,
  FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH,
  FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH,
} from './flowPresentation'
export type {
  FlowAnimationStyle,
  MonitorFlowPath,
  MonitorStaticFlowLineGroup,
} from './flowPresentation'

import { flowEndpointDirections, flowPhaseOffsets } from './flowPathGeometry'

const SEGMENT_EPSILON = 0.001

interface FlowSegment {
  start: Point
  end: Point
  lineWidth: number
  scalesWithZoom: boolean
  style: FlowAnimationStyle
}

function resolvedLineWidth(path: MonitorFlowPath) {
  const screenWidth = path.screenWidth ?? FLOW_CHILD_LINE_SCREEN_WIDTH
  const staticWidth = screenWidth === FLOW_BUSBAR_SCREEN_WIDTH
    ? FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH
    : screenWidth === FLOW_CHILD_LINE_SCREEN_WIDTH ? FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH : screenWidth
  return path.worldWidth !== undefined
    ? { lineWidth: path.worldWidth, scalesWithZoom: true }
    : {
        lineWidth: staticWidth,
        scalesWithZoom: false,
      }
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
  const phaseOffsets = flowPhaseOffsets(paths)
  const endpointDirections = flowEndpointDirections(paths)
  const positions: number[] = []
  const ends: number[] = []
  const sides: number[] = []
  const alongs: number[] = []
  const widths: number[] = []
  const speeds: number[] = []
  const distances: number[] = []
  const widthScales: number[] = []
  const colors: number[] = []
  const joins: number[] = []
  const seenSegments = new Set<string>()
  const quadVertices = [
    { along: 0, side: -1 },
    { along: 0, side: 1 },
    { along: 1, side: 1 },
    { along: 0, side: -1 },
    { along: 1, side: 1 },
    { along: 1, side: -1 },
  ] as const
  const orderedPaths = paths
    .map((path, index) => ({ path, index }))
    .sort((left, right) => (
      (left.path.renderPriority ?? 1) - (right.path.renderPriority ?? 1) ||
      left.index - right.index
    ))
    .map(({ path }) => path)
  for (const path of orderedPaths) {
    const { lineWidth, scalesWithZoom } = resolvedLineWidth(path)
    const speedMultiplier = flowAnimationSpeedMultiplier(path)
    const color = new Color(path.baseColor ?? '#FFFFFF')
    let accumulated = phaseOffsets.get(path.id) ?? 0
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
      const normal = (a: Point, b: Point) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
      }
      const currentNormal = normal(start, end)
      const join = (other: Point) => {
        const dot = currentNormal.x * other.x + currentNormal.y * other.y
        const divisor = Math.max(1 + dot, 0.5)
        return { x: (currentNormal.x + other.x) / divisor, y: (currentNormal.y + other.y) / divisor }
      }
      const continuation = endpointDirections.get(path.id)
      const startNormal = continuation?.start
        ? { x: continuation.start.y, y: -continuation.start.x } : currentNormal
      const endNormal = continuation?.end
        ? { x: -continuation.end.y, y: continuation.end.x } : currentNormal
      const startJoin = index > 1 ? join(normal(path.points[index - 2], start)) : join(startNormal)
      const endJoin = index < path.points.length - 1 ? join(normal(end, path.points[index + 1])) : join(endNormal)
      for (const vertex of quadVertices) {
        const offset = vertex.along === 0 ? startJoin : endJoin
        joins.push(offset.x * vertex.side, offset.y * vertex.side)
        positions.push(start.x, start.y, 0)
        ends.push(end.x, end.y)
        sides.push(vertex.side)
        alongs.push(vertex.along)
        colors.push(color.r, color.g, color.b)
        widths.push(lineWidth)
        speeds.push(speedMultiplier)
        distances.push(path.animationPhaseDistance ?? accumulated + length * vertex.along)
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
    colors: new Float32Array(colors),
    joins: new Float32Array(joins),
  }
}

const vertexShader = `
  uniform float uWaveWidthRatio;
  uniform float uDotSize;
  uniform vec2 uResolution;
  uniform vec2 uTranslation;
  uniform float uZoom;
  attribute vec2 aEnd;
  attribute vec3 aFlowColor;
  attribute vec2 aJoin;
  uniform float uCooling;
  uniform float uDots;
  attribute float aSide;
  attribute float aAlong;
  attribute float aLineWidth;
  attribute float aDistance;
  attribute float aSpeed;
  attribute float aWidthScalesWithZoom;
  varying float vDistance;
  varying float vSpeed;
  varying float vAcross;
  varying float vSegmentAlong;
  varying float vSegmentLength;
  varying vec3 vColor;

  void main() {
    vec2 startScreen = position.xy * uZoom + uTranslation;
    vec2 endScreen = aEnd * uZoom + uTranslation;
    vec2 delta = endScreen - startScreen;
    vec2 direction = delta / max(length(delta), 0.0001);
    vec2 normal = vec2(-direction.y, direction.x);
    float lineWidth = aLineWidth * mix(1.0, uZoom, aWidthScalesWithZoom);
    // Power fills the line; cooling keeps its independently configured inset.
    lineWidth = uDots > 0.5 ? uDotSize * uZoom : lineWidth * uWaveWidthRatio;
    // Dots use an expanded rectangular segment, never the sheared miter mesh.
    // End padding lets a circle remain whole while its center crosses a joint.
    vec2 offset = uDots > 0.5
      ? (normal * aSide + direction * (2.0 * aAlong - 1.0)) * lineWidth * 0.5
      : aJoin * lineWidth * 0.5;
    vec2 screen = mix(startScreen, endScreen, aAlong) + offset;
    vec2 clip = vec2(
      screen.x / uResolution.x * 2.0 - 1.0,
      1.0 - screen.y / uResolution.y * 2.0
    );
    float alongOffset = uDots > 0.5 ? dot(offset, direction) / uZoom : 0.0;
    vDistance = aDistance + alongOffset;
    vSegmentLength = length(aEnd - position.xy);
    vSegmentAlong = aAlong * vSegmentLength + alongOffset;
    vSpeed = aSpeed;
    vAcross = aSide;
    vColor = aFlowColor;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uZoom;
  uniform float uMotion;
  uniform vec3 uDashColor;
  uniform float uDashOpacity;
  uniform float uDotSize;
  uniform float uDots;
  uniform float uDashes;
  uniform float uGapOpacity;
  uniform float uDashLength;
  uniform float uDashPeriod;
  uniform float uBaseSpeed;
  uniform float uCooling;
  varying float vDistance;
  varying float vSpeed;
  varying float vAcross;
  varying float vSegmentAlong;
  varying float vSegmentLength;
  varying vec3 vColor;

  void main() {
    // Wave position belongs to the diagram for both systems.
    float flowDistance = vDistance;
    float speed = max(vSpeed, 0.0);
    if (vSpeed <= 0.0) discard;
    float movingPhase = uTime * uBaseSpeed * speed * uMotion;
    float phase = mod(flowDistance - movingPhase, uDashPeriod);
    // Increasing distance is the actual flow direction. The bright leading
    // edge is at dashLength; the long, monotonically fading tail is behind it.
    float tail = clamp(phase / uDashLength, 0.0, 1.0);
    // The former gap is a short head-to-tail transition, never an empty cut.
    float reset = 1.0 - smoothstep(uDashLength, uDashPeriod, phase);
    float alpha = 0.4 + 0.6 * tail * reset;
    vec3 displayColor = vColor;
    if (uDashes > 0.5) {
      alpha = phase < uDashLength ? 1.0 : uGapOpacity;
    }
    if (uDots > 0.5) {
      float along = phase - uDashPeriod * 0.5;
      // Each center belongs to exactly one segment; adjacent segments do not
      // clip the circle or draw a second, differently oriented half-circle.
      float centerAlong = vSegmentAlong - along;
      if (centerAlong < 0.0 || centerAlong >= vSegmentLength) discard;
      float radius = length(vec2(along / (uDotSize * 0.5), vAcross));
      float edge = max(fwidth(radius), 0.001);
      alpha = 1.0 - smoothstep(1.0 - edge, 1.0, radius);
      displayColor = vColor;
    }
    gl_FragColor = vec4(displayColor, uDashOpacity * alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function FlowLines({
  paths,
  viewportRef,
  reducedMotion,
  playing,
  animationMode,
  style,
}: {
  paths: MonitorFlowPath[]
  viewportRef: RefObject<DiagramViewport>
  reducedMotion: boolean
  playing: boolean
  animationMode: FlowAnimationMode
  style: FlowAnimationStyle
}) {
  const { size } = useThree()
  const elapsed = useRef(0)
  const initialViewport = viewportRef.current
  const styleConfig = FLOW_ANIMATION_STYLES[style]
  const dotConfig = FLOW_DOT_ANIMATION_STYLES[style]
  const motionConfig = animationMode === 'dashes' ? FLOW_DASH_ANIMATION_STYLES[style] : styleConfig
  const geometry = useMemo(() => {
    const data = buildFlowLineGeometry(paths)
    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(data.positions, 3))
    next.setAttribute('aJoin', new BufferAttribute(data.joins, 2))
    next.setAttribute('aFlowColor', new BufferAttribute(data.colors, 3))
    next.setAttribute('aEnd', new BufferAttribute(data.ends, 2))
    next.setAttribute('aSide', new BufferAttribute(data.sides, 1))
    next.setAttribute('aAlong', new BufferAttribute(data.alongs, 1))
    next.setAttribute('aLineWidth', new BufferAttribute(data.widths, 1))
    next.setAttribute('aSpeed', new BufferAttribute(data.speeds, 1))
    next.setAttribute('aDistance', new BufferAttribute(data.distances, 1))
    next.setAttribute('aWidthScalesWithZoom', new BufferAttribute(data.widthScales, 1))
    return next
  }, [paths, animationMode])
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uResolution: { value: new Vector2(size.width, size.height) },
      uTranslation: { value: new Vector2(initialViewport.tx, initialViewport.ty) },
      uZoom: { value: initialViewport.zoom },
      uTime: { value: 0 },
      uMotion: { value: reducedMotion ? 0 : 1 },
      uDashColor: { value: new Color(styleConfig.color) },
      uDashOpacity: { value: styleConfig.opacity },
      uDashLength: { value: Math.max(0.001, motionConfig.dashLength) },
      uDashPeriod: { value: animationMode === 'dots' ? Math.max(0.001, dotConfig.dotSpacing, dotConfig.dotSize) : Math.max(0.001, motionConfig.dashLength) + Math.max(0, motionConfig.gapLength) },
      uBaseSpeed: { value: Math.max(0, animationMode === 'dots' ? dotConfig.baseSpeed : motionConfig.baseSpeed) },
      uDotSize: { value: Math.max(0.001, dotConfig.dotSize) },
      uDots: { value: animationMode === 'dots' ? 1 : 0 },
      uDashes: { value: animationMode === 'dashes' ? 1 : 0 },
      uGapOpacity: { value: Math.min(1, Math.max(0, FLOW_DASH_ANIMATION_STYLES[style].gapOpacity)) },
      uCooling: { value: style === 'cooling' ? 1 : 0 },
      uWaveWidthRatio: { value: styleConfig.waveWidthRatio },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  }), [styleConfig, motionConfig, dotConfig, style, animationMode])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    if (playing && !reducedMotion) elapsed.current += Math.min(delta, 0.1)
    const viewport = viewportRef.current
    material.uniforms.uResolution.value.set(size.width, size.height)
    material.uniforms.uTranslation.value.set(viewport.tx, viewport.ty)
    material.uniforms.uZoom.value = viewport.zoom
    material.uniforms.uTime.value = elapsed.current
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
  playing = true,
  animationMode = 'wave',
}: {
  paths: MonitorFlowPath[]
  viewportRef: RefObject<DiagramViewport>
  invalidateRef: RefObject<(() => void) | null>
  playing?: boolean
  animationMode?: FlowAnimationMode
}) {
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const hasPaths = paths.some((path) => playing || animationMode !== 'wave' || path.style === 'cooling')
  const pathsByStyle = useMemo(() => {
    const grouped = new Map<FlowAnimationStyle, MonitorFlowPath[]>()
    paths.forEach((path) => {
      const style = path.style ?? 'power'
      if (!playing && animationMode === 'wave' && style !== 'cooling') return
      const group = grouped.get(style) ?? []
      group.push(path)
      grouped.set(style, group)
    })
    return grouped
  }, [paths, playing, animationMode])
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
        frameloop={reducedMotion || !playing ? 'demand' : 'always'}
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
            playing={playing}
            animationMode={animationMode}
            style={style}
          />
        ))}
      </Canvas>
    </div>
  )
}
