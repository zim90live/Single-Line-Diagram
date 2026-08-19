import { expect, test } from '@playwright/test'

import realSceneArchive from '../scene-archives/WuHu AIDC 0814.json' with { type: 'json' }

const CONNECTED_REAL_SCENE_ELEMENT_IDS = [...new Set(
  realSceneArchive.connections.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'element-anchor' && 'elementId' in node ? [node.elementId] : []
  ))),
)]

test('keeps real-scene routing incremental and mounts anchors only when needed', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles('scene-archives/WuHu AIDC 0814.json')
  await expect(page.getByText('已导入 WuHu AIDC 0814.json')).toBeVisible()

  const powerTree = page.locator('.tree-line').filter({ hasText: '电力线路' })
  await powerTree.getByText('1 号楼', { exact: true }).click()

  const stage = page.getByTestId('diagram-canvas')
  await expect(stage).not.toHaveAttribute('data-routing-pending', 'true', { timeout: 15_000 })
  await expect(stage).toHaveAttribute('data-route-mode', 'full')
  await expect.poll(() => page.locator('.connection-edge').count(), { timeout: 15_000 })
    .toBeGreaterThan(1)
  expect(Number(await stage.getAttribute('data-rendered-routes'))).toBeLessThan(171)

  await expect(page.locator('.connection-anchor')).toHaveCount(0)
  const interactiveConnectedElementId = await page.locator('.diagram-element').evaluateAll(
    (nodes, connectedIds) => nodes.flatMap((node) => {
      if (!connectedIds.includes((node as SVGGElement).dataset.elementId ?? '')) return []
      const rect = node.getBoundingClientRect()
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const target = document.elementFromPoint(center.x, center.y)
      return target?.closest('.diagram-element') === node
        ? [(node as SVGGElement).dataset.elementId ?? '']
        : []
    })[0] ?? null,
    CONNECTED_REAL_SCENE_ELEMENT_IDS,
  )
  expect(interactiveConnectedElementId).not.toBeNull()
  const connectedElement = page.locator(
    `.diagram-element[data-element-id="${interactiveConnectedElementId}"]`,
  )
  await connectedElement.hover()
  await expect(connectedElement.locator('.connection-anchor')).not.toHaveCount(0)
  await page.mouse.move(2, 2)
  await expect(page.locator('.connection-anchor')).toHaveCount(0)

  const svgDescendantCount = await page.locator('.editor-overlay *').count()
  expect(svgDescendantCount).toBeLessThan(2_000)
  console.info('REAL_SCENE_RENDER_FOOTPRINT', JSON.stringify({
    svgDescendants: svgDescendantCount,
    renderedElements: Number(await stage.getAttribute('data-rendered-elements')),
    renderedBusbars: Number(await stage.getAttribute('data-rendered-busbars')),
    renderedRoutes: Number(await stage.getAttribute('data-rendered-routes')),
    filters: await page.locator('.editor-overlay > defs filter').count(),
    labels: await page.locator('.element-label, .busbar-label, .connection-label').count(),
    anchors: await page.locator('.connection-anchor').count(),
  }))

  await connectedElement.locator('.diagram-element__image').click()
  await expect(connectedElement).toHaveAttribute('data-selected', 'true')
  await stage.focus()
  await page.keyboard.press('ArrowRight')
  await expect(stage).toHaveAttribute('data-route-mode', 'incremental', { timeout: 5_000 })
  await expect(stage).not.toHaveAttribute('data-routing-pending', 'true', { timeout: 5_000 })

  const dirtyNetworkCount = Number(await stage.getAttribute('data-route-dirty-networks'))
  const reusedEdgeCount = Number(await stage.getAttribute('data-route-reused-edges'))
  const durationMs = Number(await stage.getAttribute('data-route-duration-ms'))
  expect(dirtyNetworkCount).toBeGreaterThan(0)
  expect(dirtyNetworkCount).toBeLessThan(67)
  expect(reusedEdgeCount).toBeGreaterThan(100)
  expect(durationMs).toBeLessThan(1_000)
})
