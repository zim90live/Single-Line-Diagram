# AIDC 合入准备与 UI 收敛方案

最后更新：2026-09-03

## 结论

目标宿主为 `/Users/gwx783510/Documents/Code/AIDC`。两项目继续保留独立业务边界，但基础 UI 必须只有一个实现源：AIDC 负责 Foundation、Semantic、Component Token、组件 Recipe、`components.css` 和 React 基础组件；一次接线图项目只保留线路 Domain Token、画布业务 Pattern 与运行时实现。

当前还不是“完全对齐”状态。AIDC 当前本地基线为 `024e3911f0d9034ee2d6085975f7d4a8692b9ea9`，其设计系统清单为 schema v9、主题为 schema v2，包含 9 个视觉原语和 2 个语义辅助。本项目仍保留一份适配后的本地实现；本轮已增加版本锁、漂移审计和统一包名入口，避免继续扩大差异。

## 已完成的准备

- 所有业务组件统一从未来共享包名 `@aidc/ui` 导入；当前由 TypeScript/Vite 临时映射到本地实现，未来替换为真实包时不需要逐文件改业务代码。
- `design-system/aidc-ui-alignment.json` 锁定 AIDC 来源提交、主题/组件清单版本和核心文件 SHA-256。
- `npm run check:aidc-ui` 检查本项目不得绕过 `@aidc/ui` 直接引用本地基础组件。
- `npm run audit:aidc-ui` 同时读取相邻 AIDC 仓库，检测 AIDC 提交、主题、组件清单、组件源码和基础 CSS 是否发生未登记漂移。
- `RuntimeBundleViewer` 现在向宿主转发 `onRuntimePresentationChange`，其中包括当前指标、设备运行态、图元和水泵派生流量。AIDC 右侧检查器可使用自己的共享组件渲染这些数据，并通过 `stateOverrides` 把 Switch、泵和阀控制状态传回查看器。

## 合并共享包前必须上游化的五项能力

以下能力已经在接线图业务使用，不能在切换到 AIDC 组件时丢失，也不能永久维护为第二份基础组件：

1. TextField/SelectField 的 `hideLabel`：视觉隐藏标签但保留可访问名称。
2. IconButton 默认用 `label` 补充 `title`。
3. NumericField 的 `onCommit` 及可选范围默认值。
4. Switch 的 `indeterminate` / `aria-checked="mixed"`。
5. TabList/Tab 的 roving focus、方向键、Home/End 自动激活。

这些能力应先合入 AIDC 的组件清单、ComponentLab、Style Studio 示例和契约测试，然后再发布共享包。完成后，本项目删除 `src/components/ui`、本地基础 `components.css` 与共享 Token 副本；一次接线图专用扩展继续放在独立 Domain/Pattern 文件中。

## 目标包边界

```text
@aidc/ui
  ├─ React 基础组件
  ├─ Foundation / Semantic / Component Token
  ├─ 组件 Recipe 与 components.css
  └─ 可访问性和交互契约

@aidc/diagram-runtime
  ├─ RuntimeBundle 校验与恢复
  ├─ 只读接线图画布、路由和动画
  ├─ 指标/冷却 Provider 接口
  ├─ 运行时 presentation 回调
  └─ 接线图 Domain Token 与运行时样式

AIDC 应用
  ├─ 顶栏、左树、右侧检查器和工作区切换
  ├─ @aidc/ui 的唯一产品消费入口
  ├─ 接线图运行状态 Store
  └─ AIDC 数据源到接线图 Provider 的适配
```

`@aidc/diagram-runtime` 不复制右侧设备面板的基础 UI。它输出面板所需的数据和状态契约；AIDC 使用 `@aidc/ui` 组合 `SingleLineInspector`，从而确保 3D 与接线图工作区的按钮、字段、开关、Tab、状态标签、焦点和禁用态完全一致。

## 下一步

1. 在 AIDC 上游化五项组件能力并更新其 schema v9 清单与验证脚本。
2. 从 AIDC 提取 `@aidc/ui`，让 AIDC 自身先反向消费该包，再让本项目移除临时别名。
3. 将接线图的共享 Token 和线路 Domain Token 拆开，删除与 AIDC 重复的主题值。
4. 提取 `@aidc/diagram-runtime`，补资产 URL resolver 与运行时专用样式入口。
5. 在 AIDC 增加 `SingleLineWorkspace`、`SingleLineInspector`、运行状态 Store、图纸绑定表和数据适配器。

## 验收

- 两项目解析到同一 `@aidc/ui` 包版本，不再各自保存基础组件源码。
- 九个视觉原语、两个语义辅助、公共 Token、Recipe 和 `components.css` 只有 AIDC 一个真源。
- 接线图专有样式不能覆盖 `.aidc-*` 原语内部结构，只能组合组件或使用明确的业务容器。
- AIDC 切换 3D/接线图时只保留一个活动 R3F Canvas。
- 图纸跳转、动画、指标、Switch、泵阀状态和右侧面板均通过非截图自动化验证；最终视觉验收由用户完成。
