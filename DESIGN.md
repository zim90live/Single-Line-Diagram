---
name: AIDC 一次接线图
description: 沿用 AIDC 项目的中性深色、高密度运维工作台设计系统
colors:
  canvas: "#141518"
  canvas-deep: "#101114"
  panel: "rgba(27, 29, 32, 0.96)"
  panel-raised: "rgba(35, 37, 41, 0.98)"
  ink: "#f2f3ef"
  muted: "#b6b8b4"
  dim: "#858784"
  accent: "#f0f1ed"
  cooling: "#77b4bf"
  electrical: "#d5b96f"
  success: "#8eac94"
  warning: "#d9a464"
  danger: "#df816f"
typography:
  interface:
    fontFamily: "Google Sans Code Variable, Google Sans Code, PingFang SC, Microsoft YaHei, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Google Sans Code Variable, Google Sans Code, PingFang SC, Microsoft YaHei, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  small: "6px"
  control: "8px"
  panel: "12px"
  pill: "999px"
spacing:
  xs: "2px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button:
    height: "28px"
    rounded: "{rounded.control}"
  field:
    height: "32px"
    rounded: "{rounded.control}"
  status-tag:
    height: "22px"
    rounded: "{rounded.pill}"
---

# Design System: AIDC 一次接线图

## 设计真源

- `design-system/theme.json` 是活动 Token 与 Recipe 的唯一真源；`npm run generate:theme` 确定性生成 `src/styles/theme.generated.css`。
- `src/components/ui/` 只承载 Button、IconButton、TextField、SelectField、NumericField、StatusTag 与无样式 Pressable 等视觉原语。
- 图纸树、素材库、属性面板、对话框和画布工具属于业务组件，只能组合原语和 Token，不得复制原语内部视觉规则。
- 图标统一使用 Lucide。项目不再使用 Ant Design 组件或主题。

## 视觉方向

Creative North Star 是“安静的运行台”。工作区由连续的中性深色表面、低对比分隔和紧凑的等宽界面字体构成。画布和图纸内容是第一视觉焦点，外壳不使用营销式大标题、装饰插画、霓虹光效或无意义卡片。

- 常规交互保持近无彩色；冷却、电力、成功、警告和危险色只表达语义。
- 持久文本不小于 10px；项目名、面板标题和关键状态建立清晰但克制的层级。
- 固定工作区依靠一像素边界和表面明度分层；阴影只用于需要脱离工作面的对话框、侧滑面板和 Toast。
- 6px、8px、12px 分别用于小表面、控件和弹层；药丸形只用于短状态标签。
- 动画只用于控件状态和未来监控数据，不为静态装饰制造动效；需遵循 `prefers-reduced-motion`。

## 工作区布局

- 顶部 52px 项目栏：品牌、项目名、保存状态和文件操作。
- 次级 42px 工具栏：返回、线路状态、面包屑和编辑命令。
- 主区三列：260px 层级/素材栏、弹性画布、288px 属性栏；桌面最小宽度 1180px。
- 左侧树每一行固定 28px 且永不换行；长名称省略，层级类型保留。
- 新功能优先进入既有工具栏或侧栏，不在画布上覆盖与图纸无关的卡片。
- 图元锚点编辑器使用大型双栏原生模态框：260px 素材浏览栏与弹性8px锚点画布；顶部集中名称、类型和图标命令，弹窗无底部操作区。

## 画布表达

- WebGL 层绘制自适应单级点阵：8px 是最小世界单位，缩小时按 16、24、32px 等 8px 倍数降低显示密度；所有点使用相同大小、颜色和透明度，不使用连续网格线，并为后续运行态动画预留批处理能力。
- SVG 层绘制图元、标签、选择框、框选区域和变换控制柄；顶部/左侧标尺随视口同步。
- 滚轮以指针为中心缩放；鼠标中键平移；左键只负责选择、框选和编辑。
- 画布内图元拖动只在产生实际 8px 网格位移后，在 SVG 交互层、图元下方显示中性半透明十字对齐带；多选拖动时每个图元都有一组，合并裁剪后只统一着色一次。
- 多选状态下，每个图元使用中性细实线表达成员选中态，外层整体包围框使用既有虚线和缩放/旋转手柄；不新增颜色、浮层或文字标签。
- 未选中的图元只显示 SVG 本身，不添加名称、背景、滤镜或卡片外壳；白色选择边界和变换手柄只在选中态出现。用户提供的 SVG 可在素材缩略图内使用浅色衬底，画布不形成浅色卡片。
- 同一锚点的多条线路共享系统派生的共同路径；自动分叉不绘制连接点、候选锚点或手柄，普通线路也不作为接线目标。
- 独立支路选中时只强调对应逻辑连接；共同主干选中时统一强调整个线路网络。不同网络的非连接交叉继续使用局部拱桥。

## 组件与状态

- 主按钮使用浅色实底，仅用于当前上下文的主要动作；普通工具使用中性软底或透明底。
- 输入框高 32px，标签置于字段上方；属性提交以 blur/Enter 为事务边界，Escape 取消草稿。
- 图元颜色选择器在连续拖动期间只原位预览当前图元 SVG 颜色，不更新项目、历史或线路路由；确认颜色或失焦后单次提交，保持一次修改对应一步撤销。
- 锚点编辑属于即时应用例外：名称与类型直接更新项目并进入弹窗内撤销历史；关闭只退出编辑，不回滚修改。
- 冷却与电力只在短状态标签中使用对应语义色；普通选中和焦点保持中性白。
- 禁用、悬停、选中和错误必须同时通过边界/明度或文字表达，不得只依赖颜色。

## 约束

- 不新增第二套组件库、第二套图标库或散落的颜色/圆角常量。
- 不让树节点、面包屑、状态栏和素材名称换行。
- 不把 Three.js/R3F 临时对象或高频监控数据写入项目 JSON。
- 不主动以截图作视觉结论；布局、质感和图元显示效果由用户验收。
