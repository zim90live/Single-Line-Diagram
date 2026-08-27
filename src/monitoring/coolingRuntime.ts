import {
  resolveConnectionType,
  type AssetDefinition,
  type DiagramElement,
  type SymbolAnchor,
} from '../domain/project'

export interface CoolingPumpRuntimeState {
  running: boolean
  outputPowerPercent: number
  ratedFlow: number
  targetFlow: number
}

export const DEFAULT_COOLING_PUMP_RATED_FLOW = 100
export const DEFAULT_COOLING_PUMP_OUTPUT_POWER_PERCENT = 100

export interface CoolingRuntimeSnapshot {
  source: 'mock' | 'telemetry'
  timestamp: number
  pumps: Record<string, CoolingPumpRuntimeState>
  valves: Record<string, { open: boolean }>
}

export interface CoolingRuntimeInput {
  elements: DiagramElement[]
  assets: AssetDefinition[]
  pumpRunningOverrides?: Record<string, boolean>
  pumpOutputPowerOverrides?: Record<string, number>
  valveOpenOverrides?: Record<string, boolean>
}

export interface CoolingRuntimeProvider {
  getSnapshot(input: CoolingRuntimeInput): CoolingRuntimeSnapshot
}

export type CoolingAssetDiagnosticCode =
  | 'pump-inlet-missing'
  | 'pump-outlet-missing'
  | 'pump-port-duplicate'
  | 'pump-port-electrical'
  | 'pump-port-type-incompatible'

export interface CoolingAssetDiagnostic {
  code: CoolingAssetDiagnosticCode
  assetKey: string
  message: string
}

export interface CoolingPumpPorts {
  inlet: SymbolAnchor
  outlet: SymbolAnchor
}

export type CoolingDirectedPorts = CoolingPumpPorts

export function clampCoolingPumpOutputPower(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

export function diagnoseCoolingPumpAsset(asset: AssetDefinition) {
  const diagnostics: CoolingAssetDiagnostic[] = []
  const inlets = asset.anchors.filter((anchor) => anchor.flowRole === 'inlet')
  const outlets = asset.anchors.filter((anchor) => anchor.flowRole === 'outlet')
  if (!inlets.length) diagnostics.push({
    code: 'pump-inlet-missing',
    assetKey: asset.key,
    message: `${asset.name} 尚未配置水泵入口`,
  })
  if (!outlets.length) diagnostics.push({
    code: 'pump-outlet-missing',
    assetKey: asset.key,
    message: `${asset.name} 尚未配置水泵出口`,
  })
  if (inlets.length > 1 || outlets.length > 1) diagnostics.push({
    code: 'pump-port-duplicate',
    assetKey: asset.key,
    message: `${asset.name} 的水泵入口和出口必须各自唯一`,
  })
  const inlet = inlets[0]
  const outlet = outlets[0]
  if (inlet?.type === 'electrical' || outlet?.type === 'electrical') diagnostics.push({
    code: 'pump-port-electrical',
    assetKey: asset.key,
    message: `${asset.name} 的水泵入口和出口必须使用冷却锚点`,
  })
  if (
    inlet &&
    outlet &&
    inlet.type !== 'electrical' &&
    outlet.type !== 'electrical' &&
    resolveConnectionType([inlet.type, outlet.type]) === null
  ) diagnostics.push({
    code: 'pump-port-type-incompatible',
    assetKey: asset.key,
    message: `${asset.name} 的水泵入口和出口类型不兼容`,
  })
  return diagnostics
}

export function resolveCoolingPumpPorts(asset: AssetDefinition): CoolingPumpPorts | null {
  if (asset.coolingDeviceRole !== 'pump') return null
  if (diagnoseCoolingPumpAsset(asset).length) return null
  const inlet = asset.anchors.find((anchor) => anchor.flowRole === 'inlet')
  const outlet = asset.anchors.find((anchor) => anchor.flowRole === 'outlet')
  return inlet && outlet ? { inlet, outlet } : null
}

export function resolveCoolingCheckValvePorts(
  asset: AssetDefinition,
): CoolingDirectedPorts | null {
  if (asset.coolingDeviceRole !== 'check-valve') return null
  const inlets = asset.anchors.filter((anchor) => anchor.flowRole === 'inlet')
  const outlets = asset.anchors.filter((anchor) => anchor.flowRole === 'outlet')
  if (inlets.length !== 1 || outlets.length !== 1) return null
  const [inlet] = inlets
  const [outlet] = outlets
  if (
    inlet.type === 'electrical' ||
    outlet.type === 'electrical' ||
    resolveConnectionType([inlet.type, outlet.type]) === null
  ) return null
  return { inlet, outlet }
}

export class MockCoolingRuntimeProvider implements CoolingRuntimeProvider {
  readonly defaultOutputPowerPercent: number
  readonly ratedFlow: number

  constructor(
    defaultOutputPowerPercent = DEFAULT_COOLING_PUMP_OUTPUT_POWER_PERCENT,
    ratedFlow = DEFAULT_COOLING_PUMP_RATED_FLOW,
  ) {
    this.defaultOutputPowerPercent = clampCoolingPumpOutputPower(defaultOutputPowerPercent)
    this.ratedFlow = Math.max(0, Number.isFinite(ratedFlow) ? ratedFlow : 0)
  }

  getSnapshot({
    elements,
    assets,
    pumpRunningOverrides = {},
    pumpOutputPowerOverrides = {},
    valveOpenOverrides = {},
  }: CoolingRuntimeInput): CoolingRuntimeSnapshot {
    const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]))
    const pumps: CoolingRuntimeSnapshot['pumps'] = {}
    const valves: CoolingRuntimeSnapshot['valves'] = {}
    for (const element of elements) {
      const role = assetsByKey.get(element.assetKey)?.coolingDeviceRole
      if (role === 'pump') {
        const running = pumpRunningOverrides[element.id] ?? true
        const outputPowerPercent = clampCoolingPumpOutputPower(
          pumpOutputPowerOverrides[element.id] ?? this.defaultOutputPowerPercent,
        )
        pumps[element.id] = {
          running,
          outputPowerPercent,
          ratedFlow: this.ratedFlow,
          targetFlow: running ? this.ratedFlow * outputPowerPercent / 100 : 0,
        }
      } else if (role === 'valve' || role === 'check-valve') {
        valves[element.id] = {
          open: valveOpenOverrides[element.id] ?? true,
        }
      }
    }
    return {
      source: 'mock',
      timestamp: 0,
      pumps,
      valves,
    }
  }
}
