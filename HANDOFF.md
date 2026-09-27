# Music Box 开发接力文档

## 0. 接力结论

当前首页已经是一个可运行的 Next.js 15 + Three.js 音乐墙原型。最近一轮修改没有重写结构，而是在现有 `JukeboxExperience` 内把卡片改为更大、更圆、数量更少的 3D 圆柱墙，并保留自动横向流动、拖拽、视差、点击试听、随机选歌和固定 HUD。

桌面端在 1440×900 的实测结果为：中心卡片约 225px 宽，明显圆角，约三行大卡可见，中央清晰、两侧缩小变暗并后退。歌曲播放时浏览器采样约 120fps（测试机器为高刷新率设备），控制台无错误。生产构建与 TypeScript 检查均通过。

代码现已托管在 GitHub `uea162/music-box`。`main` 是事实来源；每个任务单独开分支并提交 Pull Request，不要直接推送到 `main`。接手后应先阅读本文件和 `src/components/jukebox/JukeboxExperience.tsx`。

---

## 1. 当前任务目标

### 1.1 原本要实现什么

目标是在不重写业务和 UI 的前提下，复刻参考站点 `https://www.bubbbly.com/jukebox` 的核心视觉体验：

- 全屏暗色音乐卡片墙。
- 卡片排列在大型圆柱形或弧形 3D 墙面上，而不是平面 grid。
- 中央卡片正对用户、最大、最亮；两侧卡片逐渐旋转、缩小、变暗并退入纵深。
- 卡片墙缓慢、连续、电影感地横向流动，并能在两端无缝循环。
- 每列上下错落，保留轻量 masonry 感。
- 点击卡片显示白色圆角选中边框并播放 iTunes 试听。
- UI 层固定在 viewport：`Music Box` 标题、右上计数、底部 `Let the room choose` 控制面板不随墙体移动。
- 保留鼠标拖拽、滚轮、轻微 parallax 和 `prefers-reduced-motion`。
- 最近一轮额外要求：卡片放大约 30%–40%，桌面主卡宽度 220–260px；同屏卡片减少；外层圆角 22–28px；封面圆角 16–20px；减少半透明重叠。

### 1.2 当前已完成程度

已完成：

- Next.js 首页、全屏 WebGL canvas 和固定 UI 层。
- Three.js 圆柱墙坐标映射。
- requestAnimationFrame 驱动的自动横向流动。
- 水平按列无缝 `wrap`，垂直按每列高度独立 `wrap`。
- shortest-column masonry 分配和轻微卡片高度差。
- 中心距离驱动的 `scale / opacity / brightness / rotateY / translateZ`。
- 鼠标轻微 parallax。
- 指针拖拽、滚轮浏览和 Raycaster 点击。
- CanvasTexture 卡片绘制，包含封面、标题、歌手、进度条、播放状态。
- 大圆角透明裁切、圆角白色选中框。
- 单一 `<audio>` 试听播放器。
- `/api/catalog` iTunes 搜索聚合、去重与 fallback。
- 随机选歌、聚焦、结果面板和返回墙面流程。
- 独立 vignette 层与噪点层。
- 播放进度更新时只重绘状态变化的卡片，避免全量纹理重绘。
- `npm run lint`、`npm run build` 和 `npm run typecheck` 通过。

### 1.3 尚未完成或未充分验证

- 最新“大卡片”参数只重点验证了 1440×900 桌面视口；移动端和平板端尚未完成视觉回归。
- 尚未等待完整水平循环周期验证接缝。当前桌面一圈约 214 秒；短时自动移动已验证，数学 wrap 已实现。
- 放大卡片后，“Pick one record” 的 `targetScale = 1.38` 桌面聚焦效果尚未重新视觉验证，可能过度放大。
- 浏览器跨断点 resize 不会重新创建卡片数量；场景只在歌曲列表变化时重建。
- 没有 WebGL 不可用时的 2D fallback。
- 天气、地区、图片分析、规则推荐与 AI 推荐尚未实现；目前按钮是随机选歌。
- 没有自动化单元测试、视觉回归测试或端到端测试文件。
- Safari、低端移动设备、触摸惯性、完整 reduced-motion 模式尚未验证。

---

## 2. 已修改文件

### 2.1 最新一轮视觉修改

