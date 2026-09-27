# Music Box 开发接力文档

## 0. 接力结论

当前首页已经是一个可运行的 Next.js 15 + Three.js 音乐墙原型。卡片墙已按 `docs/REFERENCE-LAYOUT.md`（QA 实测的参考站点规格）改成球面墙：15 列固定宽度，每列各自上下循环移动，竖直拖拽带动所有列，快速甩动有惯性；保留视差、点击试听、随机选歌和固定 HUD。

1440×900、开启“减少动态效果”时，投影后的每张卡与 `docs/reference-layout/layout_sim.py` 的预测相差不到 0.1px，中心卡 x 范围约 601–839。本地验证必须按顺序执行，不要并行：

```powershell
npm run lint
npm run build
npm run typecheck
```

lint、生产构建与 TypeScript 检查均通过。

代码现已托管在 GitHub `uea162/music-box`。`main` 是事实来源；每个任务单独开分支并提交 Pull Request，不要直接推送到 `main`。接手后应先阅读本文件和 `src/components/jukebox/JukeboxExperience.tsx`。

---

## 1. 当前任务目标

### 1.1 原本要实现什么

目标是在不重写业务和 UI 的前提下，复刻参考站点 `https://www.bubbbly.com/jukebox` 的核心视觉体验：

- 全屏暗色音乐卡片墙。
- 卡片贴在球面前半部分上，用透视相机观察，而不是平面 grid。
- 中央卡片正对用户、最大、最亮；越往四周越窄越矮、越暗。
- 每列各自缓慢上下循环移动（偶数列向上、奇数列向下），墙体水平方向可以拖动并无缝循环。
- 每列上下错落，宽列里每隔两槽出现一对并排半宽卡。
- 点击卡片显示白色圆角选中边框并播放 iTunes 试听。
- UI 层固定在 viewport：`Music Box` 标题、右上计数、底部 `Let the room choose` 控制面板不随墙体移动。
- 保留鼠标拖拽、滚轮、轻微 parallax 和 `prefers-reduced-motion`。
- 最近一轮额外要求：卡片放大约 30%–40%，桌面主卡宽度 220–260px；同屏卡片减少；外层圆角 22–28px；封面圆角 16–20px；减少半透明重叠。

### 1.2 当前已完成程度

已完成：

- Next.js 首页、全屏 WebGL canvas 和固定 UI 层。
- 球面墙：顶点着色器把每张卡的 10×14 网格弯到球面上，按朝向逐像素压暗。
- 每列独立的自动上下移动，开场从 16 倍速逐渐降到正常速度；所有运动共用一个目标速度。
- 水平按墙宽无缝 `wrap`，垂直按每列一圈长度独立 `wrap`。
- 最短列优先排放、宽列并排半宽卡、按屏高补足每列长度。
- 鼠标轻微 parallax。
- 指针拖拽（所有列一起动）、甩动惯性、滚轮浏览，以及在球面上解析求交的点击命中。
- CanvasTexture 卡片绘制，包含封面、标题、歌手、进度条、播放状态。
- 大圆角透明裁切、圆角白色选中框。
- 单一 `<audio>` 试听播放器。
- `/api/catalog` iTunes 搜索聚合、去重与 fallback。
- 随机选歌、聚焦、结果面板和返回墙面流程。
- 独立 vignette 层。
- 播放进度更新时只重绘状态变化的卡片，避免全量纹理重绘。
- `npm run lint`、`npm run build` 和 `npm run typecheck` 通过。

### 1.3 尚未完成或未充分验证

- 最新“大卡片”参数只重点验证了 1440×900 桌面视口；移动端和平板端尚未完成视觉回归。
- 墙体不再自动横移，水平接缝只能靠拖拽经过；数学 wrap 已实现，未在真机上拖满一整圈看过。
- 放大卡片后，“Pick one record” 的 `FOCUS_SCALE_WIDE = 1.38` 桌面聚焦效果尚未在真机上视觉验证，可能过度放大。
- 没有 WebGL 不可用时的 2D fallback。
- 天气、地区、图片分析、规则推荐与 AI 推荐尚未实现；目前按钮是随机选歌。
- 没有自动化单元测试、视觉回归测试或端到端测试文件。
- Safari、低端移动设备和真机触摸惯性尚未验证。reduced-motion 只在无头 Chromium 里验证过（含实时切换）。

---

## 2. 已修改文件

### 2.1 最新一轮修改：球面墙与统一目标速度

#### `src/components/jukebox/JukeboxExperience.tsx`

本轮的主要修改文件，也是当前关键逻辑所在：

- 圆柱墙整体换成 `docs/REFERENCE-LAYOUT.md` 描述的球面墙。所有可调数值都是文件顶部的具名常量，注释里标了对应的规格章节。
- 布局：15 个固定宽度的列，固定种子洗牌后逐首放进当前最短的列；宽度 ≥ 200 的列在第 2、5、8… 槽放两张并排半宽卡；每列不足 1.5 屏高时用本列自己的歌循环补槽，相邻不重复。
- 投影：卡片网格 `PlaneGeometry(1, 1, 10, 14)` 由顶点着色器弯到球面上；相机按视口计算距离和视场角，使 z = 0 平面上 1 个世界单位等于 1 屏幕 px。朝向压暗在片元着色器里逐像素做。
- 运动：每列 `offset = 300 + 137·i ± speed_i·D + scroll_i`。`D` 是统一速度倍率对时间的积分；倍率只向一个目标速度逼近，播放、按住、惯性、聚焦、减少动态效果都只是让目标变成 0。开场倍率从 16 开始，以 1.6/s 逼近 1。
- 拖拽与惯性：`DRAG_SCOPE = "all-columns"`，竖直拖拽让所有列一起移动；松手前停顿超过 80 ms 速度清零，否则按 3.5/s 衰减滑行，低于 4 单位/秒停下。
- 缩放：尺寸入口只有一个，`ResizeObserver` 观察 canvas。每次尺寸变化都连续重算比例和相机；只有补槽数量变化时才重排卡片，而且复用已有网格和材质，不重建场景、不重画纹理、不重新请求封面。
- 纹理：每首歌一张共享纹理，另加一张给唯一的选中/播放卡。白框只画在这张上，墙上最多一张白框。
- 重排后：原选中卡还在就保留；不在了就换成离屏幕中心最近的同歌副本。聚焦状态下重新执行 focus；否则选中卡只要被屏幕边缘切到一点，就移回屏幕中心。
- 暂停时立即清空 `playingId`，墙体不用等 `pause` 事件就开始恢复移动。
- 开发调试挂钩移到 `src/components/jukebox/debug.ts`，开发模式下动态加载。

