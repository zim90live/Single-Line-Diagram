# AIDC 一次接线图编辑器

面向 AIDC 运维人员的桌面端 Web 编辑器。当前版本完成第一阶段基础编辑与图元锚点定义闭环：冷却/电力双线路、园区/楼宇/POD/设备层级下钻、图元编辑、资产级接线锚点、本地项目保存以及 JSON 导入导出。

## 启动

环境要求：Node.js 22+。

```bash
npm install
npm run dev
```

浏览器打开终端输出的本地地址。当前按 Chrome/Edge 桌面端设计，窗口宽度建议不低于 1180px。

## 当前能力

- 图元拖入或双击插入，单选、多选和框选。
- 移动、等比缩放、90° 步进旋转和 8px 网格吸附。
- 顶部/左侧标尺、画布平移和缩放。
- 属性面板编辑名称、设备标识、坐标、尺寸和角度；2WV、CV、Generator、Grid、MP、Switch、Transformer 可修改实例颜色。
- 撤销/重做、复制/粘贴、删除、全选快捷键。
- 冷却、电力两棵独立图纸树及层级下钻/返回。
- IndexedDB 本地保存/打开，版本化 JSON 导入/导出。
- 从素材 hover 编辑入口打开双栏锚点编辑器，在图元边缘 8px 网格点定义名称、类型和自动外向方向。

当前注册 `src/assets/symbols/` 中的 21 个 SVG 文件，呈现为 20 个逻辑图元：`SwitchOn.svg` 与 `SwitchOff.svg` 统一为默认 Off 的 `Switch`，On/Off 切换留给后续监控运行态。锚点只定义后续接线端点，线路连接、线路管理与监控模式明确后置。

## 操作提示

| 操作 | 方式 |
| --- | --- |
| 插入图元 | 从左侧拖入画布，或双击素材 |
| 编辑锚点 | hover 素材后点击右上角编辑图标 |
| 修改图元颜色 | 选中支持改色的单个图元，在右侧“图元颜色”中选择；可恢复默认 |
| 追加选择 | `Shift` / `Ctrl` / `⌘` + 单击 |
| 框选 | 在画布空白处拖动 |
| 平移画布 | 按住鼠标中键拖动 |
| 缩放画布 | 直接滚动滚轮，或使用工具栏 +/- |
| 复制 / 粘贴 | `Ctrl` / `⌘` + `C` / `V` |
| 撤销 / 重做 | `Ctrl` / `⌘` + `Z`；`Ctrl` / `⌘` + `Shift` + `Z` |
| 全选 / 删除 | `Ctrl` / `⌘` + `A`；`Delete` / `Backspace` |

## 质量检查

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

`test:e2e` 使用无截图的真实浏览器 DOM 断言；测试服务使用端口 `41735`。项目约定不由自动化代理主动进行视觉验收，目视检查清单见 [第一阶段验收清单](docs/FIRST_PHASE_ACCEPTANCE.md)。

## 项目文档

- [项目目标](docs/PROJECT_GOALS.md)
- [关键决策](docs/KEY_DECISIONS.md)
- [当前 TODO](docs/TODO.md)
- [第一阶段方案](docs/FIRST_PHASE_DESIGN_BRIEF.md)
- [图元锚点编辑器方案](docs/SYMBOL_ANCHOR_EDITOR_BRIEF.md)
- [设计系统](DESIGN.md)
- [文档入口](docs/README.md)
