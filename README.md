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

- Three.js 3D 歌曲卡片墙
- 鼠标和触摸拖拽
- Raycaster 卡片点击
- 单一音频播放器与试听进度
- Apple iTunes 目录适配器
- 随机聚焦、结果揭示和返回动画
- 外部目录不可用时的本地歌曲占位数据

## 下一阶段

- 完善卡片惯性和移动端布局
- 增加近期推荐排除
- 接入时间、天气与地区上下文
- 实现规则推荐，再接入 AI 精排和图片理解

产品范围与架构详见 `docs/PRD.md` 和 `docs/ARCHITECTURE.md`。