#### `src/app/globals.css`

- `.result-panel` 的 `left` 改为 `min(calc(50% + 205px), calc(100% - 面板宽 - 21px))`。宽屏仍在聚焦卡右侧；约 1232px 以下贴着右边留 21px，821–1189 宽时整块面板和按钮都在屏幕内。

#### 文档

- 新增 `docs/REFERENCE-LAYOUT.md`、`docs/reference-layout/README.md`、`docs/reference-layout/layout_sim.py`（QA 提供的参考规格和模拟脚本，数值以它为准）。
- `docs/ACCEPTANCE.md` 新增 S、S-RM、F7、F8，并改了已经过时的 V1、V8、R3、L2、M6。

关键逻辑：文件顶部常量、`buildBaseColumns` / `extendColumns`、场景 effect 里的 `stepMotion`、`placeCards`、`relayout`、`applyViewport`、`settleViewport`，以及 `refreshCards`。`drawCard` 本轮未改。

### 2.2 本项目此前已创建或修改的文件

仓库现已托管在 GitHub `uea162/music-box`。首次提交之前的修改没有逐轮 Git 记录，因此无法从 Git 精确恢复“每一轮”的文件历史。以下是本次项目工作中已知创建或修改、且组成当前实现的文件：

- `src/app/globals.css`
  - 全屏 shell、暗色背景、独立 `.vignette`、固定品牌区、右上计数、底部 dock、结果面板、响应式样式。
  - 关键逻辑是 `.vignette { position: fixed; pointer-events: none; }`，以及各 UI 层高于 canvas 的 z-index。
- `src/app/layout.tsx`
  - 全局 metadata、`zh-CN` HTML 和全局 CSS。
  - 用 `next/font/google` 引入 Instrument Serif 与 Bricolage Grotesque，并以 CSS 变量 `--font-display`、`--font-ui` 暴露。见 3.6。
- `src/app/api/catalog/route.ts`
  - 服务器端并行请求 8 个 iTunes 搜索词，每个最多 10 首。原有 6 个艺人固定 `US` 商店；陳奕迅、方大同使用 `HK` 商店，以便返回繁体艺人名和可试听曲目。
  - 各词结果按搜索词轮询交错，并按 track id 去重，再截取最多 54 首，避免后加入的艺人被顺序截断丢掉。单个搜索词超时或失败只丢掉该词，其他词照常返回；合并后不足 12 首时才返回本地 fallback。
  - 5 秒超时。成功响应（HTTP 200）按搜索词 revalidate 6 小时；非 2xx 不写入 Data Cache，下次请求会重试。路由本身不设置 `revalidate` 或 `dynamic = "force-static"`。
  - 服务器环境变量 `ITUNES_SEARCH_URL` 可覆盖 iTunes 搜索地址，不设置时默认为 `https://itunes.apple.com/search`。只在服务端读取，用于把目录请求指到本地假接口做失败和恢复测试；不要用 `NEXT_PUBLIC_` 前缀。
- `src/app/page.tsx`
  - 首页仅渲染 `<JukeboxExperience />`。
- `src/data/fallback-songs.ts`
  - 18 首离线占位歌曲及调色板；无试听 URL。
- `src/types/song.ts`
  - 当前 `Song` 类型。
- `README.md`
  - 启动、验证和当前能力说明。
- `docs/PRD.md`
  - 产品需求和阶段规划。部分规划功能尚未实现。
- `docs/ARCHITECTURE.md`
  - 目标架构和 ADR。注意其目录结构是长期规划，不等于当前实际目录。
- `.gitignore`、`package.json`、`package-lock.json`、`tsconfig.json`、`next.config.ts`、`next-env.d.ts`
  - 项目脚手架、依赖和构建配置。

生成物，不应手工编辑或作为业务修改处理：

- `.next/`
- `node_modules/`
- `tsconfig.tsbuildinfo`

用户提供的参考素材，未被代码修改：

- `resource/2026-09-27 16-26-49.mp4`
- `resource/ScreenShot_2026-09-27_162438_489.png`

---

## 3. 当前实现方案

### 3.1 页面和组件结构

当前实际结构较集中：

```text
src/app/page.tsx
└── JukeboxExperience
    ├── canvas.scene-canvas       Three.js 音乐墙
    ├── div.vignette              固定暗角层
    ├── header.brand              Music Box 标题
    ├── div.corner-index          records in rotation
    ├── loading-copy
    ├── result-scrim/result-panel Framer Motion 结果层
    ├── div.dock-anchor           底部面板定位与居中（left / bottom / width / translateX）
    │   └── motion.section.dock   面板外观与透明度、纵向动画，不加 CSS transform
    ├── source-note
    └── audio                     单一试听播放器
```

