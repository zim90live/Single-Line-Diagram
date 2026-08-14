import { expect, test, type Locator } from '@playwright/test'

import { GRID_DOT_SCREEN_RADIUS } from '../src/editor/gridScale'

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
  const horizontalTicks = await page.getByLabel('水平标尺').locator(':scope > g').evaluateAll((ticks) =>
    ticks.map((tick) => ({
      world: Number((tick as SVGGElement).dataset.tickWorld),
      position: Number((tick as SVGGElement).dataset.tickPosition),
      major: (tick as SVGGElement).dataset.tickMajor === 'true',
    })),
  )
  expect(horizontalTicks.length).toBeGreaterThan(0)
  for (const tick of horizontalTicks) {
    expect(Math.abs(tick.world % zoomedGrid.visibleStep)).toBe(0)
    expect(tick.position).toBeCloseTo(tick.world * zoomedGrid.zoom + zoomedGrid.tx, 8)
  }
  const anchorWorld = 48
  expect(horizontalTicks.some((tick) => tick.world === anchorWorld && tick.major)).toBe(true)
  const horizontalAnchorTick = page.getByLabel('水平标尺').locator(`[data-tick-world="${anchorWorld}"]`)
  const verticalAnchorTick = page.getByLabel('垂直标尺').locator(`[data-tick-world="${anchorWorld}"]`)
  const anchorTickLayout = {
    x: await horizontalAnchorTick.locator('line').evaluate((tick) => tick.getBoundingClientRect().x),
    y: await verticalAnchorTick.locator('line').evaluate((tick) => tick.getBoundingClientRect().y),
  }
  expect(anchorTickLayout.x).toBeCloseTo(
    canvasBox.x + anchorWorld * zoomedGrid.zoom + zoomedGrid.tx,
    1,
  )
  expect(anchorTickLayout.y).toBeCloseTo(
    canvasBox.y + anchorWorld * zoomedGrid.zoom + zoomedGrid.ty,
    1,
  )
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
  await expect(page.getByText('2 个图元')).toBeVisible()

  const firstElement = page.locator('.diagram-element').first()
  const firstImage = firstElement.locator('.diagram-element__image')
  await expect(firstElement.locator('image')).toHaveCount(1)
  await expect(firstElement.locator('rect, text')).toHaveCount(0)
  await firstElement.click()
  await expect(firstElement).toHaveAttribute('data-selected', 'true')
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
  const rotateBox = await rotateHandle.boundingBox()
  if (!rotateBox) throw new Error('无法读取旋转控制柄')
  await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rotateBox.x + rotateBox.width / 2 + 40, rotateBox.y + rotateBox.height / 2 + 32, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => firstElement.getAttribute('transform')).toContain('rotate(90 ')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => firstElement.getAttribute('transform')).toBe(initialTransform)

  const secondElement = page.locator('.diagram-element').last()
  await secondElement.click({ modifiers: ['Shift'] })
  await expect(page.locator('.diagram-element[data-selected="true"]')).toHaveCount(2)
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

  const uniqueBranchPoint = await page.locator('.connection-edge__hit').last().evaluate((node) => {
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
  await page.getByLabel('图元颜色').evaluate((node) => {
    const input = node as HTMLInputElement
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    valueSetter?.call(input, '#77b4bf')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#77B4BF')
  await page.getByLabel('图元颜色').evaluate((node) => {
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#777777')
  await page.getByRole('button', { name: '重做' }).click()
  await expect(switchImage).toHaveAttribute('data-symbol-color', '#77B4BF')

  await page.keyboard.press('Control+s')
  await expect(page.getByText('项目已保存到当前浏览器')).toBeVisible()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()

  expect(pageErrors).toEqual([])
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
  await page.mouse.click(canvasBox.x + canvasBox.width - 24, canvasBox.y + 24)

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

  await page.locator('.connection-edge__hit').click({ force: true })
  await expect(page.locator('.connection-edge')).toHaveAttribute('data-selected', 'true')
  await page.getByRole('button', { name: '删除所选对象' }).click()
  await expect(page.locator('.connection-edge')).toHaveCount(0)
  await expect(page.locator('.busbar-tap')).toHaveCount(0)
  await expect(page.locator('.busbar')).toHaveCount(2)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.connection-edge')).toHaveCount(1)
  await expect(page.locator('.busbar-tap')).toHaveCount(2)

  expect(pageErrors).toEqual([])
})
