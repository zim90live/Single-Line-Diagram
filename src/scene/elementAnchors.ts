import type { AssetDefinition, DiagramElement, SymbolAnchor } from '../domain/project'

/** Instance-only placement; anchor identity and circuit semantics stay intact. */
export function instanceAnchorPlacement(
  anchor: SymbolAnchor,
  asset: Pick<AssetDefinition, 'intrinsicHeight'>,
  element: Partial<Pick<DiagramElement, 'assetKey' | 'tmuPortsSwapped'>>,
): SymbolAnchor {
  if (element.assetKey !== 'tmu' || !element.tmuPortsSwapped ||
    anchor.type === 'electrical' || !['top', 'bottom'].includes(anchor.direction)) return anchor
  return {
    ...anchor,
    y: asset.intrinsicHeight - anchor.y,
    direction: anchor.direction === 'top' ? 'bottom' : 'top',
  }
}