React 管理低频业务状态：歌曲列表、加载阶段、选中歌曲、播放 ID、试听进度和结果面板。Three.js 在一个 `useEffect` 中管理高频场景状态，避免每帧触发 React render。

### 3.2 3D 卡片墙

实现文件：`src/components/jukebox/JukeboxExperience.tsx`。规则来源：`docs/REFERENCE-LAYOUT.md`。

- 墙面单位与屏幕 px 的换算：`scale = max(vw / 1500, 0.36)`。
- 列：`COLUMN_WIDTHS` 共 15 列，列间距 14，墙宽 3090。卡片高 = 宽 × 1.44。
- 排放：`SHUFFLE_SEED` 固定种子洗牌（线性同余 + Fisher–Yates），然后每首放进一圈最短的列（并列取序号小的）。宽列下标 `% 3 == 1` 的槽放两张半宽卡，宽 `(W − 14) / 2`。
- 补足：`extendColumns` 让每列一圈长度 ≥ `1.5 · vh / scale`，只用本列自己的歌、只在末尾追加，所以已有槽的歌和位置不变。
- 实例编号：`instanceIndex = (列 × 4096 + 槽) × 2 + 左右`，同一槽的编号在重排前后不变。
- 水平：列相对视角的距离 `wrap` 到 `[-墙宽/2, 墙宽/2)`；首屏第 7 列（250 宽）居中。
- 竖直：每列按自己的一圈长度 `wrap`。
- 球面：`R = 1.2 · hypot(vw, vh) / 2 / scale`，`eye = 3.2 · hypot / 2`，`fov = 2·atan(vh / 2 / eye)`。顶点着色器：

```glsl
a = turn + u * w / R;  b = tilt + v * h / R;
X = S*cos(b)*sin(a);  Y = -S*sin(b);  Z = S*(cos(a)*cos(b) - 1);
```

- 剔除：`|turn|` 或 `|tilt|` 大于 1.35、朝向低于 `M = S/(eye+S) − 0.04`、或投影偏移超过 `0.62·视口 + 卡片尺寸` 时不画。
- 明暗：`mix(0.3, 1, smoothstep(M, M + 0.5, cos a · cos b))`。
- 点击：把屏幕射线和球面解析求交，换算成 (turn, tilt) 后判断落在哪张卡的角度范围内，不用 Raycaster。

### 3.3 动画逻辑

一个 `requestAnimationFrame` 循环，每帧 `dt = min(帧间隔, 50 ms)`，顺序是 `stepMotion → 视差/缩放 → placeCards → syncActiveFace → render`。

- **统一目标速度**：`resolveTargetSpeed()` 是唯一决定目标的地方。减少动态效果、按住、惯性滑行中、正在播放、聚焦中，任一成立时为 0，否则为 1。
- **倍率**：`speed += (target − speed)·(1 − exp(−dt·k))`，目标为 0 时 `k = 6`（约 300 ms 停住），目标为 1 时 `k = 1.6`。开场把 `speed` 设为 16，于是开场曲线就是 `1 + 15·exp(−1.6·t)`，没有另一套缓动。
- **偏移**：`columnOffset(i) = 300 + 137·i + dir_i·COLUMN_SPEEDS[i]·D + scroll[i]`，偶数列 `dir = +1`（卡片向上）。
- **输入**：拖拽、滚轮、惯性、聚焦滑动都只调 `nudge()` 累加到待处理量，由 `stepMotion` 在同一处写入 `pan` / `scroll`。拖拽换算 `1 px = 1 / (scale × 聚焦缩放)` 单位，所以跟手。
- **惯性**：松手时取最近 100 ms 的平均速度；最后一次移动距松手超过 80 ms 则为 0。`v ← v·exp(−3.5·dt)`，低于 4 单位/秒停止。按下时清零。
- **减少动态效果**：`matchMedia` 的 `change` 监听实时生效。开启时倍率立即归零、惯性清零、视差归零，聚焦直接跳到位；关闭时倍率从 0 以 1.6/s 恢复，不重放开场。
- **视差**：墙体整体平移最多 ±10 / ±6 px，按住拖拽时冻结，保证拖拽 1:1。
- **聚焦**：`focus(songId)` 选离屏幕中心最近的副本，以 7.5/s 把它滑到中心；缩放目标 ≤ 820 为 1.1、以上 1.38，以 5/s 逼近。`fitFocus` 算出可用区域（视口减 16 px 边距，再减结果面板：宽屏在右侧，紧凑布局在下方），卡片放不下时缩小缩放目标；卡片会和面板重叠时把整个 group 在屏幕上平移（与视差一样改 `group.position`，不改墙的偏移）。面板挂载后再量一次真实位置（`refit`）。
- **点中卡片**：卡片被屏幕边缘切到时，`bringIntoView` 二分查找最小的滑动距离，经 `nudge()` 滑到完整可见为止，不强制居中。

### 3.4 当前完整视觉参数

除背景和 vignette 外，下列参数都是 `JukeboxExperience.tsx` 顶部的具名常量。

