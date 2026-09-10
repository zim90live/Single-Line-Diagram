import { textSymbolStyle } from './textSymbol'
import { FLOW_DOT_ANIMATION_STYLES, flowAnimationSpeedMultiplier } from '../monitoring/flowPresentation'
import { memo, useId, useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

import type {
  AnchorType,
  Busbar,
  ConnectionFlowDirection,
  CoolingLineRole,
  DiagramElement,
  MonitorAlarmSeverity,
} from '../domain/project'
import {
  FLOW_ANIMATION_STYLES,
  FLOW_BUSBAR_SCREEN_WIDTH,
  FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH,
  FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH,
  type FlowAnimationMode,
  type MonitorFlowPath,
  type MonitorStaticFlowLineGroup,
} from '../monitoring/flowPresentation'
import { flowPhaseOffsets } from '../monitoring/flowPathGeometry'
import type { BusbarLabelLayout } from './busbarLabels'
import {
  coolingPipeFilterRegion,
} from './connectionAppearance'
import type { ConnectionLabelLayout } from './connectionLabels'
import { busbarEndPoint, pathData } from './connections'
import {
  ELEMENT_LABEL_LINE_HEIGHT,
  estimateLabelTextWidth,
  elementDeviceIdentifier,
  type ElementLabelLayout,
} from './elementLabels'
import {
  fitGenericSymbolTag,
  genericSymbolDisplayedWidth,
} from './genericSymbol'
import type { Point, Rect } from './geometry'
import {
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  getSymbolDisplayUrl,
  normalizeSymbolColor,
  type SymbolDefinition,
  type SymbolVisualState,
} from './symbolCatalog'

export function symbolColorFilterId(color: string, scope?: string) {
  const suffix = normalizeSymbolColor(color).slice(1).toLowerCase()
  return scope ? `${scope}-symbol-color-${suffix}` : `symbol-color-filter-${suffix}`
}

export const SymbolColorFilter = memo(function SymbolColorFilter({
  id,
  color,
}: {
  id: string
  color: string
}) {
  return (
    <filter
      id={id}
      x="-5%"
      y="-5%"
      width="110%"
      height="110%"
      colorInterpolationFilters="sRGB"
    >
      <feFlood floodColor={color} result="symbol-color" />
      <feComposite in="symbol-color" in2="SourceAlpha" operator="in" />
    </filter>
  )
})

export const MonitorStaticFlowLines = memo(function MonitorStaticFlowLines({
  groups,
}: {
  groups: MonitorStaticFlowLineGroup[]
}) {
  return groups.map((group) => (
    <path
      key={group.id}
      className="monitor-static-flow-line"
      d={group.paths.map((points) => pathData(points)).join(' ')}
      stroke={group.color}
      strokeWidth={group.lineWidth}
      strokeLinecap={group.lineCap}
      strokeLinejoin={group.lineJoin}
      vectorEffect={group.widthSpace === 'screen' ? 'non-scaling-stroke' : undefined}
    />
  ))
})

export const MonitorAnimatedFlowLines = memo(function MonitorAnimatedFlowLines({
  paths,
  animationMode = 'wave',
  playing = true,
}: {
  paths: MonitorFlowPath[]
  animationMode?: FlowAnimationMode
  playing?: boolean
}) {
  const dotGroupRef = useRef<SVGGElement>(null)
  const scope = useId().replace(/[^a-z0-9_-]/gi, '')
  const offsets = flowPhaseOffsets(paths)
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  useEffect(() => {
    const svg = dotGroupRef.current?.ownerSVGElement
    if (!svg) return
    if (playing && !reducedMotion) svg.unpauseAnimations?.()
    else svg.pauseAnimations?.()
    return () => { svg.unpauseAnimations?.() }
  }, [playing, reducedMotion, animationMode])
  if (animationMode === 'dots') {
    return <g ref={dotGroupRef} data-dot-playing={playing && !reducedMotion}>
      {paths.flatMap((path, pathIndex) => {
        const config = FLOW_DOT_ANIMATION_STYLES[path.style ?? 'power']
        const diameter = Math.max(0.001, config.dotSize)
        const period = Math.max(diameter, config.dotSpacing)
        const speed = config.baseSpeed * flowAnimationSpeedMultiplier(path)
        if ((path.speedMultiplier ?? 1) <= 0) return []
        let distance = offsets.get(path.id) ?? 0
        return path.points.slice(1).flatMap((end, index) => {
          const start = path.points[index]
          const length = Math.hypot(end.x - start.x, end.y - start.y)
          if (!length) return []
          const dx = (end.x - start.x) / length
          const dy = (end.y - start.y) / length
          const id = `${scope}-moving-dot-${pathIndex}-${index}`
          const origin = ((distance % period) + period) % period
          distance += length
          return <g key={id}>
            <defs>
              <pattern id={id} patternUnits="userSpaceOnUse" width={period} height={diameter} y={-diameter / 2}
                patternTransform={`matrix(${dx} ${dy} ${-dy} ${dx} ${start.x - dx * origin} ${start.y - dy * origin})`}>
                <circle cx={period / 2} cy={0} r={diameter / 2}
                  fill={path.baseColor ?? '#FFFFFF'} />
                {!reducedMotion && speed > 0 ? <animateTransform attributeName="patternTransform" type="translate" additive="sum"
                  from="0 0" to={`${period} 0`} dur={`${period / speed}s`} repeatCount="indefinite" /> : null}
              </pattern>
            </defs>
            <path className="monitor-moving-dot-flow" d={pathData([start, end])}
              fill="none" pointerEvents="none" stroke={`url(#${id})`} strokeWidth={diameter} strokeLinecap="butt" />
          </g>
        })
      })}
    </g>
  }
  return paths.flatMap((path, pathIndex) => {
    const style = FLOW_ANIMATION_STYLES[path.style ?? 'power']
    const speed = style.baseSpeed * flowAnimationSpeedMultiplier(path)
    if (!speed) return []
    const period = style.dashLength + style.gapLength
    let distance = offsets.get(path.id) ?? 0
    const width = path.worldWidth ?? path.powerLineWidth ?? (path.screenWidth === FLOW_BUSBAR_SCREEN_WIDTH
      ? FLOW_POWER_BUSBAR_STATIC_SCREEN_WIDTH : FLOW_POWER_CONNECTION_STATIC_SCREEN_WIDTH)
    return path.points.slice(1).flatMap((end, index) => {
      const start = path.points[index]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (!length) return []
      const dx = (end.x - start.x) / length
      const dy = (end.y - start.y) / length
      const x = start.x - dx * distance
      const y = start.y - dy * distance
      distance += length
      const id = `${scope}-wave-${pathIndex}-${index}`
      return [(
        <g key={id}>
          <defs>
            <linearGradient id={id} gradientUnits="userSpaceOnUse" spreadMethod="repeat"
              x1={x} y1={y} x2={x + dx * period} y2={y + dy * period}>
              <stop offset="0" stopColor={path.baseColor ?? style.color} stopOpacity={0.5} />
              <stop offset={style.dashLength / period} stopColor={path.baseColor ?? style.color} stopOpacity={1} />
              <stop offset="1" stopColor={path.baseColor ?? style.color} stopOpacity={0.5} />
              {!reducedMotion ? <animateTransform attributeName="gradientTransform" type="translate"
                from="0 0" to={`${dx * period} ${dy * period}`} dur={`${period / speed}s`}
                repeatCount="indefinite" /> : null}
            </linearGradient>
          </defs>
          <path className="monitor-wave-flow-line" d={pathData([start, end])}
            fill="none" pointerEvents="none" stroke={`url(#${id})`}
            strokeWidth={width * 0.8} strokeLinecap="butt"
            />
        </g>
      )]
    })
  })
})

export interface BusbarVisualProps {
  busbar: Busbar
  selected?: boolean
  nodeRegistry?: { current: Map<string, SVGGElement> }
  children?: ReactNode
}

export const BusbarVisual = memo(function BusbarVisual({
  busbar,
  selected = false,
  nodeRegistry,
  children,
}: BusbarVisualProps) {
  const end = busbarEndPoint(busbar)
  return (
    <g
      ref={(node) => {
        if (!nodeRegistry) return
        if (node) nodeRegistry.current.set(busbar.id, node)
        else nodeRegistry.current.delete(busbar.id)
      }}
      className="busbar"
      data-busbar-id={busbar.id}
      data-orientation={busbar.orientation}
      data-monitor-flow-direction={busbar.monitorFlowDirection}
      data-selected={selected || undefined}
      style={busbar.color
        ? { '--busbar-color': busbar.color } as CSSProperties
        : undefined}
    >
      <path
        className="busbar__line"
        d={`M ${busbar.x} ${busbar.y} L ${end.x} ${end.y}`}
      />
      {children}
    </g>
  )
})

export interface BusbarTapVisualProps {
  nodeId: string
  busbarId: string
  offset: number
  point: Point
  color?: string
  zoom: number
  nodeRegistry?: { current: Map<string, SVGCircleElement> }
}

export const BusbarTapVisual = memo(function BusbarTapVisual({
  nodeId,
  busbarId,
  offset,
  point,
  color,
  zoom,
  nodeRegistry,
}: BusbarTapVisualProps) {
  return (
    <circle
      ref={(node) => {
        if (!nodeRegistry) return
        if (node) nodeRegistry.current.set(nodeId, node)
        else nodeRegistry.current.delete(nodeId)
      }}
      className="busbar-tap"
      visibility="hidden"
      aria-hidden="true"
      data-connection-type="electrical"
      data-busbar-id={busbarId}
      data-busbar-offset={offset}
      style={color ? { '--busbar-color': color } as CSSProperties : undefined}
      cx={point.x}
      cy={point.y}
      r={2.5 / zoom}
    />
  )
})

export const ConnectionBridgeCasing = memo(function ConnectionBridgeCasing({
  path,
  type,
  coolingLineRole,
}: {
  path: string
  type: AnchorType
  coolingLineRole?: CoolingLineRole
}) {
  return (
    <g>
      <path
        className="connection-edge__bridge-casing"
        data-connection-type={type}
        data-cooling-line-role={coolingLineRole}
        d={path}
      />
      <path
        className="connection-edge__bridge-casing connection-edge__bridge-casing--world"
        data-connection-type={type}
        data-cooling-line-role={coolingLineRole}
        d={path}
      />
    </g>
  )
})

export const CoolingPipeShell = memo(function CoolingPipeShell({
  path,
  type,
  color,
  coolingLineRole,
  filterId,
  monitorReplay = false,
}: {
  path: string
  type: AnchorType
  color?: string
  coolingLineRole: CoolingLineRole
  filterId: string
  monitorReplay?: boolean
}) {
  return (
    <path
      className="connection-edge__pipe-shell"
      style={color ? { '--connection-color': color } as CSSProperties : undefined}
      data-monitor-pipe-shell-replay={monitorReplay || undefined}
      data-connection-type={type}
      data-cooling-line-role={coolingLineRole}
      d={path}
      filter={`url(#${filterId})`}
    />
  )
})

export const ConnectionDirectionArrow = memo(function ConnectionDirectionArrow({
  path,
}: {
  path: string
}) {
  if (!path) return null
  return (
    <>
      <path className="connection-edge__direction-arrow-casing" d={path} />
      <path className="connection-edge__direction-arrow" d={path} />
    </>
  )
})

export interface DiagramConnectionVisualProps {
  lineWidth?: number
  edgeId: string
  networkId: string
  type: AnchorType
  color?: string
  flowDirection?: ConnectionFlowDirection
  coolingLineRole?: CoolingLineRole
  selected?: boolean
  interactive?: boolean
  linePath: string
  directionArrowPath?: string
  nodeRegistry?: { current: Map<string, SVGGElement> }
  lineUnderlay?: ReactNode
  children?: ReactNode
}

export const DiagramConnectionVisual = memo(function DiagramConnectionVisual({
  lineWidth,
  edgeId,
  networkId,
  type,
  color,
  flowDirection,
  coolingLineRole,
  selected = false,
  interactive = false,
  linePath,
  directionArrowPath = '',
  nodeRegistry,
  lineUnderlay,
  children,
}: DiagramConnectionVisualProps) {
  return (
    <g
      ref={(node) => {
        if (!nodeRegistry) return
        if (node) nodeRegistry.current.set(edgeId, node)
        else nodeRegistry.current.delete(edgeId)
      }}
      className="connection-edge"
      data-edge-id={edgeId}
      data-network-id={networkId}
      data-connection-type={type}
      data-flow-direction={flowDirection}
      data-cooling-line-role={coolingLineRole}
      data-selected={selected || undefined}
      data-interactive={interactive || undefined}
      style={{ ...(color ? { '--connection-color': color } : {}), ...(type === 'electrical' && lineWidth !== undefined ? { '--connection-line-width': `${lineWidth}px`, '--connection-selected-line-width': `${lineWidth + 1.5}px`, '--connection-hit-width': `${Math.max(12, lineWidth + 4)}px` } : {}) } as CSSProperties}
    >
      {lineUnderlay}
      <path className="connection-edge__line" d={linePath} />
      <ConnectionDirectionArrow path={directionArrowPath} />
      {children}
    </g>
  )
})

export interface ElementLabelItemProps {
  layout: ElementLabelLayout
  interactive?: boolean
  selected?: boolean
  pointerDownRef?: {
    current: (
      event: PointerEvent<SVGRectElement>,
      elementId: string,
    ) => void
  }
  metricPointerDownRef?: MetricPointerDownRef
}

export interface MetricPointerDownRef {
  current: (
    event: PointerEvent<SVGRectElement>,
    ownerId: string,
    metricId: string,
  ) => void
}

export const MetricLabelRows = memo(function MetricLabelRows({
  rows,
  ownerId,
  metricPointerDownRef,
}: {
  rows: ElementLabelLayout['metricRows']
  ownerId?: string
  metricPointerDownRef?: MetricPointerDownRef
}) {
  return rows.map((row) => (
    <g
      className="element-metric-row"
      data-severity={row.severity}
      key={row.metricId}
    >
      {row.severity !== 'normal' ? (
        <rect
          className="element-metric-row__alarm-background"
          data-severity={row.severity}
          x={row.valueBounds.x}
          y={row.valueBounds.y}
          width={row.valueBounds.width}
          height={row.valueBounds.height}
          rx={2}
        />
      ) : null}
      {ownerId && metricPointerDownRef ? (
        <rect
          className="element-metric-row__hit"
          data-metric-id={row.metricId}
          x={row.valueBounds.x}
          y={row.valueBounds.y}
          width={row.valueBounds.width}
          height={row.valueBounds.height}
          rx={2}
          onPointerDown={(event) => metricPointerDownRef.current(
            event,
            ownerId,
            row.metricId,
          )}
        />
      ) : null}
      {row.labelVisible ? (
        <text
          className="element-metric-row__label"
          textAnchor="start"
          x={row.labelX}
          y={row.textY}
        >
          {row.labelText}
        </text>
      ) : null}
      <text
        className="element-metric-row__reading"
        x={row.valueX}
        y={row.textY}
        textAnchor="end"
        aria-label={row.ariaLabel}
      >
        <tspan
          className="element-metric-row__value"
          data-severity={row.severity}
        >
          {row.valueText}
        </tspan>
      </text>
    </g>
  ))
})

export interface CompositeMetricLabelValue {
  id: string
  text: string
  severity?: MonitorAlarmSeverity
}

export interface CompositeMetricLabelRow {
  id: string
  labelText: string
  values: CompositeMetricLabelValue[]
}

export interface CompositeElementLabelItemProps {
  labelId: string
  ariaLabel: string
  title: string
  bounds: Rect
  rows: CompositeMetricLabelRow[]
}

const COMPOSITE_METRIC_VALUE_GAP = 4

/**
 * Uses the same label typography and alarm presentation as configured canvas
 * metrics, while allowing a display-only row to contain multiple values.
 */
export const CompositeElementLabelItem = memo(function CompositeElementLabelItem({
  labelId,
  ariaLabel,
  title,
  bounds,
  rows,
}: CompositeElementLabelItemProps) {
  const valueColumnCount = rows.reduce((count, row) => Math.max(count, row.values.length), 0)
  const valueColumnWidths = Array.from({ length: valueColumnCount }, (_, columnIndex) => (
    rows.reduce((width, row) => {
      const valueOffset = valueColumnCount - row.values.length
      const value = row.values[columnIndex - valueOffset]
      return value ? Math.max(width, estimateLabelTextWidth(value.text)) : width
    }, 0)
  ))
  const valueColumnsWidth = valueColumnWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, valueColumnCount - 1) * COMPOSITE_METRIC_VALUE_GAP
  const valuesStartX = bounds.x + bounds.width - valueColumnsWidth

  return (
    <g
      className="element-label composite-element-label"
      data-label-id={labelId}
      role="group"
      aria-label={ariaLabel}
    >
      <rect
        className="element-label__hit"
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
      />
      <text
        className="element-label__text"
        x={bounds.x + 2}
        y={bounds.y + 11}
      >
        {title}
      </text>
      {rows.map((row, rowIndex) => {
        const rowY = bounds.y + (rowIndex + 1) * ELEMENT_LABEL_LINE_HEIGHT
        const textY = rowY + 11
        const valueOffset = valueColumnCount - row.values.length
        return (
          <g className="element-metric-row composite-element-label__row" key={row.id}>
            <text
              className="element-metric-row__label"
              x={bounds.x + 2}
              y={textY}
            >
              {row.labelText}
            </text>
            {row.values.map((value, valueIndex) => {
              const columnIndex = valueOffset + valueIndex
              const columnX = valuesStartX + valueColumnWidths
                .slice(0, columnIndex)
                .reduce((sum, width) => sum + width + COMPOSITE_METRIC_VALUE_GAP, 0)
              const severity = value.severity ?? 'normal'
              return (
                <g
                  className="composite-element-label__value"
                  data-severity={severity}
                  key={value.id}
                >
                  {severity !== 'normal' ? (
                    <rect
                      className="element-metric-row__alarm-background"
                      data-severity={severity}
                      x={columnX}
                      y={rowY}
                      width={valueColumnWidths[columnIndex]}
                      height={ELEMENT_LABEL_LINE_HEIGHT}
                      rx={2}
                    />
                  ) : null}
                  <text
                    className="element-metric-row__reading"
                    data-severity={severity}
                    x={columnX + valueColumnWidths[columnIndex] - 2}
                    y={textY}
                    textAnchor="end"
                    aria-label={`${row.labelText} ${value.text}`}
                  >
                    <tspan
                      className="element-metric-row__value"
                      data-severity={severity}
                    >
                      {value.text}
                    </tspan>
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
})

export const ElementLabelItem = memo(function ElementLabelItem({
  layout,
  interactive = false,
  selected = false,
  pointerDownRef,
  metricPointerDownRef,
}: ElementLabelItemProps) {
  return (
    <g
      className="element-label"
      data-element-id={layout.elementId}
      style={{ '--element-label-font-size': `${10 * (layout.scale ?? 1)}px` } as CSSProperties}
      data-placement={layout.placement}
      data-interactive={interactive || undefined}
      data-selected={selected || undefined}
    >
      <rect
        className="element-label__hit"
        x={layout.bounds.x}
        y={layout.bounds.y}
        width={layout.bounds.width}
        height={layout.bounds.height}
        onPointerDown={interactive && pointerDownRef
          ? (event) => pointerDownRef.current(event, layout.elementId)
          : undefined}
      />
      {layout.nameText ? (
        <text
          className="element-label__text"
          x={layout.textX}
          y={layout.textY}
        >
          {layout.nameText}
        </text>
      ) : null}
      <MetricLabelRows
        rows={layout.metricRows}
        ownerId={layout.elementId}
        metricPointerDownRef={metricPointerDownRef}
      />
    </g>
  )
})

export interface BusbarLabelItemProps {
  metricPointerDownRef?: MetricPointerDownRef
  layout: BusbarLabelLayout
  interactive?: boolean
  selected?: boolean
  nodeRegistry?: { current: Map<string, SVGGElement> }
  pointerDownRef?: {
    current: (
      event: PointerEvent<SVGRectElement>,
      busbarId: string,
    ) => void
  }
}

export const BusbarLabelItem = memo(function BusbarLabelItem({
  metricPointerDownRef,
  layout,
  interactive = false,
  selected = false,
  nodeRegistry,
  pointerDownRef,
}: BusbarLabelItemProps) {
  return (
    <g
      ref={(node) => {
        if (!nodeRegistry) return
        if (node) nodeRegistry.current.set(layout.busbarId, node)
        else nodeRegistry.current.delete(layout.busbarId)
      }}
      className="element-label busbar-label"
      data-busbar-id={layout.busbarId}
      data-endpoint={layout.endpoint}
      data-side={layout.side}
      data-interactive={interactive || undefined}
      data-selected={selected || undefined}
      style={layout.color
        ? { '--busbar-label-color': layout.color } as CSSProperties
        : undefined}
    >
      <rect
        className="element-label__hit"
        x={layout.bounds.x}
        y={layout.bounds.y}
        width={layout.bounds.width}
        height={layout.bounds.height}
        onPointerDown={interactive && pointerDownRef
          ? (event) => pointerDownRef.current(event, layout.busbarId)
          : undefined}
      />
      <text
        className="element-label__text"
        x={layout.textX}
        y={layout.textY}
        textAnchor={layout.textAnchor}
      >
        {layout.text}
      </text>
      <MetricLabelRows rows={layout.metricRows ?? []} ownerId={layout.busbarId} metricPointerDownRef={metricPointerDownRef} />
    </g>
  )
})

export interface ConnectionLabelItemProps {
  layout: ConnectionLabelLayout
  interactive?: boolean
  selected?: boolean
  pointerDownRef?: {
    current: (
      event: PointerEvent<SVGRectElement>,
      edgeId: string,
    ) => void
  }
  metricPointerDownRef?: MetricPointerDownRef
}

export const ConnectionLabelItem = memo(function ConnectionLabelItem({
  layout,
  interactive = false,
  selected = false,
  pointerDownRef,
  metricPointerDownRef,
}: ConnectionLabelItemProps) {
  return (
    <g
      className="element-label connection-label"
      data-edge-id={layout.edgeId}
      data-endpoint={layout.endpoint}
      data-side={layout.side}
      data-orientation={layout.orientation}
      data-axis-alignment={layout.axisAlignment}
      data-interactive={interactive || undefined}
      data-selected={selected || undefined}
    >
      <rect
        className="element-label__hit"
        x={layout.bounds.x}
        y={layout.bounds.y}
        width={layout.bounds.width}
        height={layout.bounds.height}
        onPointerDown={interactive && pointerDownRef
          ? (event) => pointerDownRef.current(event, layout.edgeId)
          : undefined}
      />
      {layout.nameText ? (
        <text
          className="element-label__text"
          x={layout.textX}
          y={layout.textY}
          textAnchor={layout.textAnchor}
        >
          {layout.nameText}
        </text>
      ) : null}
      <MetricLabelRows
        rows={layout.metricRows}
        ownerId={layout.edgeId}
        metricPointerDownRef={metricPointerDownRef}
      />
    </g>
  )
})

export interface DiagramElementVisualProps {
  element: DiagramElement
  symbol?: SymbolDefinition
  symbolColor?: string
  genericBackgroundColor?: string
  visualState: SymbolVisualState
  coolingPumpStopped?: boolean
  fault?: boolean
  showCoolingPumpState?: boolean
  colorFilterId?: string
  clipPathId: string
  onPointerDown?: (event: PointerEvent<SVGElement>) => void
  children?: ReactNode
}

export const DiagramElementVisual = memo(function DiagramElementVisual({
  element,
  symbol,
  symbolColor,
  genericBackgroundColor,
  visualState,
  coolingPumpStopped = false,
  fault = false,
  showCoolingPumpState = false,
  colorFilterId,
  clipPathId,
  onPointerDown,
  children,
}: DiagramElementVisualProps) {
  if (!symbol) return null
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  if (symbol.renderMode === 'text') {
    const style = textSymbolStyle(element.properties)
    return (
      <g>
        <rect className="diagram-element__text-hit"
          x={element.x} y={element.y} width={element.width} height={element.height}
          fill="transparent" pointerEvents="all" onPointerDown={onPointerDown} />
        <text x={centerX} y={centerY} textAnchor="middle" dominantBaseline="central"
          fill={style.color} fontSize={style.fontSize} fontWeight={style.fontWeight}
          style={{ whiteSpace: 'pre' }} pointerEvents="none">{style.text}</text>
        {children}
      </g>
    )
  }
  if (symbol.renderMode === 'generic-frame') {
    const fullTag = elementDeviceIdentifier(element)
    const fittedTag = fitGenericSymbolTag(fullTag, genericSymbolDisplayedWidth(element))
    return (
      <>
        <defs>
          <clipPath id={clipPathId} clipPathUnits="userSpaceOnUse">
            <rect
              x={element.x + 2}
              y={element.y + 2}
              width={Math.max(0, element.width - 4)}
              height={Math.max(0, element.height - 4)}
              transform={`rotate(${element.rotation} ${centerX} ${centerY})`}
            />
          </clipPath>
        </defs>
        <g
          className="diagram-element__generic-body"
          transform={`rotate(${element.rotation} ${centerX} ${centerY})`}
        >
          <rect
            className="diagram-element__generic-frame"
            data-symbol-color={symbolColor}
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            fill={genericBackgroundColor}
            stroke={symbolColor ?? DEFAULT_CONFIGURABLE_SYMBOL_COLOR}
            strokeOpacity={element.properties.genericBorderVisible === false ? 0 : 1}
            onPointerDown={onPointerDown}
          />
          {children}
        </g>
        <text
          className="diagram-element__generic-tag"
          data-full-text={fullTag}
          data-upright="true"
          x={centerX}
          y={centerY}
          clipPath={`url(#${clipPathId})`}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {fittedTag}
        </text>
      </>
    )
  }
  return (
    <>
      <image
        className="diagram-element__image"
        data-symbol-color={symbolColor}
        data-symbol-state={visualState}
        data-cooling-pump-state={showCoolingPumpState
          ? coolingPumpStopped ? 'stopped' : 'running'
          : undefined}
        filter={symbolColor && colorFilterId ? `url(#${colorFilterId})` : undefined}
        href={getSymbolDisplayUrl(symbol, visualState, coolingPumpStopped, fault)}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
      />
      {children}
    </>
  )
})

export interface CoolingPipeOutlineFilterProps {
  id: string
  points: Point[]
  role?: CoolingLineRole
  suspectedLeak?: boolean
}

export const CoolingPipeOutlineFilter = memo(function CoolingPipeOutlineFilter({
  id,
  points,
  role,
  suspectedLeak = false,
}: CoolingPipeOutlineFilterProps) {
  const region = coolingPipeFilterRegion(points)
  return (
    <filter
      id={id}
      x={region.x}
      y={region.y}
      width={region.width}
      height={region.height}
      filterUnits="userSpaceOnUse"
      primitiveUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feMorphology in="SourceAlpha" operator="erode" radius={role === 'auxiliary' ? 0.8 : 1} result="pipe-interior" />
      <feComponentTransfer in="SourceGraphic" result="pipe-base">
        <feFuncR type="linear" slope={0.25} />
        <feFuncG type="linear" slope={0.25} />
        <feFuncB type="linear" slope={0.25} />
      </feComponentTransfer>
      <feComposite in="pipe-base" in2="pipe-interior" operator="in" result="pipe-fill" />
      <feComposite in="SourceGraphic" in2="pipe-interior" operator="out" result="pipe-outline" />
      {suspectedLeak ? <>
        <feMorphology in="SourceAlpha" operator="dilate" radius={role === 'auxiliary' ? 0.8 : 1} result="leak-outer" />
        <feComposite in="leak-outer" in2="pipe-interior" operator="out" result="pipe-outline" />
        <feFlood floodColor="#FF3030" result="leak-color">
          <animate attributeName="flood-color" values="#FF3030;#701515;#FF3030" dur="1s" repeatCount="indefinite" />
        </feFlood>
        <feComposite in="leak-color" in2="pipe-outline" operator="in" result="pipe-outline" />
      </> : null}
      <feMerge>
        <feMergeNode in="pipe-outline" />
        <feMergeNode in="pipe-fill" />
      </feMerge>
    </filter>
  )
})
