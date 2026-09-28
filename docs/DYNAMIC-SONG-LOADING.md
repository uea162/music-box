# 音乐墙动态加载歌曲：调研与设计方案

- 日期：2026-09-27
- 仓库：`uea162/music-box`（Next.js 15 + 原生 Three.js 球面卡片墙）
- 参考站：`https://bubbbly.com/jukebox`
- 性质：调研 + 设计，不含代码改动。所有数值均为建议初值，落地时按 HANDOFF 第 8 节第 2 条放进文件顶部具名常量并更新 3.4 表。

---

## 1. 参考站的做法（实测）

调研方法：`curl` 抓取页面 HTML、读取 `_next/static/chunks/pages/jukebox-*.js` 的源码逻辑、直接请求其 API 并统计返回体。关键结论都能在 bundle 里对应到代码，可信度高于肉眼观察。

### 1.1 结论速览

| 问题 | 参考站的做法 |
| --- | --- |
| 歌曲数据怎么来 | **不是滚动分页**。页面挂载时一次性发 2 个数据请求：`/api/jukebox/wall`（主墙 216 首）→ 成功后再发 `/api/jukebox/pool?cc=<国家码>`（2000 首）或 `/api/jukebox/cached`（1000 首，带 `cachedAt`）。没有 page/cursor/offset 之类参数。 |
| 滚到边界时 | **不发新请求，循环复用**。整面墙水平 `wrap`（折返到 `[-墙宽/2, 墙宽/2)`），每列纵向按自己的一圈长度 `wrap`。“歌很多”是因为把第二批（pool 去掉主墙已有 id 后约 1784 首）一次性生成为 `ceil(n / 14.4) ≈ 124` 个追加列，总共约 139 列、墙宽约 3 万单位（≈ 20 个 1440 宽的屏）。 |
| 每批多少首 | wall 216（≈ 27 个分类榜 × 8 首轮询交错）；pool 2000（≈ 26 个分类榜 × ~78 首）；cached 1000。 |
| 总量 | 主墙 216 + 追加 ≈ 1784 = **约 2000 首**（pool 与 wall 完全去重后 2000 个唯一 id）。 |
| 数据来源（推断） | 字段与 iTunes 旧版 RSS 分类榜 `itunes.apple.com/{cc}/rss/topsongs/limit=100/genre=N/json` 的 enclosure 一一对应（id / title / artist / genre / art / preview / url），且每个 genre 约 78–100 首、按 genre 轮询交错。`cached` 是服务端预生成的快照（`cachedAt`），用于非榜单模式/失败兜底。 |
| 封面 | 全部来自 `is1-ssl.mzstatic.com`。API 返回的 `art` 是**不带尺寸后缀**的基址，客户端按需拼 `/{w}x{w}bb.jpg`：卡片纹理用 400 或 200（按卡片屏幕宽度是否 > 300px 选档），3×3 用作底色 tint，结果面板用 600。响应头 `access-control-allow-origin: *`，可直接 `crossOrigin="anonymous"` 画进 canvas。 |
| 音频 | 全部来自 `audio-ssl.itunes.apple.com` 的 `*.plus.aac.p.m4a`（30 秒预览）。页面只有一个 `<audio preload="none">`，点卡片时换 `src` 再 `play()`。 |
| 渲染 | Next.js pages router 静态导出页 + Three.js（WebGL canvas，`CanvasTexture`）。**mesh 只为当前可见的卡创建**（key = `列:槽:左右`），离开视野即 `scene.remove` 并 `material.dispose()`。 |
| 纹理管理 | Map 缓存，key = `歌曲id:纹理宽`；每帧记录 `used = 帧号`；每 120 帧 `sweep()` 一次：缓存 > 260 张时按最久未用排序，释放超出部分中 ≥ 60 帧没用过的。 |
| 其他接口 | `/api/jukebox/weather`（天气）、`POST /api/jukebox/pick`（AI 选歌，带 `X-Jev-Key` 头和 `exclude` 列表）、`/api/jukebox/check-key`。与本任务无关。 |

### 1.2 请求样例（脱敏）

```http
GET https://bubbbly.com/api/jukebox/wall
cache-control: public, max-age=0, must-revalidate      # Vercel
content-type: text/plain (实际是 JSON)  约 103 KB
```

```json
{
  "location": { "city": "<城市>", "country": "<国家>", "countryCode": "US" },
  "source": "charts",
  "songs": [
    {
      "id": "6814997425",
      "title": "Patient Zero",
      "artist": "Taylor Swift",
      "genre": "Pop",
      "art": "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a0/dd/fd/<uuid>/<sku>.rgb.jpg",
      "preview": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/0b/be/8c/<uuid>/mzaf_<id>.plus.aac.p.m4a",
      "url": "https://music.apple.com/us/album/patient-zero/6814997249?i=6814997425&uo=2"
    }
  ]
}
```