| 常量 | 值 | 作用 |
| --- | --- | --- |
| `COLUMN_WIDTHS` | `150, 200, 165, 215, 175, 225, 190, 250, 185, 230, 170, 210, 160, 205, 150` | 15 列宽度（墙面单位） |
| `CARD_ASPECT` | `1.44` | 卡片高 / 宽 |
| `WALL_GAP` | `14` | 列间、槽间、并排卡之间的间距 |
| `PAIR_MIN_COLUMN_WIDTH` / `PAIR_SLOT_EVERY` / `PAIR_SLOT_PHASE` | `200` / `3` / `1` | 并排半宽卡规则 |
| `SHUFFLE_SEED` | `20260921` | 洗牌种子，只影响歌落在哪 |
| `CENTER_COLUMN` | `7` | 首屏居中的列 |
| `MIN_LOOP_SCREENS` | `1.5` | 每列一圈至少几个屏高 |
| `MAX_SLOTS_PER_COLUMN` | `4096` | 补槽上限，也用于实例编号 |
| `START_OFFSET_BASE` / `START_OFFSET_STEP` | `300` / `137` | 各列初始错位 |
| `COLUMN_SPEEDS` | `19, 27, 16, 24, 21, 29, 17, 25, 20, 23, 18, 26, 22, 28, 19` | 各列 1× 速度（单位/秒） |
| `RUNNING_SPEED` / `STOPPED_SPEED` | `1` / `0` | 目标速度的两个取值 |
| `INTRO_SPEED` | `16` | 开场初始倍率 |
| `SPEED_EASE_TO_RUN` / `SPEED_EASE_TO_STOP` | `1.6` / `6` /s | 倍率逼近目标的速率 |
| `MAX_FRAME_SECONDS` | `0.05` | 每帧 dt 上限 |
| `DRAG_SCOPE` | `"all-columns"` | 竖直拖拽作用于所有列（可选 `"pressed-column"`） |
| `CLICK_MOVE_TOLERANCE_PX` | `7` | 移动小于它算点击 |
| `INERTIA_DECAY` | `3.5` /s | 惯性衰减 |
| `INERTIA_STOP_SPEED` | `4` 单位/秒 | 惯性停止阈值 |
| `INERTIA_IDLE_RESET_MS` | `80` | 松手前静止超过它则不滑行 |
| `INERTIA_SAMPLE_WINDOW_MS` | `100` | 松手速度的取样窗口 |
| `DESIGN_WIDTH` / `MIN_SCALE` | `1500` / `0.36` | 屏幕缩放 |
| `SPHERE_RADIUS_FACTOR` / `EYE_DISTANCE_FACTOR` | `1.2` / `3.2` | 球半径、相机距离（乘半对角线） |
| `HORIZON_BIAS` | `0.04` | 背面阈值 `M` 的偏移 |
| `MAX_CARD_ANGLE` / `CULL_MARGIN` | `1.35` / `0.62` | 剔除 |
| `CARD_SEGMENTS_X` / `CARD_SEGMENTS_Y` | `10` / `14` | 卡片网格细分 |
| `SHADE_FLOOR` / `SHADE_SPAN` | `0.3` / `0.5` | 明暗衰减 |
| `ALPHA_CUTOFF` | `0.01` | 丢弃透明圆角像素 |
| `FOCUS_SCALE_WIDE` / `FOCUS_SCALE_COMPACT` / `COMPACT_LAYOUT_MAX_WIDTH` | `1.38` / `1.1` / `820` | 聚焦缩放的首选值（放不下时才缩小）；宽度 ≤ 820 用紧凑值，与 CSS 断点一致 |
| `FIT_SEARCH_STEPS` | `18` | 点中被边缘切到的卡时，二分查找最小滑动距离的步数 |
| `FOCUS_GLIDE_RATE` / `FOCUS_SETTLED_UNITS` / `FOCUS_SCALE_RATE` | `7.5` /s / `0.5` / `5` /s | 聚焦滑动与缩放 |
| `PARALLAX_SHIFT_X_PX` / `PARALLAX_SHIFT_Y_PX` / `PARALLAX_RATE` | `10` / `6` / `2.8` /s | 视差 |
| `RESIZE_SETTLE_MS` | `150` | 缩放停止后多久做重新聚焦 / 重新居中 |
| `CARD_TEXTURE_WIDTH` / `CARD_TEXTURE_HEIGHT` | `420` / `604` | 每张卡片纹理 |
| `MAX_PIXEL_RATIO` | `1.6` | renderer 像素比上限 |
| `FOCUS_MARGIN_PX` / `RESULT_PANEL_GAP_PX` | `16` / `24` | 聚焦卡和点中卡可用区域的边距、与结果面板的间距 |
| `RESULT_PANEL_WIDTH_PX` / `RESULT_PANEL_EDGE_PX` / `RESULT_PANEL_BESIDE_CENTER_PX` / `RESULT_PANEL_COMPACT_TOP_SHARE` | `390` / `21` / `205` / `0.5` | 面板挂载前预测它的位置（与 `.result-panel` 一致） |
| `CARD_CORNER` / `CARD_ART_CORNER` | `0.105` / `0.075` | 卡片、封面圆角（占卡宽，中心卡约 25 / 18 px） |
| `CARD_*` 其余 | 见文件 | 参考规格第 9 节的底色、氛围色、封面、标题、副标题、进度条、时间、控制按钮、边框 |

卡片绘制见 `drawCard`：底色 `#1d1921`，模糊封面做氛围色，封面内缩 5%，标题（Instrument Serif）6.6%，副标题 4.5%，进度条在约 82% 高度，下方时间和上一首 / 播放 / 下一首。边框常态 0.5% 12% 白，播放 1.5%，选中 2.2% 纯白。

页面底色是 `#0c090e`。紫色径向光在 `.jukebox-shell` 上，数值来自参考站：

```css
radial-gradient(60% 50% at 50% 45%, #2a1430 0%, #150d19 45%, #0c090e 100%)
```

Vignette 定义在 `src/app/globals.css` 的 `.vignette`，是一圈椭圆形暗角（上下左右一起压暗），同样照抄参考站：

