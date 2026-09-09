import { describe, expect, it, vi } from 'vitest'
import { completeSceneBounds, fitSceneViewport } from './sceneFit'

describe('complete scene framing', () => {
  it('includes routed detours and label extents', () => {
    expect(completeSceneBounds({ x: 0, y: 0, width: 48, height: 48 }, [{ points: [{ x: -200, y: 500 }] }], [{ bounds: { x: 40, y: -80, width: 400, height: 30 } }]))
      .toEqual({ x: -200, y: -80, width: 640, height: 580 })
  })
  it('fits inside the actual space between panels and below the header', () => {
    const shell = document.createElement('div'); shell.className = 'app-shell'
    const canvas = document.createElement('div'); shell.append(canvas)
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800))
    for (const [name, rect] of [
      ['left-sidebar', new DOMRect(0, 64, 280, 736)], ['properties-panel', new DOMRect(840, 64, 360, 736)], ['workspace-header', new DOMRect(0, 0, 1200, 64)],
    ] as const) {
      const panel = document.createElement('aside'); panel.className = name; shell.append(panel)
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect)
    }
    const bounds = { x: -100, y: -100, width: 1000, height: 900 }
    const v = fitSceneViewport(bounds, { width: 1200, height: 800 }, canvas)
    expect(bounds.x * v.zoom + v.tx).toBeGreaterThanOrEqual(328)
    expect((bounds.x + bounds.width) * v.zoom + v.tx).toBeLessThanOrEqual(792)
    expect(bounds.y * v.zoom + v.ty).toBeGreaterThanOrEqual(112)
    expect((bounds.y + bounds.height) * v.zoom + v.ty).toBeLessThanOrEqual(752)
  })
})