- `songs.length = 216`，7 个字段全部必填，216/216 有 `preview`。
- 单曲对象没有专辑名、时长、颜色等字段；颜色由客户端从 3×3 tint 图取。

```http
GET https://bubbbly.com/api/jukebox/pool?cc=US      → { "songs": [ ...2000 首，同结构 ] }   约 959 KB
GET https://bubbbly.com/api/jukebox/cached          → { "cachedAt": "2026-09-21T05:11:53.591Z", "songs": [ ...1000 首 ] }   约 478 KB
GET https://is1-ssl.mzstatic.com/image/thumb/.../<sku>.rgb.jpg/400x400bb.jpg   → image/jpeg, ACAO: *
```

客户端把 pool 交给墙之前做的唯一处理（bundle 原文语义）：

```js
const seen = new Set(wall.songs.map(s => s.id));
setMore(pool.songs.filter(s => !seen.has(s.id)));   // 只去重，不分页
```

布局函数 `D(songs, more)`：`O(songs, 0, 15, seed=0x1352839)` 生成 15 个基础列；`more.length > 0` 时再 `O(more, 15, ceil(more.length / 14.4), seed=1921)` 生成追加列（列宽沿 15 项序列循环取），整面墙横向排开后一起参与水平 wrap。这与我们 `docs/REFERENCE-LAYOUT.md` §1 已记录的“追加列”规则一致。

### 1.3 对我们的启发

1. “边界加载”在参考站其实是**一次性加载 + 追加列 + 水平循环**。用户感知到的“滚到边界会出现新歌”是因为墙宽有 20 屏，很难滚到真正的接缝。
2. 真正做到“很多歌”的代价不在数据量（1 MB JSON 可以接受），而在**纹理和 mesh 必须按可见性按需创建和释放**。参考站的纹理上限 260、mesh 按可见创建，是 2000 首能跑起来的前提。
3. 参考站 `pool` 一次 959 KB。我们既然要做分页，可以把首包压到 ~100 KB、首屏时间与现在一致，再在后台/滚近接缝时追加。

---

## 2. 数据来源方案对比

| 方案 | 做法 | 优点 | 缺点 / 风险 | 版权与试听限制 |
| --- | --- | --- | --- | --- |
| A. 本地 JSON 分页 | 脚本离线抓 iTunes 生成 `public/catalog/page-000.json …`，前端直接取静态文件 | 零运行时依赖、CDN 缓存、不受上游限流、构建可复现、layout_sim 用固定曲目对照最方便 | 预览 URL（`mzaf_*.m4a`）和封面路径会不定期轮换，需定期重跑脚本；内容不会随榜单更新；大 JSON 进 git 有噪音 | 只存元数据和外链，不存音频/封面本体，符合 iTunes 用法；仍需保留“Previews provided by iTunes”并链回商店 |
| **B. Next.js Route Handler 分页接口（推荐）** | `/api/catalog?cursor=…&limit=…`，服务端聚合 iTunes RSS 分类榜 + 现有 8 个搜索词，构建去重曲池缓存 6 h，按 cursor 切片返回 | 与现有 `route.ts` 同构，改动集中；上游失败可逐词/逐榜降级；随榜单更新；分页参数可控；服务端做 `previewUrl` 过滤和去重 | 依赖 iTunes 可用性（现状已依赖）；Search API 有约 20 次/分钟/IP 限流，构池时要控并发、靠 Data Cache 避免重复打上游 | 同上；预览 30 s（个别 90 s）、封面 400/600px 可用；Apple 要求用于推广并链回 iTunes/Apple Music，不得持久缓存音频 |
| C1. iTunes Search / Lookup / RSS（作为 B 的上游） | Search 支持 `limit≤200`、`offset`（实测 `offset=200` 可用）；Lookup 支持批量 id；旧版 RSS 分类榜每榜 100 首**自带 preview enclosure**（实测 200 OK） | 无需密钥、无需登录、CORS 友好（封面/音频均 `ACAO: *`） | 无官方 SLA；RSS 旧接口未来可能下线（v2 `rss.marketingtools.apple.com` 不含 preview，需再 Lookup） | 见上 |
| C2. Deezer API | `api.deezer.com/chart/0/tracks`、`/search` 免密钥，30 s mp3 预览 | 免费、曲库大、有分类榜 | JSON 接口未开放 `Access-Control-Allow-Origin`（实测无该头），只能服务端代理；预览有地区限制；ToS 要求展示 Deezer 标识、限制缓存；与现有 iTunes 数据模型不一致（需要双源去重） | 30 s 预览，需 Deezer 品牌归属 |
| C3. 网易云音乐 | 无官方公开 API，只有社区逆向的 NeteaseCloudMusicApi | 中文曲库最贴合 | 逆向接口随时失效；大量歌曲试听需登录/VIP、有版权灰名单；播放 URL 有时效（需反复取）；封面/音频域名 CORS 不稳定；法律与合规风险高 | **不建议** |
| C4. Spotify | Web API + OAuth | — | `preview_url` 自 2024-11-27 起对新应用不再返回，30 s 试听不可用 | **不可行** |