```css
radial-gradient(
  72% 66% at 50% 48%,
  transparent 38%,
  rgba(12, 9, 14, 0.55) 68%,
  rgba(12, 9, 14, 0.97) 96%
)
```

该层使用 `position: fixed; inset: 0; z-index: 5; pointer-events: none`。原来的暖色噪点层已去掉。

### 3.5 为什么采用当前方案

- 使用 Three.js 而不是 DOM grid，是因为需要统一的球面映射、真实 perspective 和大量卡片高频运动。
- 使用 CanvasTexture，而不是每张卡一个复杂 DOM，是为了避免几十个 DOM 卡片每帧参与布局与合成。
- React 和 Three.js 状态分离，避免墙体每帧运动触发 React render。
- 使用 wrap 后复用同一批 mesh，形成无限墙，不持续创建和销毁卡片。
- 使用透明圆角纹理 + `alphaTest` + `depthWrite`，兼顾圆角和减少重叠发灰。
- 使用指数形式、与 delta time 相关的 lerp，使不同刷新率下手感接近。

### 3.6 字体

网页层不再声明 Iowan Old Style 或 Avenir Next。字体由 `src/app/layout.tsx` 的 `next/font/google` 加载，并通过 `variable` 挂在 `<html>` 上：

| CSS 变量 | 字体 | 用途 |
| --- | --- | --- |
| `--font-display` | Instrument Serif，字重 400 | 标题（`Music Box`、结果面板歌名） |
| `--font-ui` | Bricolage Grotesque，字重 400 与 500 | 界面文字，包括按钮（字重 500） |

`globals.css` 在变量后面接中文系统后备：`"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"`。界面字体栈以 `sans-serif` 结尾，标题字体栈以 `serif` 结尾。

后续如果要在 canvas 里画卡片文字，从这两个变量读取实际 family 名：

```js
getComputedStyle(document.documentElement).getPropertyValue("--font-display")
getComputedStyle(document.documentElement).getPropertyValue("--font-ui")
```

`drawCard` 就是这样做的（`cardFonts()`）：标题用 `--font-display` 400，歌手名和时间用 `--font-ui` 400 / 500，后面接繁体在前的中文后备列表。纹理先按当时可用的字体画；如果 web 字体还没加载完，`document.fonts.load` + `document.fonts.ready` 完成后所有纹理重画一次。

---

## 4. 当前存在的问题

### 4.1 已知问题和潜在 bug

1. **点击命中仍按矩形判断。**
   - 球面上的命中是按卡片的角度矩形算的，卡片纹理角落是透明圆角。
   - 点击透明圆角区域理论上仍可能选中卡片。

2. **手机上聚焦卡偏小。**
   - 390 宽时 `FOCUS_SCALE_COMPACT = 1.1`，聚焦卡只有约 40–100 px 宽（按落在哪一列）。F8 规定了 1.1，要放大需先改验收标准。

3. ~~宽屏上结果面板可能盖住聚焦卡的一部分。~~ 已修：聚焦卡在面板左侧（紧凑布局在面板上方）的可用区域内。

4. **外部曲库失败时重复卡明显。**
   - fallback 只有 18 首，15 列每列只分到 1–2 首，补足到 1.5 屏高后同一列几乎全是同一首歌。
   - 功能稳定，但封面和标题重复会降低高级感。

5. **透明材质和 depth write 的极端角度风险。**
   - 当前桌面截图没有明显排序错误。
   - 但透明材质开启 depth write 在卡片极度交叉时可能出现遮挡不符合预期，需要在移动端和拖拽极限位置验证。

6. **暂停后选中卡会随墙移走。**
   - 播放时各列停止，暂停后恢复移动，选中卡会慢慢移出屏幕。这与参考站点一致。

7. **source note 在 fallback 时仍写 iTunes previews。**
   - Dock 会显示 `Offline study catalog`，但右下角 source note 文案是固定的。

### 4.2 视觉上仍可能需要调整

- 左侧标题与大卡会发生明显叠压；这与参考风格一致，但最终暗度和遮挡程度仍需用户主观确认。
- 1440 宽时中心卡（250 列）约 239px。卡片尺寸由 `scale` 和球面参数决定，要改先改 `docs/REFERENCE-LAYOUT.md` 再改常量。
- 中央卡约三行可见，底部 dock 会覆盖部分卡片；当前是预期的 UI 分层，但尚未在所有高度验证。
- 边缘卡的压缩和变暗完全来自球面投影和 `SHADE_FLOOR / SHADE_SPAN`，不要再叠加额外的 scale / opacity 曲线。

### 4.3 性能现状

- 修复前，播放歌曲后 `refreshCards` 每次进度更新会重画所有卡片，实测一度约 5.94fps。
- 已改为比较 `visualState`，只重画变化卡片；播放状态下复测约 120fps。
- 该数字来自 Codex in-app Chromium、1440×900、高刷新率机器，不等于低端设备保证。
- 每张纹理为 420×604 RGBA，数量为“歌曲数 + 1”，与墙上的实例数无关（54 首时 55 张）。390×844 下墙上约 250 个实例，都共用这些纹理。移动端 GPU 内存仍需 profile。
- 页面隐藏时没有显式暂停 Three.js render loop。浏览器通常会节流，但代码没有 `visibilitychange` 控制。

### 4.4 尚未验证

- 真机上的 360–430px 手机和 768–1024px 平板视觉（无头 Chromium 下已和模拟脚本对照）。
- 低端 Android 和 iOS Safari。
- 真机 60Hz 下开场曲线的速率 k（规格里标注 ±15% 不确定）。
- 横向拖满一整圈的接缝。
- WebGL context lost/recovery。
- iTunes CORS、封面加载失败和试听 URL 失效的完整错误 UI。
- 键盘操作；Canvas 卡片目前主要依赖指针。

