# 监控运行时拆分架构

最后更新：2026-09-03

## 目标

为未来把监控模式和选定图纸接入另一个 React 项目建立稳定边界，同时保持当前编辑器的视觉、交互、线路算法、存储格式和运行结果不变。

当前阶段已经把“监控能力从哪里进入、依赖什么数据、如何替换数据源”收敛为公共边界，并以约 1.7 千行的监控专用场景替代跨项目入口对 8 千行级编辑画布的依赖；仍不提前定义尚未确认的部署、遥测协议和跨仓库发布方式。

## 当前分层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 项目领域 | `src/domain/` | 版本化项目文档、图纸、图元、母线和连接网络模型 |
| 监控算法 | `src/monitoring/` | 电力/冷却拓扑、运行指标规则、流动路径与 WebGL 动画实现 |
| 运行时核心 | `src/runtime/` | 当前图纸切片、运行态上下文、数据 Provider、监控拓扑 Hook、监控专用 React 画布与公共导出入口 |
| 编辑器适配 | `src/editor/DiagramCanvas.tsx` | 编辑手势、路由预览和当前 SVG/WebGL 组合渲染；通过运行时上下文消费监控能力 |
| 应用壳 | `src/App.tsx` | 模式切换、层级导航、存储和属性面板；通过运行时工厂取得当前图纸，不再自行拼装监控切片 |

## 已建立的公共边界

### `createDiagramRuntimeView(document, diagramId)`

从完整项目文档派生单张图纸运行所需的稳定视图：

- 当前图纸、所属线路系统与面包屑路径；
- 当前图纸的图元、母线、连接网络和兼容途径点；
- 资产清单；
- 图元到子图的监控下探映射。

它是纯派生函数，不写项目、不修改 dirty，也不包含缩放和平移等会话视口变化。

### `DiagramRuntimeContext`

统一承载图纸以外的运行输入：

- Switch、2WV、CV 的 On/Off 状态；
- 水泵运行与输出功率、阀门开关状态；
- 电力设备子图外部供电是否有效；
- 图元下探映射；
- 可选的指标与冷却运行数据 Provider。

现有 `App` 与 `DiagramCanvas` 已改为使用这一对象，避免继续增加散落的监控 Props。

### Provider

- `MonitorMetricDataProvider` 支持同步快照、可选订阅和可选轮询周期；默认实现保留原有 30 秒模拟刷新。
- `CoolingRuntimeProvider` 继续使用既有接口，但通过运行时上下文注入；默认实现和原有泵阀模拟结果不变。
- Provider 输出只属于运行时，不写入图纸 JSON、项目更新时间或编辑历史。

### `useDiagramMonitorRuntime`

集中派生电力拓扑、冷却运行快照、冷却流量拓扑和泵流量指标覆盖。`DiagramCanvas` 不再直接创建模拟 Provider 或拼装这些结果。

### `DiagramRuntimeViewer`

提供监控只读 React 入口，调用方只需传入 `DiagramRuntimeView`、`DiagramRuntimeContext`、播放状态和导航/选择回调。它已改为直接使用 `DiagramMonitorCanvas`，不再实例化或导入 `DiagramCanvas`。

### `DiagramMonitorCanvas`

跨项目 React 入口的专用只读场景只包含运行所需能力：

- 正式 latest-wins Worker 路由、圆角、拱桥、冷却双层管体和视口 overscan 裁剪；
- 图元、母线、子线、标签与运行指标 SVG；
- 点阵 WebGL 与电力/冷却流动 WebGL；
- 下探入口和 Switch/2WV/CV、泵阀等运行对象选择；
- 鼠标中键、空格+左键、触控板双指平移/捏合、离散滚轮缩放；
- 仅 `zoomIn / zoomOut / zoomReset` 的公开控制句柄。

它不包含选择框、变换手柄、素材拖放、接线、线路改道、剪贴板、撤销历史、属性写回或 dirty。`runtime/react.ts` 的模块边界测试会拒绝重新导入 `DiagramCanvas` 或 `EditorCommandState`。

当前应用壳仍继续用原 `DiagramCanvas` 的监控分支，避免在本轮替换用户已经使用的产品内画面；外部 React/RuntimeBundle 入口使用新画布。两者共享领域模型、路由/几何算法、标签布局、素材、CSS、监控拓扑和动画实现；第一批静态 JSX 已进一步收敛到共享场景表现原语，剩余线路组装派生模型、母线 tap 等静态表现继续分批统一。

### `DiagramScenePrimitives`

`src/scene/DiagramScenePrimitives.tsx` 是编辑画布和监控专用画布共同使用的无状态 SVG 表现层。第一批覆盖普通图片/通用框图元主体、三类标签及指标行、母线基线、Symbol 颜色滤镜、冷却管内阴影滤镜、监控静态线路、桥面双层遮罩、冷却管壳和线路方向箭头。它只消费派生后的布局、路径与运行状态；编辑锚点通过 children 注入，标签拖动通过稳定 ref 注入，因此不会把 Store、历史、dirty、接线或下探策略带入共享层。

模块守卫要求两个画布都引用该共享入口，并继续禁止运行时 React 入口导入 `DiagramCanvas` 或 `EditorCommandState`。当前共享层仍引用 `editor/` 下的纯布局/几何/素材模块，这是目录归属待迁移项，不代表重新依赖编辑画布。