**推荐：B（Route Handler 分页）+ A 的子集作为兜底。** 即：服务端从 iTunes RSS 分类榜（多个商店）和现有 8 个搜索词构建曲池并分页；同时用脚本生成一份约 200 首的快照 `src/data/catalog-snapshot.json` 作为上游失败时的第 1 页兜底（顺带解决 HANDOFF 4.1 第 4 条“fallback 只有 18 首重复感明显”和 P1.2）。18 首 `fallback-songs.ts` 保留为最后一层（快照也读不到时）。

上游榜单建议（可配置常量 `POOL_FEEDS`）：

- 商店：`US`、`HK`（保证 Z1 的陳奕迅/方大同繁体名和可试听）、`JP`、`TW`；每个商店选 8–12 个 genre（Apple 标准 genre id，例如 Pop 14、R&B/Soul 15、Rock 21、Jazz 11、Electronic 7、Alternative 20、Soundtrack 16、Classical 5、J-Pop 27、K-Pop 51、Hip-Hop/Rap 18、Blues 2）。
- 4 商店 × 10 榜 × 100 首 ≈ 4000 原始条目，过滤无 `preview`、按 trackId 和 `title|artist` 归一化键去重后预计 2000–2500 首，服务端截到 `POOL_LIMIT = 1200`。
- 现有 `SEED_TERMS` 的 54 首固定排在曲池最前（第 1 页），保证 Z1–Z5 与 S1 的对照曲目稳定。

---

## 3. 数据模型与接口设计

### 3.1 `Song`（`src/types/song.ts`）

保留现有字段，新增 3 个可选字段，向后兼容：

```ts
export interface Song {
  id: string;            // iTunes trackId
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;   // 400x400bb（现状）
  artworkThumbUrl?: string; // 新增：200x200bb，供窄列/低档纹理
  previewUrl?: string;   // 30 s m4a；服务端保证分页结果里一定有
  externalUrl?: string;
  genre?: string;
  storefront?: string;   // 新增："US" | "HK" | "JP" | "TW"，供 lang 标签与字体回退
  accent: string;
}

export interface CatalogPage {
  songs: Song[];
  nextCursor: string | null;  // null = 曲池到底
  total: number;              // 当前曲池总数（用于右上计数与调试）
  poolVersion: string;        // 曲池构建版本，cursor 里也带
  source: "itunes" | "snapshot" | "fallback";
}
```

### 3.2 接口

```
GET /api/catalog                     → 第 1 页（等价 cursor 为空）
GET /api/catalog?cursor=<opaque>     → 后续页
可选 ?limit=N（默认 PAGE_SIZE=96，服务端夹到 [24, 144]）
```

- **cursor**：`base64url(JSON{ v:1, pool:<poolVersion>, offset:<number> })`，客户端只透传。服务端解析失败或 `pool` 与当前曲池版本不一致时，**不报错**，改为按 `offset` 在新曲池上切片并在响应里返回新的 `poolVersion`；客户端本来就按 id 去重，版本切换最多造成少量重复被丢弃或漏掉几首。
- **每批数量**：`PAGE_SIZE = 96` → 追加 `ceil(96 / 14.4) = 7` 列 ≈ 1500 单位，恰好约一个 1440 宽的屏（1440 / 0.96 = 1500 单位）。每次触发补一屏，是“滚一屏、补一屏”的自然粒度；响应体 96 首 × ~450 B ≈ 45 KB。
- **第 1 页**：固定为 `SEED_TERMS` 的结果（当前 54 首）+ 曲池头部补足到 96。保持“开场墙面”曲目稳定，便于 S1 对照和 Z 系列用例。
- **缓存**：曲池构建用 `unstable_cache`（或现有的 fetch `next.revalidate: 6h`）缓存整池；切片纯内存。响应头 `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600`。
- **失败语义**：上游全部失败且无缓存 → 第 1 页返回快照（`source: "snapshot"`，`nextCursor: null`）；快照也不可用 → 18 首 fallback。后续页失败 → HTTP 503 + `Retry-After`，由前端退避重试。
- **不做**的事：不做搜索/筛选参数、不返回音频本体、不透传用户 IP 定位（参考站的 `location` 我们不需要）。

### 3.3 服务端构池流程（`src/app/api/catalog/route.ts` 拆成 `catalog-pool.ts` + `route.ts`）

