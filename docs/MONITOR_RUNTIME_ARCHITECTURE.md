# 监控运行时拆分架构

最后更新：2026-09-03

## 目标

为未来把监控模式和选定图纸接入另一个 React 项目建立稳定边界，同时保持当前编辑器的视觉、交互、线路算法、存储格式和运行结果不变。

当前阶段已经把“监控能力从哪里进入、依赖什么数据、如何替换数据源”收敛为公共边界，并以监控专用场景替代跨项目入口和当前产品监控模式对 8 千行级编辑画布的依赖。共享场景、连接、标签、素材与路由实现已完成目录级解耦；仍不提前定义尚未确认的部署、遥测协议和跨仓库发布方式。

## 当前分层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 项目领域 | `src/domain/` | 版本化项目文档、图纸、图元、母线和连接网络模型 |
| 监控算法 | `src/monitoring/` | 电力/冷却拓扑、运行指标规则、流动路径与 WebGL 动画实现 |
| 共享场景 | `src/scene/` | 几何/视口、素材、标签、连接几何、静态场景派生与共享 SVG/WebGL 表现原语 |
| 运行时核心 | `src/runtime/` | 当前图纸切片、运行态上下文、数据 Provider、正式路由 Worker/Hook、监控专用 React 画布与公共导出入口 |
| 编辑器适配 | `src/editor/DiagramCanvas.tsx` | 编辑手势、路由预览、选择/变换和属性写回；通过共享场景与运行时接口消费基础能力 |
| 应用壳 | `src/App.tsx` | 模式切换、层级导航、存储和属性面板；编辑模式挂载编辑画布，监控模式挂载专用监控画布 |

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
- 水泵运行与输出功率、阀门开关状态；其中水泵以 Schema v35 图元实例快照为缺省值，显式宿主覆盖优先；
- 电力设备子图外部供电是否有效、父级实际 A/B 通道，以及 UPS 锂电是否正在接管；
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

当前应用壳、外部 React 入口和 RuntimeBundle 入口均使用 `DiagramMonitorCanvas`；只有编辑模式实例化 `DiagramCanvas`。两条画布共享领域模型、路由/几何算法、标签布局、素材、CSS、监控拓扑和动画实现，静态 JSX 与线路显示派生收敛到共享场景原语和纯数据场景模型，因此产品内与跨项目监控不再维护两套渲染路径。

### `DiagramScenePrimitives`

`src/scene/DiagramScenePrimitives.tsx` 是编辑画布和监控专用画布共同使用的无状态 SVG 表现层。它覆盖普通图片/通用框图元主体、三类标签及指标行、母线基线与母线节点、Symbol 颜色滤镜、冷却管内阴影滤镜、监控静态线路、桥面双层遮罩、冷却管壳和线路方向箭头。它只消费业务对象或派生后的布局、路径与运行状态；编辑锚点通过 children 注入，标签拖动和母线节点颜色预览通过稳定 ref 注入，节点交互手柄由编辑画布包裹，因此不会把 Store、历史、dirty、接线或下探策略带入共享层。

### `connectionScene` 与 `flowPresentation`

`src/scene/connectionScene.ts` 是两条画布共同使用的纯线路场景模型，负责稳定渲染分组、最终带桥显示路径、冷却管壳、监控静态线、桥下动画排除、冷却节点与连接锚点集合。编辑画布可以传入既有缓存复用路径和管壳对象；监控专用画布使用相同算法但不持有编辑缓存，避免两份派生逻辑逐渐漂移。

`src/monitoring/flowPresentation.ts` 承载静态流动常量、类型、无流量压暗颜色和静态线路分组，不依赖 React、Three.js 或 React Three Fiber。`FlowAnimationLayer.tsx` 保留 WebGL 几何与渲染组件，并重导出原公共符号保持现有调用兼容。由此核心或纯场景消费者不会因为需要线路静态分组而加载 WebGL 运行时。

### 场景与路由基础模块

`src/scene/geometry.ts`、`gridScale.ts`、`wheelGestures.ts`、`connectionAppearance.ts`、`connectionCrossingOrder.ts`、`objectColors.ts` 和 `genericSymbol.ts` 分别承载二维几何/视口、点阵密度、输入设备分类、线路外观、跨线排序、颜色及通用图元计算。`connections.ts`、`elementLabels.ts`、`busbarLabels.ts`、`connectionLabels.ts` 与 `symbolCatalog.ts` 负责连接/正式路由算法、三类标签布局和素材目录。它们只依赖领域类型或其他纯场景模块，不依赖 `editor/`、React 或 Three。`src/scene/GridSurface.tsx` 是明确的 WebGL 表现层，负责点阵 Shader，因此允许依赖 React Three Fiber 与 Three.js。