#### `src/components/jukebox/JukeboxExperience.tsx`

本轮的主要修改文件，也是当前关键逻辑所在：

- 卡片世界尺寸从小卡调整为 `1.65 × 2.34`。
- 横纵 gap 调整为 `0.22 / 0.22`。
- 相机调整为 `PerspectiveCamera(48)`，`z = 7.4`，使桌面中心卡约 225px。
- 桌面布局从 16×6 降为 12×5；平板 9×6；移动 6×7。
- 外层卡片使用 Canvas 透明圆角裁切，圆角 46 canvas px。
- 封面圆角改为 34 canvas px。
- 选中框改为圆角白框，半径 40 canvas px。
- 材质启用 `alphaTest: 0.01` 与 `depthWrite: true`，减少透明卡片叠加发灰。
- 高度差缩小到 `0.94–1.04`，减少过乱的尺寸变化。
- 强化边缘卡片的 scale、brightness、opacity、rotateY 和负 Z。
- 优化 `refreshCards`：仅当播放、选中或进度状态变化时重画对应 CanvasTexture，修复播放时掉帧。

关键逻辑：`drawCard`、Three.js 初始化 effect、`animate`、`refreshCards`。

### 2.2 本项目此前已创建或修改的文件

仓库现已托管在 GitHub `uea162/music-box`。首次提交之前的修改没有逐轮 Git 记录，因此无法从 Git 精确恢复“每一轮”的文件历史。以下是本次项目工作中已知创建或修改、且组成当前实现的文件：

- `src/app/globals.css`
  - 全屏 shell、暗色背景、独立 `.vignette`、噪点层、固定品牌区、右上计数、底部 dock、结果面板、响应式样式。
  - 关键逻辑是 `.vignette { position: fixed; pointer-events: none; }`，以及各 UI 层高于 canvas 的 z-index。
- `src/app/api/catalog/route.ts`
  - 服务器端并行请求 8 个 iTunes 搜索词，每个最多 10 首。原有 6 个艺人固定 `US` 商店；陳奕迅、方大同使用 `HK` 商店，以便返回繁体艺人名和可试听曲目。
  - 各词结果按搜索词轮询交错，并按 track id 去重，再截取最多 54 首，避免后加入的艺人被顺序截断丢掉。单个搜索词超时或失败只丢掉该词，其他词照常返回；合并后不足 12 首时才返回本地 fallback。
  - 5 秒超时，Next revalidate 6 小时。
- `src/app/page.tsx`
  - 首页仅渲染 `<JukeboxExperience />`。
- `src/app/layout.tsx`
  - 全局 metadata、`zh-CN` HTML 和全局 CSS。
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
    ├── section.dock              Let the room choose
    ├── source-note
    └── audio                     单一试听播放器
