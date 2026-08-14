# AIDC 编辑器与 UI 基线重构归档

- 日期：2026-08-13
- 状态：实现完成，待用户验收
- 对应决策：KD-012

## 结论

基于 AntV X6 和 Ant Design 的初版已停止使用。活动实现改为项目内独立维护的混合二维架构：Three.js / React Three Fiber / GLSL 负责 WebGL 网格底层，SVG 负责图元、标尺、选择、框选和变换手柄，自定义交互层采用 begin → preview → commit/cancel 的单手势单历史事务。

UI 改用从 AIDC 方法裁剪出的 typed Token / Recipe、确定性 CSS 生成和 React 基础原语，图标统一使用 Lucide。项目不依赖 AIDC 相邻目录的运行时文件。

## 同步修复

- 画布图元提交改为同步写入 Zustand 文档，消除旧 X6/rAF 同步导致保存读取旧数据的风险。
- diagram viewport 与项目 JSON 连通，缩放/平移可随保存、导出和重新打开恢复。
- 打开本地已保存项目不再错误标记 dirty；导入 JSON 仍标记为待保存。
- 属性字段以 blur/Enter 为事务边界，避免每个字符建立历史记录。

## 验证

- `npm run typecheck` 通过。
- `npm test`：6 个测试文件、17 项测试通过。
- `npm run build` 通过，且构建前校验主题生成文件与 Token 真源一致。
- `npm run test:e2e`：无截图真实浏览器流程通过，覆盖 WebGL/SVG 分层、缩放、平移、插入、拖放、选择、变换、多选、框选、剪贴板、撤销、下钻和本地保存。

视觉、密度、图元清晰度和标尺/网格观感仍由用户验收。