正式 latest-wins 路由调度位于 `src/runtime/routeEngine.ts`，Worker 位于 `src/runtime/route.worker.ts`，React 路由快照 Hook 位于 `src/runtime/useRoutedConnections.ts`。监控画布不再通过编辑目录取得 Worker、调度器或 Hook。

原 `editor/` 同名入口保留兼容重导出，`editor/geometry.ts` 只额外保留选择平移这类编辑专属纯变换。监控画布、共享场景和产品代码直接引用 `scene/` / `runtime/` 实现，避免目录级依赖图把基础能力误归入编辑器。设备面板中的 UPS 内部接线不实例化完整画布，而使用固定视窗的 `ReadOnlyDiagramScene`：输入局部 `DiagramElement`、`ConnectionNetwork` 与仅供路由的合成锚点资产，调用正式正交路由并复用共享图元、线路及静态流动；播放态由共享 SVG 原语读取 `flowPresentation` 的主监控动画配置绘制移动虚线，不额外实例化 WebGL。局部标签复用画布标签视觉原语，通过只读复合行承载同一相位的电压、电流双值，不进入项目指标 Schema。场景按图元及标签合成边界计算渲染偏移，保持内容视觉居中但不破坏 8px 路由坐标；它不承载用户视口、选择、编辑命令、Store 或持久化。

模块守卫要求两个画布引用共享场景入口，禁止运行时 React 入口导入 `DiagramCanvas` 或 `EditorCommandState`，并禁止 `src/runtime/`、`src/scene/`、`src/monitoring/` 的产品实现反向导入 `editor/`。当前应用入口还会检查编辑画布固定为编辑模式、监控工作区使用专用画布。

纯数据与 Provider 公共入口从 `src/runtime/index.ts` 导出；React 查看器和监控专用画布从 `src/runtime/react.ts` 单独导出。核心消费者不会因为只导入图纸切片或状态函数而把 React、Three.js 或 React Three Fiber 加入依赖图；React 监控消费者会加载 Three.js 动画和点阵，但不会加载整套编辑画布。

### `DiagramRuntimeBundle` v2（兼容 v1）

跨项目交付使用与项目 Schema 独立演进的运行时包：

- 固定格式标识 `aidc-diagram-runtime`，当前导出 `formatVersion` 为 `2`，解析器继续接受 v1；
- 一张或多张入口图纸、入口下级子树和到线路根的必要祖先；
- 当前项目 Schema 要求的两套线路及两个结构根，但未选择线路的根图不携带画布内容；
- 保留范围内的图元、母线、连接网络，以及这些图元实际使用的资产定义；
- 导出时刻的 Switch、2WV、CV `onOffState` 快照，以及已保存的水泵启停/输出功率实例快照；
- 已冻结并经过来源图元、目标图纸和名称一致性校验的下探映射；
- `simulation` 清单保存稳定种子、算法/设备档案版本、指标语义绑定、设备档案引用和异常分配；
- 来源项目 ID、名称、项目 Schema 版本和导出时间。

`createDiagramRuntimeBundle` 负责裁剪和生成，`serializeDiagramRuntimeBundle` / `parseDiagramRuntimeBundle` 负责同一契约下的输出与拒绝无效输入，`createDiagramRuntimeViewFromBundle` 恢复单图视图，浏览器宿主可用 `downloadDiagramRuntimeBundle` 下载 `.runtime.json` 文件。

v2 仍不导出编辑选择、历史、dirty、面板草稿、当前相机会话、逐帧读数、Provider 或 Three.js/R3F 对象，并清空项目级 `extensions`。文档 Schema 中仍有画布默认视口字段，但当前平移/缩放状态不写回项目，因此它不是会话相机快照。v1 Bundle 载入后由内容和项目 ID 生成兼容演示清单，不要求源文件迁移。

### `RuntimeBundleViewer`

另一个 React 宿主可直接把通过校验的运行时包交给 `RuntimeBundleViewer`。组件支持两种导航所有权：

- 不传 `diagramId` 时，从 `defaultDiagramId` 或第一个入口开始并在下探后更新内部图纸；
- 传入 `diagramId` 时，宿主通过 `onDiagramChange` 接入自己的 Router、Tab 或页面状态。