### 4.5 已尝试但效果不好的方案

不要重复以下方向，除非有明确新理由：

1. **中心径向放大式鱼眼。**
   - 早期使用 `radialDistance`、`centerLift` 和 `fishScale`，同时按 x/y 距离放大中心卡。
   - 结果像中间鼓起的一团，而不是连续圆柱墙；放大后还会覆盖相邻卡片。
   - 后来改为圆柱坐标 + 距离驱动景深，现已换成球面墙（见 3.2）。

2. **半径 7.15 的强弯曲圆柱。**
   - 边缘卡被过度压缩到中间，左右出现空边。
   - 后来改为 `CYLINDER_RADIUS = 15` 才能同时覆盖全屏并保留约 35–45° 侧向旋转。

3. **16×6 小卡全屏。**
   - 虽然能铺满，但视觉太密、卡片只有约 130px、透明重影多。
   - 当前已改为 12×5 和约 225px 大卡。

4. **`depthWrite: false` 的大量半透明卡。**
   - 多层卡片颜色叠加，画面发灰、凌乱。
   - 当前使用透明圆角裁切、`alphaTest: 0.01` 和 `depthWrite: true`。

5. **构建和 typecheck 并行。**
   - `next build` 会重建 `.next/types`，与 `tsc --noEmit` 并行时曾出现找不到生成文件的 TS6053 竞态。
   - 不是源码错误。后续必须顺序运行 build 和 typecheck。

6. **播放时全量纹理重绘。**
   - 导致严重掉帧，已通过 `visualState` 比较修复。

---

## 5. 下一步明确任务

### P0 必须继续做

#### ~~P0.1 验证并修正放大后的随机聚焦流程~~ ✅ 已完成

- 1440×900 下 1.38 不过大（250 列整卡聚焦后约 270×390 px），保留；缩放只在卡片放不下可用区域时变小。聚焦卡在结果面板左侧（≤ 820 宽时在面板上方），三种尺寸下都完整在屏幕内、不和面板重叠。点中被边缘切到的卡会滑到完整可见。见 3.3 “聚焦”“点中卡片”。

#### P0.2 完成移动端和平板视觉回归

- **改哪里：** 主要是 `JukeboxExperience.tsx` 的 columns/rows、camera 参数和 `globals.css` 的 `@media (max-width: 820px)`。
- **预期结果：** 卡片仍覆盖视口，圆角和间距清楚，底部 dock 不遮住主要中心卡，拖拽可用且帧率稳定。
- **建议方法：** 至少验证 390×844、768×1024、1440×900。不要直接用桌面参数缩放；必要时按断点设置 camera Z 或独立 card scale。

#### P0.3 验证完整无缝循环

- **改哪里：** `placeCards` 中列的水平 `wrap(column.x - viewX, wallWidth)`，以及每列竖直 `wrap(..., column.length)`。
- **预期结果：** 横向拖过接缝、纵向滚过每列循环点时没有空洞、抖动或间距突变。
- **建议方法：** 墙体不再自动横移，用拖拽或滚轮横向走一整圈（3090 单位）。不要提交任何调试调速开关。

#### ~~P0.4 修复跨断点 resize 不重排~~ ✅ 已完成

- PR #5 先做了跨断点重建；本轮改成连续缩放：任何尺寸变化都只重算比例和相机，补槽数量变化时复用网格重排，不重建场景。验收见 `docs/ACCEPTANCE.md` 的 R1–R6、S10。

### P1 建议继续做

#### P1.1 修正透明圆角的点击命中

- **改哪里：** 在 `hitCard` 求交之后加圆角判定。
- **预期结果：** 点击透明圆角不选中卡片。
- **建议方法：** 求交得到的 (turn, tilt) 换算成卡内坐标后，用解析式圆角矩形判断（圆角半径与 `drawCard` 的 `CARD_CORNER` 一致）；不要为每张卡创建复杂圆角几何体。

#### P1.2 改善 fallback 的重复感

- **改哪里：** `fallback-songs.ts` 或 wall visual instance 生成。
- **预期结果：** iTunes 超时时仍有足够多不同标题、色彩和封面占位，不出现一屏大量完全重复卡。
- **建议方法：** 扩展本地 fallback 至 36–54 条，或为重复视觉实例生成可区分但稳定的调色变化；不要伪造真实艺人封面。

#### P1.3 页面隐藏时暂停渲染

- **改哪里：** Three.js effect。
- **预期结果：** tab hidden 时停止或显著降低 rAF 工作，返回时平滑恢复且不发生 delta 跳跃。
- **建议方法：** 监听 `visibilitychange`，暂停请求帧或跳过 render，并重置 `lastFrameTime`。

#### P1.4 补充错误和降级 UI

- **改哪里：** catalog fetch、封面加载、audio play catch、WebGL 初始化。
- **预期结果：** 外部目录、封面、试听或 WebGL 失败时用户能理解发生了什么，页面仍可操作。
- **建议方法：** 优先添加轻量状态提示；不要引入新的复杂面板。

### P2 可选优化

#### P2.1 拆分渲染引擎文件

- **改哪里：** 把 `JukeboxExperience.tsx` 中的布局、纹理绘制、Three 场景和交互逐步移动到 `src/engine/jukebox/`。
- **预期结果：** 保持现有行为，降低单文件复杂度，方便单元测试。
- **建议方法：** 先提取纯函数 `layout` 和 `card-texture`，不要一次性重写成 React Three Fiber。

