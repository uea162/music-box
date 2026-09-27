#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
layout_sim.py — 按 docs/REFERENCE-LAYOUT.md 描述的规则，预测点唱机墙面上每张可见卡片的屏幕矩形。

本脚本是我们自己根据文档规则编写的实现，不包含参考站点的任何代码。
所有常量与公式的出处见 REFERENCE-LAYOUT.md 中对应章节（注释里以 §章节名 标出）。

仅依赖 Python 3 标准库；如需 --overlay 叠加绘制，需要 Pillow（可选）。

用法示例：
  python3 layout_sim.py --width 1440 --height 900
  python3 layout_sim.py --width 390 --height 844 --mode ours --songs 120 --time 5 --intro
  python3 layout_sim.py --width 1440 --height 900 --overlay ours-1440.png out.png
"""
import argparse
import json
import math
import random
import sys

# ---------------------------------------------------------------------------
# §列与卡片：15 个基础列宽（墙面单位），循环使用
# ---------------------------------------------------------------------------
BASE_COLUMN_WIDTHS = (150, 200, 165, 215, 175, 225, 190, 250, 185, 230, 170, 210, 160, 205, 150)
CARD_ASPECT = 1.44          # 卡片高 = 宽 × 1.44
GAP = 14                    # §间距：列间、槽间统一 14 墙面单位
EXTRA_SONGS_PER_COLUMN = 14.4   # §列与卡片：追加歌曲的列数 = ceil(n / 14.4)
PAIR_MIN_WIDTH = 200        # §并排半宽卡：列宽 ≥ 200 才有并排槽
CENTER_COLUMN = 7           # 首屏居中的列（宽 250 的那一列），见 §不确定项

# §初始错位与自动移动
START_OFFSET_BASE = 300
START_OFFSET_STEP = 137
COLUMN_SPEEDS = (19, 27, 16, 24, 21, 29, 17, 25, 20, 23, 18, 26, 22, 28, 19)  # 墙面单位/秒
INTRO_MULTIPLIER = 16.0
INTRO_RATE = 1.6           # 开场倍率指数逼近速率（1/s），实测拟合 1.3–1.5，见 §不确定项

# §屏幕缩放
DESIGN_WIDTH = 1500.0
MIN_SCALE = 0.36

# §球面投影
RADIUS_FACTOR = 1.2
EYE_FACTOR = 3.2
MAX_ANGLE = 1.35            # 超过 ±1.35 弧度的列/槽不绘制
CULL_MARGIN = 0.62          # 投影偏移超过 0.62×视口 + 卡片尺寸 的不绘制
MESH_COLS, MESH_ROWS = 10, 14   # 每张卡片是 10×14 细分网格
SHADE_LOW, SHADE_SPAN = 0.3, 0.5


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def wrap_centered(value, period):
    """把 value 折返到 [-period/2, period/2) 区间（循环墙面的最近副本）。"""
    return (value + period / 2.0) % period - period / 2.0


def smoothstep(lo, hi, x):
    t = min(1.0, max(0.0, (x - lo) / (hi - lo)))
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# §排放方式：先按种子洗牌，再逐首放入当前最短的列
# ---------------------------------------------------------------------------
class Column:
    def __init__(self, index, width):
        self.index = index
        self.width = width
        self.slots = []     # 每个槽：{"songs": [...], "height": h, "top": y}
        self.length = 0.0   # 一圈的总长度（含每个槽后面的 14 间距）
        self.x = 0.0        # 列中心在墙面上的横坐标

    def next_slot_is_pair(self):
        # §并排半宽卡：宽列中下标 1、4、7…（下标 % 3 == 1）的槽放两张半宽卡
        return self.width >= PAIR_MIN_WIDTH and len(self.slots) % 3 == 1

    def add_slot(self, songs):
        card_w = (self.width - GAP) / 2.0 if len(songs) == 2 else float(self.width)
        height = card_w * CARD_ASPECT
        self.slots.append({"songs": list(songs), "height": height, "top": self.length})
        self.length += height + GAP


def shuffled(items, seed):
    # 可复现的洗牌；具体随机序列只影响“哪首歌在哪”，不影响矩形几何（见 §排放方式）
    rng = random.Random(seed)
    out = list(items)
    rng.shuffle(out)
    return out


def build_columns(songs, first_index, count, seed):
    columns = [Column(first_index + k, BASE_COLUMN_WIDTHS[(first_index + k) % len(BASE_COLUMN_WIDTHS)])
               for k in range(count)]
    queue = shuffled(songs, seed)
    while queue:
        # 最短列优先；并列时取下标最小的列
        target = min(columns, key=lambda c: (c.length, c.index))
        take = 2 if (target.next_slot_is_pair() and len(queue) >= 2) else 1
        target.add_slot(queue[:take])
        del queue[:take]
    return columns


def build_wall(num_songs, extra_songs=0, seed=1):
    songs = ["song-%03d" % i for i in range(num_songs)]
    columns = build_columns(songs, 0, len(BASE_COLUMN_WIDTHS), seed)
    if extra_songs > 0:
        extra = ["extra-%03d" % i for i in range(extra_songs)]
        n_extra_cols = math.ceil(extra_songs / EXTRA_SONGS_PER_COLUMN)
        columns += build_columns(extra, len(columns), n_extra_cols, seed + 1)
    # §列与卡片：列从左到右排开，列与列之间 14 间距，整面墙横向循环
    cursor = 0.0
    for col in columns:
        col.x = cursor + col.width / 2.0
        cursor += col.width + GAP
    return columns, cursor


# ---------------------------------------------------------------------------
# §我们项目的差异与团队决定：每列重复自身歌曲，直到一圈 ≥ 1.5 屏高，且同列相邻不重复
# ---------------------------------------------------------------------------
def extend_columns_for_screen(columns, view):
    min_length = 1.5 * view["height"] / view["scale"]
    for col in columns:
        pool = [s for slot in col.slots for s in slot["songs"]]
        if not pool:
            continue
        cursor = 0
        guard = 0
        while col.length < min_length and guard < 10000:
            guard += 1
            take = 2 if col.next_slot_is_pair() else 1
            previous = set(col.slots[-1]["songs"]) if col.slots else set()
            picked = []
            for _ in range(len(pool) * 2):
                cand = pool[cursor % len(pool)]
                cursor += 1
                if cand in previous or cand in picked:
                    continue
                picked.append(cand)
                if len(picked) == take:
                    break
            if len(picked) < take:          # 池子太小，无法满足“不相邻重复”，退回允许重复
                picked = [pool[(cursor + i) % len(pool)] for i in range(take)]
            col.add_slot(picked)
        # 循环衔接处（最后一槽与第一槽）也不能重复：必要时再补一槽
        if len(pool) > 2 and col.slots and set(col.slots[-1]["songs"]) & set(col.slots[0]["songs"]):
            take = 2 if col.next_slot_is_pair() else 1
            banned = set(col.slots[-1]["songs"]) | set(col.slots[0]["songs"])
            fill = [s for s in pool if s not in banned][:take]
            if len(fill) == take:
                col.add_slot(fill)
    return columns


# ---------------------------------------------------------------------------
# §屏幕缩放 + §球面投影：视图参数
# ---------------------------------------------------------------------------
def make_view(width, height):
    scale = max(width / DESIGN_WIDTH, MIN_SCALE)
    half_diag = math.hypot(width, height) / 2.0
    radius = RADIUS_FACTOR * half_diag / scale      # 球半径（墙面单位）
    eye = EYE_FACTOR * half_diag                    # 相机到屏幕平面的距离（屏幕 px）
    sphere_px = radius * scale                      # 球半径（屏幕 px）= 1.2·hypot/2
    return {
        "width": width, "height": height, "scale": scale,
        "radius": radius, "eye": eye, "sphere_px": sphere_px,
        "fov_deg": math.degrees(2.0 * math.atan(height / 2.0 / eye)),
        # 背面阈值 M = S/(eye+S) − 0.04，S = 球半径的屏幕像素；恒约 0.233
        "horizon": sphere_px / (eye + sphere_px) - 0.04,
    }


def project(view, turn, tilt):
    """球面上角度 (turn, tilt) 的点投影到屏幕 px。返回 (x, y, facing)。
    x_world = S·cos(b)·sin(a)，y_world = −S·sin(b)（向上为正），z = S·cos(a)·cos(b) − S；
    透视因子 k = eye / (eye − z)；屏幕 x = vw/2 + x_world·k，屏幕 y = vh/2 − y_world·k。"""
    s = view["sphere_px"]
    facing = math.cos(turn) * math.cos(tilt)
    wx = s * math.cos(tilt) * math.sin(turn)
    wy = -s * math.sin(tilt)
    wz = s * facing - s
    k = view["eye"] / (view["eye"] - wz)
    return view["width"] / 2.0 + wx * k, view["height"] / 2.0 - wy * k, facing


def projected_offset(view, angle, other_cos=1.0):
    # 列/槽中心相对屏幕中心的投影偏移（用于剔除判断）
    s = view["sphere_px"]
    e = view["eye"]
    return abs(s * math.sin(angle) * e / (e + s * (1.0 - math.cos(angle) * other_cos)))


# ---------------------------------------------------------------------------
# §初始错位与自动移动：时间 t 时各列的纵向偏移
# ---------------------------------------------------------------------------
def motion_distance(t, intro, reduced_motion, intro_rate=None):
    """统一速度倍率对时间的积分（单位：秒 × 1× 速度）。t 是“动画时间”（每帧 dt 上限 50 ms 累加）。
    §初始错位与自动移动（2026-09-27 实测）：开场倍率从 16× 按指数逼近 1×，
    m(t) = 1 + 15·exp(−k·t)，k ≈ 1.6/s（τ ≈ 0.63 s）。积分闭式：t + 15/k·(1 − exp(−k·t))。
    减少动态效果时倍率为 0。"""
    if reduced_motion or t <= 0:
        return 0.0
    if not intro:
        return t
    k = intro_rate or INTRO_RATE
    return t + (INTRO_MULTIPLIER - 1.0) / k * (1.0 - math.exp(-k * t))


def column_offset(index, distance, scroll):
    base = START_OFFSET_BASE + START_OFFSET_STEP * index
    direction = 1 if index % 2 == 0 else -1          # 偶数列向上，奇数列向下
    speed = COLUMN_SPEEDS[index % len(COLUMN_SPEEDS)]
    return base + direction * speed * distance + scroll


# ---------------------------------------------------------------------------
# 可见卡片
# ---------------------------------------------------------------------------
def card_outline(view, turn, tilt, w, h, samples=(MESH_COLS, MESH_ROWS)):
    """沿卡片四条边按网格细分采样投影点，返回外轮廓多边形（顺时针）。"""
    r = view["radius"]
    nu, nv = samples
    pts = []
    edge = [(i / nu - 0.5, -0.5) for i in range(nu)] + \
           [(0.5, j / nv - 0.5) for j in range(nv)] + \
           [(0.5 - i / nu, 0.5) for i in range(nu)] + \
           [(-0.5, 0.5 - j / nv) for j in range(nv)]
    for u, v in edge:
        x, y, _ = project(view, turn + u * w / r, tilt + v * h / r)
        pts.append((x, y))
    return pts


def visible_cards(columns, wall_width, view, pan=0.0, scroll=0.0, time=0.0,
                  intro=False, intro_rate=None, reduced_motion=False, center_column=CENTER_COLUMN):
    r = view["radius"]
    scale = view["scale"]
    horizon = view["horizon"]
    camera_x = columns[center_column % len(columns)].x + pan
    distance = motion_distance(time, intro, reduced_motion, intro_rate)
    cards = []
    for col in columns:
        dx = wrap_centered(col.x - camera_x, wall_width)
        turn_c = dx / r
        if abs(turn_c) > MAX_ANGLE:
            continue
        cos_turn = math.cos(turn_c)
        if cos_turn < horizon or projected_offset(view, turn_c) > CULL_MARGIN * view["width"] + scale * col.width:
            continue
        offset = column_offset(col.index, distance, scroll)
        for slot_index, slot in enumerate(col.slots):
            dy = wrap_centered(slot["top"] + slot["height"] / 2.0 - offset, col.length)
            tilt = dy / r
            if abs(tilt) > MAX_ANGLE or math.cos(tilt) * cos_turn < horizon:
                continue
            if projected_offset(view, tilt, cos_turn) > CULL_MARGIN * view["height"] + scale * slot["height"]:
                continue
            n = len(slot["songs"])
            card_w = (col.width - GAP * (n - 1)) / n
            for k in range(n):
                shift = (k - (n - 1) / 2.0) * (card_w + GAP)
                turn = (dx + shift) / r
                cx, cy, facing = project(view, turn, tilt)
                outline = card_outline(view, turn, tilt, card_w, slot["height"])
                xs = [p[0] for p in outline]
                ys = [p[1] for p in outline]
                flat_w = card_w * scale
                flat_h = slot["height"] * scale
                flat_cx = view["width"] / 2.0 + (dx + shift) * scale
                flat_cy = view["height"] / 2.0 + dy * scale
                cards.append({
                    "col": col.index,
                    "col_width": col.width,
                    "slot": slot_index,
                    "half": n == 2,
                    "half_index": k if n == 2 else None,
                    "song": slot["songs"][k],
                    # 投影后的外接矩形（屏幕 px），叠加对比时主要看这个
                    "x": round(min(xs), 1), "y": round(min(ys), 1),
                    "w": round(max(xs) - min(xs), 1), "h": round(max(ys) - min(ys), 1),
                    # 不做球面弯曲时的平面矩形（屏幕 px），供参考
                    "flat": {"x": round(flat_cx - flat_w / 2, 1), "y": round(flat_cy - flat_h / 2, 1),
                             "w": round(flat_w, 1), "h": round(flat_h, 1)},
                    "center": [round(cx, 1), round(cy, 1)],
                    "wall_w": round(card_w, 2), "wall_h": round(slot["height"], 2),
                    "turn": round(turn, 4), "tilt": round(tilt, 4),
                    "brightness": round(SHADE_LOW + (1 - SHADE_LOW) * smoothstep(horizon, horizon + SHADE_SPAN, facing), 3),
                    "outline": [[round(x, 1), round(y, 1)] for x, y in outline],
                })
    return cards


# ---------------------------------------------------------------------------
# 叠加绘制（可选 Pillow）
# ---------------------------------------------------------------------------
PALETTE = [(255, 80, 80), (255, 170, 60), (240, 240, 60), (120, 255, 90), (60, 240, 200),
           (60, 170, 255), (150, 110, 255), (255, 90, 220)]


def draw_overlay(cards, src, dst, width, height):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        sys.exit("--overlay 需要 Pillow：pip install pillow")
    img = Image.open(src).convert("RGB")
    if img.size != (width, height):
        img = img.resize((width, height))
    draw = ImageDraw.Draw(img)
    for c in cards:
        color = PALETTE[c["col"] % len(PALETTE)]
        draw.line([tuple(p) for p in c["outline"]] + [tuple(c["outline"][0])], fill=color, width=2)
        label = "c%d/%d%s" % (c["col"], c["slot"], "h" if c["half"] else "")
        draw.text((c["center"][0] - 14, c["center"][1] - 6), label, fill=color)
    img.save(dst)


# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="按 REFERENCE-LAYOUT.md 规则预测可见卡片矩形")
    ap.add_argument("--width", type=int, required=True, help="视口宽 (CSS px)")
    ap.add_argument("--height", type=int, required=True, help="视口高 (CSS px)")
    ap.add_argument("--mode", choices=("ref", "ours"), default="ref",
                    help="ref = 参考站点规则（默认 216 首）；ours = 团队决定（默认 120 首 + 按列重复补足）")
    ap.add_argument("--songs", type=int, default=None, help="歌曲数（ref 默认 216，ours 默认 120）")
    ap.add_argument("--extra-songs", type=int, default=0, help="追加歌曲数，生成 ceil(n/14.4) 个追加列")
    ap.add_argument("--seed", type=int, default=1, help="洗牌种子（只影响歌曲分配，不影响矩形）")
    ap.add_argument("--time", type=float, default=0.0, help="自动移动经过的秒数（默认 0 = 初始状态）")
    ap.add_argument("--intro", action="store_true",
                    help="模拟开场：倍率从 16× 按 exp(−k·t) 逼近 1×（--time 从开始移动算起，动画时间）")
    ap.add_argument("--intro-rate", type=float, default=INTRO_RATE,
                    help="开场指数逼近速率 k（1/s，默认 1.6）")
    ap.add_argument("--reduced-motion", action="store_true", help="减少动态效果：自动移动速度为 0")
    ap.add_argument("--pan", type=float, default=0.0, help="水平拖动量（墙面单位）")
    ap.add_argument("--scroll", type=float, default=0.0, help="纵向拖动量（墙面单位，作用于所有列）")
    ap.add_argument("--include-offscreen", action="store_true",
                    help="也输出通过剔除规则但完全落在视口外的卡片")
    ap.add_argument("--compact", action="store_true", help="每张卡片一行，省略 outline")
    ap.add_argument("--overlay", nargs=2, metavar=("INPUT_PNG", "OUTPUT_PNG"), help="把预测轮廓画到截图上")
    args = ap.parse_args(argv)

    n = args.songs if args.songs is not None else (216 if args.mode == "ref" else 120)
    view = make_view(args.width, args.height)
    columns, wall_width = build_wall(n, args.extra_songs, args.seed)
    if args.mode == "ours":
        extend_columns_for_screen(columns, view)
    cards = visible_cards(columns, wall_width, view, pan=args.pan, scroll=args.scroll, time=args.time,
                          intro=args.intro, intro_rate=args.intro_rate, reduced_motion=args.reduced_motion)

    if not args.include_offscreen:
        cards = [c for c in cards if c["x"] < args.width and c["x"] + c["w"] > 0
                 and c["y"] < args.height and c["y"] + c["h"] > 0]
    # 视口中心所在（或最近）的卡片，便于快速核对
    cx0, cy0 = args.width / 2.0, args.height / 2.0
    center_card = min(cards, key=lambda c: (c["center"][0] - cx0) ** 2 + (c["center"][1] - cy0) ** 2) if cards else None

    if args.overlay:
        draw_overlay(cards, args.overlay[0], args.overlay[1], args.width, args.height)

    meta = {
        "viewport": [args.width, args.height], "mode": args.mode, "songs": n,
        "scale": round(view["scale"], 4), "radius_units": round(view["radius"], 2),
        "eye_px": round(view["eye"], 2), "fov_deg": round(view["fov_deg"], 3),
        "horizon": round(view["horizon"], 4), "wall_width": wall_width,
        "columns": len(columns), "column_loops": [round(c.length, 1) for c in columns],
        "visible_columns": sorted({c["col"] for c in cards}), "visible_cards": len(cards),
        "center_card": None if center_card is None else
        {k: center_card[k] for k in ("col", "slot", "half", "x", "y", "w", "h")},
    }
    if args.compact:
        print(json.dumps(meta, ensure_ascii=False))
        for c in cards:
            c = {k: v for k, v in c.items() if k != "outline"}
            print(json.dumps(c, ensure_ascii=False))
    else:
        print(json.dumps({"meta": meta, "cards": cards}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:     # 例如输出被 head 截断
        sys.exit(0)