1. 并行（并发 ≤ 6、单请求 5 s 超时）请求 `SEED_TERMS` 搜索与 `POOL_FEEDS` 各榜；单个失败只丢该源。
2. 归一化：RSS entry → `Song`（`im:image` 取最大图基址拼 400/200；enclosure 为 `previewUrl`；`id.attributes['im:id']` 为 trackId）；Search 结果沿用现有 `normalize`。
3. 过滤无 `previewUrl`；按 `id` 去重，再按 `lower(title)|lower(artist)` 二次去重（同曲不同专辑）。
4. 排序：种子词结果在前，其后各榜按现有 `interleaveUnique` 轮询交错（避免连续 7 列全是同一类型）。
5. `poolVersion = 前 16 位 sha1(所有 id 拼接)`；`total = songs.length`。
6. 曲池 < 12 首视为失败，走快照。

---

## 4. 前端加载策略

### 4.1 总体原则（对应 HANDOFF 第 8 节）

- **速度只由 `resolveTargetSpeed()` / `stepMotion()` 决定**：加载和接列不引入任何新的“改 offset / pan / scroll”的地方，也不改目标速度。追加列后墙照常运动；数据到达那一帧不产生任何位移。
- **不重建场景**：场景 effect 现在依赖 `[songs, pausePlayback]`，`setSongs` 会整场重建。必须先解耦：场景只在**第 1 页**到达时创建一次；后续页通过 `sceneApiRef.current.appendSongs(page)` 交给正在运行的场景，React 侧另存 `loadedSongs`（低频，只用于右上计数和 `chooseRandom`）。
- **一个 rAF、一个 `<audio>`**：加载触发检查放在现有 `animate` 里 `stepMotion` 之后、`placeCards` 之前（`maybeCommitPage()`），不加第二个循环、不用 `setInterval`。
- **可调数值全部进顶部常量**并补到 HANDOFF 3.4 表：

| 常量 | 建议值 | 作用 |
| --- | --- | --- |
| `PAGE_SIZE` | 96 | 每批歌曲数（与服务端默认一致） |
| `SONGS_PER_EXTRA_COLUMN` | 14.4 | 追加列数 = `ceil(批内歌数 / 14.4)`（参考站与 REFERENCE-LAYOUT §1） |
| `EXTRA_SHUFFLE_SEED` | 1921 | 追加列洗牌种子（每批用 `1921 + 批序号`，保证可复现且各批不同） |
| `LOAD_AHEAD_SCREENS` | 1.5 | 视角中心距接缝小于 1.5 个屏宽（墙面单位 `1.5·vw/scale`）时发起下一页请求 |
| `COMMIT_CLEAR_SCREENS` | 0.75 | 接缝两侧各 0.75 屏宽内没有可见列时才把新列并入墙 |
| `MAX_LOADED_SONGS` | 1200 | 客户端最多保留的歌数（≈ 83 列、≈ 17 000 单位、≈ 11 屏）；到顶后不再请求，靠水平 wrap 循环 |
| `MAX_FACES_WIDE` / `MAX_FACES_COMPACT` | 200 / 110 | 共享纹理上限（宽 ≥ 820 / 以下），不含 activeFace |
| `FACE_SWEEP_EVERY_FRAMES` / `FACE_IDLE_FRAMES` | 120 / 60 | 每 120 帧回收一次；只回收 ≥ 60 帧未被可见卡使用的纹理 |
| `LOAD_TIMEOUT_MS` / `LOAD_RETRY_BASE_MS` / `LOAD_MAX_RETRIES` | 8000 / 2000 / 3 | 分页请求超时与指数退避（2 s、4 s、8 s） |
| `LOAD_COOLDOWN_MS` | 60000 | 连续失败 3 次后的冷却时间，期间不再请求 |

### 4.2 触发阈值：什么时候请求

墙只有**一个接缝**：最后一列右边与第 0 列左边的边界，位置 `seamX = wallWidth`（等价于 0）。每帧算一次（纯标量，可忽略成本）：

```
seamDx = wrap(seamX - cameraX(), wallWidth)          // 接缝相对视角中心的横向距离（墙面单位）
screenUnits = view.width / view.scale                  // 一个屏宽对应的墙面单位
```

- `|seamDx| < LOAD_AHEAD_SCREENS · screenUnits` 且没有在途请求、`nextCursor !== null`、未到 `MAX_LOADED_SONGS`、不在冷却期 → `fetch(nextCursor)`。
- 首屏例外：第 1 页到达、场景建好后**立即**请求第 2 页（参考站也是这样做），这样正常自动运动下用户第一次横向拖拽就已经有 30 列可看；15 列时接缝距中心 1545 单位，在三种视口下都在剔除范围之外（1440：可见半宽 ≈ 0.62·1500+250 = 1180；390：≈ 0.62·1083+250 = 922），首次并入不会被看到。
- 无论方向：向左拖到第 0 列以左会看到第 14 列（wrap），向右拖到最后一列以右会看到第 0 列，两边都是同一个接缝，阈值判断不分方向。
- 减少动态效果或播放中（墙静止）同样适用：只要用户把接缝拖近就会触发；墙不自己动时不会无故请求。

