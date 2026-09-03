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
- CHWP、CWP、CPD、CT、PHE 使用透明 PNG；源像素均为逻辑尺寸的 5 倍。PHE 的逻辑尺寸为 200×80，旧 80×160 竖版资产由项目解析器一次性迁移实例与锚点布局。
- TMU 使用用户最新提供的 640×960 透明 PNG，稳定键为 `tmu`，属于冷却图元，画布逻辑尺寸为 64×96；首版不预置锚点，可通过现有锚点编辑器按项目接口配置。曾使用旧 48×64 或 72×96 默认尺寸保存的实例会定向升级，主动缩放过的实例尺寸保留。
- CDU 使用用户提供的 192×96 横版 SVG，稳定键为 `cdu`，属于冷却图元，画布逻辑尺寸为 192×96。旧 96×96 资产下保存的实例会按原横纵缩放比例迁移，旋转显示位置和既有锚点接线保持。
- `PumpOff.png` 是用户提供的 1000×403 RGBA 水泵停机辅助素材，不登记独立 `assetKey`，也不显示在素材库。监控模式中任意 `coolingDeviceRole: pump` 实例停止时使用它，运行及编辑状态继续使用该设备原素材；替换不改变图元几何和锚点。
- 素材的视觉分类与显示效果由用户验收。

## 当前专业分类

- 冷却：包括 CPD、TMU。
- 电力：包括 FM、Battery、Battery-group、UPS、UPS-group、Cabinet、Tap-off Unit A、Tap-off Unit B、Tap-off Unit、算力 POD、动力 POD。
- `Battery-group.svg` 显示为 Battery-group，使用稳定键 `battery-group`，是 48×48 的独立普通电力图元；首版无预置锚点、改色或运行状态，不继承现有 Battery 的监控 Source 角色。
- `UPS-group.svg` 显示为 UPS-group，使用稳定键 `ups-group`，是 48×48 的独立普通电力图元；首版无预置锚点、改色、运行状态或子图下探关系，不继承现有 UPS 的实例或监控语义。
- 新 `Cabinet.svg` 显示为 Cabinet，使用稳定键 `cabinet-device`。原 `Cabinet A.svg` / `Cabinet B.svg` 的显示名分别为 Tap-off Unit A / B，继续使用历史键 `cabinet` / `cabinet-b`；三者是独立图元，不使用实例水平翻转互相转换。
- `Tap-off Unit.svg` 显示为 Tap-off Unit，使用稳定键 `tap-off-unit`，是 Tap-off Unit A/B 的 32×32 子图元。当前作为独立实例使用，不自动嵌入或跟随 A/B，首版不预置锚点；右侧属性面板允许修改或恢复单一实例颜色。
- 已保存项目重新打开或导入时，以本目录登记的稳定 `assetKey` 同步当前分类与素材源；一般保留已有锚点，PHE 旧竖版锚点仅迁移坐标和方向并保留 ID、类型及接线引用。
