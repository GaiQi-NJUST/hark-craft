# HARK CRAFT · 由 Hark 打造

一个方块构成的世界 —— 基于 **Vite + React 18 + TypeScript + three.js** 的 Minecraft 风格体素沙盒。
重点是**光影展示**（ACES 色调映射、实时阴影、体素 AO、SSAO、辉光、体积光、调色、昼夜循环），玩法保持简单：走、跳、飞、挖、放。

---

## 快速开始

```bash
npm i
npm run dev        # 开发模式，浏览器打开终端里显示的地址（默认 http://localhost:5173）
```

生产构建：

```bash
npm run build      # = tsc --noEmit（类型检查零错误）+ vite build
npm run preview    # 本地预览 dist/
```

- `vite.config.ts` 使用 `base: './'`，`dist/` 可放到任意静态托管的任意子路径。
- 生产构建输出为**单个经典脚本（IIFE）**并以 `<script defer>` 引入，因此 **直接双击 `dist/index.html`（file://）也能运行**（浏览器禁止 file:// 加载 ES Module，这是特意做的兼容）。
- 需要支持 WebGL2 的现代浏览器（Chrome / Edge / Safari 16+ / Firefox）。

### 调试用 URL 参数（可选）

| 参数 | 作用 |
| --- | --- |
| `?quality=high\|medium\|low` | 强制画质档位（默认：桌面「高」，触屏「低」） |
| `?skipIntro` | 跳过开场动画，直接进入推镜与标题 |
| `?autoplay` | 世界加载后自动开始游戏 |
| `?seed=12345` | 固定世界种子 |
| `?time=0.25` | 初始时间（0=日出，0.25=正午，0.5=日落，0.75=午夜） |
| `?fixedStep` | 固定 1/60 秒步长（录屏 / 无头截图用） |
| `?budget=ms` | 覆盖每帧区块生成预算（无头测试用） |

---

## 操作说明

**键盘鼠标**

| 按键 | 功能 |
| --- | --- |
| W A S D | 移动 |
| 空格 | 跳跃（飞行时上升） |
| Shift | 疾跑（飞行时下降） |
| F | 切换飞行模式（落地自动退出） |
| 鼠标 | 转动视角（点击画面锁定指针；浏览器不支持时自动改为**按住拖拽转向**） |
| 左键（按住） | 破坏方块（有裂纹阶段 + 碎屑粒子） |
| 右键 | 放置当前方块 |
| 1–9 / 滚轮 | 切换物品栏（草、泥土、石头、沙子、原木、木板、玻璃、荧石、雪） |
| T（按住） | 时间快进 ×40 |
| F3 | 调试信息（FPS、坐标、朝向/生物群系、区块数、绘制调用） |
| M | 静音开关 |
| Esc | 暂停菜单（继续 / 画质 / 重新生成世界 / 观看开场动画） |

**触屏**：左下虚拟摇杆移动（推到底自动疾跑），右侧滑动转向，「破坏」按住挖掘，「放置」点击放置，「跳跃」「飞行」，右上「Ⅱ」暂停；点击物品栏切换方块。

开场动画可点击或按任意键跳过。一天约 6 分钟，从日出开始；夜晚有星空、月亮与萤火虫。

---

## 架构