`animationPlaying` 由宿主控制并同时冻结/恢复演示数据时钟；`stateOverrides` 可覆盖包内 On/Off 初始状态、水泵存档快照、父级外部供电、A/B 通道、UPS 锂电接管及其他运行状态；`providers` 可替换指标和冷却数据源。未提供指标 Provider 时，查看器按 Bundle 的 `simulation` 清单零配置启动确定性演示。`onRuntimePresentationChange` 向宿主输出当前指标、设备运行态、图元和水泵派生流量，使 AIDC 可用自己的共享右侧组件渲染详情并把控制结果再通过 `stateOverrides` 回传。查看器不读取 Zustand、IndexedDB 或编辑保存状态，转发的 ref 也只包含三个缩放命令。

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

## 已实现：确定性拟真演示快照

KD-133 已用确定性 Demo Runtime Engine 改造当前默认模拟。当前数据流为：

```text
RuntimeBundle.simulation + 相对场景时钟 + 人工运行态覆盖
  -> DemoMonitorMetricDataProvider
  -> MonitorMetricRuntimeSnapshot
       ├─ device health / operation / online
       ├─ metric readings + final severity
       └─ effective On/Off / pump / valve state
  -> 电力/冷却拓扑
  -> 共享 SVG 状态与 WebGL 流动动画
```

新快照把设备健康、运行方式、指标和影响拓扑的有效状态放在同一个采样边界中，解决独立随机导致的停泵仍有流量、关闭阀仍显示大开度等矛盾。显式外部指标 Provider 和既有冷却 Provider 继续兼容；宿主未来传入真实遥测时可替换 Demo Provider。RuntimeBundle v2 保存种子、算法/设备档案版本、指标语义和异常分配，不保存每帧读数。完整范围、页面异常预算、设备指标区间和实施结果见 `DEMO_RUNTIME_SIMULATION_DESIGN.md`。

下探只通过 `runtime.navigation[elementId]` 返回目标图纸，不在渲染组件内直接修改路由或全局 Store。宿主 React 项目可以把它接到自己的 Router、Tab 或页面状态。

## 跨项目接入示例

导出侧先从当前项目生成包；On/Off 快照与 Schema v36 水泵、A/B 模板角色及子图入口通道一同成为可移植初始状态：

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
  onDiagramChange={(diagramId) => navigate(`/diagram/${diagramId}`)}
  onRuntimePresentationChange={setDiagramPresentation}
/>
```

省略 `providers` 时使用 Bundle 内置的确定性演示；接入真实数据时再传入 `providers={{ metrics, cooling }}`。

示例中的运行时入口将发布为 `@aidc/diagram-runtime`；基础 UI 统一由 AIDC 的 `@aidc/ui` 提供，详细收敛方案见 `AIDC_INTEGRATION_PREPARATION.md`。当前 v2 的资产 `source` 是元数据路径，不是内嵌资源；目标项目必须同时获得当前运行时素材目录，或在后续版本接入资产 URL resolver/内嵌方案。

## 后续交付顺序

1. 为 RuntimeBundle 增加宿主资产 URL 解析器或可选 SVG/PNG 内嵌策略，并按兼容规则升级独立格式版本。
2. 先把本项目需要的五项基础组件能力上游化到 AIDC，并发布双方共同消费的 `@aidc/ui`。
3. 将 `src/runtime` 与所需 `scene/monitoring/domain` 入口发布为 `@aidc/diagram-runtime`，以 React/Three/R3F/`@aidc/ui` 为 peer dependency，并提供运行时专用样式入口。
4. 接入 AIDC Router/工作区、右侧检查器、运行状态 Store、素材部署与数据 Provider。
5. 在目标项目复验图纸下探、播放/暂停、泵阀/Switch 状态、指标刷新和大图性能；必要时再增加带算法版本的派生路由快照。

## 本阶段验收边界

- 现有编辑与监控模式的可见行为不变化；
- 现有应用实际消费运行时视图和上下文，而不是保留两套并行拼装逻辑；
- 当前应用与跨项目入口统一使用监控专用画布；
- 跨项目 React 入口不导入编辑画布或编辑命令类型；
- 运行时、共享场景和监控算法产品代码不反向导入编辑目录；
- 默认模拟数据、泵阀状态、电力外部供电、图元下探和动画拓扑结果保持；
- 类型检查、单元/组件测试和生产构建通过；
- 当前项目 Schema v36 与 RuntimeBundle v2 均继续兼容旧项目和 v1 运行包。
