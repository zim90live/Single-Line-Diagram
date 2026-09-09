import type { FlowAnimationMode } from '../../monitoring/flowPresentation'
import type {
  AssetDefinition,
  ConnectionNetwork,
  DiagramElement,
  SymbolAnchor,
} from '../../domain/project'
import {
  CompositeElementLabelItem,
  type CompositeMetricLabelRow,
} from '../../scene/DiagramScenePrimitives'
import { symbolsByKey } from '../../scene/symbolCatalog'
import { ReadOnlyDiagramScene } from './ReadOnlyDiagramScene'

const UPS_DIAGRAM_ID = 'ups-internal-diagram'
const UPS_GRID_SIZE = 8
const UPS_CONTENT_BOUNDS = { x: 4, y: 24, width: 444, height: 304 }

const UPS_ELEMENTS: DiagramElement[] = [
  { id: 'ups-bypass-supply', assetKey: 'supply', name: '旁路电源', x: 40, y: 24 },
  { id: 'ups-ac-ac', assetKey: 'ac-ac-converter', name: 'AC-AC Converter', x: 176, y: 24 },
  { id: 'ups-main-supply', assetKey: 'supply', name: '主路电源', x: 40, y: 168 },
  { id: 'ups-rectifier', assetKey: 'rectifier', name: 'Rectifier', x: 144, y: 168 },
  { id: 'ups-inverter', assetKey: 'inverter', name: 'Inverter', x: 248, y: 168 },
  { id: 'ups-load', assetKey: 'load', name: '负载', x: 368, y: 168 },
  { id: 'ups-battery', assetKey: 'battery', name: 'Battery', x: 200, y: 280 },
].map((element) => ({
  ...element,
  diagramId: UPS_DIAGRAM_ID,
  width: 48,
  height: 48,
  rotation: 0,
  properties: {},
  extensions: {},
}))

const electricalAnchor = (
  anchor: Omit<SymbolAnchor, 'type'>,
): SymbolAnchor => ({ ...anchor, type: 'electrical' })

const ROUTE_ANCHORS_BY_ASSET: Record<string, SymbolAnchor[]> = {
  supply: [electricalAnchor({ id: 'out', name: '输出', x: 48, y: 24, direction: 'right' })],
  'ac-ac-converter': [
    electricalAnchor({ id: 'in', name: '输入', x: 0, y: 24, direction: 'left' }),
    electricalAnchor({ id: 'out', name: '输出', x: 48, y: 24, direction: 'right' }),
  ],
  rectifier: [
    electricalAnchor({ id: 'in', name: '输入', x: 0, y: 24, direction: 'left' }),
    electricalAnchor({ id: 'out', name: '输出', x: 48, y: 24, direction: 'right' }),
  ],
  inverter: [
    electricalAnchor({ id: 'in', name: '输入', x: 0, y: 24, direction: 'left' }),
    electricalAnchor({ id: 'out', name: '输出', x: 48, y: 24, direction: 'right' }),
  ],
  load: [electricalAnchor({ id: 'in', name: '输入', x: 0, y: 24, direction: 'left' })],
  battery: [electricalAnchor({ id: 'out', name: '输出', x: 24, y: 0, direction: 'top' })],
}

const UPS_ROUTE_ASSETS: AssetDefinition[] = Object.entries(ROUTE_ANCHORS_BY_ASSET).flatMap(([
  assetKey,
  anchors,
]) => {
  const symbol = symbolsByKey.get(assetKey)
  return symbol ? [{ ...symbol, anchors }] : []
})

