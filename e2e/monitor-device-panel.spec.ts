import { expect, test } from '@playwright/test'

test('keeps the monitor trend period control within the device panel', async ({ page }) => {
  await page.goto('/')

  await page.getByTitle('拖动或双击插入Switch').dblclick()
  const switchElement = page.locator('.diagram-element[data-asset-key="switch"]')
  await expect(switchElement).toHaveCount(1)

  const behavior = page.getByLabel('监控点击行为')
  await behavior.selectOption('device-panel')
  await expect(behavior).toHaveValue('device-panel')

  await page.getByRole('tab', { name: '监控模式' }).click()
  await switchElement.locator('.diagram-element__image').click({ force: true })
  await expect(page.locator('.monitor-device-panel')).toBeVisible()

  const period = page.getByRole('group', { name: '趋势时间范围' })
  await expect(period).toBeVisible()
  await expect(period).toHaveCSS('width', '112px')
  await expect(period).toHaveCSS('height', '28px')

  const voltageTrend = page.getByRole('img', { name: '线电压趋势' }).locator('..')
  await expect(voltageTrend).toHaveAttribute('data-duration-minutes', '1440')
  await expect(voltageTrend.locator('.monitor-trend__time-tick').first()).toHaveText(/^\d{2}:\d{2}$/)
  await period.getByRole('button', { name: '周' }).click()
  await expect(voltageTrend).toHaveAttribute('data-duration-minutes', '10080')
  await expect(voltageTrend.locator('.monitor-trend__time-tick').first()).toHaveText(/^\d{2}-\d{2}$/)
  await period.getByRole('button', { name: '月' }).click()
  await expect(voltageTrend).toHaveAttribute('data-duration-minutes', '43200')

  const layout = await period.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    buttons: Array.from(element.querySelectorAll('button')).map((button) => ({
      clientWidth: button.clientWidth,
      scrollWidth: button.scrollWidth,
      height: button.getBoundingClientRect().height,
    })),
  }))
  expect(layout.scrollWidth).toBe(layout.clientWidth)
  expect(layout.buttons).toHaveLength(3)
  expect(Math.max(...layout.buttons.map((button) => button.clientWidth)) -
    Math.min(...layout.buttons.map((button) => button.clientWidth))).toBeLessThanOrEqual(1)
  layout.buttons.forEach((button) => {
    expect(button.scrollWidth).toBe(button.clientWidth)
    expect(button.height).toBe(24)
  })

  const viewportLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  expect(viewportLayout.documentWidth).toBeLessThanOrEqual(viewportLayout.viewportWidth)
})

test('renders the UPS internal topology through the read-only canvas scene', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'UPS', exact: true }).dblclick()
  const upsElement = page.locator('.diagram-element[data-asset-key="ups"]')
  await expect(upsElement).toHaveCount(1)

  await page.getByRole('tab', { name: '监控模式' }).click()
  await page.getByRole('button', { name: '播放流动' }).click()
  await upsElement.locator('.diagram-element__image').click({ force: true })
  await expect(page.locator('.monitor-device-panel')).toBeVisible()

  const scene = page.getByRole('img', { name: 'UPS内部一次接线图' })
  await expect(scene).toHaveAttribute('data-routed-edge-count', '7')
  await expect(scene).toHaveAttribute('data-routing-invalid-count', '0')
  await expect(scene).toHaveAttribute('data-active-edge-count', '5')
  await expect(scene).toHaveAttribute('data-content-center-x', '226')
  await expect(scene).toHaveAttribute('data-content-center-y', '180')
  await expect(scene.locator('.read-only-diagram-scene__element image')).toHaveCount(7)
  await expect(scene.locator('.connection-edge__line')).toHaveCount(7)
  await expect(scene.locator('.monitor-static-flow-line')).toHaveCount(1)
  await expect(scene.getByRole('group', { name: '主路数据' })).toContainText('A：')
  await expect(scene.getByRole('group', { name: '主路数据' })).toContainText('V')
  await expect(
    scene.getByRole('group', { name: '主路数据' }).locator('.element-metric-row__reading').first(),
  ).toHaveCSS('fill', 'rgb(255, 255, 255)')
  const sceneFrame = scene.locator('..')
  await expect(sceneFrame).toHaveAttribute('data-animation-playing', 'true')
  await expect(scene.locator('.monitor-animated-flow-line')).toHaveCount(5)
})

test('keeps the data-panel period text inside its dropdown', async ({ page }) => {
  await page.goto('/')

  await page.getByTitle('拖动或双击插入CHWP').dblclick()
  const element = page.locator('.diagram-element[data-asset-key="chwp"]')
  await element.locator('.diagram-element__image').click({ force: true })
  await page.getByRole('switch', { name: '显示运行数据' }).click()
  await page.getByRole('button', { name: '添加' }).click()

  await page.getByRole('tab', { name: '监控模式' }).click()
  const label = page.locator('.element-label').filter({ hasText: 'CHWP-01' })
  await label.locator('.element-metric-row__hit').click({ force: true })

  const dataPanel = page.locator('.monitor-data-panel')
  await expect(dataPanel).toBeVisible()
  const period = dataPanel.getByRole('combobox', { name: '趋势时间范围' })
  await period.selectOption('day')
  await expect(period).toHaveValue('day')

  const layout = await period.evaluate((select) => {
    const styles = getComputedStyle(select)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法测量下拉文字')
    context.font = styles.font
    const selectedText = select.selectedOptions[0]?.textContent ?? ''
    const availableWidth = select.clientWidth
      - Number.parseFloat(styles.paddingLeft)
      - Number.parseFloat(styles.paddingRight)
    return {
      availableWidth,
      textWidth: context.measureText(selectedText).width,
      clientWidth: select.clientWidth,
      renderedWidth: select.getBoundingClientRect().width,
      renderedHeight: select.getBoundingClientRect().height,
      panelScrollWidth: select.closest('.monitor-data-panel')?.scrollWidth ?? 0,
      panelClientWidth: select.closest('.monitor-data-panel')?.clientWidth ?? 0,
    }
  })

  expect(layout.availableWidth).toBeGreaterThanOrEqual(layout.textWidth)
  expect(layout.renderedWidth).toBe(76)
  expect(layout.renderedHeight).toBe(24)
  expect(layout.panelScrollWidth).toBe(layout.panelClientWidth)
})
