import type { AssetDefinition } from '../domain/project'

/** MP uses the containing diagram's domain, not a shared template's fixed domain. */
export function sensorAssetsForSystem(assets: AssetDefinition[], system: 'power' | 'cooling'): AssetDefinition[] {
  return assets.map((asset) => asset.key !== 'mp' ? asset : {
    ...asset,
    category: '通用',
    coolingDeviceRole: undefined,
    anchors: asset.anchors.map((anchor) => ({
      ...anchor,
      type: system === 'power' ? 'electrical' as const
        : anchor.type === 'electrical' ? 'cooling-general' as const : anchor.type,
      flowRole: undefined,
      powerSupplyChannel: undefined,
    })),
  })
}
