import { memo, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

import type {
  AnchorType,
  Busbar,
  CoolingLineRole,
  DiagramElement,
} from '../domain/project'
import type { MonitorStaticFlowLineGroup } from '../monitoring/FlowAnimationLayer'
import type { BusbarLabelLayout } from '../editor/busbarLabels'
import {
  COOLING_PIPE_INNER_SHADOW_BLUR,
  COOLING_PIPE_INNER_SHADOW_COLOR,
  COOLING_PIPE_INNER_SHADOW_DX,
  COOLING_PIPE_INNER_SHADOW_DY,
  coolingPipeFilterRegion,
  coolingPipeInnerShadowOpacity,
} from '../editor/connectionAppearance'
import type { ConnectionLabelLayout } from '../editor/connectionLabels'
import { busbarEndPoint, pathData } from '../editor/connections'
import {
  elementDeviceIdentifier,
  type ElementLabelLayout,
} from '../editor/elementLabels'
import {
  fitGenericSymbolTag,
  genericSymbolDisplayedWidth,
} from '../editor/genericSymbol'
import type { Point } from '../editor/geometry'
import {
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  getSymbolDisplayUrl,
  normalizeSymbolColor,
  type SymbolDefinition,
  type SymbolVisualState,
} from '../editor/symbolCatalog'

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
  coolingLineRole,
  filterId,
  monitorReplay = false,
}: {
  path: string
  type: AnchorType
  coolingLineRole: CoolingLineRole
  filterId: string
  monitorReplay?: boolean
}) {
  return (
    <path
      className="connection-edge__pipe-shell"
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
}

export const MetricLabelRows = memo(function MetricLabelRows({
  rows,
}: {
  rows: ElementLabelLayout['metricRows']
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
      {row.labelVisible ? (
        <text
          className="element-metric-row__label"
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

export const ElementLabelItem = memo(function ElementLabelItem({
  layout,
  interactive = false,
  selected = false,
  pointerDownRef,
}: ElementLabelItemProps) {
  return (
    <g
      className="element-label"
      data-element-id={layout.elementId}
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
      <MetricLabelRows rows={layout.metricRows} />
    </g>
  )
})

export interface BusbarLabelItemProps {
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
}

export const ConnectionLabelItem = memo(function ConnectionLabelItem({
  layout,
  interactive = false,
  selected = false,
  pointerDownRef,
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
      <MetricLabelRows rows={layout.metricRows} />
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
  showCoolingPumpState = false,
  colorFilterId,
  clipPathId,
  onPointerDown,
  children,
}: DiagramElementVisualProps) {
  if (!symbol) return null
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
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
        href={getSymbolDisplayUrl(symbol, visualState, coolingPumpStopped)}
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

export interface CoolingPipeInnerShadowFilterProps {
  id: string
  points: Point[]
  role?: CoolingLineRole
}

export const CoolingPipeInnerShadowFilter = memo(function CoolingPipeInnerShadowFilter({
  id,
  points,
  role,
}: CoolingPipeInnerShadowFilterProps) {
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
      <feGaussianBlur
        in="SourceAlpha"
        stdDeviation={COOLING_PIPE_INNER_SHADOW_BLUR}
        result="cooling-pipe-blur"
      />
      <feOffset
        in="cooling-pipe-blur"
        dx={COOLING_PIPE_INNER_SHADOW_DX}
        dy={COOLING_PIPE_INNER_SHADOW_DY}
        result="cooling-pipe-offset-blur"
      />
      <feComposite
        in="SourceAlpha"
        in2="cooling-pipe-offset-blur"
        operator="out"
        result="cooling-pipe-inner-shadow-mask"
      />
      <feFlood
        floodColor={COOLING_PIPE_INNER_SHADOW_COLOR}
        floodOpacity={coolingPipeInnerShadowOpacity(role)}
        result="cooling-pipe-inner-shadow-color"
      />
      <feComposite
        in="cooling-pipe-inner-shadow-color"
        in2="cooling-pipe-inner-shadow-mask"
        operator="in"
        result="cooling-pipe-inner-shadow"
      />
      <feComposite in="cooling-pipe-inner-shadow" in2="SourceGraphic" operator="over" />
    </filter>
  )
})
