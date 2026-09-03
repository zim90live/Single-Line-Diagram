# AIDC 一次接线图设计系统

## 真源与生成

- `theme.json` 是 Token 与 Component Recipe 的唯一手工维护真源。
- `npm run generate:theme` 根据 `theme.schema.json` 校验并生成 `src/styles/theme.generated.css`；生成文件不得手工编辑。
- `component-manifest.json` 记录九个视觉原语和两个无样式语义辅助组件；Pressable 不拥有颜色、背景或边框，具体 Pattern 由业务样式组合 Token 定义。
- `src/styles/components.css` 是基础组件结构、变体和交互状态的唯一视觉实现。
- `src/styles.css` 只承载工作区和业务 Pattern，位于 `legacy` 层；基础组件样式位于更高优先级的 `components` 层。

## 使用规则

1. 页面必须在 `[data-aidc-theme]` 作用域内；当前入口在 `html` 与应用根节点同时声明。
2. 组件统一从 `src/components/ui/index.ts` 导入，不在业务页面重写按钮、字段、Tab、Switch 或状态标签内部样式。
3. 通用视觉值先进入 `theme.json`，组件绑定写入 Recipe；冷却、电力、告警等值只进入 `domain` 组。
4. 字体通过 `--aidc-font-family` 可覆盖；默认字体由项目依赖加载，并提供中文与系统等宽回退。
5. 修改 Token 后运行 `npm run generate:theme`，提交真源和生成物；提交前运行 `npm run check:design-system`。

沉浸式工作区尺寸使用 `hud-*` Component Token；编辑与监控业务统一采用参考项目监控模式的 `panel`、`backdrop-monitor-blur` 和 `monitor-*` 状态 Token。左树、右侧检查器和返回/命令 HUD 不得恢复编辑模式专用背景、阴影、常驻描边或第二套尺寸，也不要在页面另建浮层常量。
