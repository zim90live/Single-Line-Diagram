import { expect, test, type Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import { createDefaultProject, SCHEMA_VERSION } from '../src/domain/project'
import { GRID_DOT_SCREEN_RADIUS } from '../src/editor/gridScale'
import { defaultConnectionColor } from '../src/editor/objectColors'
import realSceneArchive from '../scene-archives/WuHu AIDC 0814.json' with { type: 'json' }

const CONNECTED_REAL_SCENE_ELEMENT_IDS = [...new Set(
  realSceneArchive.connections.flatMap((network) => network.nodes.flatMap((node) => (
    node.kind === 'element-anchor' && 'elementId' in node ? [node.elementId] : []
  ))),
)]

test('registers Cabinet A and Cabinet B as separate insertable symbols', async ({ page }) => {
  await page.goto('/')

  const cabinetA = page.getByTitle('拖动或双击插入Cabinet A')
  const cabinetB = page.getByTitle('拖动或双击插入Cabinet B')
  await expect(cabinetA).toBeVisible()
  await expect(cabinetB).toBeVisible()

  await cabinetA.dblclick()
  await cabinetB.dblclick()

  await expect(page.locator('.diagram-element[data-asset-key="cabinet"]')).toHaveCount(1)
  await expect(page.locator('.diagram-element[data-asset-key="cabinet-b"]')).toHaveCount(1)
})

test('renders a free-size generic frame with an upright clipped device identifier', async ({ page }) => {
  await page.goto('/')

  await page.getByTitle('拖动或双击插入通用图元').dblclick()
  const element = page.locator('.diagram-element[data-asset-key="generic"]')
  const frame = element.locator('.diagram-element__generic-frame')
  const body = element.locator('.diagram-element__generic-body')
  const tag = element.locator('.diagram-element__generic-tag')

  await expect(element).toHaveCount(1)
  await expect(frame).toHaveAttribute('width', '96')
  await expect(frame).toHaveAttribute('height', '48')
  await expect(frame).toHaveAttribute('fill', '#121316')
  await expect(frame).toHaveAttribute('stroke', '#777777')
  await expect(frame).toHaveAttribute('stroke-opacity', '1')
  await expect(tag).toHaveText('通用图元-01')
  await expect(page.locator('.element-label').filter({ hasText: '通用图元-01' })).toHaveCount(0)

  const borderVisibility = page.getByRole('switch', { name: '显示虚线框' })
  await expect(borderVisibility).toHaveAttribute('aria-checked', 'true')
  await borderVisibility.click()
  await expect(frame).toHaveAttribute('stroke-opacity', '0')
  await expect(frame).toHaveAttribute('fill', '#121316')
  await expect(tag).toHaveText('通用图元-01')
  await borderVisibility.click()
  await expect(frame).toHaveAttribute('stroke-opacity', '1')

  await page.getByLabel('宽度').fill('160')
  await page.getByLabel('宽度').press('Enter')
  await page.getByLabel('高度').fill('64')
  await page.getByLabel('高度').press('Enter')
  await expect(frame).toHaveAttribute('width', '160')
  await expect(frame).toHaveAttribute('height', '64')
  await expect(page.getByLabel('缩放', { exact: true })).toHaveCount(0)

  const resizeHandle = page.locator('.transform-handle--resize')
  const resizeBox = await resizeHandle.boundingBox()
  if (!resizeBox) throw new Error('无法读取通用图元缩放手柄位置')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 + 48,
    resizeBox.y + resizeBox.height / 2 + 16,
  )
  await page.mouse.up()
  await expect(frame).toHaveAttribute('width', '208')
  await expect(frame).toHaveAttribute('height', '80')

  await page.getByLabel('虚线框颜色 HEX').fill('#77b4bf')
  await page.getByLabel('虚线框颜色 HEX').blur()
  await expect(frame).toHaveAttribute('stroke', '#77B4BF')

  const longIdentifier = 'AHU-THIS-IS-A-VERY-LONG-DEVICE-IDENTIFIER-01'
  await page.getByLabel('设备标识').fill(longIdentifier)
  await page.getByLabel('设备标识').press('Enter')
  await expect(tag).toHaveAttribute('data-full-text', longIdentifier)
  await expect(tag).not.toHaveText(longIdentifier)
  await expect(tag).toContainText('…')
  await expect(tag).toHaveAttribute('clip-path', /generic-symbol-clip/)

  await page.getByLabel('角度').fill('90')
  await page.getByLabel('角度').press('Enter')
  await expect(body).toHaveAttribute('transform', /rotate\(90 /)
  await expect(tag).toHaveAttribute('data-upright', 'true')
  await expect(tag).not.toHaveAttribute('transform')
})

test('creates a compatible generic anchor and connects resized rotated instances', async ({ page }) => {
  await page.goto('/')

  const genericMaterial = page.getByTitle('拖动或双击插入通用图元')
  await genericMaterial.hover()
  await page.getByRole('button', { name: '编辑 通用图元 锚点' }).click()

  const anchorDialog = page.getByRole('dialog', { name: '接线锚点编辑器' })
  await anchorDialog.getByRole('button', { name: '在 96, 24 添加锚点' }).click()
  await expect(anchorDialog.getByLabel('锚点类型')).toHaveValue('cooling-general')
  await anchorDialog.getByRole('button', { name: '关闭图元编辑器' }).click()

  const canvas = page.getByLabel('一次接线图编辑画布')
  await genericMaterial.dragTo(canvas, { targetPosition: { x: 220, y: 220 } })
  await genericMaterial.dragTo(canvas, { targetPosition: { x: 520, y: 260 } })

  const elements = page.locator('.diagram-element[data-asset-key="generic"]')
  await expect(elements).toHaveCount(2)
  await elements.first().click()
  await page.getByLabel('宽度').fill('160')
  await page.getByLabel('宽度').press('Enter')
  await page.getByLabel('高度').fill('64')
  await page.getByLabel('高度').press('Enter')
  await page.getByLabel('角度').fill('90')
  await page.getByLabel('角度').press('Enter')

  const sourceAnchor = elements.first().locator('.connection-anchor')
  const targetAnchor = elements.last().locator('.connection-anchor')
  await expect(sourceAnchor).toHaveAttribute('data-compatible', 'true')
  await expect(sourceAnchor).toHaveAttribute('data-anchor-type', 'cooling-general')
  await sourceAnchor.click({ force: true })
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)
  await targetAnchor.click({ force: true })

  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.locator('.connection-edge')).toHaveAttribute(
    'data-connection-type',
    'cooling-general',
  )
})