```

React 管理低频业务状态：歌曲列表、加载阶段、选中歌曲、播放 ID、试听进度和结果面板。Three.js 在一个 `useEffect` 中管理高频场景状态，避免每帧触发 React render。

### 3.2 3D 卡片墙

实现文件：`src/components/jukebox/JukeboxExperience.tsx`。

- 每张卡由一个离屏 `canvas` 绘制为 `THREE.CanvasTexture`。
- 所有卡共享一个 `PlaneGeometry(CARD_WIDTH, CARD_HEIGHT)`，每张卡各有 `MeshBasicMaterial`。
- `wallSongs` 保证至少覆盖当前断点需要的 `columns × rows`。歌曲不足时克隆视觉实例，并给实例 ID 加 `-wall-${index}`，防止一个歌曲的多个视觉实例同时出现选中态。
- 卡片使用 shortest-column 算法分配到当前最短列，形成轻量 masonry。
- 每列保存独立 `columnSpan`，垂直位置通过 `wrap(baseY + current.y, columnSpan)` 循环。
- 水平位置通过 `wrap(baseX + current.x + autoOffset, wallSpan)` 循环，`wallSpan = columns × horizontalPitch`。
- 圆柱映射：

```ts
theta = flatX / CYLINDER_RADIUS
cylinderX = sin(theta) * CYLINDER_RADIUS
cylinderZ = (cos(theta) - 1) * CYLINDER_RADIUS
```

### 3.3 动画逻辑

主循环使用 `requestAnimationFrame`，按实际 delta time 更新：

- delta 最大限制 0.05 秒，避免切回页面时发生大跳跃。
- 自动横移：`autoOffset += delta * speed`，然后 wrap。
- 拖拽时速度降到普通速度的约四分之一，而不是完全停止。
- 拖拽目标使用 `current.lerp(target, 1 - exp(-delta * 7.5))` 平滑跟随。
- parallax 使用 `1 - exp(-delta * 2.8)` 平滑跟随鼠标。
- 聚焦 scale 使用 `1 - exp(-delta * 5)`。
- 没有 bounce、spring 或 overshoot。
- `prefers-reduced-motion` 时关闭自动横移和 parallax，但拖拽仍可用。

### 3.4 当前完整视觉参数

除 vignette 外，下列参数均定义在 `src/components/jukebox/JukeboxExperience.tsx`。

| 参数 | 当前值 | 定义和作用 |
| --- | --- | --- |
| card width | `CARD_WIDTH = 1.65` world units | 文件顶部；1440×900 中心卡约 225px |
| card height | `CARD_HEIGHT = 2.34` world units | 文件顶部；保持 420×604 纹理比例 |
| horizontal gap | `CARD_GAP_X = 0.22` | 文件顶部；`horizontalPitch = width + gap` |
| vertical gap | `CARD_GAP_Y = 0.22` | shortest-column 累计高度 |
| card height variation | `0.94 + (seed % 5) * 0.025` | 范围 0.94–1.04，仅改变高度 |
| outer border radius | `46` canvas px | `drawCard` 外层 `roundRect`；桌面约 25px |
| artwork radius | `34` canvas px | `drawCard` 封面 `roundRect`；桌面约 18px |
| selected border radius | `40` canvas px | 白色选中框 |
| selected border | `11` canvas px，`#fff` | 阴影 blur 14，alpha 0.38 |
| texture size | `420 × 604` | 每张离屏 canvas |
| perspective/FOV | `48°` | `new PerspectiveCamera(48, 1, 0.1, 100)` |
| camera Z | `7.4` | 决定中心卡的屏幕尺寸 |
| cylinder radius | `15` | 文件顶部 `CYLINDER_RADIUS` |
| desktop grid budget | `12 columns × 5 rows` | `innerWidth >= 1180` |
| tablet budget | `9 × 6` | `720 <= innerWidth < 1180` |
| mobile budget | `6 × 7` | `innerWidth < 720` |
| center distance | `abs(flatX) / (wallSpan * 0.5)` | clamp 到 0–1 |
| depth curve | `centerDistance ^ 1.25` | 所有景深变化的统一输入 |
| scale | `1 - depthCurve * 0.22` | 中心 1，最边缘 0.78 |
| opacity | `1 - depthCurve * 0.58` | 中心 1，最边缘 0.42 |
| brightness | `1 - depthCurve * 0.48` | 通过材质 color scalar；边缘 0.52 |
| rotateY | `-theta * (0.96 + depthCurve * 0.24)` | 越靠边旋转越明显 |
| translateZ | `cylinderZ - depthCurve * 1.35 - 0.008 * y²` | 圆柱深度 + 额外边缘后退 + 轻微纵向弯曲 |
| rotateX | `y * 0.006` | 极轻微纵向弧度 |
| selected lift | `+0.28 Z` | 选中卡前移 |
| selected scale | `1.035` | 选中卡轻微放大 |
| wall speed | `0.105 world units/s` | 自动移动；拖拽时 `0.025` |
| horizontal drag | `dx * 0.008` | 指针拖拽 |
| vertical drag | `-dy * 0.008` | 指针拖拽 |
| wheel X | `-deltaX * 0.0025` | 触控板横向 |
| wheel Y | `deltaY * 0.0042` | 滚轮纵向 |
| parallax rotateX | `-pointerY * 0.014 rad` | group 级别 |
| parallax rotateY | `pointerX * 0.022 rad` | group 级别 |
| parallax translateX | `pointerX * 0.07` | group 级别 |
| parallax translateY | `-pointerY * 0.045` | group 级别 |
| renderer pixel ratio | `min(devicePixelRatio, 1.6)` | 控制 GPU 压力 |
| material alpha test | `0.01` | 丢弃透明圆角像素 |
| material depth write | `true` | 减少多层半透明叠加 |