### 4.3 接列：如何把新卡接进球面墙而不打断运动

新列**只追加在墙的右端**（`x` 递增），已有列的 `x`、`index`、`instanceIndex`、槽内容都不变，因此：

- `cameraX() = columns[CENTER_COLUMN].x + pan` 不变（第 7 列没动，`pan` 没改）。
- 已有可见列的 `wrap(column.x − cameraX, wallWidth)`：`wallWidth` 变大，但只要 `|dx| < 旧墙宽/2`，折返结果不变——可见列的 `|dx|` 最多约一个屏宽，远小于 1545。**画面上任何已可见的卡在并入那一帧位置完全不变。**
- 唯一会“跳”的是折返到另一侧的列（`|dx| ≈ 墙宽/2`），并入前这些列必须已被剔除。这正是 `COMMIT_CLEAR_SCREENS` 的作用：**请求可以提前发，但并入要等接缝远离**。

并入步骤（`commitPage(page)`，在 `animate` 里 `stepMotion` 之后执行，一帧内完成）：

1. 去重：过滤掉 `loadedIds` 里已有的 id（以及 `title|artist` 键重复的），空则丢弃该页只更新 `nextCursor`。
2. `buildExtraColumns(songs, startIndex = columns.length, count = ceil(n / 14.4), seed = EXTRA_SHUFFLE_SEED + pageIndex)`：复用 `buildBaseColumns` 的最短列优先 + 并排规则，列宽 `COLUMN_WIDTHS[index % 15]`，`x` 接着 `wallWidth` 往右排；追加进 `extraBases: WallColumn[]`（不动 `base`）。
3. `wallWidth += Σ(列宽 + 14)`；`wallWidth` 由 `const` 改 `let`。
4. `growColumnBuffers(columns.length)`：`wallMotion.scroll` / `pendingScroll` / `columnTurn` / `columnCos` / `columnShown` / `columnOffsets` 这些按 15 列定长的 typed array 扩容并拷贝旧值；新列 `scroll = 0`。`columnOffset(i)` 已经对 `COLUMN_SPEEDS` 取模，`START_OFFSET_STEP·i` 由列长 wrap 吸收，不需要改。
5. 调用现有 `applyViewport()` 里的补槽逻辑：`extendColumns([...base.columns, ...extraBases], 1.5 屏高)` → 签名变化 → `relayout()`。`relayout` 已经会复用 mesh 池、保留选中卡/聚焦卡，不重画纹理、不重新请求封面，正好满足需求；由于新列都在末尾，旧卡的 `instanceIndex` 与 `nextCards` 序号都不变，mesh 池前段一一对应，不会闪。
6. `loadedIds` 合并；`sceneApiRef` 回调 React：`setLoadedSongs(prev => [...prev, ...added])`（只影响计数与随机选歌，不进 effect 依赖）。

`placeCards` 的成本：列级剔除本来就在，卡级循环应改成**只遍历 `columnShown === 1` 的列的卡**（把 `cards` 按列分组保存），否则 1200 首 ≈ 1400 张卡每帧全算一遍（约 0.2 ms，可接受但没必要）。`hitCard` 同理只在可见列里找。mesh 仍按现有池方式为每张卡持有（1400 个 `Mesh` + `ShaderMaterial`，程序只编译一份，`visible=false` 的对象渲染时直接跳过），实测不够再进入第 6 节阶段 4 的“按可见分配 mesh”。

### 4.4 纹理：每首歌一张、按需创建、限量、卸载全释放

现状：场景创建时为所有歌各画一张 420×604 的 `CanvasTexture`（≈ 1 MB/张，含 mipmap ≈ 1.35 MB），1200 首会超过 1.5 GB，**必须改成按可见按需**。参考站的做法（缓存 + 帧号 + 周期回收）可以直接借用，并保留“每首歌一张 + 一张 activeFace”的规则。

