# 图元资产目录

本目录用于存放 AIDC 一次接线图的正式图元资产。

## 约定

- 优先使用 SVG；确需位图时使用透明背景 PNG 或 WebP。
- 保留当前稳定文件名；新增素材优先使用可读的英文名称。
- 同一设备的不同样式或状态可以使用独立文件，并在名称中注明；素材目录通过一个稳定 `assetKey` 把状态文件映射为同一逻辑图元，例如 Switch 的 On/Off。
- 图元放入本目录后，还需在 `src/scene/symbolCatalog.ts` 中登记稳定的 `key`、名称、分类、画布逻辑尺寸和资源路径。
- 已进入项目 JSON 的 `assetKey` 不应随意修改；需要重命名时应提供数据迁移。
- 普通图元登记的逻辑宽高必须是 8px 整数倍；PNG 可使用更高的源像素尺寸，画布仍按登记尺寸插入，并只允许保持宽高比、宽高同时贴合 8px 网格的离散缩放。
- 画布只渲染素材内容本身，不自动添加名称、背景或卡片外壳。
- 当前 Switch、2WV、CV 均缺省使用 Off 素材，编辑属性面板与监控画布共享独立 On/Off 运行态和各自的关/开颜色槽；Generator、Grid、MP、Transformer、Tap-off Unit 使用单一实例颜色，素材源文件不修改。CV 还带有顶部入口、底部出口的止回阀语义，只允许入口→出口。
- CWP、CHWP 使用 64×64 SVG，CT 使用 128×128 SVG，PHE 使用 80×80 SVG（2026-09-18 批次）；CPD 使用 80×80 SVG，旧 PNG 作为兼容资源保留。CWP、CHWP、CT、PHE 的旧 PNG/SVG 布局在载入时迁移实例尺寸与边缘锚点，稳定资产键和接线引用不变。
- TMU 使用用户于 2026-09-18 提供的 SVG，稳定键 `tmu`，冷却分类，默认 48×48。仍不预置锚点；旧 48×64、72×96、64×96 默认尺寸按既有规则迁移，主动缩放实例沿用既有兼容策略。
- CDU 使用用户于 2026-09-18 提供的 48×48 SVG，稳定键 `cdu`，冷却分类。旧版式实例按原缩放比例换算到当前素材尺寸并吸附网格，锚点 ID、接线引用和旋转保留。
- `CHWP CWP Off.svg` 是 CHWP、CWP 共用的 64×64 关闭素材，2026-09-18 与运行素材一起更新，不登记独立图元；`PumpOff.png` 保留为其他水泵的停机素材。正常与关闭态共用实例几何和锚点，切换状态不改变尺寸。
- 素材的视觉分类与显示效果由用户验收。

## 当前专业分类

- 冷却：包括 CPD、TMU。
- MP 作为通用传感器，冷却与电力图纸均可使用；单测量端口按图纸适配，不作为设备进出口或电源/负载。稳定键与尺寸保持。
- 2026-09-09：九份 `Fault.svg` 为监控故障辅助素材，不进入独立素材栏；Battery-group、Tap-off Unit-group（旧 A/B）、Cabinet、UPS-group、UPS、FM、TMU、CDU、CT 在三级异常时使用，保持实例几何并不改变流动资格。
- 电力：包括 FM、Battery、Battery-group、UPS、UPS-group、Cabinet、Tap-off Unit A、Tap-off Unit B、Tap-off Unit、算力 POD、动力 POD。
- `Battery-group.svg` 显示为 Battery-group，使用稳定键 `battery-group`，是 48×48 的独立普通电力图元；首版无预置锚点、改色或运行状态，不继承现有 Battery 的监控 Source 角色。
- `UPS-group.svg` 显示为 UPS-group，使用稳定键 `ups-group`，是 48×48 的独立普通电力图元；首版无预置锚点、改色、运行状态或子图下探关系，不继承现有 UPS 的实例或监控语义。
- `Cabinet.svg` 显示为 Cabinet，使用稳定键 `cabinet-device`。2026-09-09 原 A/B 两份素材已统一为 48×48 `Tap-off Unit-group.svg`；历史键 `cabinet` / `cabinet-b` 均使用新外观和名称，保留独立锚点配置，素材栏仅显示一个入口。旧 SVG 可从 Git 恢复。
- 2026-09-07：TMU、FM、UPS-group、Cabinet 已替换为用户最新 SVG。TMU 按根画布登记为 48×48，并迁移旧默认尺寸实例；FM、UPS-group、Cabinet 的根画布与目录尺寸分别保持 64×64、48×48、48×48。
- 2026-09-08：UPS-group、CDU 再次按用户附件更新，均使用原 SVG 的 48×48 尺寸，CDU 历史版式通过载入迁移兼容。
- `Tap-off Unit.svg` 显示为 Tap-off Unit，使用稳定键 `tap-off-unit`，是 Tap-off Unit A/B 的 32×32 子图元。当前作为独立实例使用，不自动嵌入或跟随 A/B，首版不预置锚点；右侧属性面板允许修改或恢复单一实例颜色。
- 已保存项目重新打开或导入时，以本目录登记的稳定 `assetKey` 同步当前分类与素材源；一般保留已有锚点。CWP、CHWP、CT、PHE 旧布局的边缘锚点会按新画布比例吸附到对应边缘，保留 ID、名称、类型、角色及接线引用。

- 2026-09-18：更新 CWP、CHWP、CT、PHE、CDU、TMU、CHWP CWP Off、TMU Fault、CDU Fault、CT Fault 共 10 个 SVG。Fault 尺寸分别为 TMU/CDU 48×48、CT 128×128，均与对应正常素材一致。旧尺寸说明归档见 `../../../docs/archive/2026-09-18-cooling-symbol-sizes.md`，当前规则见 KD-206。