Vignette 定义在 `src/app/globals.css` 的 `.vignette`：

```css
linear-gradient(
  90deg,
  rgba(4, 3, 4, 0.8) 0%,
  rgba(4, 3, 4, 0.28) 10%,
  transparent 25%,
  transparent 75%,
  rgba(4, 3, 4, 0.3) 90%,
  rgba(4, 3, 4, 0.82) 100%
),
radial-gradient(
  ellipse at center,
  transparent 43%,
  rgba(4, 3, 4, 0.06) 64%,
  rgba(4, 3, 4, 0.56) 100%
)
```

该层使用 `position: fixed; inset: 0; z-index: 5; pointer-events: none`。噪点层是 `.jukebox-shell::after`，opacity 为 0.14。

### 3.5 为什么采用当前方案

- 使用 Three.js 而不是 DOM grid，是因为需要统一的圆柱映射、真实 perspective、Raycaster 和大量卡片高频运动。
- 使用 CanvasTexture，而不是每张卡一个复杂 DOM，是为了避免几十个 DOM 卡片每帧参与布局与合成。
- React 和 Three.js 状态分离，避免墙体每帧运动触发 React render。
- 使用 wrap 后复用同一批 mesh，形成无限墙，不持续创建和销毁卡片。
- 使用透明圆角纹理 + `alphaTest` + `depthWrite`，兼顾圆角和减少重叠发灰。
- 使用指数形式、与 delta time 相关的 lerp，使不同刷新率下手感接近。

---

## 4. 当前存在的问题

### 4.1 已知问题和潜在 bug

1. **跨响应式断点 resize 不会重排卡片。**
   - `columns` 和 `rows` 只在 Three.js effect 创建时读取一次。
   - `resize` 只更新 renderer 和 camera aspect。
   - 从桌面缩到手机或反向缩放时仍沿用旧列数，必须刷新页面才会使用新断点。

2. **Raycaster 仍按矩形 Plane 命中。**
   - 卡片纹理角落是透明圆角，但几何体仍为矩形。
   - 点击透明圆角区域理论上仍可能选中卡片。

3. **放大卡片后的随机聚焦可能过度。**
   - 桌面 `targetScale = 1.38` 是小卡片时期留下的值。
   - 最新参数下尚未重新检查完整 `landing -> reveal -> reset` 流程。

4. **外部曲库失败时重复卡明显。**
   - fallback 只有 18 首，视觉实例会重复到至少 60 张桌面卡。
   - 功能稳定，但封面和标题重复会降低高级感。

5. **透明材质和 depth write 的极端角度风险。**
   - 当前桌面截图没有明显排序错误。
   - 但透明材质开启 depth write 在卡片极度交叉时可能出现遮挡不符合预期，需要在移动端和拖拽极限位置验证。

6. **选中卡会继续随自动墙移动。**
   - 普通点击试听后，选中卡不会锁在中心。
   - 这是当前环境式设计的一部分，但如果产品期望持续强调选中卡，需要定义暂停或跟随策略。

7. **source note 在 fallback 时仍写 iTunes previews。**
   - Dock 会显示 `Offline study catalog`，但右下角 source note 文案是固定的。

### 4.2 视觉上仍可能需要调整

- 左侧标题与大卡会发生明显叠压；这与参考风格一致，但最终暗度和遮挡程度仍需用户主观确认。
- 现在中心卡约 225px，符合范围下沿。如果希望更接近 240–250px，优先微调 camera Z 或 FOV，不要同时放大 geometry 和缩相机。
- 中央卡约三行可见，底部 dock 会覆盖部分卡片；当前是预期的 UI 分层，但尚未在所有高度验证。
- 边缘卡当前最小 scale 0.78、opacity 0.42、brightness 0.52。若仍显拥挤，优先降低边缘 opacity 或减少桌面列数，不要重新引入整体 fishScale。

### 4.3 性能现状

- 修复前，播放歌曲后 `refreshCards` 每次进度更新会重画所有卡片，实测一度约 5.94fps。
- 已改为比较 `visualState`，只重画变化卡片；播放状态下复测约 120fps。
- 该数字来自 Codex in-app Chromium、1440×900、高刷新率机器，不等于低端设备保证。
- 每张纹理为 420×604 RGBA；桌面通常 60 张视觉实例，GPU/Canvas 内存仍需移动端 profile。
- 页面隐藏时没有显式暂停 Three.js render loop。浏览器通常会节流，但代码没有 `visibilitychange` 控制。

