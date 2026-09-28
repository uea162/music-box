# Music Box

Music Box 是一个以 3D 唱片墙为核心的音乐发现原型。当前版本通过服务端目录接口读取 Apple iTunes 歌曲元数据，在浏览器中流式播放官方短试听，不下载或托管歌曲文件。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 验证

```bash
npm run typecheck
npm run build
```

## 当前能力

- Three.js 球面歌曲卡片墙，每列各自上下移动（规格见 `docs/REFERENCE-LAYOUT.md`）
- 鼠标和触摸拖拽、甩动惯性，支持“减少动态效果”
- 球面卡片点击命中
- 单一音频播放器与试听进度
- 分页目录接口 `GET /api/catalog?cursor=…`：iTunes 搜索词（含陳奕迅、林俊傑、周杰倫、鄧紫棋等中文歌手）+ 多商店分类榜，去重后最多 1200 首
- 横向拖近墙的接缝时加载下一页，新歌作为追加列接到墙上，到底后循环
- 卡片纹理按可见范围按需创建并限量回收
- 随机聚焦（从当前屏幕上的歌里选）、结果揭示和返回动画
- 外部目录不可用时先回退到 200 首快照（`npm run catalog:snapshot` 重新生成），再回退到本地占位数据

## 下一阶段

- 移动端真机视觉回归
- 增加近期推荐排除
- 接入时间、天气与地区上下文
- 实现规则推荐，再接入 AI 精排和图片理解

产品范围与架构详见 `docs/PRD.md` 和 `docs/ARCHITECTURE.md`。