- `faces: Map<songId, CardTexture>` 改为 **LRU**：`CardTexture` 增加 `lastUsedFrame`。
- **创建时机**：`placeCards` 判定某卡 `visible` 时，如果 `faces` 没有它的歌，就 `acquireFace(song)`：建 canvas、先画无封面的渐变占位（现有 `drawCard` 在 `image=null` 时的分支）、`renderer.initTexture`、启动封面 `Image` 加载，加载完成再 `drawCard`。该卡 `uniforms.uMap` 每帧指向 `faces.get(id).texture`（现在是 relayout 时赋一次，改为可见时校正一次即可，避免指向已释放纹理）。`CULL_MARGIN = 0.62` 已经比屏幕宽出 12%，等于自带约 170 px 的预加载带；初次入镜会先看到占位渐变再换成封面，参考站行为一致。
- **释放**：每 `FACE_SWEEP_EVERY_FRAMES` 帧执行 `sweepFaces()`：`faces.size > MAX_FACES` 时按 `lastUsedFrame` 升序，释放超出数量且 `frame − lastUsedFrame ≥ FACE_IDLE_FRAMES` 的：`texture.dispose()`、`image.onload = null; image.src = ""`（中止未完成下载）、从 `faces` 和 `facesRef.current` 移除、把仍指向它的卡 `uMap = null`（这些卡此时不可见）。
- **保护**：`selectedId`、`playingId`、`focus.songId` 对应的歌永不回收；`activeFace` 不参与 LRU；`syncActiveFace` 里 `faces.get(...)?.texture ?? null` 改为 `?? acquireFace(...)`，避免取消选中时卡片变黑。
- **两档尺寸**（REFERENCE-LAYOUT §11 已定 384/224 档）：列宽 ≥ 200 用 420×604，否则用 224×322（`artworkThumbUrl`）。半宽卡在宽列里也用小档。粗算上限内存：200 张中约一半小档 → ≈ 200 × 0.7 MB ≈ 140 MB（含 mipmap），移动端 110 张 ≈ 75 MB。仍需按 P2.3 做真机 profile；不够就先关 mipmap（`generateMipmaps = false`，`minFilter = LinearFilter`）再降上限。
- **`refreshCards`**：继续遍历 `facesRef.current`，只是现在最多 `MAX_FACES + 1` 张而不是“歌数 + 1”，`unchanged` 短路保留不动，播放时重绘量反而更小。
- **卸载**：清理函数里 `allFaces.forEach(dispose)` 改为遍历当前 `faces` + `activeFace`，并中止所有在途 `Image`；`renderer.info.memory.textures` 卸载后应回到 0。

### 4.5 去重与循环复用

- **服务端**：曲池内 `id` 与 `title|artist` 双重去重；`poolVersion` 让客户端知道曲池换过。
- **客户端**：`loadedIds: Set<string>` 跨页去重（参考站同款）；`title|artist` 键可选，防止同曲不同专辑的“视觉重复”。
- **列内重复**只来自 `extendColumns` 补足 1.5 屏高（相邻不重复规则不变）。第 1 页 96 首时 15 列每列约 6 首，390×844 下仍要补足；后续页 14.4 首/列在 390 下（需 ≥ 3517 单位，约 12 张整卡）基本不用补。
- **到底后的循环**：`nextCursor === null` 或 `loadedIds.size ≥ MAX_LOADED_SONGS` 时停止请求，墙就是一个 N 列的大圈，靠现有水平 wrap 无缝循环——这就是参考站的“循环复用”，不需要额外逻辑，也**不做**“丢掉远处列再重新加载”（会破坏 `instanceIndex` 稳定和选中卡保留）。
- **右上计数**：显示 `loadedSongs.length`（已加载）而不是曲池 `total`，避免“显示 1200 但拖不到”。

### 4.6 加载失败处理

| 情形 | 处理 |
| --- | --- |
| 第 1 页失败 | 现状不变：服务端返回快照/fallback；客户端 `catch` 走 `fallbackSongs`。`nextCursor = null`，不再分页。 |
| 后续页超时 / 5xx / 网络错 | 不改墙、不提示；按 2 s、4 s、8 s 退避重试 3 次；仍失败进入 60 s 冷却，冷却后如果用户还在接缝附近再试。墙在此期间靠 wrap 正常循环，用户只是看到“歌没变多”。 |
| 返回 200 但去重后为空 | 视为该页无新歌，更新 `nextCursor` 继续；连续 3 页为空则视为到底。 |
| 返回 `poolVersion` 变化 | 忽略差异，正常去重并入（见 3.2）。 |
| 页面正在卸载 / effect 已 `disposed` | `AbortController` 中止在途 fetch；`commitPage` 检查 `disposed` 直接丢弃。 |
| 封面 404 / CORS 失败 | 现状的渐变占位继续显示；`image.onerror` 里标记 `artFailed` 避免回收后再次重试同一 URL。 |
| 试听 URL 失效（`audio.play()` 拒绝） | 现有 `catch → setPlayingId(null)` 不变；可在 `Song` 上标 `previewBroken`，`chooseRandom` 跳过（P1.4 范畴，不在本方案强制）。 |

### 4.7 “Pick one record” 的配套调整

`chooseRandom` 目前从全部 `songs` 里随机。墙变成 80 列后，随机到 8000 单位外的歌，`focusSong` 的滑动（通过 `nudge`，仍走 `stepMotion`）会以 7.5/s 指数逼近，横穿几十列，约 1 s 到位，视觉上是一次“呼啸”。两种选择：

1. **推荐**：候选限制在“视角中心 ±1 屏宽内可见列”的歌（`cards` 里 `visible` 的去重），仍然随机，滑动距离和现在一样。
2. 参考站做法：把选中的歌**换进**中心附近的某个槽（它的 `pick` 流程会重写列内容）。这会改变槽内容与 `instanceIndex` 语义，不推荐现在做。

