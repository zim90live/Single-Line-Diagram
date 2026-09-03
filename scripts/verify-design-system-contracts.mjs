import { readFile, access } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const read = (file) => readFile(path.join(projectRoot, file), 'utf8')
const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const theme = JSON.parse(await read('design-system/theme.json'))
const manifest = JSON.parse(await read('design-system/component-manifest.json'))
const generatedCss = await read('src/styles/theme.generated.css')
const componentCss = await read('src/styles/components.css')
const featureCss = await read('src/styles.css')
const main = await read('src/main.tsx')
const uiIndex = await read('src/components/ui/index.ts')
const appSources = await Promise.all([
  read('src/App.tsx'),
  read('src/components/PropertiesPanel.tsx'),
  read('src/components/MonitorPropertiesPanel.tsx'),
])

assert(theme.css?.selector === '[data-aidc-theme]', '主题必须限制在 [data-aidc-theme] 作用域。')
assert(Object.keys(theme.groups?.foundation ?? {}).length > 0, '缺少 Foundation Token。')
assert(Object.keys(theme.groups?.semantic ?? {}).length > 0, '缺少 Semantic Token。')
assert(Object.keys(theme.groups?.domain ?? {}).length > 0, '缺少独立 Domain Token 层。')
assert(Object.keys(theme.groups?.component ?? {}).length > 0, '缺少 Component Token。')
assert(Object.keys(theme.recipes ?? {}).length > 0, '缺少 Component Recipe。')
assert(manifest.components?.length === 9, '组件清单必须包含九个视觉原语。')
assert(manifest.headless?.length === 2, '组件清单必须包含 Pressable 与 TabList 两个语义辅助组件。')
assert(generatedCss.includes('[data-aidc-theme] {'), '生成主题没有使用声明的作用域。')
assert(componentCss.startsWith('@layer components'), '基础组件样式必须位于 components 层。')
assert(featureCss.startsWith('@layer legacy'), '业务样式必须位于 legacy 层。')
assert(!/#[\da-f]{3,8}\b/i.test(componentCss), '基础组件 CSS 不得包含硬编码十六进制颜色。')
assert(!/--recipe-field\b|--type-(?:value|label|action)\b|--control-height\b/.test(featureCss), '业务 CSS 仍在使用已废弃的视觉别名。')
assert(!featureCss.includes('.property-toggle__control'), '业务 CSS 仍包含重复的 Switch 实现。')

const themeImport = main.indexOf("./styles/theme.generated.css")
const featureImport = main.indexOf("./styles.css")
const componentImport = main.indexOf("./styles/components.css")
assert(themeImport >= 0 && themeImport < featureImport && featureImport < componentImport, '样式加载顺序必须为 theme → legacy → components。')

for (const entry of [...manifest.components, ...manifest.headless]) {
  try {
    await access(path.join(projectRoot, entry.path))
  } catch {
    failures.push(`组件文件不存在：${entry.path}`)
  }
  assert(new RegExp(`\\b${entry.export}\\b`).test(uiIndex), `统一入口未导出 ${entry.export}。`)
}

const composedSources = appSources.join('\n')
assert(!/className="property-toggle__control"/.test(composedSources), '页面仍在使用旧的属性开关。')
assert(!/<button[^>]+role="(?:switch|tab)"/s.test(composedSources), '页面仍在手写 Switch 或 Tab 语义。')

if (failures.length) {
  console.error(`Design system contract check failed (${failures.length}):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`Design system contracts verified: ${manifest.components.length} primitives, ${manifest.headless.length} semantic helpers, ${Object.keys(theme.recipes).length} recipes.`)
