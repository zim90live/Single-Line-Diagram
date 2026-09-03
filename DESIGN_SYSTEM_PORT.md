# AIDC Design System 迁移记录

- 参考项目：`/Users/gwx783510/Documents/Code/AIDC`
- 参考版本：`97ecddf`
- 迁移日期：2026-09-03

## Token 映射

目标项目以 `design-system/theme.json` 为唯一真源，并通过 `[data-aidc-theme]` 作用域生成 CSS。AIDC Foundation 中的字体、字号、字重、行高、间距、圆角、阴影、时长和缓动分别映射到目标的 `foundation` 组；画布、面板、文本、边框、焦点、成功、错误和警告映射到 `semantic` 组；控件尺寸和状态语义映射到 `component` 组。

| AIDC 语义 | 目标 Token | 说明 |
| --- | --- | --- |
| Interface font | `font-interface` | 支持宿主通过 `--aidc-font-family` 覆盖，默认依赖本地打包字体 |
| Canvas / panel | `canvas`、`canvas-deep`、`panel`、`panel-raised` | 工作区左右面板统一使用监控 `panel`；只有弹层等提升内容使用 `panel-raised` |
| Ink hierarchy | `ink`、`muted`、`dim` | 保持主、次、弱三级文字 |
| Control surface | `component-control-*` | 统一按钮、字段和选择控件状态 |
| Focus | `focus`、`component-control-focus` | 统一 `focus-visible` 双像素轮廓 |
| Status | `success`、`warning`、`error` 及 soft 版本 | 状态不只依赖颜色，同时保留文字和边界 |
| Component dimensions | `button-height-sm`、`field-height-sm`、`switch-*`、`status-tag-height` | 复刻紧凑型桌面尺寸 |
| Immersive HUD | `hud-topbar-*`、`hud-top-row`、`hud-tree-*`、`hud-inspector-*` | 复刻 64px 顶栏、4px 贴边、280px 左树和 360px 检查器的单一监控尺寸 |
| Panel material | `panel`、`backdrop-monitor-blur` | 左树与右侧检查器使用 90% 单色面板、30px 模糊且无阴影/内描边 |
| Monitor navigation | `monitor-tree-*`、`monitor-control-*`、`monitor-scrollbar` | 两种业务模式都使用 40%/76%/100% 层级、5%/8% 行表面和黑色操作分组 |

冷却、电力、告警及目标项目现有的冷却管线几何值放在独立 `domain` 组，避免它们成为通用组件依赖。Component Recipe 保留 `recipe-*` 绑定，使组件样式只消费 Recipe，业务样式只消费 Foundation、Semantic、Domain 或 Component Token。

## 已复刻组件

- Button、IconButton：四种变体、选中、禁用、loading、hover 与 `focus-visible`。
- TextField、NumericField、SelectField：统一标签、提示、错误、禁用与提交边界；NumericField 保留目标项目 `onCommit` API。
- Switch：switch、surface、chip 三种变体，并为目标批量编辑增加 `mixed` 三态。
- SegmentedControl、Tab：统一选择态和语义色；TabList 支持方向键、Home、End 自动激活。
- StatusTag：neutral、success、warning、danger、cooling、electrical。
- Pressable：为树、面包屑、素材格和画布 HUD 提供原生按钮语义，不拥有业务视觉。

所有组件由 `src/components/ui/index.ts` 统一导出，组件清单见 `design-system/component-manifest.json`。

## 已迁移业务 UI Pattern

- 沉浸式工作区：纯黑画布铺满应用，64px 半透明 Topbar、280px 左面板、360px 右检查器及命令/缩放控件作为 HUD 悬浮覆盖。编辑和监控业务不再切换外壳设计语言。
- 树菜单与素材区：两种模式都使用参考监控树的 28px 行高、无阴影单色面板、无边框搜索，以及参考专用展开/园区/楼宇/POD/叶节点 SVG。编辑业务保留新增、重命名、拖放和删除，它们组合在 28px 黑色监控工具组内；素材区仅在编辑模式出现，并改为无描边低对比网格。
- 画布 HUD：返回使用参考 `back.svg` 和 44px 无背景按钮；面包屑与对象统计直接跟随其后，不再形成第二块路径面板。编辑/播放命令和缩放控件使用 6px、无阴影、30px 模糊的监控浮层。
- 右侧属性与监控面板：统一为 360px / 24px，使用 `panel` 单色半透明背景、30px 模糊且无阴影/常驻内描边。检查器标题统一为“眉题 + 状态标签 + 22px 对象标题 + 描述”；运行信息、属性开关和只读元数据无外框，真正输入字段继续保留 Recipe 边界及 `focus-visible`。

## 未复刻内容及原因

- Three.js 场景、AIDC 数据模型、监控模拟数据和编辑器状态管理：属于明确排除的业务实现。
- Style Studio 与 Component Lab：它们是参考项目的设计工具链，目标运行时不需要。
- 告警详情和图表：目标项目当前没有对应页面或业务入口，提前引入会扩大范围并产生未使用样式。
- 未被当前页面使用的参考项目组件和 Pattern：按需迁移原则不引入。

## 目标项目特有覆盖

- 保留一次接线图的 1180px 桌面最小宽度和纯黑业务画布；原分模式尺寸已由 AIDC 监控模式的 280px / 360px 悬浮外壳统一取代。
- 保留冷却双层管线、线路告警和 SVG 场景所需的 Domain Token；这些值不进入通用组件 Recipe。
- 保留目标现有路由、Schema、数据、文案、拖放、编辑和监控行为。
- `styles.css` 作为 `legacy` 业务层加载，`components.css` 在 `components` 层拥有基础组件最终解释权。

## 后续新增规则

1. 新视觉值先判断属于 Foundation、Semantic、Domain 还是 Component，再写入 `theme.json`；禁止直接编辑生成 CSS。
2. 新基础组件必须有明确 DOM/ARIA 契约、键盘行为、disabled/loading/error 状态和 Recipe，并从统一入口导出。
3. 业务组件只负责布局和组合；不得复制 `.aidc-*` 原语内部视觉状态，也不得新增第二套基础组件。
4. 颜色、间距、圆角、阴影和动画不得以无语义硬编码散落在页面 CSS；业务数据驱动的 SVG/HEX 值除外。
5. 修改后至少运行主题契约检查、TypeScript、单元测试和生产构建；视觉验收按项目约定由用户完成。
