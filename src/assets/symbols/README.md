# 图元资产目录

本目录用于存放 AIDC 一次接线图的正式图元资产。

## 约定

- 优先使用 SVG；确需位图时使用透明背景 PNG 或 WebP。
- 保留当前稳定文件名；新增素材优先使用可读的英文名称。
- 同一设备的不同样式或状态可以使用独立文件，并在名称中注明；素材目录通过一个稳定 `assetKey` 把状态文件映射为同一逻辑图元，例如 Switch 的 On/Off。
- 图元放入本目录后，还需在 `src/editor/symbolCatalog.ts` 中登记稳定的 `key`、名称、分类、画布逻辑尺寸和资源路径。
- 已进入项目 JSON 的 `assetKey` 不应随意修改；需要重命名时应提供数据迁移。
- 普通图元登记的逻辑宽高必须是 8px 整数倍；PNG 可使用更高的源像素尺寸，画布仍按登记尺寸插入，并只允许保持宽高比、宽高同时贴合 8px 网格的离散缩放。
- 画布只渲染素材内容本身，不自动添加名称、背景或卡片外壳。
- 当前 Switch、2WV、CV 均缺省使用 Off 素材，编辑属性面板与监控画布共享独立 On/Off 运行态和各自的关/开颜色槽；Generator、Grid、MP、Transformer、Tap-off Unit 使用单一实例颜色，素材源文件不修改。CV 还带有顶部入口、底部出口的止回阀语义，只允许入口→出口。
- CWP、CHWP、PHE 使用用户最新提供的 80×128 SVG，CT 使用 96×96 SVG；CPD 继续使用 80×80 透明 PNG。此前 200×80 的 CWP、CHWP、PHE PNG 与 160×160 的 CT PNG 项目会在载入时迁移实例尺寸与边缘锚点，稳定资产键和接线引用不变。
- TMU 使用用户于 2026-09-07 提供的 SVG，稳定键为 `tmu`，属于冷却图元，按 SVG 原始画布登记为 48×48。首版不预置锚点，可通过现有锚点编辑器按项目接口配置。曾使用旧 48×64、72×96 或 64×96 默认尺寸保存的实例会定向迁移，主动缩放过的实例尺寸保留。
- CDU 使用用户提供的 192×96 横版 SVG，稳定键为 `cdu`，属于冷却图元，画布逻辑尺寸为 192×96。旧 96×96 资产下保存的实例会按原横纵缩放比例迁移，旋转显示位置和既有锚点接线保持。
- `CHWP CWP Off.svg` 是 CHWP、CWP 共用的 80×128 关闭素材，2026-09-08 与两份运行 SVG 一起按附件更新；不登记独立图元。`PumpOff.png` 保留为其他显式 `coolingDeviceRole: pump` 实例的停机素材。监控停泵时切换，运行及编辑状态使用各设备原素材，几何与锚点不变。
- 素材的视觉分类与显示效果由用户验收。

## 当前专业分类

- 冷却：包括 CPD、TMU。
- 2026-09-09：九份 `Fault.svg` 为监控故障辅助素材，不进入独立素材栏；Battery-group、Tap-off Unit-group（旧 A/B）、Cabinet、UPS-group、UPS、FM、TMU、CDU、CT 在三级异常时使用，保持实例几何并不改变流动资格。
- 电力：包括 FM、Battery、Battery-group、UPS、UPS-group、Cabinet、Tap-off Unit A、Tap-off Unit B、Tap-off Unit、算力 POD、动力 POD。
- `Battery-group.svg` 显示为 Battery-group，使用稳定键 `battery-group`，是 48×48 的独立普通电力图元；首版无预置锚点、改色或运行状态，不继承现有 Battery 的监控 Source 角色。
- `UPS-group.svg` 显示为 UPS-group，使用稳定键 `ups-group`，是 48×48 的独立普通电力图元；首版无预置锚点、改色、运行状态或子图下探关系，不继承现有 UPS 的实例或监控语义。
- `Cabinet.svg` 显示为 Cabinet，使用稳定键 `cabinet-device`。2026-09-09 原 A/B 两份素材已统一为 48×48 `Tap-off Unit-group.svg`；历史键 `cabinet` / `cabinet-b` 均使用新外观和名称，保留独立锚点配置，素材栏仅显示一个入口。旧 SVG 可从 Git 恢复。
- 2026-09-07：TMU、FM、UPS-group、Cabinet 已替换为用户最新 SVG。TMU 按根画布登记为 48×48，并迁移旧默认尺寸实例；FM、UPS-group、Cabinet 的根画布与目录尺寸分别保持 64×64、48×48、48×48。
- 2026-09-08：UPS-group、CDU 再次按用户附件更新，均使用原 SVG 的 48×48 尺寸，CDU 历史版式通过载入迁移兼容。
- `Tap-off Unit.svg` 显示为 Tap-off Unit，使用稳定键 `tap-off-unit`，是 Tap-off Unit A/B 的 32×32 子图元。当前作为独立实例使用，不自动嵌入或跟随 A/B，首版不预置锚点；右侧属性面板允许修改或恢复单一实例颜色。
- 已保存项目重新打开或导入时，以本目录登记的稳定 `assetKey` 同步当前分类与素材源；一般保留已有锚点。CWP、CHWP、CT、PHE 旧布局的边缘锚点会按新画布比例吸附到对应边缘，保留 ID、名称、类型、角色及接线引用。
