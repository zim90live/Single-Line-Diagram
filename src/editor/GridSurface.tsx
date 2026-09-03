import { useMemo, useRef, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Vector2, type ShaderMaterial } from 'three'

import type { DiagramViewport } from '../domain/project'
import { GRID_DOT_SCREEN_RADIUS } from './gridScale'

export const GRID_BACKGROUND_COLOR = '#000000'

const vertexShader = `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = `
  uniform vec2 uResolution;
  uniform vec2 uTranslation;
  uniform float uPixelRatio;
  uniform float uZoom;
  uniform float uGrid;
  uniform vec3 uBackgroundColor;

  float gridDot(vec2 world, float spacing, float screenRadius) {
    vec2 cell = fract(world / spacing + 0.5) - 0.5;
    float distanceToCenter = length(cell * spacing * uZoom);
    float antialias = max(fwidth(distanceToCenter), 0.35);
    return 1.0 - smoothstep(
      screenRadius - antialias,
      screenRadius + antialias,
      distanceToCenter
    );
  }

  void main() {
    vec2 screen = vec2(
      gl_FragCoord.x / uPixelRatio,
      uResolution.y - gl_FragCoord.y / uPixelRatio
    );
    vec2 world = (screen - uTranslation) / uZoom;
    float dot = gridDot(world, uGrid, ${GRID_DOT_SCREEN_RADIUS.toFixed(2)});
    vec3 dotColor = vec3(0.25, 0.25, 0.25);
    vec3 color = mix(uBackgroundColor, dotColor, dot * 0.60);
    gl_FragColor = vec4(color, 1.0);
  }
`

export interface GridRenderState {
  viewport: DiagramViewport
  worldStep: number
}

interface GridSurfaceProps {
  renderStateRef: RefObject<GridRenderState>
}

export function GridSurface({ renderStateRef }: GridSurfaceProps) {
  const materialRef = useRef<ShaderMaterial>(null)
  const { gl, size } = useThree()
  const initialRenderState = renderStateRef.current
  const uniforms = useMemo(
    () => ({
      uResolution: { value: new Vector2(size.width, size.height) },
      uTranslation: {
        value: new Vector2(
          initialRenderState?.viewport.tx ?? 0,
          initialRenderState?.viewport.ty ?? 0,
        ),
      },
      uPixelRatio: { value: gl.getPixelRatio() },
      uZoom: { value: initialRenderState?.viewport.zoom ?? 1 },
      uGrid: { value: initialRenderState?.worldStep ?? 8 },
      uBackgroundColor: { value: new Color(GRID_BACKGROUND_COLOR) },
    }),
    [],
  )

  const syncUniforms = () => {
    const renderState = renderStateRef.current
    const material = materialRef.current
    if (!renderState || !material) return
    const materialUniforms = material.uniforms as typeof uniforms
    materialUniforms.uResolution.value.set(size.width, size.height)
    materialUniforms.uTranslation.value.set(renderState.viewport.tx, renderState.viewport.ty)
    materialUniforms.uPixelRatio.value = gl.getPixelRatio()
    materialUniforms.uZoom.value = renderState.viewport.zoom
    materialUniforms.uGrid.value = renderState.worldStep
    material.uniformsNeedUpdate = true
  }

  const prepareRender = () => {
    syncUniforms()
  }

  return (
    <mesh frustumCulled={false} onBeforeRender={prepareRender}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}