---

## 5. 对现有验收用例与减少动态效果的影响

| 用例 | 影响 | 建议改法 |
| --- | --- | --- |
| V1–V12 | 不变。开场墙面（第 1 页 96 首、15 列）与现在等价 | 无 |
| V6 右上计数 | 数字会随加载增长 | 文案改为“N records loaded”或保持，不视为缺陷 |
| R3 “Network 里没有重新请求封面” | 缩放本身仍不请求；但按需纹理意味着**新出现的卡**会请求封面 | 改为“缩放期间不重复请求**同一**封面 URL；封面请求只发生在卡片首次进入可见范围” |
| R5 `memory()` 贴图数“回到初始值” | 贴图数不再等于歌数 + 1，而是 ≤ `MAX_FACES + 1` 且随可见集合波动 | 改为“几何体始终 1；贴图数 ≤ 上限 + 1；来回 10 次后不持续上涨；`activeLoops() === 1`” |
| S1 layout_sim 对照 | 只要第 1 页曲目数固定（96），15 个基础列几何不变 | `--songs 96`；新增 `--extra <n>` 模式模拟追加列（脚本已知规则，见 REFERENCE-LAYOUT §1） |
| S10 播放中跨断点 | `relayout` 保留选中卡逻辑不变；并入新列走同一 `relayout` | 增加“播放中并入新列，白框仍 1 张、声音不断” |
| L2 “墙宽 3090 单位” | 墙宽 = 已加载列总宽（15 列 3090，30 列约 6200，…） | 改为“拖过一整圈接缝处列间距始终 14；圈长见 `__musicBoxDebug.catalog().wallWidth`” |
| L1/L3/L4 接缝 | 并入时机保证接缝不可见；新列之间也是 14 间距 | 新增 D 用例（见下） |
| Z1–Z5 | 第 1 页固定含种子词 54 首，行为不变 | 无 |
| **S-RM（减少动态效果）** | 自动运动为 0，加载只由拖拽触发；并入不产生位移；`stepMotion` 未变 | 新增 S-RM5：“开启减少动态效果，横向拖到接缝附近会加载下一页；并入瞬间画面无跳动；拖拽仍 1:1” |
| F1–F8 聚焦 | 若采用 4.7 方案 1，滑动距离不变；面板逻辑不变 | 新增 F9：“加载 3 页后连点 Pick 10 次，聚焦卡始终完整在屏内，滑动不穿越多屏” |

新增用例 **D（动态加载）**，写进 `docs/ACCEPTANCE.md`：

- D1 打开页面后 Network 里先有 `/api/catalog`（无 cursor，96 首），随后自动有第 2 页请求（带 cursor）；两页 id 无重复。
- D2 横向拖拽把接缝拖到距中心约 1.5 屏内，出现第 3 页请求；接缝进入可见区前后画面没有卡片跳位。
- D3 停在接缝正中不动，此时到达的数据**不会**并入；拖离 0.75 屏后一帧内并入，无跳动、无空洞。
- D4 播放中触发加载并并入：声音不断，白框 1 张，选中卡不动。
- D5 `npm run dev` 下 `__musicBoxDebug.memory().textures ≤ MAX_FACES + 1`，拖满 3 圈后数值不持续上涨；`geometries === 1`；`activeLoops() === 1`。
- D6 断网（DevTools offline）后拖到接缝：无报错弹窗、控制台无未捕获错误，墙照常循环；恢复网络并等冷却后再拖，加载恢复。
- D7 加载到 `MAX_LOADED_SONGS` 或 `nextCursor === null` 后不再有请求，横向拖一整圈无缝。
- D8 卸载页面（客户端路由离开或热重载）后 `renderer.info.memory.textures === 0`，没有在途图片请求继续回调。

---

## 6. 分阶段实施计划

每阶段单独分支 + PR，PR 描述引用用例编号；每阶段结束顺序跑 `npm run lint` → `npm run build` → `npm run typecheck`。

### 阶段 1：分页接口与快照（只改服务端和类型，前端行为不变）

- 改动文件
  - `src/types/song.ts`：新增 `artworkThumbUrl`、`storefront`、`CatalogPage`。
  - `src/app/api/catalog/route.ts` → 拆为 `src/app/api/catalog/route.ts`（解析 cursor/limit、切片、缓存头）和 `src/server/catalog-pool.ts`（构池、归一化、去重、`poolVersion`）。
  - 新增 `scripts/build-catalog-snapshot.mjs` 与生成物 `src/data/catalog-snapshot.json`（约 200 首，只含元数据和外链）；`package.json` 加 `catalog:snapshot` 脚本（不进 CI）。
  - `src/data/fallback-songs.ts` 保留。
  - `HANDOFF.md` 2.2 / 3.4、`README.md` 接口说明。
