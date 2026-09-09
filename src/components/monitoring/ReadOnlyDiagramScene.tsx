import type { FlowAnimationMode } from '../../monitoring/flowPresentation'
import { useId, useMemo, type ReactNode } from 'react'

import type {
  AssetDefinition,
  ConnectionNetwork,
  DiagramElement,
} from '../../domain/project'
import {
  buildMonitorStaticFlowLineGroups,
  type MonitorFlowPath,
} from '../../monitoring/flowPresentation'
import {
  DiagramConnectionVisual,
  DiagramElementVisual,
  MonitorAnimatedFlowLines,
  MonitorStaticFlowLines,
  SymbolColorFilter,
  symbolColorFilterId,
} from '../../scene/DiagramScenePrimitives'
import { pathData, routeConnectionNetworks } from '../../scene/connections'
import type { Rect } from '../../scene/geometry'
import {
  resolvedSymbolColor,
  symbolsByKey,
  type SymbolVisualState,
} from '../../scene/symbolCatalog'

export interface ReadOnlyDiagramSceneProps {
  ariaLabel: string
  width: number
  height: number
  gridSize: number
  elements: DiagramElement[]
  connections: ConnectionNetwork[]
  routeAssets: AssetDefinition[]
  activeEdgeIds?: readonly string[]
  animationMode?: FlowAnimationMode
  animationPlaying?: boolean
  contentBounds?: Rect
  children?: ReactNode
}

/** A fixed-viewport diagram scene for embedding a small topology in monitoring UI. */
export function ReadOnlyDiagramScene({
  ariaLabel,
  width,
  height,
  gridSize,
  elements,
  connections,
  routeAssets,
  activeEdgeIds = [],
  animationMode = 'wave',
  animationPlaying = false,
  contentBounds,
  children,
}: ReadOnlyDiagramSceneProps) {
  const reactId = useId()
  const sceneScope = `read-only-scene-${reactId.replace(/[^a-z0-9_-]/gi, '')}`
  const routed = useMemo(() => routeConnectionNetworks(
    connections,
    elements,
    routeAssets,
    gridSize,
  ), [connections, elements, gridSize, routeAssets])
  const edgesById = useMemo(() => new Map(connections.flatMap((network) => (
    network.edges.map((edge) => [edge.id, edge] as const)
  ))), [connections])
  const activeEdgeIdSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds])
  const contentOffset = useMemo(() => contentBounds ? {
    x: (width - contentBounds.width) / 2 - contentBounds.x,
    y: (height - contentBounds.height) / 2 - contentBounds.y,
  } : { x: 0, y: 0 }, [contentBounds, height, width])
  const elementPresentations = useMemo(() => elements.flatMap((element) => {
    const symbol = symbolsByKey.get(element.assetKey)
    if (!symbol) return []
    const visualState: SymbolVisualState = symbol.defaultState ?? 'off'
    const symbolColor = symbol.configurableColor
      ? resolvedSymbolColor(element, visualState)
      : undefined
    return [{ element, symbol, visualState, symbolColor }]
  }), [elements])
  const symbolColors = useMemo(() => [...new Set(elementPresentations.flatMap((item) => (
    item.symbolColor ? [item.symbolColor] : []
  )))], [elementPresentations])
  const activeFlowPaths = useMemo(() => (
    routed.edges.flatMap((edge): MonitorFlowPath[] => (
      activeEdgeIdSet.has(edge.edgeId) ? [{
        id: `read-only-flow:${edge.edgeId}`,
        connectionEdgeId: edge.edgeId,
        points: edge.points,
        baseColor: edgesById.get(edge.edgeId)?.color ?? 'var(--electrical)',
        phasePath: { id: edge.edgeId, networkId: edge.networkId, startNodeId: edge.sourceNodeId, endNodeId: edge.targetNodeId, points: edge.points },
      }] : []
    ))
  ), [activeEdgeIdSet, edgesById, routed.edges])
  const activeFlowGroups = useMemo(() => (
    buildMonitorStaticFlowLineGroups(activeFlowPaths, [], animationMode)
  ), [activeFlowPaths, animationMode])

  return (
    <div
      className="read-only-diagram-scene-frame"
      data-animation-playing={animationPlaying || undefined}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <svg
        className="read-only-diagram-scene"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        data-routed-edge-count={routed.edges.length}
        data-routing-invalid-count={routed.invalidEdgeIds.length}
        data-active-edge-count={activeFlowPaths.length}
        data-content-center-x={contentBounds
          ? contentBounds.x + contentBounds.width / 2 + contentOffset.x
          : undefined}
        data-content-center-y={contentBounds
          ? contentBounds.y + contentBounds.height / 2 + contentOffset.y
          : undefined}
      >
        <defs>
          {symbolColors.map((color) => (
            <SymbolColorFilter
              key={color}
              id={symbolColorFilterId(color, sceneScope)}
              color={color}
            />
          ))}
        </defs>
        <g
          className="read-only-diagram-scene__content"
          transform={contentOffset.x || contentOffset.y
            ? `translate(${contentOffset.x} ${contentOffset.y})`
            : undefined}
        >
          <g className="read-only-diagram-scene__connections" aria-hidden="true">
            {routed.edges.map((route) => {
              const edge = edgesById.get(route.edgeId)
              return (
                <DiagramConnectionVisual
                  key={route.edgeId}
                  edgeId={route.edgeId}
                  networkId={route.networkId}
                  type={route.type}
                  color={edge?.color}
                  flowDirection={edge?.flowDirection}
                  coolingLineRole={edge?.coolingLineRole}
                  linePath={pathData(route.points)}
                />
              )
            })}
          </g>
          <g className="read-only-diagram-scene__active-lines" aria-hidden="true">
            <MonitorStaticFlowLines groups={activeFlowGroups} />
            {animationPlaying || animationMode === 'dots' ? <MonitorAnimatedFlowLines paths={activeFlowPaths} animationMode={animationMode} playing={animationPlaying} /> : null}
          </g>
          <g className="read-only-diagram-scene__elements">
            {elementPresentations.map(({ element, symbol, visualState, symbolColor }) => (
              <g
                key={element.id}
                className="diagram-element read-only-diagram-scene__element"
                data-element-id={element.id}
                data-asset-key={element.assetKey}
                transform={`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`}
              >
                <title>{element.name}</title>
                <DiagramElementVisual
                  element={element}
                  symbol={symbol}
                  symbolColor={symbolColor}
                  visualState={visualState}
                  colorFilterId={symbolColor
                    ? symbolColorFilterId(symbolColor, sceneScope)
                    : undefined}
                  clipPathId={`${sceneScope}-clip-${element.id}`}
                />
              </g>
            ))}
          </g>
          {children}
        </g>
      </svg>
    </div>
  )
}
