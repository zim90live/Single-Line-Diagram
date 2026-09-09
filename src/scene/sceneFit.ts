import { fitViewportToBounds, type Rect, type Point } from './geometry'

export function completeSceneBounds(base: Rect | null, paths: readonly { points: Point[] }[], labels: readonly { bounds: Rect }[]): Rect | null {
  const rects = [...(base ? [base] : []), ...labels.map(label => label.bounds), ...paths.flatMap(path => path.points.map(point => ({ ...point, width: 0, height: 0 })))]
  if (!rects.length) return null
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y))
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y }
}

export function fitSceneViewport(bounds: Rect | null, size: { width: number; height: number }, container: HTMLElement | null) {
  if (!bounds) return { zoom: 1, tx: 0, ty: 0 }
  const root = container?.getBoundingClientRect()
  let left = 0, right = size.width, top = 0
  if (root && root.width > 0) {
    const shell = container?.closest('.app-shell')
    shell?.querySelectorAll('.left-sidebar:not([aria-hidden="true"]), .properties-panel, .monitor-device-panel, .workspace-header').forEach(panel => {
      const rect = panel.getBoundingClientRect()
      if (!rect.width || !rect.height || rect.bottom <= root.top || rect.top >= root.bottom || rect.right <= root.left || rect.left >= root.right) return
      if (panel.classList.contains('workspace-header')) top = Math.max(top, rect.bottom - root.top)
      else if (rect.left + rect.width / 2 < root.left + root.width / 2) left = Math.max(left, rect.right - root.left)
      else right = Math.min(right, rect.left - root.left)
    })
  }
  const fitted = fitViewportToBounds(bounds, { width: Math.max(1, right - left), height: Math.max(1, size.height - top) })
  return { ...fitted, tx: fitted.tx + left, ty: fitted.ty + top }
}