- 验收点
  - `curl /api/catalog` 返回 96 首且前 54 首与旧接口曲目一致（顺序可不同）、全部有 `previewUrl`；`curl "/api/catalog?cursor=<上一页 nextCursor>"` 无重复 id；伪造/过期 cursor 返回 200 且带新 `poolVersion`。
  - `ITUNES_SEARCH_URL` 指向本地假接口全失败时，第 1 页 `source === "snapshot"` 且 ≥ 100 首；快照也读不到时回到 18 首 fallback。
  - Z1–Z5、V1–V12 不变；C1 通过。

### 阶段 2：纹理按需创建与限量（仍是 15 列，先把内存模型改对）

- 改动文件：`src/components/jukebox/JukeboxExperience.tsx`（`createFace` → `acquireFace`/`releaseFace`/`sweepFaces`，`placeCards` 内可见时取纹理，`syncActiveFace` 兜底，清理函数），`src/components/jukebox/debug.ts`（`memory()` 增加 `faces`、`facesCap`），`HANDOFF.md` 3.4 与 8.10。
- 验收点：V10–V12 不回归（播放 120 fps 量级不下降）；R3/R5 按第 5 节新表述通过；D5、D8；1440 首屏贴图数 ≈ 可见（含 0.62 剔除边距）卡的歌数 + 1（约 60–90）而不是“歌数 + 1”固定；390×844 下贴图 ≤ 111。

### 阶段 3：追加列与边界加载（核心）

- 改动文件：`JukeboxExperience.tsx`
  - React 侧：`songs` 拆为 `baseSongs`（触发场景创建，只设一次）与 `loadedSongs`（计数、随机）；新增 `catalogLoader`（fetch、cursor、退避、冷却、`AbortController`）。
  - 场景侧：`buildExtraColumns`、`growColumnBuffers`、`commitPage`、`maybeLoadAndCommit()`（挂在 `animate` 的 `stepMotion` 之后）、`wallWidth` 改 `let`、`placeCards`/`hitCard` 按可见列遍历、`sceneApiRef.appendSongs`。
  - `debug.ts`：只读 `catalog()` → `{ loaded, pages, pending, wallWidth, columns, nextCursor: boolean, cooldownUntil }`。
  - `docs/ACCEPTANCE.md` 新增 D1–D8、S-RM5、F9，改 R3/R5/L2 文案；`docs/REFERENCE-LAYOUT.md` §11 更新曲库规模与分页；`docs/reference-layout/layout_sim.py` 加 `--extra`。
  - `HANDOFF.md` 3.2/3.3/3.4/4.3/8 节。
- 验收点：D1–D7；S-RM1–5；L1–L4 在 30 列以上墙宽下复测；S10 含并入场景；V11 播放帧率不降。

### 阶段 4：收口与性能

- `chooseRandom` 就近候选（4.7 方案 1）→ F1–F9。
- 真机 profile（P2.3）：1200 首、上限贴图下的 GPU 内存、主线程；不达标时实施“mesh 只为可见卡分配”（把 `WallCard` 拆成数据记录 + 可选 mesh 句柄，池上限约 160）并关 mipmap。
- 可选：`visibilitychange` 暂停 rAF（P1.3）与加载器一起做，隐藏页不请求。
- 验收点：M1–M7 三视口回归；D5 在 390×844 真机通过；`grep -R __musicBoxDebug .next` 无结果。

---

## 7. 风险与未决

- iTunes 旧版 RSS（`itunes.apple.com/{cc}/rss/topsongs`）没有官方 SLA，v2 RSS 不带 preview。构池代码应把“榜单源”抽象为可替换适配器，失败时用 Search API（`term` 走 genre 名 + `offset`）兜底。
- 预览 URL 轮换：快照需要有生成日期，README 里写明“过期请重跑脚本”；运行时以接口为主，快照只兜底。
- 服务端 `unstable_cache` 在 Vercel 多实例下每实例各构一池，`poolVersion` 可能在实例间不同；3.2 的“版本不一致不报错”正是为此。
- 真实浏览器复核（Chrome DevTools Network，持续滚动 30+ 屏）：只在挂载时出现 `/api/jukebox/wall`（本次 211 首，榜单随时间小幅变化），滚动全程**没有任何新的 fetch/XHR**，远处出现重复封面，即循环复用；封面按 `3x3bb.jpg` / `400x400bb.jpg` 两档请求，音频点击时以 HTTP 206 流式加载约 990 KB 的 m4a。与源码分析一致。该复核未捕获到 `/api/jukebox/pool` 请求（可能受过滤或时序影响），且把渲染层误判为 DOM；bundle 里明确是 Three.js `WebGLRenderer` + `CanvasTexture`，以源码为准。
- 本方案没有触碰 `drawCard` 样式（HANDOFF 8.13），两档纹理尺寸只是画布尺寸不同，绘制逻辑按比例缩放即可；具体像素值属于卡片重绘任务。