### 4.4 尚未验证

- 360–430px 手机视口的最新大卡参数。
- 768–1024px 平板视口。
- 低端 Android 和 iOS Safari。
- 完整约 214 秒水平循环接缝。
- `prefers-reduced-motion` 实际视觉。
- WebGL context lost/recovery。
- iTunes CORS、封面加载失败和试听 URL 失效的完整错误 UI。
- 键盘操作；Canvas 卡片目前主要依赖指针。

### 4.5 已尝试但效果不好的方案

不要重复以下方向，除非有明确新理由：

1. **中心径向放大式鱼眼。**
   - 早期使用 `radialDistance`、`centerLift` 和 `fishScale`，同时按 x/y 距离放大中心卡。
   - 结果像中间鼓起的一团，而不是连续圆柱墙；放大后还会覆盖相邻卡片。
   - 已替换为圆柱坐标 + 距离驱动景深。

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

#### P0.1 验证并修正放大后的随机聚焦流程

- **改哪里：** `JukeboxExperience.tsx` 的 `sceneApiRef.current.focus`、`chooseRandom` 和结果面板流程。
- **预期结果：** 点击 `Pick one record` 后选中卡片自然聚焦但不溢出屏幕；结果面板出现；点击返回后墙体恢复；音频状态正常。
- **建议方法：** 先视觉验证当前 `targetScale = 1.38`。若过大，桌面建议从 1.12–1.22 之间试，不要改变基础卡片尺寸。确认自动横移在 reveal 期间是否应该暂停或减速。

#### P0.2 完成移动端和平板视觉回归

- **改哪里：** 主要是 `JukeboxExperience.tsx` 的 columns/rows、camera 参数和 `globals.css` 的 `@media (max-width: 820px)`。
- **预期结果：** 卡片仍覆盖视口，圆角和间距清楚，底部 dock 不遮住主要中心卡，拖拽可用且帧率稳定。
- **建议方法：** 至少验证 390×844、768×1024、1440×900。不要直接用桌面参数缩放；必要时按断点设置 camera Z 或独立 card scale。

#### P0.3 验证完整无缝循环

- **改哪里：** `animate` 中 `flatX = wrap(...)` 及 `wallSpan`。
- **预期结果：** 最后一列离开一侧时，第一列从另一侧连续进入，没有空洞、抖动或列间距突变。
- **建议方法：** 开发时临时把 speed 提高到 1–2 units/s 或通过 DevTools 注入调试参数观察一整圈，确认后恢复 `0.105`。不要将调试速度提交为正式参数。

#### P0.4 修复跨断点 resize 不重排

- **改哪里：** Three.js 场景 effect 和 resize 管理。
- **预期结果：** 窗口跨过 720/1180px 后列数和行数正确重建，不需要刷新页面。
- **建议方法：** 最小方案是在 React 中维护 breakpoint key，并将其加入 effect 依赖；仅跨断点时重建场景，不要每次 resize 都重建纹理。

### P1 建议继续做

#### P1.1 修正透明圆角的点击命中

- **改哪里：** `clickSong` 的 Raycaster 结果处理。
- **预期结果：** 点击透明圆角不选中卡片。
- **建议方法：** 使用 intersection UV 采样圆角 mask，或用解析式 rounded-rect hit test；不要为每张卡创建复杂圆角几何体。

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

必须顺序运行，不要并行：

```powershell
npm run build
npm run typecheck
```

当前最后一次结果：两者均成功。

### 6.3 当前没有的测试

- 没有 `test` 脚本。
- 没有 Jest/Vitest 单元测试。
- 没有 Playwright/Cypress E2E。
- 没有截图基线。

### 6.4 UI 验收清单

桌面建议使用 1440×900：