纯数据与 Provider 公共入口从 `src/runtime/index.ts` 导出；React 查看器和监控专用画布从 `src/runtime/react.ts` 单独导出。核心消费者不会因为只导入图纸切片或状态函数而把 React、Three.js 或 React Three Fiber 加入依赖图；React 监控消费者会加载 Three.js 动画和点阵，但不会加载整套编辑画布。

### `DiagramRuntimeBundle` v1

跨项目交付使用与项目 Schema 独立演进的运行时包：

- 固定格式标识 `aidc-diagram-runtime`，当前 `formatVersion` 为 `1`；
- 一张或多张入口图纸、入口下级子树和到线路根的必要祖先；
- 当前项目 Schema 要求的两套线路及两个结构根，但未选择线路的根图不携带画布内容；
- 保留范围内的图元、母线、连接网络，以及这些图元实际使用的资产定义；
- 导出时刻的 Switch、2WV、CV `onOffState` 快照；
- 已冻结并经过来源图元、目标图纸和名称一致性校验的下探映射；
- 来源项目 ID、名称、项目 Schema 版本和导出时间。

`createDiagramRuntimeBundle` 负责裁剪和生成，`serializeDiagramRuntimeBundle` / `parseDiagramRuntimeBundle` 负责同一契约下的输出与拒绝无效输入，`createDiagramRuntimeViewFromBundle` 恢复单图视图，浏览器宿主可用 `downloadDiagramRuntimeBundle` 下载 `.runtime.json` 文件。

v1 明确不导出编辑选择、历史、dirty、面板草稿、当前相机会话、随机读数、Provider 或 Three.js/R3F 对象，并清空项目级 `extensions`。文档 Schema 中仍有画布默认视口字段，但当前平移/缩放状态不写回项目，因此它不是会话相机快照。

### `RuntimeBundleViewer`

另一个 React 宿主可直接把通过校验的运行时包交给 `RuntimeBundleViewer`。组件支持两种导航所有权：

- 不传 `diagramId` 时，从 `defaultDiagramId` 或第一个入口开始并在下探后更新内部图纸；
- 传入 `diagramId` 时，宿主通过 `onDiagramChange` 接入自己的 Router、Tab 或页面状态。

`animationPlaying` 由宿主控制；`stateOverrides` 可覆盖包内 On/Off 初始状态及其他运行状态；`providers` 可替换指标和冷却数据源。它不读取 Zustand、IndexedDB 或编辑保存状态，转发的 ref 也只包含三个缩放命令。

## 数据流

```text
ProjectDocument
  -> createDiagramRuntimeBundle
  -> DiagramRuntimeBundle JSON
  -> parseDiagramRuntimeBundle
  -> createDiagramRuntimeViewFromBundle
  -> DiagramRuntimeView

遥测/模拟/会话控制
  -> DiagramRuntimeContext + Provider
  -> useDiagramMonitorRuntime
  -> 电力/冷却拓扑 + 指标读数
  -> SVG 静态层 + WebGL 动画层
```

下探只通过 `runtime.navigation[elementId]` 返回目标图纸，不在渲染组件内直接修改路由或全局 Store。宿主 React 项目可以把它接到自己的 Router、Tab 或页面状态。

## 跨项目接入示例

导出侧先从当前项目生成包；On/Off 会话态在导出时固化为可移植初始状态：

```ts
const bundle = createDiagramRuntimeBundle(document, ['pod-a-id'], {
  onOffStates: currentOnOffStates,
})
downloadDiagramRuntimeBundle(bundle, 'POD A')
```

目标 React 项目先校验 JSON，再挂载宿主组件：

```tsx
const bundle = parseDiagramRuntimeBundle(await file.text())

<RuntimeBundleViewer
  bundle={bundle}
  animationPlaying={playing}
  providers={{ metrics, cooling }}
  onDiagramChange={(diagramId) => navigate(`/diagram/${diagramId}`)}
/>
```

示例中的导入路径取决于后续选择工作区包、私有包或代码同步方式。当前 v1 的资产 `source` 是元数据路径，不是内嵌资源；目标项目必须同时获得当前运行时素材目录，或在后续 v2 接入资产解析/内嵌方案。

## 后续拆分顺序

1. 在已共享图元、标签、母线基线、滤镜、静态线、桥面/管壳和方向箭头的基础上，继续统一线路组装派生模型、母线 tap 等剩余静态表现；验证后再让当前 `App` 使用专用画布。
2. 把仍位于 `editor/` 的无状态路由、连接几何、标签布局、素材解析和视口手势迁入共享 `scene/` 或 `runtime/`，形成目录级独立边界。
3. 为 RuntimeBundle 增加宿主资产 URL 解析器或可选 SVG/PNG 内嵌策略，并按兼容规则升级独立格式版本。
4. 将 `src/runtime` 发布为工作区包或私有包，并接入目标项目 Router、素材部署与真实数据 Provider。
5. 在目标项目复验图纸下探、播放/暂停、泵阀/Switch 状态、指标刷新和大图性能；必要时再增加带算法版本的派生路由快照。

## 本阶段验收边界

- 现有编辑与监控模式的可见行为不变化；
- 现有应用实际消费运行时视图和上下文，而不是保留两套并行拼装逻辑；
- 跨项目 React 入口不导入编辑画布或编辑命令类型；
- 默认模拟数据、泵阀状态、电力外部供电、图元下探和动画拓扑结果保持；
- 类型检查、单元/组件测试和生产构建通过；
- 项目 Schema 保持 v33，旧项目和场景归档无需迁移。