test('uses a flat four-region workspace with transparent canvas HUD', async ({ page }) => {
  await page.goto('/')

  const canvasFrame = page.locator('.canvas-frame')
  const canvasStage = canvasFrame.locator('.canvas-stage')
  await expect(page.locator('.context-toolbar')).toHaveCount(0)
  await expect(page.locator('.ruler, .ruler-corner')).toHaveCount(0)
  await expect(canvasFrame.locator('.canvas-titlebar')).toHaveCount(1)
  await expect(canvasFrame.locator('.status-bar')).toHaveCount(1)
  await expect(canvasFrame.getByRole('button', { name: '返回上一级' })).toBeVisible()
  await expect(canvasFrame.getByRole('button', { name: '缩小画布' })).toBeVisible()
  await expect(canvasFrame).toHaveCSS('padding', '0px')
  await expect(canvasStage).toHaveCSS('border-radius', '0px')
  await expect(canvasFrame.locator('.canvas-titlebar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(canvasFrame.locator('.status-bar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(canvasFrame.locator('.status-bar')).not.toContainText(/^X\s/)
})

test('collapses and expands the left menu from its graphical edge control', async ({ page }) => {
  await page.goto('/')

  const workspace = page.locator('.workspace-main')
  const leftSidebar = page.locator('.left-sidebar')
  const canvasColumn = page.locator('.canvas-column')
  const savedStatus = page.locator('.workspace-header').getByText('已保存', { exact: true })
  const initialCanvasBox = await canvasColumn.boundingBox()
  const initialSidebarBox = await leftSidebar.boundingBox()
  if (!initialCanvasBox) throw new Error('无法读取初始画布区域尺寸')
  if (!initialSidebarBox) throw new Error('无法读取初始左侧菜单尺寸')

  const collapseButton = page.getByRole('button', { name: '收起左侧菜单' })
  await expect(collapseButton).toHaveAttribute('aria-expanded', 'true')
  await expect(collapseButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(collapseButton).toHaveCSS('border-top-width', '0px')
  const collapseButtonBox = await collapseButton.boundingBox()
  if (!collapseButtonBox) throw new Error('无法读取收起按钮位置')
  expect(collapseButtonBox.x).toBeGreaterThanOrEqual(initialSidebarBox.x + initialSidebarBox.width)
  await collapseButton.hover()
  await expect(collapseButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await collapseButton.click()

  await expect(workspace).toHaveAttribute('data-left-sidebar-collapsed', 'true')
  await expect(leftSidebar).toHaveCSS('visibility', 'hidden')
  await expect(page.getByRole('button', { name: '展开左侧菜单' })).toHaveAttribute('aria-expanded', 'false')
  await expect(savedStatus).toBeVisible()
  const expandedCanvasBox = await canvasColumn.boundingBox()
  if (!expandedCanvasBox) throw new Error('无法读取收起菜单后的画布区域尺寸')
  expect(expandedCanvasBox.width).toBeGreaterThan(initialCanvasBox.width + 200)

  await page.getByRole('button', { name: '展开左侧菜单' }).click()

  await expect(workspace).not.toHaveAttribute('data-left-sidebar-collapsed')
  await expect(leftSidebar).toHaveCSS('visibility', 'visible')
  await expect(page.getByRole('button', { name: '收起左侧菜单' })).toHaveAttribute('aria-expanded', 'true')
  await expect(savedStatus).toBeVisible()
  const restoredCanvasBox = await canvasColumn.boundingBox()
  if (!restoredCanvasBox) throw new Error('无法读取展开菜单后的画布区域尺寸')
  expect(restoredCanvasBox.width).toBeCloseTo(initialCanvasBox.width, 0)
})

test('keeps zoom and pan as unsaved session-only view state', async ({ page }) => {
  await page.goto('/')

  const savedStatus = page.locator('.workspace-header').getByText('已保存', { exact: true })
  const stage = page.getByTestId('diagram-canvas')
  const canvas = page.getByLabel('一次接线图编辑画布')
  const zoomReadout = page.getByRole('button', { name: '重置画布缩放' })
  await expect(savedStatus).toBeVisible()

  await page.getByRole('button', { name: '放大画布' }).click()
  await expect(zoomReadout).toHaveText('120%')
  await expect(savedStatus).toBeVisible()

  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('无法读取画布尺寸')
  const center = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
  }
  await page.mouse.move(center.x, center.y)
  await page.mouse.wheel(0, 120)
  await expect(zoomReadout).not.toHaveText('120%')
  await expect(savedStatus).toBeVisible()

  const beforePanX = Number(await stage.getAttribute('data-grid-translation-x'))
  await page.mouse.move(center.x, center.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(center.x + 40, center.y + 24)
  await page.mouse.up({ button: 'middle' })
  await expect.poll(async () => Number(await stage.getAttribute('data-grid-translation-x')))
    .not.toBe(beforePanX)
  await expect(savedStatus).toBeVisible()
})

test('starts a new connection by double-clicking a node', async ({ page }) => {
  const document = createDefaultProject('节点双击起线回归')
  const diagramId = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
  document.connections = [{
    id: 'node-start-network',
    diagramId,
    type: 'cooling-primary-hot',
    nodes: [
      { id: 'node-start', kind: 'node', x: 240, y: 200 },
      { id: 'node-right', kind: 'node', x: 480, y: 200 },
      { id: 'node-bottom', kind: 'node', x: 360, y: 360 },
    ],
    edges: [
      { id: 'node-start-edge-top', sourceNodeId: 'node-start', targetNodeId: 'node-right' },
      { id: 'node-start-edge-right', sourceNodeId: 'node-right', targetNodeId: 'node-bottom' },
      { id: 'node-start-edge-left', sourceNodeId: 'node-bottom', targetNodeId: 'node-start' },
    ],
  }]

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'node-double-click.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await expect(page.getByText('已导入 node-double-click.json')).toBeVisible()

  const sourceNode = page.locator('.connection-junction-handle[data-node-id="node-start"]')
  await expect(sourceNode).toBeVisible()
  await sourceNode.dblclick()

  await expect(page.getByTestId('connection-preview')).toHaveCount(1)
  await expect(page.getByText('正在接线 · 一次回路热')).toBeVisible()
})

test('derives an automatic corner node only when dragging or completing a branch', async ({ page }) => {
  const document = createDefaultProject('自动拐角候选节点回归', [{
    key: 'mp',
    name: 'MP',
    category: '冷却',
    source: 'src/assets/symbols/MP.svg',
    intrinsicWidth: 32,
    intrinsicHeight: 32,
    anchors: [
      {
        id: 'left',
        name: '左侧',
        x: 0,
        y: 16,
        direction: 'left',
        type: 'cooling-primary-cold',
      },
      {
        id: 'right',
        name: '右侧',
        x: 32,
        y: 16,
        direction: 'right',
        type: 'cooling-primary-cold',
      },
    ],
  }])
  const diagramId = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
  document.elements = [
    {
      id: 'corner-source',
      diagramId,
      assetKey: 'mp',
      name: '源设备',
      x: 160,
      y: 160,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
    {
      id: 'corner-target',
      diagramId,
      assetKey: 'mp',
      name: '目标设备',
      x: 416,
      y: 288,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
    {
      id: 'corner-branch-target',
      diagramId,
      assetKey: 'mp',
      name: '支路目标',
      x: 640,
      y: 160,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
  ]
  document.connections = [{
    id: 'corner-network',
    diagramId,
    type: 'cooling-primary-cold',
    nodes: [
      {
        id: 'corner-source-anchor',
        kind: 'element-anchor',
        elementId: 'corner-source',
        anchorId: 'right',
      },
      {
        id: 'corner-target-anchor',
        kind: 'element-anchor',
        elementId: 'corner-target',
        anchorId: 'left',
      },
    ],
    edges: [{
      id: 'corner-edge',
      sourceNodeId: 'corner-source-anchor',
      targetNodeId: 'corner-target-anchor',
    }],
  }]

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'derived-corner-node.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await expect(page.getByText('已导入 derived-corner-node.json')).toBeVisible()
  const edge = page.locator('.connection-edge[data-edge-id="corner-edge"]')
  await expect(edge).toHaveCount(1)

  const firstCornerScreenPoint = async () => edge
    .locator('.connection-edge__hit:not(.connection-edge__hit--world)')
    .evaluate((path) => {
      const matrix = (path as SVGPathElement).getScreenCTM()
      const corner = { x: 304, y: 176 }
      if (!matrix) throw new Error('无法读取自动线路拐角')
      return {
        world: corner,
        screen: {
          x: corner.x * matrix.a + matrix.e,
          y: corner.y * matrix.d + matrix.f,
        },
      }
    })

  const initialCorner = await firstCornerScreenPoint()
  await page.mouse.move(initialCorner.screen.x, initialCorner.screen.y)
  const candidate = page.locator(
    '.connection-junction-candidate[data-derived-corner="true"]',
  )
  await expect(candidate).toHaveCount(1)
  await expect(candidate).toHaveAttribute('cx', String(initialCorner.world.x))
  await expect(candidate).toHaveAttribute('cy', String(initialCorner.world.y))

  await candidate.click()
  await expect(page.locator('.connection-junction-handle')).toHaveCount(0)
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await page.waitForTimeout(550)

  await page.mouse.move(initialCorner.screen.x, initialCorner.screen.y)
  await expect(candidate).toHaveCount(1)
  await candidate.dblclick()
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)
  await expect(page.locator('.connection-junction-handle')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('connection-preview')).toHaveCount(0)
  await expect(page.locator('.connection-junction-handle')).toHaveCount(0)
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  await page.mouse.move(initialCorner.screen.x, initialCorner.screen.y)
  await expect(candidate).toHaveCount(1)
  await candidate.dblclick()
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)

  await page.locator(
    '.diagram-element[data-element-id="corner-branch-target"] .connection-anchor[data-anchor-id="left"]',
  ).click({ force: true })
  await expect(page.getByTestId('connection-preview')).toHaveCount(0)
  await expect(page.locator('.connection-junction-handle')).toHaveCount(1)
  await expect(page.locator('.connection-edge')).toHaveCount(2)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.connection-junction-handle')).toHaveCount(0)
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.getByTestId('diagram-canvas')).not.toHaveAttribute(
    'data-routing-pending',
    'true',
    { timeout: 15_000 },
  )

  const restoredCorner = await firstCornerScreenPoint()
  await page.mouse.move(restoredCorner.screen.x + 24, restoredCorner.screen.y + 24)
  await page.mouse.move(restoredCorner.screen.x, restoredCorner.screen.y)
  await expect(candidate).toHaveCount(1)
  const candidateDrag = await candidate.evaluate((circle) => {
    const node = circle as SVGCircleElement
    const matrix = node.getScreenCTM()
    if (!matrix) throw new Error('无法读取候选节点屏幕坐标')
    const x = node.cx.baseVal.value
    const y = node.cy.baseVal.value
    return {
      world: { x: x + 32, y: y + 32 },
      start: { x: x * matrix.a + matrix.e, y: y * matrix.d + matrix.f },
      target: { x: (x + 32) * matrix.a + matrix.e, y: (y + 32) * matrix.d + matrix.f },
    }
  })
  await page.mouse.move(candidateDrag.start.x, candidateDrag.start.y)
  await page.mouse.down()
  await page.mouse.move(candidateDrag.target.x, candidateDrag.target.y, { steps: 4 })
  await page.mouse.up()

  const materializedNode = page.locator('.connection-junction-handle')
  await expect(materializedNode).toHaveCount(1)
  await expect(materializedNode).toHaveAttribute('cx', String(candidateDrag.world.x))
  await expect(materializedNode).toHaveAttribute('cy', String(candidateDrag.world.y))
  await expect(page.locator('.connection-edge')).toHaveCount(1)
})

test('moves an unrelated element when a pre-existing manual route is already invalid', async ({ page }) => {
  const document = createDefaultProject('既有无解线路不阻止无关图元移动', [{
    key: 'mp',
    name: 'MP',
    category: '冷却',
    source: 'src/assets/symbols/MP.svg',
    intrinsicWidth: 32,
    intrinsicHeight: 32,
    anchors: [
      {
        id: 'left',
        name: '左侧',
        x: 0,
        y: 16,
        direction: 'left',
        type: 'cooling-primary-cold',
      },
      {
        id: 'right',
        name: '右侧',
        x: 32,
        y: 16,
        direction: 'right',
        type: 'cooling-primary-cold',
      },
    ],
  }])
  const diagramId = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
  document.elements = [
    {
      id: 'manual-source',
      diagramId,
      assetKey: 'mp',
      name: '源',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
    {
      id: 'manual-target',
      diagramId,
      assetKey: 'mp',
      name: '目标',
      x: 192,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
    {
      id: 'unrelated-bug-element',
      diagramId,
      assetKey: 'mp',
      name: 'Bug',
      x: 176,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
  ]
  document.connections = [{
    id: 'invalid-manual-network',
    diagramId,
    type: 'cooling-primary-cold',
    nodes: [
      {
        id: 'manual-source-anchor',
        kind: 'element-anchor',
        elementId: 'manual-source',
        anchorId: 'right',
      },
      {
        id: 'manual-blocked-node',
        kind: 'node',
        x: 112,
        y: 80,
      },
      {
        id: 'manual-target-anchor',
        kind: 'element-anchor',
        elementId: 'manual-target',
        anchorId: 'left',
      },
    ],
    edges: [{
      id: 'invalid-manual-edge',
      sourceNodeId: 'manual-source-anchor',
      targetNodeId: 'manual-target-anchor',
      routeNodeIds: ['manual-blocked-node'],
    }],
  }]

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'unrelated-invalid-manual-route.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await expect(page.getByText('已导入 unrelated-invalid-manual-route.json')).toBeVisible()
  await expect(page.getByTestId('diagram-canvas')).not.toHaveAttribute(
    'data-routing-pending',
    'true',
    { timeout: 15_000 },
  )
  await expect(page.locator('.connection-edge')).toHaveCount(0)

  await page.locator(
    '.diagram-element[data-element-id="unrelated-bug-element"]',
  ).click({ force: true })
  const xField = page.getByLabel('X', { exact: true })
  await expect(xField).toHaveValue('176')
  await xField.fill('320')
  await xField.press('Enter')

  await expect(xField).toHaveValue('320')
  await expect(page.locator(
    '.diagram-element[data-element-id="unrelated-bug-element"] .diagram-element__image',
  )).toHaveAttribute('x', '320')
  await expect(page.getByText(/无法完成变换：/)).toHaveCount(0)
  await expect(page.getByTestId('diagram-canvas')).not.toHaveAttribute(
    'data-routing-pending',
    'true',
    { timeout: 15_000 },
  )
  await expect(page.locator('.connection-edge')).toHaveCount(1)
})

test('removes endpoint nodes when a dragged child line returns to its anchors', async ({ page }) => {
  const document = createDefaultProject('子线拖回锚点回归', [{
    key: 'chwp',
    name: 'CHWP',
    category: '冷却',
    source: 'src/assets/symbols/CHWP.svg',
    intrinsicWidth: 200,
    intrinsicHeight: 80,
    anchors: [
      {
        id: 'left-cold',
        name: '左侧冷水',
        x: 0,
        y: 40,
        direction: 'left',
        type: 'cooling-primary-cold',
      },
      {
        id: 'right-cold',
        name: '右侧冷水',
        x: 200,
        y: 40,
        direction: 'right',
        type: 'cooling-primary-cold',
      },
    ],
  }])
  const diagramId = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
  document.elements = [
    {
      id: 'source-element',
      diagramId,
      assetKey: 'chwp',
      name: 'CHWP-01',
      x: 160,
      y: 200,
      width: 200,
      height: 80,
      rotation: 0,
      properties: {},
      extensions: {},
    },
    {
      id: 'target-element',
      diagramId,
      assetKey: 'chwp',
      name: 'CHWP-02',
      x: 560,
      y: 200,
      width: 200,
      height: 80,
      rotation: 0,
      properties: {},
      extensions: {},
    },
  ]
  document.connections = [{
    id: 'anchor-merge-network',
    diagramId,
    type: 'cooling-primary-cold',
    nodes: [
      {
        id: 'source-anchor-node',
        kind: 'element-anchor',
        elementId: 'source-element',
        anchorId: 'right-cold',
      },
      {
        id: 'target-anchor-node',
        kind: 'element-anchor',
        elementId: 'target-element',
        anchorId: 'left-cold',
      },
    ],
    edges: [{
      id: 'anchor-merge-edge',
      sourceNodeId: 'source-anchor-node',
      targetNodeId: 'target-anchor-node',
    }],
  }]

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'child-line-anchor-merge.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await expect(page.getByText('已导入 child-line-anchor-merge.json')).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await page.locator('.connection-edge__hit:not(.connection-edge__hit--world)').click({ force: true })
  const horizontalSegment = page.locator(
    '.route-segment-handle[data-orientation="horizontal"]',
  )
  await expect(horizontalSegment).toHaveCount(1)

  const segmentCenter = async () => horizontalSegment.evaluate((line) => {
    const segment = line as SVGLineElement
    const matrix = segment.getScreenCTM()
    if (!matrix) throw new Error('无法读取子线段屏幕坐标')
    return {
      x: ((segment.x1.baseVal.value + segment.x2.baseVal.value) / 2) * matrix.a + matrix.e,
      y: ((segment.y1.baseVal.value + segment.y2.baseVal.value) / 2) * matrix.d + matrix.f,
    }
  })
  const initialCenter = await segmentCenter()
  await page.mouse.move(initialCenter.x, initialCenter.y)
  await page.mouse.down()
  await page.mouse.move(initialCenter.x, initialCenter.y + 64, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.connection-junction-handle')).toHaveCount(2)
  await expect(page.getByTestId('diagram-canvas')).not.toHaveAttribute(
    'data-routing-pending',
    'true',
    { timeout: 15_000 },
  )
  const edge = page.locator('.connection-edge[data-edge-id="anchor-merge-edge"]')
  await expect(edge.locator('.connection-edge__line')).toHaveAttribute(
    'd',
    'M 360 240 L 364 240 A 4 4 0 0 1 368 244 L 368 296 A 8 8 0 0 0 376 304 L 544 304 A 8 8 0 0 0 552 296 L 552 244 A 4 4 0 0 1 556 240 L 560 240',
  )

  const movedEdgeClick = await edge
    .locator('.connection-edge__hit:not(.connection-edge__hit--world)')
    .evaluate((path) => {
      const matrix = (path as SVGPathElement).getScreenCTM()
      if (!matrix) throw new Error('无法读取拖出后线路的屏幕坐标')
      return {
        x: 460 * matrix.a + matrix.e,
        y: 304 * matrix.d + matrix.f,
      }
    })
  await page.mouse.click(movedEdgeClick.x, movedEdgeClick.y)
  const movedHorizontalSegments = page.locator(
    '.route-segment-handle[data-orientation="horizontal"]',
  )
  const movedSegmentIndex = await movedHorizontalSegments.evaluateAll((segments) => (
    segments.findIndex((segment) => (
      Number(segment.getAttribute('y1')) === 304 &&
      Number(segment.getAttribute('y2')) === 304 &&
      Math.min(
        Number(segment.getAttribute('x1')),
        Number(segment.getAttribute('x2')),
      ) === 368 &&
      Math.max(
        Number(segment.getAttribute('x1')),
        Number(segment.getAttribute('x2')),
      ) === 552
    ))
  ))
  expect(movedSegmentIndex).toBeGreaterThanOrEqual(0)
  const movedSegmentDrag = await movedHorizontalSegments.nth(movedSegmentIndex).evaluate((line) => {
    const segment = line as SVGLineElement
    const matrix = segment.getScreenCTM()
    if (!matrix) throw new Error('无法读取拖出后子线段的屏幕坐标')
    const x = (segment.x1.baseVal.value + segment.x2.baseVal.value) / 2
    const y = segment.y1.baseVal.value
    return {
      start: { x: x * matrix.a + matrix.e, y: y * matrix.d + matrix.f },
      target: { x: x * matrix.a + matrix.e, y: 240 * matrix.d + matrix.f },
    }
  })
  await page.mouse.move(movedSegmentDrag.start.x, movedSegmentDrag.start.y)
  await page.mouse.down()
  await page.mouse.move(movedSegmentDrag.target.x, movedSegmentDrag.target.y, { steps: 4 })
  await page.mouse.up()

  await expect(page.locator('.connection-junction-handle')).toHaveCount(0)
  await expect(page.locator('.connection-edge')).toHaveCount(1)
})

test('removes a folded segment after it returns to an element anchor', async ({ page }) => {
  const document = createDefaultProject('锚点吸附折返线头回归', [{
    key: 'mp',
    name: 'MP',
    category: '冷却',
    source: 'src/assets/symbols/MP.svg',
    intrinsicWidth: 32,
    intrinsicHeight: 32,
    anchors: [{
      id: 'bottom',
      name: '下方',
      x: 16,
      y: 32,
      direction: 'bottom',
      type: 'cooling-general',
    }],
  }])
  const diagramId = document.lineSystems.find((line) => line.type === 'cooling')!.rootDiagramId
  document.diagrams.find((diagram) => diagram.id === diagramId)!.canvas.gridSize = 16
  document.elements = [
    {
      id: 'fold-source',
      diagramId,
      assetKey: 'mp',
      name: '源设备',
      x: 208,
      y: 208,
      width: 32,
      height: 32,
      rotation: 0,
      properties: {},
      extensions: {},
    },
    {
      id: 'fold-target',
      diagramId,
      assetKey: 'mp',
      name: '旁流旁滤设备',
      x: 608,
      y: 256,
      width: 32,
      height: 32,
      rotation: 90,
      properties: {},
      extensions: {},
    },
  ]
  document.connections = [{
    id: 'fold-network',
    diagramId,
    type: 'cooling-general',
    nodes: [
      {
        id: 'fold-source-anchor',
        kind: 'element-anchor',
        elementId: 'fold-source',
        anchorId: 'bottom',
      },
      {
        id: 'fold-target-anchor',
        kind: 'element-anchor',
        elementId: 'fold-target',
        anchorId: 'bottom',
      },
      { id: 'fold-left-node', kind: 'node', x: 224, y: 296 },
      { id: 'fold-overshoot-node', kind: 'node', x: 608, y: 296 },
      { id: 'fold-return-node', kind: 'node', x: 600, y: 296 },
    ],
    edges: [{
      id: 'fold-edge',
      sourceNodeId: 'fold-source-anchor',
      targetNodeId: 'fold-target-anchor',
      routeNodeIds: ['fold-left-node', 'fold-overshoot-node', 'fold-return-node'],
    }],
  }]

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'anchor-snap-fold.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await expect(page.getByText('已导入 anchor-snap-fold.json')).toBeVisible()

  const edge = page.locator('.connection-edge[data-edge-id="fold-edge"]')
  await expect(edge.locator('.connection-edge__line')).toHaveAttribute(
    'd',
    /L 608 296 L 600 296 L 600 276 A 4 4 0 0 1 604 272 L 608 272$/,
  )
  const edgeClick = await edge
    .locator('.connection-edge__hit:not(.connection-edge__hit--world)')
    .evaluate((path) => {
      const matrix = (path as SVGPathElement).getScreenCTM()
      if (!matrix) throw new Error('无法读取折返线路屏幕坐标')
      return {
        x: 400 * matrix.a + matrix.e,
        y: 296 * matrix.d + matrix.f,
      }
    })
  await page.mouse.click(edgeClick.x, edgeClick.y)
  const verticalSegments = page.locator(
    '.route-segment-handle[data-orientation="vertical"]',
  )
  const foldedSegmentIndex = await verticalSegments.evaluateAll((segments) => (
    segments.findIndex((segment) => (
      Number(segment.getAttribute('x1')) === 600 &&
      Number(segment.getAttribute('x2')) === 600 &&
      Math.min(
        Number(segment.getAttribute('y1')),
        Number(segment.getAttribute('y2')),
      ) === 272 &&
      Math.max(
        Number(segment.getAttribute('y1')),
        Number(segment.getAttribute('y2')),
      ) === 296
    ))
  ))
  expect(foldedSegmentIndex).toBeGreaterThanOrEqual(0)
  const foldedSegment = verticalSegments.nth(foldedSegmentIndex)
  const drag = await foldedSegment.evaluate((segment) => {
    const line = segment as SVGLineElement
    const matrix = line.getScreenCTM()
    if (!matrix) throw new Error('无法读取折返子线屏幕坐标')
    const centerX = line.x1.baseVal.value
    const centerY = (line.y1.baseVal.value + line.y2.baseVal.value) / 2
    return {
      start: {
        x: centerX * matrix.a + matrix.e,
        y: centerY * matrix.d + matrix.f,
      },
      end: {
        x: (centerX + 8) * matrix.a + matrix.e,
        y: centerY * matrix.d + matrix.f,
      },
    }
  })
  await page.mouse.move(drag.start.x, drag.start.y)
  await page.mouse.down()
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 4 })
  await page.mouse.up()

  await expect(page.getByTestId('diagram-canvas')).not.toHaveAttribute(
    'data-routing-pending',
    'true',
    { timeout: 15_000 },
  )
  await expect(edge.locator('.connection-edge__line')).toHaveAttribute('d', /L 608 272$/)
  await expect(edge.locator('.connection-edge__line')).not.toHaveAttribute('d', /296/)
  await expect(page.locator(
    '.connection-junction-handle[cx="608"][cy="272"]',
  )).toHaveCount(0)
  await expect(page.locator(
    '.connection-junction-handle[cx="608"][cy="296"]',
  )).toHaveCount(0)
  await expect(page.locator('.connection-junction-handle')).toHaveCount(0)
})

test('copies and cuts selected objects across compatible diagrams', async ({ page }) => {
  await page.goto('/')

  await page.getByTitle('拖动或双击插入CHWP').dblclick()
  const sourceElement = page.locator('.diagram-element[data-asset-key="chwp"]')
  await expect(sourceElement).toHaveCount(1)
  await sourceElement.locator('.diagram-element__image').click({ force: true })
  await page.keyboard.press('Control+c')

  const coolingTree = page.locator('.tree-line').filter({ hasText: '冷却线路' })
  await coolingTree.getByText('1 号楼', { exact: true }).click()
  await expect(page.getByRole('region', { name: '1 号楼编辑区' })).toBeVisible()
  await page.keyboard.press('Control+v')

  const copiedElement = page.locator('.diagram-element[data-asset-key="chwp"]')
  await expect(copiedElement).toHaveCount(1)
  await expect(copiedElement).toHaveAttribute('data-selected', 'true')
  const targetCanvasBox = await page.getByLabel('一次接线图编辑画布').boundingBox()
  const copiedImageBox = await copiedElement.locator('.diagram-element__image').boundingBox()
  if (!targetCanvasBox || !copiedImageBox) throw new Error('无法读取跨图纸粘贴位置')
  expect(copiedImageBox.x + copiedImageBox.width / 2).toBeCloseTo(
    targetCanvasBox.x + targetCanvasBox.width / 2,
    -1,
  )
  expect(copiedImageBox.y + copiedImageBox.height / 2).toBeCloseTo(
    targetCanvasBox.y + targetCanvasBox.height / 2,
    -1,
  )

  await page.keyboard.press('Control+x')
  await expect(copiedElement).toHaveCount(0)
  await coolingTree.getByText('园区总图', { exact: true }).click()
  await page.keyboard.press('Control+v')
  await expect(sourceElement).toHaveCount(2)
  await expect(page.locator('.diagram-element[data-selected="true"]')).toHaveCount(1)

  await page.keyboard.press('Control+c')
  const powerTree = page.locator('.tree-line').filter({ hasText: '电力线路' })
  await powerTree.getByText('园区总图', { exact: true }).click()
  await page.keyboard.press('Control+v')
  await expect(page.locator('.diagram-element')).toHaveCount(0)
  await expect(page.getByText('只能粘贴到相同线路系统的图纸。')).toBeVisible()
})

test('switches to monitor mode, locks editing, and exports the Switch state', async ({ page }) => {
  const offColor = defaultConnectionColor('cooling-secondary-cold')
  const onColor = defaultConnectionColor('cooling-primary-hot')
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')

  await page.getByTitle('拖动或双击插入Switch').dblclick()
  const element = page.locator('.diagram-element[data-asset-key="switch"]')
  await expect(element).toHaveCount(1)
  const image = element.locator('.diagram-element__image')
  await expect(image).toHaveAttribute('data-symbol-state', 'off')
  const stateToggle = page.getByRole('switch', { name: 'Switch 开关状态' })
  await expect(stateToggle).toHaveAttribute('aria-checked', 'false')

  const offColorInput = page.getByLabel('Switch 关状态颜色 HEX')
  const onColorInput = page.getByLabel('Switch 开状态颜色 HEX')
  await offColorInput.fill(offColor)
  await expect(image).toHaveAttribute('data-symbol-color', offColor)
  await offColorInput.press('Enter')
  await onColorInput.fill(onColor)
  await onColorInput.press('Enter')
  await expect(image).toHaveAttribute('data-symbol-color', offColor)

  await stateToggle.click()
  await expect(stateToggle).toHaveAttribute('aria-checked', 'true')
  await expect(image).toHaveAttribute('data-symbol-state', 'on')
  await expect(image).toHaveAttribute('data-symbol-color', onColor)

  await page.getByRole('tab', { name: '监控模式' }).click()
  await expect(page.getByLabel('一次接线图监控画布')).toBeVisible()
  await expect(page.locator('.symbol-section')).toHaveCount(0)
  await expect(page.locator('.properties-panel')).toHaveCount(0)
  await expect(page.getByLabel('项目名称')).toBeDisabled()

  await expect(image).toHaveAttribute('data-symbol-state', 'on')
  await image.click()
  await expect(image).toHaveAttribute('data-symbol-state', 'off')
  await expect(image).toHaveAttribute('data-symbol-color', offColor)

  await page.getByLabel('一次接线图监控画布').press('Delete')
  await expect(element).toHaveCount(1)

  await page.getByRole('button', { name: '播放流动' }).click()
  await expect(page.getByRole('button', { name: '暂停流动' })).toBeVisible()
  await expect(page.getByText('正在显示水泵闭合回路运行流向')).toBeVisible()

  await image.click()
  await expect(image).toHaveAttribute('data-symbol-state', 'on')
  const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  if (!downloadPath) throw new Error('无法读取导出的项目 JSON')
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'))
  const elementId = await element.getAttribute('data-element-id')
  expect(exported.schemaVersion).toBe(SCHEMA_VERSION)
  expect(exported.elements.find((candidate: { id: string }) => (
    candidate.id === elementId
  ))?.onOffState).toBe('on')
  expect(pageErrors).toEqual([])
})

test('previews numeric and text metrics in edit mode and refreshes them in monitor mode', async ({ page }) => {
  await page.goto('/')

  await page.getByTitle('拖动或双击插入CHWP').dblclick()
  const element = page.locator('.diagram-element[data-asset-key="chwp"]')
  await element.locator('.diagram-element__image').click({ force: true })
  await page.getByRole('switch', { name: '显示运行数据' }).click()
  await page.getByRole('button', { name: '添加' }).click()
  const numericMetricEditor = page.locator('.monitor-metric-editor__item').filter({ hasText: '指标 1' })
  await numericMetricEditor.locator('summary').click()
  await numericMetricEditor.getByLabel('单位').fill('kW')
  await numericMetricEditor.getByLabel('单位').press('Enter')
  await page.getByRole('button', { name: '添加' }).click()
  const textMetricEditor = page.locator('.monitor-metric-editor__item').filter({ hasText: '指标 2' })
  await textMetricEditor.locator('summary').click()
  await textMetricEditor.getByLabel('数据类型').selectOption('text')

  const editPreviewLabel = page.locator('.element-label').filter({ hasText: 'CHWP-01' })
  await expect(editPreviewLabel.locator('.element-metric-row')).toHaveCount(2)
  await expect(editPreviewLabel.locator('.element-metric-row__label').nth(0)).toHaveText('指标 1(kW)')
  await expect(editPreviewLabel.locator('.element-metric-row__value').nth(0)).toHaveText('50.0')
  await expect(editPreviewLabel.locator('.element-metric-row__label').nth(1)).toHaveText('指标 2')
  await expect(editPreviewLabel.locator('.element-metric-row__value').nth(1)).toHaveText('运行')

  await page.getByRole('switch', { name: '显示指标名称与单位' }).click()
  await expect(editPreviewLabel.locator('.element-metric-row__label')).toHaveCount(0)
  await expect(editPreviewLabel.locator('.element-metric-row__value')).toHaveCount(2)
  await expect(editPreviewLabel.locator('.element-metric-row__value').nth(0)).toHaveText('50.0')
  await expect(editPreviewLabel.locator('.element-metric-row__value').nth(1)).toHaveText('运行')

  await page.getByRole('tab', { name: '监控模式' }).click()
  const combinedLabel = page.locator('.element-label').filter({ hasText: 'CHWP-01' })
  await expect(combinedLabel).toHaveCount(1)
  await expect(combinedLabel.locator('.element-metric-row__label')).toHaveCount(0)
  await expect(combinedLabel.locator('.element-metric-row__value').nth(0)).toHaveText(/^\d+\.\d$/)
  await expect(combinedLabel.locator('.element-metric-row__value').nth(0))
    .toHaveAttribute('data-severity', /^(normal|minor|major|critical)$/)
  await expect(combinedLabel.locator('.element-metric-row__value').nth(1))
    .toHaveText(/^(运行|停机|离线)$/)
  await expect(combinedLabel.locator('.element-metric-row__value').nth(1))
    .toHaveAttribute('data-severity', /^(normal|minor|major|critical)$/)
  await expect(combinedLabel).not.toContainText('紧急')
  await expect(combinedLabel).not.toContainText('重要')
  await expect(combinedLabel).not.toContainText('次要')
})

test('loads the hybrid editor and completes the phase-one editing path', async ({ page }) => {
  await page.addInitScript(() => {
    const runtimeWindow = window as typeof window & {
      __gridUniformLog: Array<{ name: string; value: number }>
    }
    const uniformNames = new WeakMap<WebGLUniformLocation, string>()
    runtimeWindow.__gridUniformLog = []

    const observeContext = (Context: typeof WebGLRenderingContext | undefined) => {
      if (!Context) return
      const getUniformLocation = Context.prototype.getUniformLocation
      const uniform1f = Context.prototype.uniform1f

      Context.prototype.getUniformLocation = function (program, name) {
        const location = getUniformLocation.call(this, program, name)
        if (location) uniformNames.set(location, name)
        return location
      }
      Context.prototype.uniform1f = function (location, value) {
        const name = location ? uniformNames.get(location) : undefined
        if (name === 'uZoom' || name === 'uGrid') {
          runtimeWindow.__gridUniformLog.push({ name, value })
        }
        return uniform1f.call(this, location, value)
      }
    }

    observeContext(window.WebGLRenderingContext)
    observeContext(window.WebGL2RenderingContext as unknown as typeof WebGLRenderingContext)
  })

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')

  await expect(page.getByTestId('app-shell')).toBeVisible()
  await expect(page.getByLabel('一次接线图编辑画布')).toBeVisible()
  await expect(page.getByText('图纸层级')).toBeVisible()
  await expect(page.getByText('Switch', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Switch On', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Switch Off', { exact: true })).toHaveCount(0)
  await expect(page.locator('.grid-webgl canvas')).toHaveCount(1)
  await expect(page.getByTestId('editor-overlay')).toHaveCount(1)
  await expect(page.getByTestId('diagram-canvas')).toHaveAttribute('data-grid-presentation', 'dots')
  await expect(page.getByTestId('diagram-canvas')).toHaveAttribute('data-grid-size', '8')
  await expect(page.getByText('网格 8 px')).toBeVisible()

  const electricalSymbolGroup = page.locator('.symbol-group').filter({
    has: page.getByRole('heading', { name: '电力', exact: true }),
  })
  const lineToolBrowser = page.locator('.line-tool-browser')
  const libraryLayout = {
    electrical: await electricalSymbolGroup.boundingBox(),
    lineTools: await lineToolBrowser.boundingBox(),
  }
  if (!libraryLayout.electrical || !libraryLayout.lineTools) {
    throw new Error('无法读取素材分类布局')
  }
  expect(libraryLayout.electrical.y + libraryLayout.electrical.height)
    .toBeLessThanOrEqual(libraryLayout.lineTools.y)

  const treeRows = page.locator('.hierarchy-tree .tree-row')
  await expect(treeRows.first()).toBeVisible()
  expect(
    await treeRows.evaluateAll((rows) =>
      rows.every((row) => getComputedStyle(row).whiteSpace === 'nowrap'),
    ),
  ).toBe(true)

  const chwpMaterial = page.getByTitle('拖动或双击插入CHWP')
  await chwpMaterial.hover()
  const editChwpAnchors = page.getByRole('button', { name: '编辑 CHWP 锚点' })
  await expect(editChwpAnchors).toBeVisible()
  await editChwpAnchors.click()

  const anchorDialog = page.getByRole('dialog', { name: '接线锚点编辑器' })
  await expect(anchorDialog).toBeVisible()
  await expect(anchorDialog.getByTestId('anchor-editor-canvas')).toHaveAttribute('data-grid-size', '8')
  await expect(anchorDialog.getByTestId('anchor-editor-canvas')).toHaveAttribute('data-selected-asset', 'chwp')
  await anchorDialog.getByRole('button', { name: '在 8, 0 添加锚点' }).click()
  await expect(anchorDialog.getByLabel('锚点名称')).toHaveValue('通用 1')
  await anchorDialog.getByLabel('锚点名称').fill('主回水')
  await anchorDialog.getByLabel('锚点类型').selectOption('cooling-primary-hot')
  await expect(anchorDialog.getByLabel('锚点名称')).toHaveValue('主回水')
  await expect(anchorDialog.getByText(/1 个锚点/)).toBeVisible()
  await anchorDialog.getByRole('button', { name: '删除所选锚点' }).click()
  await expect(anchorDialog.getByText(/0 个锚点/)).toBeVisible()
  await anchorDialog.getByRole('button', { name: '撤销锚点修改' }).click()
  await expect(anchorDialog.getByText(/1 个锚点/)).toBeVisible()
  await anchorDialog.getByRole('button', { name: '关闭图元编辑器' }).click()
  await expect(anchorDialog).toBeHidden()

  const canvas = page.getByLabel('一次接线图编辑画布')
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('无法读取画布尺寸')

  const zoomReadout = page.getByRole('button', { name: '重置画布缩放' })
  await expect(zoomReadout).toHaveText('100%')
  const zoomIn = page.getByRole('button', { name: '放大画布' })
  for (let index = 0; index < 10; index += 1) await zoomIn.click()
  await expect(zoomReadout).toHaveText('400%')
  await expect.poll(() => page.evaluate(() => {
    const samples = (window as typeof window & {
      __gridUniformLog: Array<{ name: string; value: number }>
    }).__gridUniformLog
    return samples.filter((sample) => sample.name === 'uZoom').at(-1)?.value
  })).toBe(4)
  await expect(page.getByTestId('diagram-canvas')).toHaveAttribute('data-grid-screen-step', '32')
  await zoomReadout.click()
  await expect(zoomReadout).toHaveText('100%')

  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
  await page.mouse.wheel(0, 120)
  await expect(zoomReadout).not.toHaveText('100%')
  const zoomedGrid = await page.getByTestId('diagram-canvas').evaluate((stage) => ({
    zoom: Number(stage.dataset.gridZoom),
    tx: Number(stage.dataset.gridTranslationX),
    ty: Number(stage.dataset.gridTranslationY),
    density: Number(stage.dataset.gridDensity),
    visibleStep: Number(stage.dataset.gridVisibleStep),
    screenStep: Number(stage.dataset.gridScreenStep),
    dotRadius: Number(stage.dataset.gridScreenDotRadius),
  }))
  expect(zoomedGrid.density).toBe(2)
  expect(zoomedGrid.visibleStep).toBe(16)
  expect(zoomedGrid.screenStep).toBeCloseTo(16 * zoomedGrid.zoom, 8)
  expect(zoomedGrid.dotRadius).toBe(GRID_DOT_SCREEN_RADIUS)
  await expect.poll(() => page.evaluate(() => {
    const samples = (window as typeof window & {
      __gridUniformLog: Array<{ name: string; value: number }>
    }).__gridUniformLog
    const latest = (name: string) => samples.filter((sample) => sample.name === name).at(-1)?.value
    return { zoom: latest('uZoom'), grid: latest('uGrid') }
  })).toEqual({ zoom: zoomedGrid.zoom, grid: zoomedGrid.visibleStep })
  await expect(page.getByText('网格 16 px')).toBeVisible()
  await zoomReadout.click()
  await expect(zoomReadout).toHaveText('100%')
  await expect(page.getByTestId('diagram-canvas')).toHaveAttribute('data-grid-screen-step', '8')

  const overlayWorld = page.getByTestId('editor-overlay').locator(':scope > g')
  const transformBeforePan = await overlayWorld.getAttribute('transform')
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.7, canvasBox.y + canvasBox.height * 0.7)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.6, canvasBox.y + canvasBox.height * 0.6, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  await expect.poll(() => overlayWorld.getAttribute('transform')).not.toBe(transformBeforePan)

  await page.getByTitle('拖动或双击插入CHWP').dblclick()
  await expect(page.locator('.diagram-element')).toHaveCount(1)
  await expect(page.getByText('1 个图元')).toBeVisible()
  await expect(page.locator('.transform-controls')).toHaveCount(1)

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __symbolLibraryAlignmentCross: { width: number; height: number } | null
    }
    runtimeWindow.__symbolLibraryAlignmentCross = null
    const observer = new MutationObserver(() => {
      const cross = document.querySelector<SVGGElement>(
        '[data-testid="alignment-cross"][data-source="symbol-library"]',
      )
      if (cross) {
        runtimeWindow.__symbolLibraryAlignmentCross = {
          width: Number(cross.dataset.bandWidth),
          height: Number(cross.dataset.bandHeight),
        }
        observer.disconnect()
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
  await page
    .getByTitle('拖动或双击插入UPS')
    .dragTo(canvas, { targetPosition: { x: 140, y: 120 } })
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __symbolLibraryAlignmentCross: { width: number; height: number } | null
    }
  ).__symbolLibraryAlignmentCross)).toEqual({ width: 48, height: 48 })
  await expect(page.getByTestId('alignment-cross')).toHaveCount(0)
  await expect(page.locator('.diagram-element')).toHaveCount(2)
  await expect(page.locator('.element-label')).toHaveCount(2)
  await expect(page.locator('.element-label__text')).toHaveText(['CHWP-01', 'UPS-01'])
  await expect(page.getByText('2 个图元')).toBeVisible()

  const firstElement = page.locator('.diagram-element').first()
  const firstImage = firstElement.locator('.diagram-element__image')
  const firstElementId = await firstElement.getAttribute('data-element-id')
  if (!firstElementId) throw new Error('无法读取图元 ID')
  const firstLabel = page.locator(`.element-label[data-element-id="${firstElementId}"]`)
  await expect(firstElement.locator('image')).toHaveCount(1)
  await expect(firstElement.locator('rect, text')).toHaveCount(0)
  await firstElement.click()
  await expect(firstElement).toHaveAttribute('data-selected', 'true')
  await expect(firstLabel).toHaveAttribute('data-interactive', 'true')
  const initialLabelPlacement = await firstLabel.getAttribute('data-placement')
  const initialLabelBox = await firstLabel.locator('.element-label__hit').boundingBox()
  const labelTargetElementBox = await firstImage.boundingBox()
  if (!initialLabelBox || !labelTargetElementBox) throw new Error('无法读取图元标签位置')
  await page.mouse.move(
    initialLabelBox.x + initialLabelBox.width / 2,
    initialLabelBox.y + initialLabelBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    labelTargetElementBox.x - 24,
    labelTargetElementBox.y + labelTargetElementBox.height / 2,
    { steps: 4 },
  )
  await page.mouse.up()
  await expect(firstLabel).toHaveAttribute('data-placement', 'left')
  await expect(firstLabel).toHaveAttribute('data-selected', 'true')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(firstLabel).toHaveAttribute('data-placement', initialLabelPlacement ?? 'bottom')
  const initialTransform = await firstElement.getAttribute('transform')
  const firstBox = await firstElement.boundingBox()
  if (!firstBox) throw new Error('无法读取图元尺寸')
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
  await page.mouse.down()
  await expect(page.getByTestId('alignment-cross')).toHaveCount(0)
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 2, firstBox.y + firstBox.height / 2 + 2)
  await expect(page.getByTestId('alignment-cross')).toHaveCount(0)
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 42, firstBox.y + firstBox.height / 2 + 22, { steps: 4 })
  const alignmentCross = page.getByTestId('alignment-cross')
  await expect(alignmentCross).toHaveCount(1)
  await expect(alignmentCross).toHaveAttribute('data-target-count', '1')
  const movedBox = await firstImage.boundingBox()
  const verticalBandBox = await alignmentCross.locator('.alignment-cross__band--vertical').evaluate((band) => {
    const rect = band as SVGRectElement
    const matrix = rect.getScreenCTM()
    return matrix ? {
      x: rect.x.baseVal.value * matrix.a + matrix.e,
      y: rect.y.baseVal.value * matrix.d + matrix.f,
      width: rect.width.baseVal.value * matrix.a,
      height: rect.height.baseVal.value * matrix.d,
    } : null
  })
  const horizontalBandBox = await alignmentCross.locator('.alignment-cross__band--horizontal').evaluate((band) => {
    const rect = band as SVGRectElement
    const matrix = rect.getScreenCTM()
    return matrix ? {
      x: rect.x.baseVal.value * matrix.a + matrix.e,
      y: rect.y.baseVal.value * matrix.d + matrix.f,
      width: rect.width.baseVal.value * matrix.a,
      height: rect.height.baseVal.value * matrix.d,
    } : null
  })
  if (!movedBox || !verticalBandBox || !horizontalBandBox) {
    throw new Error('无法读取拖动对齐区域')
  }
  expect(verticalBandBox.width).toBeCloseTo(movedBox.width, 1)
  expect(verticalBandBox.height).toBeCloseTo(canvasBox.height, 1)
  expect(horizontalBandBox.width).toBeCloseTo(canvasBox.width, 1)
  expect(horizontalBandBox.height).toBeCloseTo(movedBox.height, 1)
  expect(verticalBandBox.x + verticalBandBox.width / 2).toBeCloseTo(
    movedBox.x + movedBox.width / 2,
    1,
  )
  expect(horizontalBandBox.y + horizontalBandBox.height / 2).toBeCloseTo(
    movedBox.y + movedBox.height / 2,
    1,
  )
  await page.mouse.up()
  await expect(alignmentCross).toHaveCount(0)
  await expect.poll(() => firstElement.getAttribute('transform')).not.toBe(initialTransform)
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled()
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => firstElement.getAttribute('transform')).toBe(initialTransform)

  await expect(firstImage).toHaveAttribute('width', '200')
  await expect(firstImage).toHaveAttribute('height', '80')
  const initialWidth = await firstImage.getAttribute('width')
  const resizeHandle = page.locator('.transform-handle--resize')
  const resizeBox = await resizeHandle.boundingBox()
  if (!resizeBox) throw new Error('无法读取缩放控制柄')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 32, resizeBox.y + resizeBox.height / 2 + 22, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => firstImage.getAttribute('width')).not.toBe(initialWidth)
  const resizedSize = await firstImage.evaluate((image) => ({
    width: Number(image.getAttribute('width')),
    height: Number(image.getAttribute('height')),
  }))
  expect(resizedSize.width % 8).toBe(0)
  expect(resizedSize.height % 8).toBe(0)
  expect(resizedSize.width / resizedSize.height).toBe(2.5)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => firstImage.getAttribute('width')).toBe(initialWidth)

  const rotateHandle = page.locator('.transform-handle--rotate')
  const labelPlacementBeforeRotation = await firstLabel.getAttribute('data-placement')
  const rotateBox = await rotateHandle.boundingBox()
  if (!rotateBox) throw new Error('无法读取旋转控制柄')
  await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rotateBox.x + rotateBox.width / 2 + 40, rotateBox.y + rotateBox.height / 2 + 32, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => firstElement.getAttribute('transform')).toContain('rotate(90 ')
  await expect(firstLabel).toHaveAttribute('data-placement', labelPlacementBeforeRotation ?? 'bottom')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => firstElement.getAttribute('transform')).toBe(initialTransform)

  const secondElement = page.locator('.diagram-element').last()
  await secondElement.click({ modifiers: ['Shift'] })
  await expect(page.locator('.diagram-element[data-selected="true"]')).toHaveCount(2)
  await expect(page.locator('.element-label[data-interactive="true"]')).toHaveCount(0)
  await expect(page.locator('.selection-member')).toHaveCount(2)
  await expect(page.locator('.transform-controls')).toHaveAttribute('data-selection-count', '2')

  const multiMoveStart = await firstElement.boundingBox()
  if (!multiMoveStart) throw new Error('无法读取多选拖动起点')
  await page.mouse.move(
    multiMoveStart.x + multiMoveStart.width / 2,
    multiMoveStart.y + multiMoveStart.height / 2,
  )
  await page.mouse.down()
  await expect(page.getByTestId('alignment-cross')).toHaveCount(0)
  await page.mouse.move(
    multiMoveStart.x + multiMoveStart.width / 2 + 18,
    multiMoveStart.y + multiMoveStart.height / 2 + 18,
    { steps: 3 },
  )
  await expect(page.getByTestId('alignment-cross')).toHaveAttribute('data-target-count', '2')
  await expect(page.getByTestId('alignment-cross').locator('.alignment-cross__surface')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.getByTestId('alignment-cross')).toHaveCount(0)

  const multiResizeHandle = page.locator('.transform-handle--resize')
  const multiResizeBox = await multiResizeHandle.boundingBox()
  if (!multiResizeBox) throw new Error('无法读取多选缩放控制柄')
  const multiWidthsBefore = await page.locator('.diagram-element__image').evaluateAll((images) => (
    images.map((image) => Number(image.getAttribute('width')))
  ))
  await page.mouse.move(
    multiResizeBox.x + multiResizeBox.width / 2,
    multiResizeBox.y + multiResizeBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    multiResizeBox.x + multiResizeBox.width / 2 + 64,
    multiResizeBox.y + multiResizeBox.height / 2 + 48,
    { steps: 5 },
  )
  await page.mouse.up()
  const multiWidthsAfter = await page.locator('.diagram-element__image').evaluateAll((images) => (
    images.map((image) => Number(image.getAttribute('width')))
  ))
  expect(multiWidthsAfter.every((width, index) => width !== multiWidthsBefore[index])).toBe(true)
  expect(multiWidthsAfter.every((width) => width % 8 === 0)).toBe(true)

  const multiRotateHandle = page.locator('.transform-handle--rotate')
  const multiRotateBox = await multiRotateHandle.boundingBox()
  if (!multiRotateBox) throw new Error('无法读取多选旋转控制柄')
  await page.mouse.move(
    multiRotateBox.x + multiRotateBox.width / 2,
    multiRotateBox.y + multiRotateBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    multiRotateBox.x + multiRotateBox.width / 2 + 80,
    multiRotateBox.y + multiRotateBox.height / 2 + 80,
    { steps: 5 },
  )
  await page.mouse.up()
  const multiGeometry = await page.locator('.diagram-element').evaluateAll((nodes) => nodes.map((node) => {
    const image = node.querySelector('image')
    return {
      x: Number(image?.getAttribute('x')),
      y: Number(image?.getAttribute('y')),
      rotation: Number(node.getAttribute('transform')?.match(/rotate\(([-\d.]+)/)?.[1]),
    }
  }))
  expect(multiGeometry.every(({ x, y, rotation }) => (
    x % 8 === 0 && y % 8 === 0 && rotation % 90 === 0
  ))).toBe(true)

  const elementBoxes = await page.locator('.diagram-element').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
    }),
  )
  const selectionBounds = elementBoxes.reduce(
    (bounds, box) => ({
      left: Math.min(bounds.left, box.left),
      top: Math.min(bounds.top, box.top),
      right: Math.max(bounds.right, box.right),
      bottom: Math.max(bounds.bottom, box.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  )
  await page.mouse.move(selectionBounds.left - 8, selectionBounds.top - 8)
  await page.mouse.down()
  await page.mouse.move(selectionBounds.right + 8, selectionBounds.bottom + 8, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.diagram-element[data-selected="true"]')).toHaveCount(2)

  await page.keyboard.press('Control+d')
  await expect(page.locator('.diagram-element')).toHaveCount(4)
  await expect(page.locator('.diagram-element[data-selected="true"]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(page.locator('.diagram-element[data-selected="true"]')).toHaveCount(0)
  await expect(page.locator('.transform-controls')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.diagram-element')).toHaveCount(2)
  await page.keyboard.press('Control+a')

  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.diagram-element')).toHaveCount(4)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.diagram-element')).toHaveCount(2)

  await page
    .getByTitle('拖动或双击插入CHWP')
    .dragTo(canvas, { targetPosition: { x: canvasBox.width - 180, y: 180 } })
  const chwpElements = page.locator('.diagram-element[data-asset-key="chwp"]')
  await expect(chwpElements).toHaveCount(2)
  const sourceConnectionAnchor = chwpElements.first().locator('.connection-anchor')
  const targetConnectionAnchor = chwpElements.last().locator('.connection-anchor')
  await chwpElements.first().hover()
  await expect(sourceConnectionAnchor).toHaveCSS('opacity', '1')
  await sourceConnectionAnchor.click()
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)
  await expect(page.getByText(/正在接线 · 一次回路热/)).toBeVisible()
  await expect(targetConnectionAnchor).toHaveCSS('opacity', '1')
  await targetConnectionAnchor.click()
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.getByTestId('connection-preview')).toHaveCount(0)
  await expect(page.getByText(/1 个线路网络/)).toBeVisible()

  await chwpElements.first().locator('.diagram-element__image').click({ force: true })
  await chwpElements.last().locator('.diagram-element__image').click({
    force: true,
    modifiers: ['Control'],
  })
  await expect(page.locator('.diagram-element[data-asset-key="chwp"][data-selected="true"]'))
    .toHaveCount(2)

  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(chwpElements).toHaveCount(4)
  await expect(page.getByText(/2 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(chwpElements).toHaveCount(2)
  await expect(page.getByText(/1 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  await chwpElements.first().locator('.diagram-element__image').click({ force: true })
  await chwpElements.last().locator('.diagram-element__image').click({
    force: true,
    modifiers: ['Control'],
  })
  await page.keyboard.press('Control+d')
  await expect(chwpElements).toHaveCount(4)
  await expect(page.getByText(/2 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(chwpElements).toHaveCount(2)
  await expect(page.getByText(/1 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  await page
    .getByTitle('拖动或双击插入CHWP')
    .dragTo(canvas, { targetPosition: { x: canvasBox.width - 180, y: canvasBox.height - 160 } })
  await expect(chwpElements).toHaveCount(3)

  await chwpElements.first().hover()
  await expect(sourceConnectionAnchor).toHaveCSS('opacity', '1')
  await sourceConnectionAnchor.click()
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)
  await expect(page.getByTestId('connection-branch-candidate')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('connection-preview')).toHaveCount(0)
  await sourceConnectionAnchor.click()
  const repeatedTargetAnchor = chwpElements.last().locator('.connection-anchor')
  await expect(repeatedTargetAnchor).toHaveCSS('opacity', '1')
  await repeatedTargetAnchor.click()
  await expect(page.locator('.connection-edge')).toHaveCount(2)
  await expect(page.locator('.connection-junction')).toHaveCount(0)
  await expect(page.getByTestId('connection-branch-candidate')).toHaveCount(0)

  const uniqueBranchPoint = await page
    .locator('.connection-edge__hit:not(.connection-edge__hit--world)')
    .last()
    .evaluate((node) => {
      const path = node as SVGPathElement
      const point = path.getPointAtLength(Math.max(0, path.getTotalLength() - 20))
      const matrix = path.getScreenCTM()
      if (!matrix) throw new Error('无法读取独立支路屏幕坐标')
      return {
        x: point.x * matrix.a + point.y * matrix.c + matrix.e,
        y: point.x * matrix.b + point.y * matrix.d + matrix.f,
      }
    })
  await page.mouse.click(uniqueBranchPoint.x, uniqueBranchPoint.y)
  await expect(page.locator('.connection-edge[data-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.connection-edge')).toHaveCount(2)

  await page.getByText('1 号楼', { exact: true }).first().click()
  await expect(page.getByRole('region', { name: '1 号楼编辑区' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回上一级' })).toBeEnabled()

  await page.getByTitle('拖动或双击插入Switch').dblclick()
  const switchElement = page.locator('.diagram-element').first()
  const switchImage = switchElement.locator('.diagram-element__image')
  await expect(switchImage).toHaveAttribute('data-symbol-state', 'off')
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#777777')
  const symbolHex = page.getByLabel('Switch 关状态颜色 HEX')
  await symbolHex.fill('#77B4BF')
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#77B4BF')
  await symbolHex.press('Enter')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#777777')
  await page.getByRole('button', { name: '重做' }).click()
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#77B4BF')

  await page.keyboard.press('Control+s')
  await expect(page.getByText('项目已保存到当前浏览器')).toBeVisible()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()

  expect(pageErrors).toEqual([])
})

test('keeps real-scene connected moves clear of full-route main-thread blocking', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles('scene-archives/WuHu AIDC 0814.json')
  await expect(page.getByText('已导入 WuHu AIDC 0814.json')).toBeVisible()

  const powerTree = page.locator('.tree-line').filter({ hasText: '电力线路' })
  await powerTree.getByText('1 号楼', { exact: true }).click()

  const stage = page.getByTestId('diagram-canvas')
  await expect(stage).not.toHaveAttribute('data-routing-pending', 'true', { timeout: 15_000 })
  await expect.poll(
    () => page.locator('.connection-edge').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(1)

  const connectionHits = page.locator(
    '.connection-edge__hit:not(.connection-edge__hit--world)',
  )
  const visibleConnections = await connectionHits.evaluateAll((nodes) => nodes.flatMap((node, index) => {
    const rect = node.getBoundingClientRect()
    const networkId = (node.parentElement as SVGGElement | null)?.dataset.networkId ?? ''
    const visible = rect.right >= 0 && rect.bottom >= 0 &&
      rect.left <= window.innerWidth && rect.top <= window.innerHeight
    return visible ? [{ index, networkId }] : []
  }))
  const firstVisibleConnection = visibleConnections[0]
  const secondVisibleConnection = visibleConnections.find((candidate) => (
    candidate.networkId !== firstVisibleConnection?.networkId
  ))
  if (!firstVisibleConnection || !secondVisibleConnection) {
    throw new Error('真实归档可视区域缺少两个可用于多选的线路网络')
  }
  await connectionHits.nth(firstVisibleConnection.index).dispatchEvent('pointerdown', {
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
  })
  const firstSelectionCount = await page.locator('.connection-edge[data-selected="true"]').count()
  await connectionHits.nth(secondVisibleConnection.index).dispatchEvent('pointerdown', {
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 2,
    shiftKey: true,
  })
  await expect.poll(() => page.locator('.connection-edge[data-selected="true"]').count())
    .toBeGreaterThan(firstSelectionCount)

  await expect(page.getByLabel('子线颜色 HEX')).toBeVisible()

  const selectedEdgeColorsBefore = await page
    .locator('.connection-edge[data-selected="true"]')
    .evaluateAll((nodes) => nodes.map((node) => (
      (node as SVGGElement).style.getPropertyValue('--connection-color')
    )))
  const replacementColor = defaultConnectionColor('cooling-secondary-cold')
  await page.getByLabel('子线颜色 HEX').fill(replacementColor)
  expect(await page.locator('.connection-edge[data-selected="true"]').evaluateAll((nodes, expected) => (
    nodes.every((node) => (
      (node as SVGGElement).style.getPropertyValue('--connection-color') === expected
    ))
  ), replacementColor)).toBe(true)
  await page.getByLabel('子线颜色 HEX').press('Enter')
  await page.getByRole('button', { name: '撤销' }).click()
  expect(await page.locator('.connection-edge[data-selected="true"]').evaluateAll((nodes) => (
    nodes.map((node) => (
      (node as SVGGElement).style.getPropertyValue('--connection-color')
    ))
  ))).toEqual(selectedEdgeColorsBefore)
  await page.getByLabel('一次接线图编辑画布').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.connection-edge[data-selected="true"]')).toHaveCount(0)

  const interactiveConnectedElementId = await page.locator('.diagram-element').evaluateAll(
    (nodes, connectedIds) => nodes.flatMap((node) => {
      const elementId = (node as SVGGElement).dataset.elementId ?? ''
      if (!connectedIds.includes(elementId)) return []
      const rect = node.getBoundingClientRect()
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const target = document.elementFromPoint(center.x, center.y)
      return target?.closest('.diagram-element') === node ? [elementId] : []
    })[0] ?? null,
    CONNECTED_REAL_SCENE_ELEMENT_IDS,
  )
  if (!interactiveConnectedElementId) {
    throw new Error('真实归档可视区域缺少可拖动的已接线图元')
  }
  const connectedElement = page.locator(
    `.diagram-element[data-element-id="${interactiveConnectedElementId}"] .diagram-element__image`,
  )

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __routingLongTasks: Array<{ start: number; duration: number }>
      __routingMarks: Record<string, number>
    }
    runtimeWindow.__routingLongTasks = []
    runtimeWindow.__routingMarks = { start: performance.now() }
    new PerformanceObserver((entries) => {
      runtimeWindow.__routingLongTasks.push(...entries.getEntries().map((entry) => ({
        start: entry.startTime,
        duration: entry.duration,
      })))
    }).observe({ type: 'longtask', buffered: false })
  })

  const box = await connectedElement.boundingBox()
  if (!box) throw new Error('无法读取真实归档中已接线图元的位置')
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.evaluate(() => {
    (window as typeof window & { __routingMarks: Record<string, number> })
      .__routingMarks.afterDown = performance.now()
  })
  await page.mouse.move(center.x + 16, center.y, { steps: 2 })
  await page.evaluate(() => {
    (window as typeof window & { __routingMarks: Record<string, number> })
      .__routingMarks.afterMove = performance.now()
  })
  await page.mouse.up()
  await page.evaluate(() => {
    (window as typeof window & { __routingMarks: Record<string, number> })
      .__routingMarks.afterUp = performance.now()
  })

  await expect(stage).not.toHaveAttribute('data-routing-pending', 'true', { timeout: 15_000 })
  await page.waitForTimeout(50)
  const metrics = await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __routingLongTasks: Array<{ start: number; duration: number }>
      __routingMarks: Record<string, number>
    }
    return { tasks: runtimeWindow.__routingLongTasks, marks: runtimeWindow.__routingMarks }
  })
  console.info(`REAL_SCENE_ROUTING_METRICS=${JSON.stringify(metrics)}`)
  expect(Math.max(0, ...metrics.tasks.map((task) => task.duration))).toBeLessThan(120)
  expect(metrics.marks.afterUp - metrics.marks.start).toBeLessThan(300)
})

test('creates, connects, edits, and deletes an electrical busbar', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')

  const powerTree = page.locator('.tree-line').filter({ hasText: '电力线路' })
  await powerTree.locator('.tree-row').first().click()
  await expect(page.getByTitle('拖动或双击插入母线')).toBeEnabled()

  await page.getByTitle('拖动或双击插入Grid').hover()
  await page.getByRole('button', { name: '编辑 Grid 锚点' }).click()
  const anchorDialog = page.getByRole('dialog', { name: '接线锚点编辑器' })
  await anchorDialog.getByRole('button', { name: '在 8, 0 添加锚点' }).click()
  await expect(anchorDialog.getByLabel('锚点类型')).toHaveValue('electrical')
  await anchorDialog.getByRole('button', { name: '关闭图元编辑器' }).click()

  const canvas = page.getByLabel('一次接线图编辑画布')
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('无法读取母线测试画布尺寸')
  await page.getByTitle('拖动或双击插入Grid').dragTo(canvas, {
    targetPosition: { x: 150, y: 150 },
  })
  await page.getByTitle('拖动或双击插入母线').dragTo(canvas, {
    targetPosition: { x: Math.min(canvasBox.width - 190, 430), y: 280 },
  })

  await expect(page.locator('.diagram-element[data-asset-key="grid"]')).toHaveCount(1)
  await expect(page.locator('.busbar')).toHaveCount(1)
  await expect(page.getByText(/1 条母线/)).toBeVisible()

  const sourceElement = page.locator('.diagram-element[data-asset-key="grid"]')
  await sourceElement.hover()
  await sourceElement.locator('.connection-anchor').click()
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)

  const busbarHit = page.locator('.busbar__hit')
  const busbarMidpoint = await busbarHit.evaluate((node) => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() / 2)
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('无法读取母线屏幕坐标')
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    }
  })
  await page.mouse.move(busbarMidpoint.x, busbarMidpoint.y)
  await expect(page.getByTestId('busbar-tap-candidate')).toHaveCount(1)
  await page.getByTestId('busbar-tap-candidate').click()
  await expect(page.locator('.busbar-tap')).toHaveCount(1)
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  const mixedElementBox = await sourceElement.boundingBox()
  const mixedBusbarBox = await busbarHit.boundingBox()
  if (!mixedElementBox || !mixedBusbarBox) throw new Error('无法读取混合框选对象边界')
  const mixedBounds = {
    left: Math.min(mixedElementBox.x, mixedBusbarBox.x),
    top: Math.min(mixedElementBox.y, mixedBusbarBox.y),
    right: Math.max(
      mixedElementBox.x + mixedElementBox.width,
      mixedBusbarBox.x + mixedBusbarBox.width,
    ),
    bottom: Math.max(
      mixedElementBox.y + mixedElementBox.height,
      mixedBusbarBox.y + mixedBusbarBox.height,
    ),
  }
  await page.mouse.move(mixedBounds.left - 12, mixedBounds.top - 12)
  await page.mouse.down()
  await page.mouse.move(mixedBounds.right + 12, mixedBounds.bottom + 12, { steps: 6 })
  await page.mouse.up()
  await expect(sourceElement).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.busbar')).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.transform-controls')).toHaveAttribute('data-selection-count', '2')
  await expect(page.locator('.transform-controls')).toHaveAttribute('data-selection-has-busbar', 'true')
  await expect(page.locator('.selection-member')).toHaveCount(1)
  await expect(page.locator('.transform-handle--resize')).toHaveCount(0)
  await expect(page.locator('.busbar-controls')).toHaveCount(0)

  const mixedElementX = await sourceElement.locator('image').getAttribute('x')
  const mixedBusbarPath = await busbarHit.getAttribute('d')
  const mixedElementXValue = Number(mixedElementX)
  const mixedBusbarStartX = await busbarHit.evaluate((node) => (
    (node as SVGPathElement).getPointAtLength(0).x
  ))
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => sourceElement.locator('image').getAttribute('x'))
    .toBe(String(mixedElementXValue + 24))
  await expect.poll(() => busbarHit.evaluate((node) => (
    (node as SVGPathElement).getPointAtLength(0).x
  ))).toBe(mixedBusbarStartX + 24)
  await page.waitForTimeout(160)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => sourceElement.locator('image').getAttribute('x')).toBe(mixedElementX)
  await expect.poll(() => busbarHit.getAttribute('d')).toBe(mixedBusbarPath)

  await page.mouse.move(
    mixedElementBox.x + mixedElementBox.width / 2,
    mixedElementBox.y + mixedElementBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    mixedElementBox.x + mixedElementBox.width / 2 + 20,
    mixedElementBox.y + mixedElementBox.height / 2 + 20,
    { steps: 4 },
  )
  await page.mouse.up()
  await expect.poll(() => sourceElement.locator('image').getAttribute('x')).not.toBe(mixedElementX)
  await expect.poll(() => busbarHit.getAttribute('d')).not.toBe(mixedBusbarPath)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => sourceElement.locator('image').getAttribute('x')).toBe(mixedElementX)
  await expect.poll(() => busbarHit.getAttribute('d')).toBe(mixedBusbarPath)

  const mixedRotateHandle = page.locator('.transform-handle--rotate')
  const mixedRotateBox = await mixedRotateHandle.boundingBox()
  const mixedOutlineBox = await page.locator('.transform-controls__outline').boundingBox()
  if (!mixedRotateBox || !mixedOutlineBox) throw new Error('无法读取混合选择旋转控制柄')
  await page.mouse.move(
    mixedRotateBox.x + mixedRotateBox.width / 2,
    mixedRotateBox.y + mixedRotateBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    mixedOutlineBox.x + mixedOutlineBox.width + 32,
    mixedOutlineBox.y + mixedOutlineBox.height / 2,
    { steps: 5 },
  )
  await page.mouse.up()
  await expect.poll(() => sourceElement.getAttribute('transform')).toContain('rotate(90 ')
  await expect(page.locator('.busbar')).toHaveAttribute('data-orientation', 'vertical')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.busbar')).toHaveAttribute('data-orientation', 'horizontal')
  await page.mouse.click(canvasBox.x + canvasBox.width - 180, canvasBox.y + 24)

  const busbarQuarterPoint = await busbarHit.evaluate((node) => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() / 4)
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('无法读取母线选择坐标')
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    }
  })
  await page.mouse.click(busbarQuarterPoint.x, busbarQuarterPoint.y)
  await expect(page.locator('.busbar')).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.busbar-controls')).toHaveCount(1)
  const busbarHex = page.getByLabel('母线颜色 HEX')
  await expect(busbarHex).toHaveValue('#D5B96F')
  await busbarHex.fill('#77B4BF')
  await expect.poll(() => page.locator('.busbar-tap').evaluate((node) => (
    (node as SVGCircleElement).style.getPropertyValue('--busbar-color')
  ))).toBe('#77B4BF')
  await busbarHex.press('Enter')
  await expect.poll(() => page.locator('.busbar').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--busbar-color')
  ))).toBe('#77B4BF')
  await expect.poll(() => page.locator('.busbar-tap').evaluate((node) => (
    (node as SVGCircleElement).style.getPropertyValue('--busbar-color')
  ))).toBe('#77B4BF')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => page.locator('.busbar').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--busbar-color')
  ))).toBe('')
  await expect.poll(() => page.locator('.busbar-tap').evaluate((node) => (
    (node as SVGCircleElement).style.getPropertyValue('--busbar-color')
  ))).toBe('')
  await page.getByRole('button', { name: '重做' }).click()
  await expect.poll(() => page.locator('.busbar').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--busbar-color')
  ))).toBe('#77B4BF')
  await page.mouse.click(busbarQuarterPoint.x, busbarQuarterPoint.y)

  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.busbar')).toHaveCount(2)
  expect(await page.locator('.busbar').evaluateAll((nodes) => nodes.every((node) => (
    (node as SVGGElement).style.getPropertyValue('--busbar-color') === '#77B4BF'
  )))).toBe(true)
  await expect(page.locator('.busbar[data-selected="true"]')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  await page.keyboard.press('Control+d')
  await expect(page.locator('.busbar')).toHaveCount(3)
  await expect(page.locator('.busbar[data-selected="true"]')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.busbar')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.busbar')).toHaveCount(1)
  await page.mouse.click(busbarQuarterPoint.x, busbarQuarterPoint.y)
  await expect(page.locator('.busbar')).toHaveAttribute('data-selected', 'true')

  await sourceElement.locator('.diagram-element__image').click({
    force: true,
    modifiers: ['Control'],
  })
  await expect(sourceElement).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.busbar')).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.diagram-element[data-asset-key="grid"]')).toHaveCount(2)
  await expect(page.locator('.busbar')).toHaveCount(2)
  await expect(page.locator('.busbar-tap')).toHaveCount(2)
  await expect(page.getByText(/2 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.diagram-element[data-asset-key="grid"]')).toHaveCount(1)
  await expect(page.locator('.busbar')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)
  await expect(page.getByText(/1 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(1)

  await page.mouse.click(busbarQuarterPoint.x, busbarQuarterPoint.y)
  await sourceElement.locator('.diagram-element__image').click({
    force: true,
    modifiers: ['Control'],
  })
  await page.keyboard.press('Control+d')
  await expect(page.locator('.diagram-element[data-asset-key="grid"]')).toHaveCount(2)
  await expect(page.locator('.busbar')).toHaveCount(2)
  await expect(page.locator('.busbar-tap')).toHaveCount(2)
  await expect(page.getByText(/2 个线路网络/)).toBeVisible()
  await expect(page.locator('.connection-edge')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.diagram-element[data-asset-key="grid"]')).toHaveCount(1)
  await expect(page.locator('.busbar')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)
  await page.mouse.click(busbarQuarterPoint.x, busbarQuarterPoint.y)
  await expect(page.locator('.busbar')).toHaveAttribute('data-selected', 'true')

  const endHandle = page.locator('.busbar-handle--end')
  const endHandleBox = await endHandle.boundingBox()
  if (!endHandleBox) throw new Error('无法读取母线长度控制柄')
  await page.mouse.move(
    endHandleBox.x + endHandleBox.width / 2,
    endHandleBox.y + endHandleBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(endHandleBox.x - 180, endHandleBox.y + endHandleBox.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => busbarHit.evaluate((node) => (
    (node as SVGPathElement).getTotalLength()
  ))).toBe(8)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)
  await expect.poll(() => page.locator('.busbar-tap').getAttribute('data-busbar-offset'))
    .toMatch(/^(0|8)$/)

  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => busbarHit.evaluate((node) => (
    (node as SVGPathElement).getTotalLength()
  ))).toBe(160)
  await page.getByRole('button', { name: '重做' }).click()
  await expect.poll(() => busbarHit.evaluate((node) => (
    (node as SVGPathElement).getTotalLength()
  ))).toBe(8)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)

  const rotateHandle = page.locator('.busbar-handle--rotate')
  const rotateBox = await rotateHandle.boundingBox()
  if (!rotateBox) throw new Error('无法读取母线旋转控制柄')
  await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    rotateBox.x + rotateBox.width / 2 + 32,
    rotateBox.y + rotateBox.height / 2 + 32,
    { steps: 4 },
  )
  await page.mouse.up()
  await expect(page.locator('.busbar')).toHaveAttribute('data-orientation', 'vertical')

  await page.getByRole('button', { name: '删除所选对象' }).click()
  await expect(page.locator('.busbar')).toHaveCount(0)
  await expect(page.locator('.connection-edge')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.busbar')).toHaveCount(1)
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(1)

  expect(pageErrors).toEqual([])
})

test('connects two selected busbars with an ordinary child line', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')

  const powerTree = page.locator('.tree-line').filter({ hasText: '电力线路' })
  await powerTree.locator('.tree-row').first().click()
  const canvas = page.getByLabel('一次接线图编辑画布')
  await page.getByTitle('拖动或双击插入母线').dragTo(canvas, {
    targetPosition: { x: 280, y: 220 },
  })
  await page.getByTitle('拖动或双击插入母线').dragTo(canvas, {
    targetPosition: { x: 280, y: 360 },
  })
  await expect(page.locator('.busbar')).toHaveCount(2)

  const screenMidpoint = async (locator: Locator) => locator.evaluate((node) => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() / 2)
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('无法读取母线屏幕坐标')
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    }
  })

  const firstHit = page.locator('.busbar__hit').nth(0)
  const secondHit = page.locator('.busbar__hit').nth(1)
  const firstMidpoint = await screenMidpoint(firstHit)
  await page.mouse.click(firstMidpoint.x, firstMidpoint.y)
  await expect(page.locator('.busbar').nth(0)).toHaveAttribute('data-selected', 'true')
  await page.mouse.move(firstMidpoint.x + 16, firstMidpoint.y + 16)
  await page.mouse.move(firstMidpoint.x, firstMidpoint.y)
  const sourceCandidate = page.getByTestId('busbar-tap-candidate')
  await expect(sourceCandidate).toHaveAttribute('data-mode', 'source')
  await sourceCandidate.click()
  await expect(page.getByTestId('connection-preview')).toHaveCount(1)

  const secondMidpoint = await screenMidpoint(secondHit)
  await page.mouse.move(secondMidpoint.x, secondMidpoint.y)
  const targetCandidate = page.getByTestId('busbar-tap-candidate')
  await expect(targetCandidate).toHaveAttribute('data-mode', 'target')
  await targetCandidate.click()

  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(2)
  const tapCoordinates = await page.locator('.busbar-tap').evaluateAll((nodes) => nodes.map((node) => ({
    x: Number(node.getAttribute('cx')),
    y: Number(node.getAttribute('cy')),
  })))
  expect(tapCoordinates[0].x).toBe(tapCoordinates[1].x)
  expect(tapCoordinates[0].y).not.toBe(tapCoordinates[1].y)

  await page.locator('.connection-edge__hit:not(.connection-edge__hit--world)').click({ force: true })
  await expect(page.locator('.connection-edge')).toHaveAttribute('data-selected', 'true')
  const childLineLabelInput = page.getByLabel('子线标签', { exact: true })
  await expect(childLineLabelInput).toHaveValue('')
  await childLineLabelInput.fill('联络线 01')
  await childLineLabelInput.press('Enter')
  const childLineLabel = page.locator('.connection-label')
  await expect(childLineLabel).toHaveCount(1)
  await expect(childLineLabel).toHaveText('联络线 01')
  await expect(childLineLabel).toHaveAttribute('data-endpoint', 'target')
  await expect(childLineLabel).toHaveAttribute('data-side', 'negative')
  await expect(childLineLabel).toHaveAttribute('data-orientation', 'vertical')
  await expect(childLineLabel).toHaveAttribute('data-axis-alignment', 'bottom')

  const childLabelSwitch = page.getByRole('switch', { name: '显示子线标签' })
  await expect(childLabelSwitch).toHaveAttribute('aria-checked', 'true')
  await childLabelSwitch.click()
  await expect(childLineLabel).toHaveCount(0)
  await expect(childLineLabelInput).toHaveValue('联络线 01')
  await childLabelSwitch.click()
  await expect(childLineLabel).toHaveCount(1)

  const childLabelHitBox = await childLineLabel.locator('.element-label__hit').boundingBox()
  const sourceRightPoint = await page.locator('.connection-edge__line').evaluate((node) => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(0)
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('无法读取子线标签拖动坐标')
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e + 40,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    }
  })
  if (!childLabelHitBox) throw new Error('无法读取子线标签命中区域')
  await page.mouse.move(
    childLabelHitBox.x + childLabelHitBox.width / 2,
    childLabelHitBox.y + childLabelHitBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(sourceRightPoint.x, sourceRightPoint.y, { steps: 5 })
  await page.mouse.up()
  await expect(childLineLabel).toHaveAttribute('data-endpoint', 'source')
  await expect(childLineLabel).toHaveAttribute('data-side', 'positive')
  await expect(childLineLabel).toHaveAttribute('data-axis-alignment', 'top')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(childLineLabel).toHaveAttribute('data-endpoint', 'target')
  await expect(childLineLabel).toHaveAttribute('data-side', 'negative')
  await expect(childLineLabel).toHaveAttribute('data-axis-alignment', 'bottom')
  await page.getByRole('button', { name: '重做' }).click()
  await expect(childLineLabel).toHaveAttribute('data-endpoint', 'source')
  await expect(childLineLabel).toHaveAttribute('data-side', 'positive')
  await expect(childLineLabel).toHaveAttribute('data-axis-alignment', 'top')

  const childLineHex = page.getByLabel('子线颜色 HEX')
  await expect(childLineHex).toHaveValue('#D5B96F')
  await page.getByRole('button', { name: '打开子线颜色选择器' }).click()
  await expect(page.getByRole('group', { name: '子线颜色 HEX 选择器' })).toBeVisible()
  await expect(page.locator('input[type="color"]')).toHaveCount(0)
  await page.getByLabel('子线颜色 选择器 HEX').fill('#77B4BF')
  await page.getByRole('button', { name: '完成' }).click()
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe('#77B4BF')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe('')
  await page.getByRole('button', { name: '重做' }).click()
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe('#77B4BF')
  const childCanvasBox = await canvas.boundingBox()
  if (!childCanvasBox) throw new Error('无法读取子线测试画布尺寸')
  await canvas.click({ position: { x: childCanvasBox.width - 180, y: childCanvasBox.height - 24 } })
  await page.locator('.connection-edge__hit:not(.connection-edge__hit--world)').click({ force: true })
  await expect(page.getByLabel('子线颜色 HEX')).toHaveValue('#77B4BF')
  await canvas.click({ position: { x: childCanvasBox.width - 180, y: childCanvasBox.height - 24 } })
  const globalChildColor = page.getByRole('button', {
    name: '全局修改子线颜色 #77B4BF',
  })
  await expect(globalChildColor).toContainText('1 条')
  await globalChildColor.click()
  const replacementColor = defaultConnectionColor('cooling-secondary-cold')
  await page.getByLabel('全局替换子线颜色 选择器 HEX').fill(replacementColor)
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe(replacementColor)
  await page.getByRole('button', { name: '完成' }).click()
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe('#77B4BF')

  await page.locator('.connection-edge__hit:not(.connection-edge__hit--world)').click({ force: true })
  const firstQuarterPoint = await firstHit.evaluate((node) => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() / 4)
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('无法读取母线追加选择坐标')
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    }
  })
  await page.keyboard.down('Shift')
  await page.mouse.click(firstQuarterPoint.x, firstQuarterPoint.y)
  await page.keyboard.up('Shift')

  const selectedBusbar = page.locator('.busbar[data-selected="true"]')
  await expect(selectedBusbar).toHaveCount(1)
  await expect(page.locator('.connection-edge[data-selected="true"]')).toHaveCount(1)
  const selectedBusbarId = await selectedBusbar.getAttribute('data-busbar-id')
  if (!selectedBusbarId) throw new Error('无法读取混合选中母线 ID')
  const selectedBusbarTap = page.locator(`.busbar-tap[data-busbar-id="${selectedBusbarId}"]`)
  const mixedLineHex = page.getByLabel('线路颜色 HEX')
  await expect(mixedLineHex).toHaveValue('')
  await expect(mixedLineHex).toHaveAttribute('placeholder', '多种颜色')

  const mixedReplacementColor = defaultConnectionColor('cooling-secondary-hot')
  await mixedLineHex.fill(mixedReplacementColor)
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe(mixedReplacementColor)
  await expect.poll(() => selectedBusbar.evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--busbar-color')
  ))).toBe(mixedReplacementColor)
  await expect.poll(() => selectedBusbarTap.evaluate((node) => (
    (node as SVGCircleElement).style.getPropertyValue('--busbar-color')
  ))).toBe(mixedReplacementColor)
  await mixedLineHex.press('Enter')

  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => page.locator('.connection-edge').evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--connection-color')
  ))).toBe('#77B4BF')
  await expect.poll(() => selectedBusbar.evaluate((node) => (
    (node as SVGGElement).style.getPropertyValue('--busbar-color')
  ))).toBe('')
  await expect.poll(() => selectedBusbarTap.evaluate((node) => (
    (node as SVGCircleElement).style.getPropertyValue('--busbar-color')
  ))).toBe('')
  await expect(page.locator('.connection-edge[data-selected="true"]')).toHaveCount(1)
  await expect(selectedBusbar).toHaveCount(1)

  await page.locator('.connection-edge__hit:not(.connection-edge__hit--world)').click({ force: true })
  await expect(page.locator('.busbar[data-selected="true"]')).toHaveCount(0)
  await expect(page.locator('.connection-edge[data-selected="true"]')).toHaveCount(1)
  await page.getByRole('button', { name: '删除所选对象' }).click()
  await expect(page.locator('.connection-edge')).toHaveCount(0)
  await expect(page.locator('.connection-label')).toHaveCount(0)
  await expect(page.locator('.busbar-tap')).toHaveCount(0)
  await expect(page.locator('.busbar')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.locator('.connection-label')).toHaveText('联络线 01')
  await expect(page.locator('.busbar-tap')).toHaveCount(2)

  expect(pageErrors).toEqual([])
})