1. 页面加载后无需操作，卡片墙应缓慢持续横向移动。
2. 中心卡片约 220–230px 宽，外圆角明显约 25px，封面圆角约 18px。
3. 中心卡片最大、最亮、最清晰。
4. 左右卡片逐渐缩小、变暗、降低透明度、rotateY 增加并退到更负的 Z。
5. 同屏约三行大卡，中央卡片之间有清楚间距，不应出现大片半透明重影。
6. 四周有暗角，左右最暗；暗角不能阻断鼠标事件。
7. `Music Box`、副标题、右上计数和底部面板固定，不随卡片墙移动。
8. 鼠标缓慢移到四角，墙体有轻微 parallax，UI 不动，页面不应剧烈摇晃。
9. 拖拽 canvas，卡片墙平滑跟随；松手后没有弹跳或 overshoot。
10. 滚轮应纵向浏览各列，触控板横向手势可改变墙体位置。
11. 点击中央卡片后出现粗白色圆角边框并播放试听；再次点击同一卡应暂停。
12. 播放时进度条更新，动画不能明显掉帧。
13. 点击 `Pick one record`，检查聚焦、结果面板和返回流程。
14. 控制台不应出现运行时 error。

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

- `JukeboxExperience.tsx`：3D 圆柱墙、自动循环、masonry、圆角卡片、景深、交互、试听和性能优化。
- `globals.css`：全屏暗色 UI、固定 vignette、标题、控制面板和响应式。
- `api/catalog/route.ts`：iTunes 目录聚合与 fallback。

具体改动以对应分支相对 `main` 的 Pull Request diff 为准。

### 7.4 工作区注意

用 `git status` 判断是否有未提交修改。未提交的本地改动不会进入 CI，也不会出现在 Pull Request 里。不要在未审查的情况下执行 `git reset --hard`、`git clean` 或覆盖未跟踪文件。

---

## 8. 给下一个 Agent 的注意事项

1. **不要先重写组件或切换 React Three Fiber。**
   - 当前 Three.js 原生实现已达到高帧率并通过视觉验证。
   - 优先做参数微调和局部修复。

2. **不要重新引入中心整体 fishScale。**
   - 这会让卡片互相覆盖，并把圆柱墙变成中心鼓包。
   - 当前景深必须继续以 `flatX -> theta -> cylinder position` 为基础。

3. **保留 UI 与墙体分层。**
   - canvas 独立运动；标题、计数、dock 和 vignette 是固定 DOM 层。
   - 不要把标题或控制面板放进 Three group。

4. **保留单一 audio 元素。**
   - 不要为每张卡创建播放器。

5. **保留纹理重绘短路。**
   - `refreshCards` 的 `unchanged` 检查是关键性能修复。
   - 删除后播放状态会重新出现严重掉帧。

6. **构建和 typecheck 必须顺序执行。**
   - 并行执行会与 `.next/types` 生成过程发生竞态。

7. **注意 breakpoint 重建问题。**
   - 这是当前最明确的结构性 bug，修复时避免每个 resize event 都销毁 60 张纹理。

8. **注意大卡后的聚焦 scale。**
   - `1.38` 可能过大，是下一个最可能需要调整的视觉参数。

9. **不要把用户参考素材加入网页或上传。**
   - `resource/` 仅用于视觉对照。

10. **天气和地区是明确延后需求。**
    - 当前优先级仍是音乐墙视觉与交互，不要未经用户确认扩大到定位、天气或图片上传。

11. **文档中的长期架构不是当前代码事实。**
    - `docs/ARCHITECTURE.md` 描述了未来的 engine/store/server 分层；当前核心仍在一个组件中。

12. **当前最可能出问题的位置：**
    - `JukeboxExperience.tsx` 的场景重建和 resize。
    - 大卡片后的 `focus` scale。
    - 透明材质在极端侧边的深度排序。
    - 移动端纹理内存和可见卡数量。
    - fallback 重复内容造成的视觉廉价感。

---

## 9. 最近一次验证记录

- 日期：2026-09-27（Asia/Shanghai）。
- 视口：1440×900。
- 浏览器：Codex in-app Chromium。
- iTunes live catalog：54 records in rotation。
- 中心卡视觉宽度：约 225px。
- 圆角选中框：已点击验证，白色圆角框与播放状态正常。
- 自动横向移动：已观察多个时间点，持续平滑。
- parallax：已移动指针验证，墙体轻微移动且 UI 固定。
- 控制台 errors：0。
- 播放状态性能：优化后两秒 rAF 采样约 120fps。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run typecheck`：通过。