```
src/
├─ main.tsx                 React 入口（不使用 StrictMode，避免 WebGL 引擎重复创建）
├─ App.tsx                  场景状态机 splash → title → playing ⇄ paused；挂载引擎与各 UI 层
├─ store.ts                 zustand 共享状态（场景、画质、物品栏、时间、调试信息、提示）
├─ engine/
│  ├─ Engine.ts             渲染器 + 主循环 + 阶段编排（intro → push → world），对 UI 暴露 startGame/resume/pause/regenerateWorld/replayIntro
│  ├─ PostFX.ts             EffectComposer：Render → GTAO(SSAO) → UnrealBloom → 径向体积光 → OutputPass(ACES+sRGB) → 调色/暗角/胶片颗粒
│  ├─ Lighting.ts           唯一投影平行光（日/月）+ 半球光；阴影相机跟随玩家并按纹素对齐防闪烁
│  ├─ SkySystem.ts          昼夜循环：three Sky 大气散射（扩展了白天增益与夜色）、星空、像素月亮、雾/水面/曝光同步
│  └─ Quality.ts            画质档：SSAO、阴影贴图、渲染距离、像素比、体积光采样、生成预算
├─ world/
│  ├─ Blocks.ts             方块注册表（渲染类型、碰撞、贴图、自发光、摆动、硬度、粒子色）+ 物品栏
│  ├─ TextureAtlas.ts       程序化 16×16 像素风 Canvas 图集（无外部图片）、等距图标、破坏裂纹
│  ├─ TerrainGen.ts         种子化 simplex 噪声：大陆/丘陵/山脊高度场，平原/森林/沙漠/雪原，橡树/云杉、花草
│  ├─ Chunk.ts              16×16×48 区块数据（Uint8Array）
│  ├─ ChunkMesher.ts        合并几何 + 面剔除 + 逐顶点体素 AO + 各向异性对角线翻转（零分配热循环）
│  └─ World.ts              区块管理：按距离增量生成/网格化（每帧时间预算）、卸载、编辑后只重建本区块（边界处连同邻居）
├─ player/
│  ├─ PlayerController.ts   AABB 分轴扫掠碰撞、重力、跳跃、疾跑、飞行、游泳、视角晃动与疾跑 FOV
│  ├─ Input.ts              键盘 / 指针锁定（失败回退拖拽视角）/ 滚轮 / 触屏状态
│  ├─ Raycast.ts            Amanatides–Woo 体素 DDA 射线
│  └─ Interaction.ts        选中发光描边、按住破坏（8 阶裂纹）、放置（不会把方块放进自己身体里）
├─ fx/
│  ├─ Water.ts              水面着色器：顶点波浪、解析法线、菲涅尔天空反射、太阳闪烁高光
│  ├─ Foliage.ts            方块材质；onBeforeCompile 注入树叶/草/花随风摆动（阴影深度材质同步摆动）与荧石自发光
│  ├─ Particles.ts          破坏碎屑（InstancedMesh）、白天尘埃光斑、夜晚萤火虫（HDR → 辉光）
│  └─ SplashScene.ts        开场：数百个方块飞入拼成 3D「HARK」，金色扫光、体积光、尘埃，碎裂坠落
├─ audio/
│  └─ Synth.ts              WebAudio 合成：缓慢换和弦的氛围铺底 + 破坏/放置/按钮音；首次交互后才发声
└─ ui/
   ├─ SplashOverlay.tsx     开场中文字幕「由 Hark 打造 · 一个方块构成的世界」与跳过提示
   ├─ TitleScreen.tsx       标题：方块 Logo、开始游戏 / 画质 / 操作说明、右下角 “Made by Hark”
   ├─ BlockLogo.tsx         用图集贴图逐像素绘制带倒角与挤出的方块字 Logo
   ├─ HUD.tsx               准星、日月时间指示、F3 调试面板、提示 Toast
   ├─ Hotbar.tsx            9 格物品栏（图集生成的等距图标）
   ├─ PauseMenu.tsx         暂停菜单
   ├─ HelpPanel.tsx         操作说明弹窗（桌面/触屏两套）
   ├─ TouchControls.tsx     虚拟摇杆 + 滑动转向 + 动作按钮
   ├─ pixelFont.ts          5×7 像素字体（开场与 Logo 共用）
   └─ styles.css            毛玻璃方块风 UI、缓动过渡
```

### 渲染管线与光影（按「造型 → 材质 → 光照 → 特效」顺序）

1. **造型**：区块合并网格，只生成暴露面；十字交叉面片表现花草；水面顶部下沉 1/8。
2. **材质**：像素风图集（Nearest 过滤、sRGB），顶点色烘焙体素 AO；镂空材质 alphaTest；荧石通过 `aEmissive` 输出 HDR 自发光。
3. **光照**：`ACESFilmicToneMapping` + sRGB 输出；单一投影 DirectionalLight（高 4096 / 中低 2048）+ HemisphereLight；阴影相机紧贴玩家、纹素对齐，调好 `bias / normalBias`；白天太阳、夜晚切换为冷色月光（在地平线处交接，无跳变）。
4. **特效**：GTAO（屏幕空间 AO，仅高画质）→ UnrealBloom（太阳、荧石、萤火虫、描边）→ 朝向太阳的径向体积光 → ACES → 分离调色（高光偏暖、阴影偏青）+ 暗角 + 胶片颗粒；雾颜色与天空地平线同步；水面动态波浪与菲涅尔；树叶草花随风摆动；白天尘埃、夜晚萤火虫。

### 画质档

| | 高（桌面默认） | 中 | 低（触屏默认） |
| --- | --- | --- | --- |
| SSAO (GTAO) | ✔ | ✘ | ✘ |
| 阴影贴图 | 4096 | 2048 | 2048 |
| 渲染距离（区块半径） | 8 | 6 | 4 |
| 像素比上限 | 2 | 1.5 | 1 |
| 体积光 | 60 采样 | 40 采样 | 关 |
| 4×MSAA | 桌面端开启 | 桌面端开启 | 桌面端开启 |

### 性能要点

- 区块 16×16×48；按与玩家距离排序，**每帧在时间预算内**增量生成/网格化（生成约 1ms/区块，网格化约 2–3ms/区块，测于 ARM 无头环境）。
- 编辑方块只重建所在区块，若在区块边界则连同相邻区块（含对角）重建。
- 网格化器预计算所有面常量，热循环无对象分配，使用可增长 TypedArray 与复用缓冲。
- 远处区块卸载，但保留玩家的编辑记录，回来时会恢复。

---

## 已知限制

- 荧石只有自发光与辉光，**不会照亮周围方块**（没有方块光照传播 / 点光源，以保持 60fps）。
- 没有洞穴、存档、生存要素（血量、合成、怪物）；「重新生成世界」会丢失当前建造。
- 水是静态方块（不流动）；玩家在水中可游泳。
- 部分浏览器（如嵌入 iframe 时）不允许指针锁定，会自动切换为按住拖拽转向。
- 首次进入时如果渲染距离内的区块还在生成，远处地形会在雾中逐步出现。