const UPS_CONNECTIONS: ConnectionNetwork[] = [{
  id: 'ups-internal-network',
  diagramId: UPS_DIAGRAM_ID,
  type: 'electrical',
  nodes: [
    { id: 'bypass-out', kind: 'element-anchor', elementId: 'ups-bypass-supply', anchorId: 'out' },
    { id: 'ac-in', kind: 'element-anchor', elementId: 'ups-ac-ac', anchorId: 'in' },
    { id: 'ac-out', kind: 'element-anchor', elementId: 'ups-ac-ac', anchorId: 'out' },
    { id: 'main-out', kind: 'element-anchor', elementId: 'ups-main-supply', anchorId: 'out' },
    { id: 'rectifier-in', kind: 'element-anchor', elementId: 'ups-rectifier', anchorId: 'in' },
    { id: 'rectifier-out', kind: 'element-anchor', elementId: 'ups-rectifier', anchorId: 'out' },
    { id: 'dc-junction', kind: 'node', x: 224, y: 192 },
    { id: 'inverter-in', kind: 'element-anchor', elementId: 'ups-inverter', anchorId: 'in' },
    { id: 'inverter-out', kind: 'element-anchor', elementId: 'ups-inverter', anchorId: 'out' },
    { id: 'load-in', kind: 'element-anchor', elementId: 'ups-load', anchorId: 'in' },
    { id: 'battery-out', kind: 'element-anchor', elementId: 'ups-battery', anchorId: 'out' },
  ],
  edges: [
    { id: 'bypass-to-converter', sourceNodeId: 'bypass-out', targetNodeId: 'ac-in' },
    { id: 'converter-to-load', sourceNodeId: 'ac-out', targetNodeId: 'load-in' },
    { id: 'main-to-rectifier', sourceNodeId: 'main-out', targetNodeId: 'rectifier-in' },
    { id: 'rectifier-to-dc', sourceNodeId: 'rectifier-out', targetNodeId: 'dc-junction' },
    { id: 'dc-to-inverter', sourceNodeId: 'dc-junction', targetNodeId: 'inverter-in' },
    { id: 'inverter-to-load', sourceNodeId: 'inverter-out', targetNodeId: 'load-in' },
    { id: 'battery-to-dc', sourceNodeId: 'battery-out', targetNodeId: 'dc-junction' },
  ],
}]

const UPS_ACTIVE_EDGE_IDS = [
  'main-to-rectifier',
  'rectifier-to-dc',
  'dc-to-inverter',
  'inverter-to-load',
  'battery-to-dc',
] as const

function phaseRows(
  voltage: string,
  current: string,
  includeFrequency = false,
): CompositeMetricLabelRow[] {
  const rows = ['A', 'B', 'C'].map((phase) => ({
    id: phase.toLowerCase(),
    labelText: `${phase}：`,
    values: [
      { id: 'voltage', text: voltage },
      { id: 'current', text: current },
    ],
  }))
  return includeFrequency ? [...rows, {
    id: 'frequency',
    labelText: '频率：',
    values: [{ id: 'frequency', text: '50.00Hz' }],
  }] : rows
}

export function UpsLineDiagram({
  inputVoltage,
  outputVoltage,
  batteryLevel,
  inputCurrent,
  outputCurrent,
  animationMode = 'wave',
  animationPlaying = false,
}: {
  inputVoltage: string
  outputVoltage: string
  batteryLevel: string
  inputCurrent: string
  outputCurrent: string
  animationMode?: FlowAnimationMode
  animationPlaying?: boolean
}) {
  return (
    <div className="ups-line-diagram" aria-label="UPS线路画布">
      <ReadOnlyDiagramScene
        ariaLabel="UPS内部一次接线图"
        width={452}
        height={360}
        gridSize={UPS_GRID_SIZE}
        elements={UPS_ELEMENTS}
        connections={UPS_CONNECTIONS}
        routeAssets={UPS_ROUTE_ASSETS}
        activeEdgeIds={UPS_ACTIVE_EDGE_IDS}
        animationMode={animationMode}
        animationPlaying={animationPlaying}
        contentBounds={UPS_CONTENT_BOUNDS}
      >
        <g className="ups-line-diagram__labels">
          <CompositeElementLabelItem
            labelId="ups-bypass-label"
            ariaLabel="旁路数据"
            title="旁路"
            bounds={{ x: 4, y: 74, width: 120, height: 80 }}
            rows={phaseRows(outputVoltage, '0.0A', true)}
          />
          <CompositeElementLabelItem
            labelId="ups-main-label"
            ariaLabel="主路数据"
            title="主路"
            bounds={{ x: 4, y: 218, width: 120, height: 80 }}
            rows={phaseRows(inputVoltage, inputCurrent, true)}
          />
          <CompositeElementLabelItem
            labelId="ups-load-label"
            ariaLabel="负载数据"
            title="负载"
            bounds={{ x: 328, y: 218, width: 120, height: 64 }}
            rows={phaseRows(outputVoltage, outputCurrent)}
          />
          <CompositeElementLabelItem
            labelId="ups-battery-label"
            ariaLabel="电池数据"
            title="电池"
            bounds={{ x: 252, y: 280, width: 112, height: 48 }}
            rows={[
              {
                id: 'battery-level',
                labelText: '电量：',
                values: [{ id: 'level', text: batteryLevel }],
              },
              {
                id: 'battery-voltage',
                labelText: '电压：',
                values: [{ id: 'voltage', text: outputVoltage }],
              },
            ]}
          />
        </g>
      </ReadOnlyDiagramScene>
    </div>
  )
}
