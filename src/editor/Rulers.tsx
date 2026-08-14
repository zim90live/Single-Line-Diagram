import { useMemo } from 'react'

import type { DiagramViewport } from '../domain/project'
import { createRulerTicks, getRulerScale } from './gridScale'

interface RulersProps {
  viewport: DiagramViewport
  width: number
  height: number
  gridSize: number
}

export function Rulers({ viewport, width, height, gridSize }: RulersProps) {
  const rulerScale = useMemo(
    () => getRulerScale(gridSize, viewport.zoom),
    [gridSize, viewport.zoom],
  )
  const horizontalTicks = useMemo(
    () => createRulerTicks(viewport, width, 'x', gridSize),
    [gridSize, viewport, width],
  )
  const verticalTicks = useMemo(
    () => createRulerTicks(viewport, height, 'y', gridSize),
    [gridSize, height, viewport],
  )

  return (
    <>
      <div className="ruler-corner" aria-hidden="true" />
      <svg
        className="ruler ruler-horizontal"
        aria-label="水平标尺"
        viewBox={`0 0 ${Math.max(width, 1)} 26`}
        preserveAspectRatio="none"
        data-grid-world-step={rulerScale.gridWorldStep}
        data-grid-density={rulerScale.density}
        data-label-world-step={rulerScale.labelWorldStep}
      >
        {horizontalTicks.map((tick) => (
          <g
            key={tick.key}
            transform={`translate(${tick.position} 0)`}
            data-tick-world={tick.value}
            data-tick-position={tick.position}
            data-tick-major={tick.major}
          >
            <line y1={tick.major ? 12 : 18} y2="26" />
            {tick.labeled ? <text x="3" y="10">{tick.value}</text> : null}
          </g>
        ))}
      </svg>
      <svg
        className="ruler ruler-vertical"
        aria-label="垂直标尺"
        viewBox={`0 0 26 ${Math.max(height, 1)}`}
        preserveAspectRatio="none"
        data-grid-world-step={rulerScale.gridWorldStep}
        data-grid-density={rulerScale.density}
        data-label-world-step={rulerScale.labelWorldStep}
      >
        {verticalTicks.map((tick) => (
          <g
            key={tick.key}
            transform={`translate(0 ${tick.position})`}
            data-tick-world={tick.value}
            data-tick-position={tick.position}
            data-tick-major={tick.major}
          >
            <line x1={tick.major ? 12 : 18} x2="26" />
            {tick.labeled ? <text x="4" y="-3" transform="rotate(-90 4 -3)">{tick.value}</text> : null}
          </g>
        ))}
      </svg>
    </>
  )
}
