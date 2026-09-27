# layout_sim.py — 参考布局模拟脚本

按 `../REFERENCE-LAYOUT.md` 描述的规则，预测任意视口下每张可见卡片的屏幕矩形，并可以把预测轮廓叠加到截图上，用于 QA 对比。脚本全部由我们自己编写，不含参考站点代码。

## 依赖

- Python 3.8+（只用标准库）
- 可选：Pillow（仅 `--overlay` 需要）：`pip install pillow`

## 常用命令

```bash
# 参考规则（216 首），1440×900 初始状态，完整 JSON
python3 layout_sim.py --width 1440 --height 900

# 每行一张卡片（第一行是 meta，里面有 center_card 和可见列）
python3 layout_sim.py --width 1440 --height 900 --compact

# 按团队决定（约 120 首 + 按列重复补足到 ≥1.5 屏高），含开场加速，开始移动 5 秒后的状态
python3 layout_sim.py --width 390 --height 844 --mode ours --songs 120 --time 5 --intro

# 把预测轮廓画到我们的截图上
python3 layout_sim.py --width 1440 --height 900 --mode ours --overlay ours-1440.png overlay-1440.png
```

## 参数

| 参数 | 说明 |
|---|---|
| `--width` / `--height` | 视口尺寸（CSS px，必填） |
| `--mode ref\|ours` | `ref` 为参考规则（默认 216 首）；`ours` 为团队决定（默认 120 首，按列重复补足） |
| `--songs N` | 歌曲数 |
| `--extra-songs N` | 追加歌曲数，会生成 `ceil(N/14.4)` 个追加列 |
| `--seed S` | 洗牌种子，只影响歌曲分配，不影响矩形 |
| `--time T` | 自动移动经过的秒数（默认 0） |
| `--intro` | 模拟开场：倍率从 16× 按 `1 + 15·exp(−k·t)` 逼近 1×（默认关闭）。`--time` 按开始移动后的动画时间计 |
| `--intro-rate K` | 开场指数逼近速率 k（1/s，默认 1.6，实测拟合 1.3–1.5，见文档“不确定项”） |
| `--reduced-motion` | 自动移动速度为 0 |
| `--pan X` / `--scroll Y` | 水平视角 / 所有列的纵向偏移（墙面单位） |
| `--include-offscreen` | 同时输出通过剔除规则、但完全在视口外的卡片 |
| `--compact` | 每张卡片一行，并省略 outline |
| `--overlay IN OUT` | 把预测轮廓画到截图 IN 上，保存为 OUT |

## 输出字段（每张卡片）

`col` 列序号、`song` 歌曲占位 id、`slot` 槽序号、`half` 是否并排半宽卡（`half_index` 为 0 左 / 1 右）、`x y w h` 投影后的外接矩形（屏幕 px）、`flat` 不做球面弯曲时的平面矩形、`center` 投影中心、`wall_w/wall_h` 墙面尺寸、`turn/tilt` 球面角度、`brightness` 明暗系数、`outline` 沿 10×14 网格边缘采样的投影轮廓。

## 自检

`python3 layout_sim.py --width 1440 --height 900 --compact | head -1` 输出的 `center_card` 应为第 7 列第 3 槽，x ≈ 600.6，w ≈ 238.8，即 x 范围约 601–839。
