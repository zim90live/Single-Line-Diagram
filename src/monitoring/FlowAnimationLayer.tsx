import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
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
export const FLOW_CHILD_LINE_SCREEN_WIDTH = 2
export const FLOW_BUSBAR_SCREEN_WIDTH = 4.5

export interface MonitorFlowPath {
  id: string
  points: Point[]
  screenWidth?: number
}

export function buildFlowLineGeometry(paths: MonitorFlowPath[]) {
  const positions: number[] = []
  const ends: number[] = []
  const sides: number[] = []
  const alongs: number[] = []
  const widths: number[] = []
  const distances: number[] = []
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
    const screenWidth = path.screenWidth ?? FLOW_CHILD_LINE_SCREEN_WIDTH
    let accumulated = 0
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]
      const end = path.points[index]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length < 0.001) continue
      const segmentKey = [start.x, start.y, end.x, end.y, screenWidth]
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
        widths.push(screenWidth)
        distances.push(accumulated + length * vertex.along)
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
    distances: new Float32Array(distances),
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
  varying float vDistance;

  void main() {
    vec2 startScreen = position.xy * uZoom + uTranslation;
    vec2 endScreen = aEnd * uZoom + uTranslation;
    vec2 delta = endScreen - startScreen;
    vec2 direction = delta / max(length(delta), 0.0001);
    vec2 normal = vec2(-direction.y, direction.x);
    float capExtension = aLineWidth * 0.5;
    vec2 screen = mix(startScreen, endScreen, aAlong)
      + direction * mix(-capExtension, capExtension, aAlong)
      + normal * aSide * aLineWidth * 0.5;
    vec2 clip = vec2(
      screen.x / uResolution.x * 2.0 - 1.0,
      1.0 - screen.y / uResolution.y * 2.0
    );
    vDistance = aDistance;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uZoom;
  uniform float uMotion;
  uniform vec3 uDashColor;
  uniform float uDashOpacity;
  varying float vDistance;

  void main() {
    float screenDistance = vDistance * uZoom;
    float movingPhase = uTime * 34.0 * uMotion;
    float phase = mod(screenDistance - movingPhase, 12.0);
    if (phase > 6.0) discard;
    gl_FragColor = vec4(uDashColor, uDashOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function FlowLines({
  paths,
  viewport,
  reducedMotion,
}: {
  paths: MonitorFlowPath[]
  viewport: DiagramViewport
  reducedMotion: boolean
}) {
  const { size } = useThree()
  const geometry = useMemo(() => {
    const data = buildFlowLineGeometry(paths)
    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(data.positions, 3))
    next.setAttribute('aEnd', new BufferAttribute(data.ends, 2))
    next.setAttribute('aSide', new BufferAttribute(data.sides, 1))
    next.setAttribute('aAlong', new BufferAttribute(data.alongs, 1))
    next.setAttribute('aLineWidth', new BufferAttribute(data.widths, 1))
    next.setAttribute('aDistance', new BufferAttribute(data.distances, 1))
    return next
  }, [paths])
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uResolution: { value: new Vector2(size.width, size.height) },
      uTranslation: { value: new Vector2(viewport.tx, viewport.ty) },
      uZoom: { value: viewport.zoom },
      uTime: { value: 0 },
      uMotion: { value: reducedMotion ? 0 : 1 },
      uDashColor: { value: new Color(FLOW_DASH_COLOR) },
      uDashOpacity: { value: FLOW_DASH_OPACITY },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  }), [])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ clock }) => {
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
  viewport,
}: {
  paths: MonitorFlowPath[]
  viewport: DiagramViewport
}) {
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  if (!paths.length) return null
  return (
    <div className="monitor-flow-layer" data-testid="monitor-flow-layer" aria-hidden="true">
      <Canvas
        orthographic
        frameloop="always"
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 1] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <FlowLines paths={paths} viewport={viewport} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  )
}