#### P2.2 纹理缓存和图片生命周期

- **改哪里：** CanvasTexture 和 Image 创建部分。
- **预期结果：** 重建断点或曲库时减少重复图片请求和 canvas 分配。
- **建议方法：** 以 artwork URL 建 Map/LRU；注意销毁 GPU texture，但不要销毁仍被其他实例使用的资源。

#### P2.3 正式性能追踪

- **改哪里：** 无需先改业务代码。
- **预期结果：** 获得桌面和移动设备上的 GPU、主线程、纹理内存和帧率基线。
- **建议方法：** Chrome Performance + WebGL renderer info；分别测静止、自动移动、拖拽、播放进度和结果面板。

---

## 6. 验证方式

### 6.1 启动项目

```powershell
cd D:\Project\codex-project\music-box
npm install
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

如 3000 被占用：

```powershell
npm run dev -- -p 3002
```

### 6.2 编译和类型检查

必须按顺序运行，不要并行：

```powershell
npm run lint
npm run build
npm run typecheck
```

当前最后一次结果：三者均成功。`build` 与 `typecheck` 不能并行，见 4.5 第 5 条。lint 放在它们前面，与 CI 的顺序一致。

### 6.3 当前没有的测试

- 没有 `test` 脚本。
- 没有 Jest/Vitest 单元测试。
- 没有 Playwright/Cypress E2E。
- 没有截图基线。

### 6.4 UI 验收清单

桌面建议使用 1440×900：

1. 页面加载后无需操作，各列开场先快后慢，之后偶数列缓慢向上、奇数列缓慢向下，墙体不横移。
2. 中心卡片（250 列）约 239px 宽，外圆角明显，封面圆角清楚。
3. 中心卡片最大、最亮、最清晰。
4. 越往四周卡片越窄越矮、越暗，像贴在球面上。
5. 同屏约三行大卡，宽列里有并排半宽卡，不应出现大片半透明重影。
6. 四周有椭圆形暗角，上下左右都压暗；暗角不能阻断鼠标事件。
7. `Music Box`、右上计数和底部面板固定，不随卡片墙移动。标题下没有副标题。
8. 鼠标缓慢移到四角，墙体有轻微 parallax，UI 不动，页面不应剧烈摇晃。
9. 按住墙面所有列约 300 ms 内停住；竖直拖拽所有列一起跟手移动；快速甩动后滑行一小段，拖完停住再松手不滑行。
10. 滚轮应纵向浏览各列，触控板横向手势可改变墙体位置。
11. 点击中央卡片后出现粗白色圆角边框并播放试听，墙体停住；再次点击同一卡应暂停，墙体恢复移动；再点从暂停处继续。
12. 播放时进度条更新，动画不能明显掉帧。
13. 点击 `Pick one record`，检查聚焦、结果面板和返回流程；821、1000、1189 宽时面板完整可见。
14. 控制台不应出现运行时 error。
15. 开启“减少动态效果”，按 `docs/ACCEPTANCE.md` 的 S-RM 检查。

性能验证建议：

- 至少观察 10 秒静止自动运动、10 秒拖拽和 10 秒播放状态。
- 当前 in-app Chromium 在播放状态下 rAF 采样约 120fps；正式目标是普通 60Hz 桌面保持接近 60fps。

---

## 7. Git 状态

### 7.1 仓库与分支

代码托管在 GitHub：`uea162/music-box`（https://github.com/uea162/music-box）。

`main` 是唯一事实来源。不要在 `main` 上直接开发或推送。每个任务单独开分支，完成后通过 Pull Request 合入 `main`。

查看当前分支与仓库根目录：

```text
git branch --show-current
git rev-parse --show-toplevel
```

### 7.2 CI

Pull Request，以及推送到 `main` 时，GitHub Actions 严格按顺序执行：

```text
npm ci
npm run lint
npm run build
npm run typecheck
```

`build` 和 `typecheck` 不能并行。`next build` 会重建 `.next/types`，与 `tsc --noEmit` 同时跑时曾出现找不到生成文件的 TS6053 竞态（见 4.5 第 5 条）。本地验证也必须按这个顺序。

### 7.3 当前实现的核心文件

源码的核心仍集中于第 2、3 节所写的实现，主要是：

- `JukeboxExperience.tsx`：球面墙布局与投影、各列自动移动、拖拽与惯性、圆角卡片纹理、交互、试听和性能优化。
- `globals.css`：全屏暗色 UI、固定 vignette、标题、控制面板和响应式。
- `api/catalog/route.ts`：iTunes 目录聚合与 fallback。

具体改动以对应分支相对 `main` 的 Pull Request diff 为准。

### 7.4 工作区注意

用 `git status` 判断是否有未提交修改。未提交的本地改动不会进入 CI，也不会出现在 Pull Request 里。不要在未审查的情况下执行 `git reset --hard`、`git clean` 或覆盖未跟踪文件。

---

## 8. 给下一个 Agent 的注意事项

1. **墙面布局和运动以 `docs/REFERENCE-LAYOUT.md` 为准。**
   - 列宽、间距、并排规则、初始错位、各列速度、球面参数、拖拽和惯性数值都来自 QA 实测。
   - 要改数值，先确认参考站点有变化并更新该文档，再改 `JukeboxExperience.tsx` 顶部对应的常量。用 `docs/reference-layout/layout_sim.py` 对照截图。

2. **所有可调数值都放在文件顶部的具名常量里。**
   - 不要在函数里写裸数字。新增参数时同时更新第 3.4 节的表。

3. **只有一个目标速度。**
   - 播放、按住、惯性、聚焦、减少动态效果只能通过 `resolveTargetSpeed()` 影响自动移动。
   - 拖拽、滚轮、惯性、聚焦滑动只能调 `nudge()`，由 `stepMotion` 统一写入偏移。不要再加一套各自改偏移的逻辑。
   - 开场加速就是倍率从 16 逼近 1，不要另写开场动画。

4. **竖直拖拽带动所有列（`DRAG_SCOPE = "all-columns"`）。**
   - 这是 QA 在参考站点实测确认的，不要改成只拖按住的那一列。

5. **减少动态效果必须实时生效。**
   - 没有自动移动、没有开场加速、松手不滑行、拖拽仍 1:1、视差关闭；`matchMedia` 的 `change` 监听不能删。
   - 惯性以 `docs/ACCEPTANCE.md` 的 S-RM 和代码为准：减少动态效果时关闭惯性。`docs/REFERENCE-LAYOUT.md` 第 10 节记录的是参考站在该模式下仍有惯性，本仓库不照搬。

6. **缩放不重建场景。**
   - 尺寸入口只有 canvas 上的一个 `ResizeObserver`。尺寸变化只重算比例和相机；补槽数量变化才 `relayout`，而且复用网格、材质和纹理。
   - 不要为了断点重新创建纹理、重新请求封面或重新开场。
   - 重排后选中卡和正在播放的歌不能丢，`<audio>` 不能重新开始。结果面板打开时要重新 focus；选中卡被边缘切到就移回中心。

7. **保留 UI 与墙体分层。**
   - canvas 独立运动；标题、计数、dock 和 vignette 是固定 DOM 层，不要放进 Three group。
   - `.dock-anchor` 负责定位和居中，`motion.section.dock` 只做外观和纵向动画，不要给它加 CSS transform。

8. **页面上只能有一个动画循环和一个 `<audio>`。**
   - 不要为每张卡创建播放器，不要加第二个 rAF。

9. **卸载或重建时释放所有资源。**
   - 取消 rAF，移除 pointer / wheel 监听、`matchMedia` 监听，断开 `ResizeObserver`，清掉定时器，dispose 几何体、所有材质和纹理，中止封面下载。

10. **纹理按歌共享，白框最多一张。**
    - 每首歌一张纹理，另加一张给唯一的选中/播放卡；白框只能画在这张上。
    - `refreshCards` 的 `unchanged` 短路必须保留，删掉后播放时会严重掉帧。

11. **调试挂钩只在开发模式、只读。**
    - `window.__musicBoxDebug`（`memory()`、`activeLoops()`、`highlights()`、`cardPoints()`、`motion()`）只在 `process.env.NODE_ENV === "development"` 下挂载，生产构建里不能出现（在干净的 `.next` 上 build 后，`grep -R __musicBoxDebug .next` 应无结果）。
    - 全局名只写在 `src/components/jukebox/debug.ts` 里，组件在开发分支里用动态 `import()` 加载它。生产构建不会编译这个文件，webpack 缓存里也就没有这个名字。不要改成静态 import。
    - 不要加调速或任何写入型的调试开关。

12. **构建和 typecheck 必须顺序执行。**
    - 并行执行会与 `.next/types` 生成过程发生竞态。

13. **`drawCard` 按参考规格第 9 节绘制。**
    - 数值都是文件顶部的 `CARD_*` 常量。圆角按 `docs/ACCEPTANCE.md` V2（约 25 / 18 px），不是参考站的 7% / 3.5%。
    - 字体从 `--font-display` / `--font-ui` 读取，中文后备繁体在前；不要再写死字体名。字体加载完成后所有纹理只重画一次。

14. **不要切换 React Three Fiber，不要把用户参考素材加入网页或上传。**
    - `resource/` 仅用于视觉对照。

15. **天气和地区是明确延后需求。**
    - 不要未经用户确认扩大到定位、天气或图片上传。

16. **文档中的长期架构不是当前代码事实。**
    - `docs/ARCHITECTURE.md` 描述了未来的 engine/store/server 分层；当前核心仍在一个组件中。

---

## 9. 最近一次验证记录

- 日期：2026-09-27。
- 环境：无头 Chrome 148 + SwiftShader 软件渲染（没有硬件 GPU），帧率低且不稳定，时间常数类的观察只能看趋势。
- 目录：拦截 `/api/catalog` 得到 54 首，带 wav 试听和 png 封面。
- 布局：开启减少动态效果，1440×900、768×1024、390×844 三个视口下，每张可见卡的投影外接矩形与 `layout_sim.py --mode ours --songs 54` 相差 ≤ 0.09 px，可见列集合一致。1440 中心卡 x ≈ 600.7–839.3。
- 运动：偶数列向上、奇数列向下，各列速率比例与 `COLUMN_SPEEDS` 一致；竖直拖 200 px 时 15 列都移动 200 px；快甩 30 px 后滑行约 80 px；停 120 ms 再松手速度为 0。
- 减少动态效果：加载即静止、拖拽 1:1、甩动不滑行；实时关闭后倍率从 0 升到约 0.86（未超过 1），实时开启后立即归零。
- 跨断点：播放中 1440→1000→390→1000→1440 来回 10 次，声音不断，白框 1 张、播放标记 1 张，选中卡始终完整在屏内；`memory()` 保持 1 个几何体、55 张贴图，`activeLoops()` 为 1，封面没有重新请求。
- 结果面板：821、1000、1189、1440、390 宽时面板完整在屏内，“Back to the wall” 可点。
- `npm ci`、`npm run lint`、`npm run build`、`npm run typecheck` 顺序执行通过；`grep -R __musicBoxDebug .next` 无结果。
