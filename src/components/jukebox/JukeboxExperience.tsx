"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { fallbackSongs } from "@/data/fallback-songs";
import { songKey } from "@/lib/song-key";
import { chooseSong, describeScene, jpegForGemini, type SongMatch } from "@/lib/photo-recommendation";
import type { CatalogPage, CatalogSource, Song } from "@/types/song";
import type { JukeboxDebugApi } from "./debug";
import { LocalContext } from "./LocalContext";

type Phase = "loading" | "idle" | "landing" | "reveal";
type DragScope = "all-columns" | "pressed-column";

// Tunables. Wall layout and motion follow docs/REFERENCE-LAYOUT.md (section
// numbers in brackets). Lengths are wall units unless the name ends in _PX;
// one wall unit is `scale` screen px, scale = max(width / 1500, 0.36).

// [§1–§4] Columns, cards and gaps.
const COLUMN_WIDTHS = [150, 200, 165, 215, 175, 225, 190, 250, 185, 230, 170, 210, 160, 205, 150];
const CARD_ASPECT = 1.44;
const WALL_GAP = 14;
const PAIR_MIN_COLUMN_WIDTH = 200;
const PAIR_SLOT_EVERY = 3;
const PAIR_SLOT_PHASE = 1;
const SHUFFLE_SEED = 20260921;
const CENTER_COLUMN = 7;
// [§11] A column repeats its own songs until one loop is this many screens tall.
const MIN_LOOP_SCREENS = 1.5;
const MAX_SLOTS_PER_COLUMN = 4096;

// [§5] Per-column auto motion, all driven by one shared speed multiplier.
const START_OFFSET_BASE = 300;
const START_OFFSET_STEP = 137;
const COLUMN_SPEEDS = [19, 27, 16, 24, 21, 29, 17, 25, 20, 23, 18, 26, 22, 28, 19];
const RUNNING_SPEED = 1;
const STOPPED_SPEED = 0;
// Opening multiplier is 1 + 15·exp(−1.6·t): start at 16, ease toward 1 at 1.6/s.
const INTRO_SPEED = 16;
const SPEED_EASE_TO_RUN = 1.6;
const SPEED_EASE_TO_STOP = 6;
const MAX_FRAME_SECONDS = 0.05;

// [§10] Drag and inertia.
const DRAG_SCOPE = "all-columns" as DragScope;
const CLICK_MOVE_TOLERANCE_PX = 7;
const INERTIA_DECAY = 3.5;
const INERTIA_STOP_SPEED = 4;
const INERTIA_IDLE_RESET_MS = 80;
const INERTIA_SAMPLE_WINDOW_MS = 100;

// [§6–§7] Screen scale and spherical projection.
const DESIGN_WIDTH = 1500;
const MIN_SCALE = 0.36;
const SPHERE_RADIUS_FACTOR = 1.2;
const EYE_DISTANCE_FACTOR = 3.2;
const HORIZON_BIAS = 0.04;
const MAX_CARD_ANGLE = 1.35;
const CULL_MARGIN = 0.62;
const CARD_SEGMENTS_X = 10;
const CARD_SEGMENTS_Y = 14;
const SHADE_FLOOR = 0.3;
const SHADE_SPAN = 0.5;
const ALPHA_CUTOFF = 0.01;

// Focus, parallax, resize and textures.
// Preferred zoom; it only shrinks when the card would not fit the free frame.
const FOCUS_SCALE_WIDE = 1.38;
const FOCUS_SCALE_COMPACT = 1.1;
// Same breakpoint as `@media (max-width: 820px)` in globals.css.
const COMPACT_LAYOUT_MAX_WIDTH = 820;
const FOCUS_GLIDE_RATE = 7.5;
const FOCUS_SETTLED_UNITS = 0.5;
const FOCUS_SCALE_RATE = 5;
// Free frame for a focused or clicked card: viewport minus this margin, minus
// the result panel plus a gap. Before the panel mounts its box is predicted
// from the .result-panel rules in globals.css.
const FOCUS_MARGIN_PX = 16;
const RESULT_PANEL_GAP_PX = 24;
const RESULT_PANEL_WIDTH_PX = 390;
const RESULT_PANEL_EDGE_PX = 21;
const RESULT_PANEL_BESIDE_CENTER_PX = 205;
const RESULT_PANEL_COMPACT_TOP_SHARE = 0.5;
const PARALLAX_SHIFT_X_PX = 10;
const PARALLAX_SHIFT_Y_PX = 6;
const PARALLAX_RATE = 2.8;
const RESIZE_SETTLE_MS = 150;
const MAX_PIXEL_RATIO = 1.6;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Catalog paging (docs/DYNAMIC-SONG-LOADING.md §4). New pages become extra
// columns appended at the right end of the wall, the way [§1] describes.
// Distances in screens are multiples of `view.width / view.scale` wall units.
const SONGS_PER_EXTRA_COLUMN = 14.4;
const EXTRA_SHUFFLE_SEED = 1921;
const LOAD_AHEAD_SCREENS = 1; // request when the seam is this far past the culling reach
const LOAD_REARM_SCREENS = 0.5; // horizontal travel needed after a commit before the next request
const MAX_LOADED_SONGS = 1200;
const MAX_EMPTY_PAGES = 3;
const LOAD_TIMEOUT_MS = 8000;
const LOAD_RETRY_BASE_MS = 2000;
const LOAD_MAX_RETRIES = 3;
const LOAD_COOLDOWN_MS = 60000;
const CULL_SEARCH_STEPS = 24;
// Shared card textures are created when a card first becomes visible and
// the least recently used are released above the cap (not counting the
// active texture). Selected, playing and focused songs are never released.
const MAX_FACES_WIDE = 200;
const MAX_FACES_COMPACT = 110;
const FACE_SWEEP_EVERY_FRAMES = 120;
const FACE_IDLE_FRAMES = 60;

// [§9] Card face. Fractions are of the texture width unless noted; corner
// radii follow docs/ACCEPTANCE.md V2 (≈25 px / ≈18 px on the 239 px centre card).
const CARD_TEXTURE_WIDTH = 420;
const CARD_TEXTURE_HEIGHT = 604;
const CARD_EDGE_PX = 2;
const CARD_CORNER = 0.105;
const CARD_BASE_COLOR = "#1d1921";
const CARD_AMBIENCE_SPREAD = 0.12;
const CARD_AMBIENCE_RESOLUTION = 0.1;
const CARD_AMBIENCE_FILTER = "blur(2px) saturate(1.55) brightness(0.72)";
const CARD_AMBIENCE_FALLBACK_ALPHA = 0.55;
const CARD_SHADE_COLOR = "rgba(14, 10, 16, 0.3)";
const CARD_FADE_START = 0.35; // of the texture height
const CARD_FADE_TOP_COLOR = "rgba(14, 10, 16, 0.08)";
const CARD_FADE_BOTTOM_COLOR = "rgba(14, 10, 16, 0.62)";
const CARD_ART_INSET = 0.05;
const CARD_ART_SIZE = 0.9;
const CARD_ART_CORNER = 0.075;
const CARD_ART_PLACEHOLDER = "#2a2530";
// Instrument Serif has a smaller x-height than the reference's grotesque at
// 5.5%, so the serif title runs larger to read at the same size.
const CARD_TITLE_SIZE = 0.066;
const CARD_TITLE_LINE = 1.3;
const CARD_TITLE_GAP = 0.05;
const CARD_TITLE_TRACKING = -0.01; // em
const CARD_TEXT_COLOR = "#ffffff";
const CARD_SUBTITLE_SIZE = 0.045;
const CARD_SUBTITLE_LINE = 1.35;
const CARD_SUBTITLE_COLOR = "rgba(255, 255, 255, 0.56)";
const CARD_PROGRESS_GAP = 0.05;
const CARD_PROGRESS_HEIGHT = 0.015;
const CARD_PROGRESS_TRACK_COLOR = "rgba(255, 255, 255, 0.24)";
const CARD_PROGRESS_FILL_COLOR = "rgba(255, 255, 255, 0.88)";
const CARD_TIME_GAP = 0.016;
const CARD_TIME_SIZE = 0.037;
const CARD_TIME_COLOR = "rgba(255, 255, 255, 0.5)";
const CARD_CONTROLS_CENTER = 0.93; // of the texture height
const CARD_CONTROLS_GAP = 0.1;
const CARD_CONTROL_SIDE_SIZE = 0.085;
const CARD_CONTROL_PLAY_SIZE = 0.105;
const CARD_CONTROL_COLOR = "rgba(255, 255, 255, 0.92)";
const CARD_BORDER_WIDTH = 0.005;
const CARD_BORDER_COLOR = "rgba(255, 255, 255, 0.12)";
const CARD_BORDER_PLAYING_WIDTH = 0.015;
const CARD_BORDER_PLAYING_COLOR = "rgba(255, 255, 255, 0.88)";
const CARD_BORDER_SELECTED_WIDTH = 0.022;
const CARD_BORDER_SELECTED_COLOR = "#ffffff";
const PREVIEW_SECONDS = 30;
const SOURCE_LABELS: Record<CatalogSource, string> = {
  itunes: "Live catalog · 30 sec previews",
  snapshot: "Saved catalog · 30 sec previews",
  fallback: "Offline study catalog",
};
const percent = (value: number) => `${Math.round(value * 100)}%`;

const PALETTES = [
  ["#6f1d2b", "#140b10"],
  ["#99542d", "#21110c"],
  ["#255d5a", "#091a1a"],
  ["#504066", "#130f1c"],
  ["#744054", "#190c12"],
  ["#3f5273", "#0b111d"],
];

// Traditional Chinese faces first so 陳奕迅 / 方大同 keep their HK glyphs.
const CJK_FALLBACK_FONTS =
  "'PingFang TC', 'PingFang HK', 'PingFang SC', 'Hiragino Sans CNS', 'Hiragino Sans GB', 'Microsoft JhengHei', 'Microsoft YaHei', 'Noto Sans CJK TC', 'Noto Sans CJK SC', sans-serif";
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const DISPLAY_FONT_VARIABLE = "--font-display";
const UI_FONT_VARIABLE = "--font-ui";

const cardVertexShader = /* glsl */ `
uniform float uTurn;
uniform float uTilt;
uniform vec2 uSize;
uniform float uRadius;
uniform float uSphere;
varying vec2 vUv;
varying float vFacing;

void main() {
  vUv = uv;
  float a = uTurn + position.x * uSize.x / uRadius;
  float b = uTilt - position.y * uSize.y / uRadius;
  float cb = cos(b);
  vec3 bent = vec3(uSphere * cb * sin(a), -uSphere * sin(b), uSphere * (cos(a) * cb - 1.0));
  vFacing = cos(a) * cb;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(bent, 1.0);
}
`;

const cardFragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uHorizon;
uniform float uShadeFloor;
uniform float uShadeSpan;
uniform float uAlphaCutoff;
varying vec2 vUv;
varying float vFacing;

void main() {
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < uAlphaCutoff) discard;
  float shade = mix(uShadeFloor, 1.0, smoothstep(uHorizon, uHorizon + uShadeSpan, vFacing));
  gl_FragColor = vec4(texel.rgb * shade, texel.a);
  #include <colorspace_fragment>
}
`;

interface CardTexture {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  song: Song;
  image: HTMLImageElement | null;
  ambience: HTMLCanvasElement | null;
  instanceIndex: number;
  visualState: { playing: boolean; progress: number; selected: boolean };
  lastUsedFrame: number;
}

interface WallSlot {
  songs: Song[];
  top: number;
  height: number;
}

interface WallColumn {
  index: number;
  width: number;
  x: number;
  length: number;
  slots: WallSlot[];
}

interface WallView {
  width: number;
  height: number;
  scale: number;
  radius: number;
  sphere: number;
  eye: number;
  horizon: number;
  fov: number;
}

interface SharedCardUniforms {
  uRadius: THREE.IUniform<number>;
  uSphere: THREE.IUniform<number>;
  uHorizon: THREE.IUniform<number>;
  uShadeFloor: THREE.IUniform<number>;
  uShadeSpan: THREE.IUniform<number>;
  uAlphaCutoff: THREE.IUniform<number>;
}

interface CardUniforms extends SharedCardUniforms {
  uMap: THREE.IUniform<THREE.Texture | null>;
  uTurn: THREE.IUniform<number>;
  uTilt: THREE.IUniform<number>;
  uSize: THREE.IUniform<THREE.Vector2>;
}

interface CardMesh {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  uniforms: CardUniforms;
}

interface WallCard extends CardMesh {
  song: Song;
  instanceIndex: number;
  column: number;
  shift: number;
  centerY: number;
  width: number;
  height: number;
  turn: number;
  tilt: number;
  visible: boolean;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let visible = "";
  for (const character of text) {
    const candidate = `${visible}${character}`;
    if (ctx.measureText(`${candidate}${ellipsis}`).width > maxWidth) break;
    visible = candidate;
  }
  return `${visible}${ellipsis}`;
}

function wrap(value: number, span: number) {
  if (span <= 0) return value;
  return ((value + span / 2) % span + span) % span - span / 2;
}

function makeView(width: number, height: number): WallView {
  const scale = Math.max(width / DESIGN_WIDTH, MIN_SCALE);
  const halfDiagonal = Math.hypot(width, height) / 2;
  const sphere = SPHERE_RADIUS_FACTOR * halfDiagonal;
  const eye = EYE_DISTANCE_FACTOR * halfDiagonal;
  return {
    width,
    height,
    scale,
    radius: sphere / scale,
    sphere,
    eye,
    horizon: sphere / (eye + sphere) - HORIZON_BIAS,
    fov: THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / eye)),
  };
}

function projectedOffset(view: WallView, angle: number, otherCos = 1) {
  const { sphere, eye } = view;
  return Math.abs((sphere * Math.sin(angle) * eye) / (eye + sphere * (1 - Math.cos(angle) * otherCos)));
}

function shuffleSongs(songs: Song[], seed: number) {
  const result = songs.slice();
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function nextSlotIsPair(column: WallColumn) {
  return column.width >= PAIR_MIN_COLUMN_WIDTH && column.slots.length % PAIR_SLOT_EVERY === PAIR_SLOT_PHASE;
}

function addSlot(column: WallColumn, songs: Song[]) {
  const cardWidth = songs.length === 2 ? (column.width - WALL_GAP) / 2 : column.width;
  const height = cardWidth * CARD_ASPECT;
  column.slots.push({ songs, top: column.length, height });
  column.length += height + WALL_GAP;
}

// Columns `startIndex …` laid out left to right from `startX`; widths cycle
// through COLUMN_WIDTHS. Returns the new right edge (the next wall width).
function buildColumns(songs: Song[], startIndex: number, count: number, startX: number, seed: number) {
  let cursor = startX;
  const columns: WallColumn[] = Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const width = COLUMN_WIDTHS[index % COLUMN_WIDTHS.length];
    const column = { index, width, x: cursor + width / 2, length: 0, slots: [] };
    cursor += width + WALL_GAP;
    return column;
  });
  const queue = shuffleSongs(songs, seed);
  let next = 0;
  while (next < queue.length) {
    let target = columns[0];
    for (const column of columns) {
      if (column.length < target.length) target = column;
    }
    const take = nextSlotIsPair(target) && queue.length - next >= 2 ? 2 : 1;
    addSlot(target, queue.slice(next, next + take));
    next += take;
  }
  return { columns, wallWidth: cursor };
}

function buildBaseColumns(songs: Song[]) {
  return buildColumns(songs, 0, COLUMN_WIDTHS.length, 0, SHUFFLE_SEED);
}

function buildExtraColumns(songs: Song[], startIndex: number, startX: number, seed: number) {
  return buildColumns(songs, startIndex, Math.ceil(songs.length / SONGS_PER_EXTRA_COLUMN), startX, seed);
}

function grownFloat64(source: Float64Array<ArrayBuffer>, length: number) {
  if (source.length >= length) return source;
  const next = new Float64Array(length);
  next.set(source);
  return next;
}

function hasSong(songs: Song[], song: Song) {
  return songs.some((item) => item.id === song.id);
}

// Repeats only append slots, so every existing slot keeps its song and
// position when a taller viewport needs a longer loop.
function extendColumns(base: WallColumn[], minLength: number) {
  return base.map((source) => {
    const column: WallColumn = { ...source, slots: source.slots.slice() };
    const pool = source.slots.flatMap((slot) => slot.songs);
    if (!pool.length) return column;
    let cursor = 0;
    while (column.length < minLength && column.slots.length < MAX_SLOTS_PER_COLUMN) {
      const take = nextSlotIsPair(column) ? 2 : 1;
      const previous = column.slots[column.slots.length - 1].songs;
      let picked: Song[] = [];
      for (let tries = 0; tries < pool.length * 2 && picked.length < take; tries += 1) {
        const candidate = pool[cursor % pool.length];
        cursor += 1;
        if (!hasSong(previous, candidate) && !hasSong(picked, candidate)) picked.push(candidate);
      }
      if (picked.length < take) {
        picked = Array.from({ length: take }, (_, offset) => pool[(cursor + offset) % pool.length]);
      }
      addSlot(column, picked);
    }
    const first = column.slots[0].songs;
    const last = column.slots[column.slots.length - 1].songs;
    if (pool.length > 2 && column.slots.length > 1 && last.some((song) => hasSong(first, song))) {
      const take = nextSlotIsPair(column) ? 2 : 1;
      const fill = pool.filter((song) => !hasSong(first, song) && !hasSong(last, song)).slice(0, take);
      if (fill.length === take) addSlot(column, fill);
    }
    return column;
  });
}

let activeAnimationLoopCount = 0;

function cardVisual(
  card: CardTexture,
  playingId: string | null,
  progress: number,
  selectedId: string | null,
  instanceIndex: number | null,
) {
  const active = instanceIndex !== null && card.instanceIndex === instanceIndex;
  const playing = active && card.song.id === playingId;
  return {
    playing,
    progress: playing ? progress : 0,
    selected: active && card.song.id === selectedId,
  };
}

function drawCard(
  card: CardTexture,
  state: { playing: boolean; progress: number; selected: boolean },
) {
  card.visualState = state;
  const { canvas, context: ctx, song, image } = card;
  const width = canvas.width;
  const height = canvas.height;
  const fonts = cardFonts();
  const palette = PALETTES[Math.abs(Number(song.id.replace(/\D/g, "").slice(-2)) || 0) % PALETTES.length];
  const faceWidth = width - CARD_EDGE_PX * 2;
  const faceHeight = height - CARD_EDGE_PX * 2;
  const corner = width * CARD_CORNER;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(CARD_EDGE_PX, CARD_EDGE_PX, faceWidth, faceHeight, corner);
  ctx.clip();

  ctx.fillStyle = CARD_BASE_COLOR;
  ctx.fillRect(0, 0, width, height);
  const spread = width * CARD_AMBIENCE_SPREAD;
  if (card.ambience) {
    ctx.drawImage(card.ambience, -spread, -spread, width + spread * 2, height + spread * 2);
  } else if (!song.artworkUrl) {
    const glow = ctx.createLinearGradient(0, 0, width, height);
    glow.addColorStop(0, song.accent || palette[0]);
    glow.addColorStop(1, palette[1]);
    ctx.globalAlpha = CARD_AMBIENCE_FALLBACK_ALPHA;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = CARD_SHADE_COLOR;
  ctx.fillRect(0, 0, width, height);
  const fade = ctx.createLinearGradient(0, height * CARD_FADE_START, 0, height);
  fade.addColorStop(0, CARD_FADE_TOP_COLOR);
  fade.addColorStop(1, CARD_FADE_BOTTOM_COLOR);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);

  const inset = width * CARD_ART_INSET;
  const artSize = width * CARD_ART_SIZE;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(inset, inset, artSize, artSize, width * CARD_ART_CORNER);
  ctx.clip();
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, inset, inset, artSize, artSize);
  } else if (song.artworkUrl) {
    ctx.fillStyle = CARD_ART_PLACEHOLDER;
    ctx.fillRect(inset, inset, artSize, artSize);
  } else {
    const art = ctx.createRadialGradient(width * 0.64, height * 0.18, 10, width * 0.5, height * 0.28, artSize);
    art.addColorStop(0, "rgba(255, 235, 196, .72)");
    art.addColorStop(0.34, song.accent || palette[0]);
    art.addColorStop(1, palette[1]);
    ctx.fillStyle = art;
    ctx.fillRect(inset, inset, artSize, artSize);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 2;
    for (let ring = 0; ring < 7; ring += 1) {
      ctx.beginPath();
      ctx.arc(width / 2, inset + artSize / 2, 24 + ring * 24, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  const textWidth = artSize;
  ctx.textBaseline = "middle";
  const titleSize = width * CARD_TITLE_SIZE;
  const titleTop = inset + artSize + width * CARD_TITLE_GAP;
  const titleLine = titleSize * CARD_TITLE_LINE;
  ctx.fillStyle = CARD_TEXT_COLOR;
  ctx.font = `400 ${titleSize}px ${fonts.display}`;
  ctx.letterSpacing = `${titleSize * CARD_TITLE_TRACKING}px`;
  ctx.fillText(ellipsize(ctx, song.title, textWidth), inset, titleTop + titleLine / 2);
  ctx.letterSpacing = "0px";

  const subtitleSize = width * CARD_SUBTITLE_SIZE;
  const subtitleTop = titleTop + titleLine;
  const subtitleLine = subtitleSize * CARD_SUBTITLE_LINE;
  ctx.fillStyle = CARD_SUBTITLE_COLOR;
  ctx.font = `400 ${subtitleSize}px ${fonts.ui}`;
  ctx.fillText(ellipsize(ctx, song.artist, textWidth), inset, subtitleTop + subtitleLine / 2);

  const barTop = subtitleTop + subtitleLine + width * CARD_PROGRESS_GAP;
  const barHeight = width * CARD_PROGRESS_HEIGHT;
  ctx.fillStyle = CARD_PROGRESS_TRACK_COLOR;
  ctx.beginPath();
  ctx.roundRect(inset, barTop, textWidth, barHeight, barHeight / 2);
  ctx.fill();
  if (state.progress > 0) {
    ctx.fillStyle = CARD_PROGRESS_FILL_COLOR;
    ctx.beginPath();
    ctx.roundRect(inset, barTop, Math.max(barHeight, textWidth * Math.min(1, state.progress)), barHeight, barHeight / 2);
    ctx.fill();
  }

  const timeSize = width * CARD_TIME_SIZE;
  const timeMiddle = barTop + barHeight + width * CARD_TIME_GAP + timeSize / 2;
  const elapsed = PREVIEW_SECONDS * Math.min(1, state.progress);
  ctx.fillStyle = CARD_TIME_COLOR;
  ctx.font = `500 ${timeSize}px ${fonts.ui}`;
  ctx.fillText(formatTime(elapsed), inset, timeMiddle);
  ctx.textAlign = "right";
  ctx.fillText(`-${formatTime(PREVIEW_SECONDS - elapsed)}`, inset + textWidth, timeMiddle);
  ctx.textAlign = "left";

  const controlsY = height * CARD_CONTROLS_CENTER;
  const playSize = width * CARD_CONTROL_PLAY_SIZE;
  const sideSize = width * CARD_CONTROL_SIDE_SIZE;
  const sideOffset = playSize / 2 + width * CARD_CONTROLS_GAP + sideSize / 2;
  ctx.fillStyle = CARD_CONTROL_COLOR;
  drawSkipIcon(ctx, width / 2 - sideOffset, controlsY, sideSize, -1);
  drawSkipIcon(ctx, width / 2 + sideOffset, controlsY, sideSize, 1);
  if (state.playing) {
    const bar = playSize * 0.22;
    ctx.beginPath();
    ctx.roundRect(width / 2 - playSize * 0.3, controlsY - playSize * 0.36, bar, playSize * 0.72, bar * 0.3);
    ctx.roundRect(width / 2 + playSize * 0.3 - bar, controlsY - playSize * 0.36, bar, playSize * 0.72, bar * 0.3);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(width / 2 - playSize * 0.3, controlsY - playSize * 0.38);
    ctx.lineTo(width / 2 + playSize * 0.38, controlsY);
    ctx.lineTo(width / 2 - playSize * 0.3, controlsY + playSize * 0.38);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const borderWidth =
    width *
    (state.selected ? CARD_BORDER_SELECTED_WIDTH : state.playing ? CARD_BORDER_PLAYING_WIDTH : CARD_BORDER_WIDTH);
  ctx.strokeStyle = state.selected
    ? CARD_BORDER_SELECTED_COLOR
    : state.playing
      ? CARD_BORDER_PLAYING_COLOR
      : CARD_BORDER_COLOR;
  ctx.lineWidth = borderWidth;
  ctx.beginPath();
  ctx.roundRect(
    CARD_EDGE_PX + borderWidth / 2,
    CARD_EDGE_PX + borderWidth / 2,
    faceWidth - borderWidth,
    faceHeight - borderWidth,
    corner - borderWidth / 2,
  );
  ctx.stroke();
  card.texture.needsUpdate = true;
}

function drawSkipIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, direction: 1 | -1) {
  const half = size / 2;
  ctx.beginPath();
  for (const start of [-half, 0]) {
    ctx.moveTo(x + direction * start, y - half * 0.62);
    ctx.lineTo(x + direction * (start + half), y);
    ctx.lineTo(x + direction * start, y + half * 0.62);
    ctx.closePath();
  }
  ctx.fill();
}

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// A tiny pre-filtered copy of the cover. Upscaling it softens it further, so
// redrawing the playing card on every progress tick never re-runs a blur.
function drawAmbience(image: HTMLImageElement) {
  const ambience = document.createElement("canvas");
  ambience.width = Math.round(CARD_TEXTURE_WIDTH * CARD_AMBIENCE_RESOLUTION);
  ambience.height = Math.round(CARD_TEXTURE_HEIGHT * CARD_AMBIENCE_RESOLUTION);
  const ctx = ambience.getContext("2d");
  if (!ctx) return null;
  const cropWidth = Math.min(image.naturalWidth, (image.naturalHeight * ambience.width) / ambience.height);
  const cropHeight = Math.min(image.naturalHeight, (image.naturalWidth * ambience.height) / ambience.width);
  ctx.filter = CARD_AMBIENCE_FILTER;
  ctx.drawImage(
    image,
    (image.naturalWidth - cropWidth) / 2,
    (image.naturalHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    ambience.width,
    ambience.height,
  );
  return ambience;
}

interface CardFonts {
  display: string;
  ui: string;
}

let cardFontCache: CardFonts | null = null;

// Canvas cannot resolve CSS variables, so read the family names next/font
// put on <html> and append the Chinese fallbacks.
function cardFonts(): CardFonts {
  if (cardFontCache) return cardFontCache;
  const style = getComputedStyle(document.documentElement);
  const display = style.getPropertyValue(DISPLAY_FONT_VARIABLE).trim();
  const ui = style.getPropertyValue(UI_FONT_VARIABLE).trim();
  const fonts = {
    display: display ? `${display}, ${CJK_FALLBACK_FONTS}` : CJK_FALLBACK_FONTS,
    ui: ui ? `${ui}, ${CJK_FALLBACK_FONTS}` : CJK_FALLBACK_FONTS,
  };
  if (display && ui) cardFontCache = fonts;
  return fonts;
}

function cardFontFaces() {
  const fonts = cardFonts();
  return [`400 24px ${fonts.display}`, `400 18px ${fonts.ui}`, `500 16px ${fonts.ui}`];
}

export function JukeboxExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const facesRef = useRef(new Set<CardTexture>());
  const sceneApiRef = useRef<{
    focus: (songId: string) => void;
    refit: () => void;
    reset: () => void;
    visibleCards: () => Array<{ song: Song; instanceIndex: number }>;
  } | null>(null);
  const resultPanelRef = useRef<HTMLElement>(null);
  // Sharp copy of the focused card above the result scrim; the scene sets its
  // box every frame to the projected bounds of the focused 3D card.
  const focusCardRef = useRef<HTMLDivElement>(null);
  // `songs` is the first catalog page and builds the scene once; later pages
  // are fetched and appended by the scene itself (see `commitPage`).
  const [songs, setSongs] = useState<Song[]>([]);
  const firstCursorRef = useRef<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [source, setSource] = useState<CatalogSource>("fallback");
  const [phase, setPhase] = useState<Phase>("loading");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [sceneText, setSceneText] = useState("");
  const [photoStatus, setPhotoStatus] = useState<"idle" | "reading" | "choosing" | "done" | "image-error" | "song-error">("idle");
  const [photoError, setPhotoError] = useState("");
  const [match, setMatch] = useState<SongMatch | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const photoRequestRef = useRef<AbortController | null>(null);
  const photoRunRef = useRef(0);
  const photoStartedRef = useRef(0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const playingIdRef = useRef(playingId);
  const selectedIdRef = useRef(selectedId);
  const progressRef = useRef(progress);
  const selectedInstanceRef = useRef<number | null>(null);
  const toggleSongRef = useRef<(song: Song) => void>(() => {});
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  playingIdRef.current = playingId;
  selectedIdRef.current = selectedId;
  progressRef.current = progress;

  const pausePlayback = useCallback(() => {
    audioRef.current?.pause();
    playingIdRef.current = null;
    setPlayingId(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalog")
      .then((response) => response.json())
      .then((data: Partial<CatalogPage>) => {
        if (cancelled) return;
        firstCursorRef.current = data.songs?.length ? data.nextCursor ?? null : null;
        setSongs(data.songs?.length ? data.songs : fallbackSongs);
        setSource(data.source ?? "fallback");
        setPhase("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setSongs(fallbackSongs);
        setPhase("idle");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (photoStatus !== "reading" && photoStatus !== "choosing") return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - photoStartedRef.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [photoStatus]);

  useEffect(() => () => photoRequestRef.current?.abort(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || songs.length === 0) return;

    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 10);
    const group = new THREE.Group();
    scene.add(group);
    const geometry = new THREE.PlaneGeometry(1, 1, CARD_SEGMENTS_X, CARD_SEGMENTS_Y);
    const sharedUniforms: SharedCardUniforms = {
      uRadius: { value: 1 },
      uSphere: { value: 1 },
      uHorizon: { value: 0 },
      uShadeFloor: { value: SHADE_FLOOR },
      uShadeSpan: { value: SHADE_SPAN },
      uAlphaCutoff: { value: ALPHA_CUTOFF },
    };

    // One texture per song, shared by every copy of it on the wall, plus one
    // extra texture for the single active (selected / playing) copy. Only the
    // active texture can carry the white frame, so the wall never shows two.
    const createFace = (song: Song): CardTexture | null => {
      const faceCanvas = document.createElement("canvas");
      faceCanvas.width = CARD_TEXTURE_WIDTH;
      faceCanvas.height = CARD_TEXTURE_HEIGHT;
      const context = faceCanvas.getContext("2d");
      if (!context) return null;
      const texture = new THREE.CanvasTexture(faceCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      return {
        canvas: faceCanvas,
        context,
        texture,
        song,
        image: null,
        ambience: null,
        instanceIndex: -1,
        visualState: { playing: false, progress: 0, selected: false },
        lastUsedFrame: 0,
      };
    };

    const wallSongs: Song[] = [];
    const loadedIds = new Set<string>();
    const loadedKeys = new Set<string>();
    songs.forEach((song) => {
      if (loadedIds.has(song.id) || loadedKeys.has(songKey(song))) return;
      loadedIds.add(song.id);
      loadedKeys.add(songKey(song));
      wallSongs.push(song);
    });
    const activeFace = createFace(wallSongs[0] ?? songs[0]);
    if (!activeFace || wallSongs.length === 0) {
      activeFace?.texture.dispose();
      geometry.dispose();
      return;
    }
    drawCard(activeFace, activeFace.visualState);
    renderer.initTexture(activeFace.texture);
    facesRef.current = new Set([activeFace]);
    setLoadedCount(loadedIds.size);

    // Shared faces live only while cards of that song are on screen; see
    // `acquireFace` / `sweepFaces`.
    const faces = new Map<string, CardTexture>();
    let frameCount = 0;
    const fontFaces = cardFontFaces();
    const fontsPending = !fontFaces.every((font) => document.fonts.check(font));
    // Faces drawn before the web fonts arrived used fallbacks; redraw every
    // texture exactly once when they are ready.
    if (fontsPending) {
      void Promise.all(fontFaces.map((font) => document.fonts.load(font)))
        .catch(() => [])
        .then(() => document.fonts.ready)
        .then(() => {
          if (disposed) return;
          facesRef.current.forEach((face) => drawCard(face, face.visualState));
        });
    }

    const loadArtwork = (face: CardTexture) => {
      const url = face.song.artworkUrl;
      if (!url) return;
      const image = new Image();
      image.crossOrigin = "anonymous";
      face.image = image;
      image.onload = () => {
        if (disposed || faces.get(face.song.id) !== face) return;
        face.ambience = drawAmbience(image);
        drawCard(face, face.visualState);
        if (activeFace.song.id === face.song.id) {
          activeFace.image = image;
          activeFace.ambience = face.ambience;
          drawCard(activeFace, activeFace.visualState);
        }
      };
      image.onerror = () => {};
      image.src = url;
    };
    const acquireFace = (song: Song) => {
      let face = faces.get(song.id);
      if (!face) {
        const created = createFace(song);
        if (!created) return null;
        face = created;
        faces.set(song.id, face);
        facesRef.current.add(face);
        drawCard(face, face.visualState);
        renderer.initTexture(face.texture);
        loadArtwork(face);
      }
      face.lastUsedFrame = frameCount;
      return face;
    };
    const releaseFace = (face: CardTexture) => {
      if (face.image) {
        face.image.onload = null;
        face.image.onerror = null;
        face.image.src = "";
      }
      face.texture.dispose();
      faces.delete(face.song.id);
      facesRef.current.delete(face);
    };
    const facesCap = () => (view.width <= COMPACT_LAYOUT_MAX_WIDTH ? MAX_FACES_COMPACT : MAX_FACES_WIDE);
    const sweepFaces = () => {
      const excess = faces.size - facesCap();
      if (excess <= 0) return;
      const kept = new Set([selectedIdRef.current, playingIdRef.current, focus.songId, activeCard?.song.id]);
      const idle = [...faces.values()]
        .filter((face) => !kept.has(face.song.id) && frameCount - face.lastUsedFrame >= FACE_IDLE_FRAMES)
        .sort((a, b) => a.lastUsedFrame - b.lastUsedFrame)
        .slice(0, excess);
      if (!idle.length) return;
      const released = new Set<THREE.Texture>(idle.map((face) => face.texture));
      idle.forEach(releaseFace);
      cards.forEach((card) => {
        if (card.uniforms.uMap.value && released.has(card.uniforms.uMap.value)) card.uniforms.uMap.value = null;
      });
    };

    const base = buildBaseColumns(wallSongs);
    let baseColumns = base.columns;
    let wallWidth = base.wallWidth;
    // Commits re-base the camera into the wall's first lap so a wider wall
    // wraps every visible column to where it already is; see `commitPage`.
    let wallOrigin = 0;
    let seamClearUnits = 0;
    let view = makeView(1, 1);
    let columns: WallColumn[] = base.columns;
    let layoutSignature = "";
    let cards: WallCard[] = [];
    let cardByInstance = new Map<number, WallCard>();
    let activeCard: WallCard | null = null;
    const meshPool: CardMesh[] = [];

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    let reducedMotion = mediaQuery.matches;

    // Everything that moves the wall goes through this object. Auto motion,
    // the opening speed-up, drag, wheel, inertia and focus all feed `nudge`
    // or `speed`; column offsets are composed in one place, `columnOffset`.
    const wallMotion = {
      targetSpeed: reducedMotion ? STOPPED_SPEED : RUNNING_SPEED,
      speed: reducedMotion ? STOPPED_SPEED : INTRO_SPEED,
      distance: 0,
      pan: 0,
      scroll: new Float64Array(baseColumns.length),
      pendingPan: 0,
      pendingScrollAll: 0,
      pendingScroll: new Float64Array(baseColumns.length),
      velocityPan: 0,
      velocityScroll: 0,
      velocityColumn: null as number | null,
    };
    const pointer = {
      pressed: false,
      id: -1,
      column: null as number | null,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      moved: 0,
      samples: [] as Array<{ time: number; x: number; y: number }>,
    };
    // `songId` is set only by Pick one record; a clicked card that sits
    // partly off screen glides with `songId` null and keeps (holdX, holdY)
    // as its remaining offset from the view centre.
    const focus = {
      songId: null as string | null,
      card: null as WallCard | null,
      gliding: false,
      holdX: 0,
      holdY: 0,
    };
    let targetScale = 1;
    const parallaxCurrent = new THREE.Vector2();
    const parallaxTarget = new THREE.Vector2();
    const focusShiftCurrent = new THREE.Vector2();
    const focusShiftTarget = new THREE.Vector2();

    const inertiaActive = () => wallMotion.velocityPan !== 0 || wallMotion.velocityScroll !== 0;
    const stopInertia = () => {
      wallMotion.velocityPan = 0;
      wallMotion.velocityScroll = 0;
      wallMotion.velocityColumn = null;
    };
    const resolveTargetSpeed = () =>
      reducedMotion || pointer.pressed || inertiaActive() || playingIdRef.current !== null || focus.songId !== null
        ? STOPPED_SPEED
        : RUNNING_SPEED;

    const nudge = (pan: number, scroll: number, column: number | null) => {
      wallMotion.pendingPan += pan;
      if (column === null) wallMotion.pendingScrollAll += scroll;
      else wallMotion.pendingScroll[column] += scroll;
    };
    const columnOffset = (index: number) =>
      START_OFFSET_BASE +
      START_OFFSET_STEP * index +
      (index % 2 === 0 ? 1 : -1) * COLUMN_SPEEDS[index % COLUMN_SPEEDS.length] * wallMotion.distance +
      wallMotion.scroll[index];
    const cameraX = () => columns[CENTER_COLUMN % columns.length].x + wallMotion.pan - wallOrigin;
    const cardOffset = (card: WallCard) => {
      const column = columns[card.column];
      return {
        dx: wrap(column.x - cameraX(), wallWidth) + card.shift,
        dy: wrap(card.centerY - columnOffset(card.column), column.length),
      };
    };
    const unitsPerPixel = () => 1 / (view.scale * group.scale.x);

    const stepMotion = (dt: number) => {
      wallMotion.targetSpeed = resolveTargetSpeed();
      const rate = wallMotion.targetSpeed === STOPPED_SPEED ? SPEED_EASE_TO_STOP : SPEED_EASE_TO_RUN;
      wallMotion.speed += (wallMotion.targetSpeed - wallMotion.speed) * (1 - Math.exp(-dt * rate));
      wallMotion.distance += wallMotion.speed * dt;

      if (!pointer.pressed && inertiaActive()) {
        nudge(wallMotion.velocityPan * dt, wallMotion.velocityScroll * dt, wallMotion.velocityColumn);
        const decay = Math.exp(-INERTIA_DECAY * dt);
        wallMotion.velocityPan *= decay;
        wallMotion.velocityScroll *= decay;
        if (Math.hypot(wallMotion.velocityPan, wallMotion.velocityScroll) < INERTIA_STOP_SPEED) stopInertia();
      }

      if (focus.card && focus.gliding && !pointer.pressed) {
        const offset = cardOffset(focus.card);
        const dx = offset.dx - focus.holdX;
        const dy = offset.dy - focus.holdY;
        const share = reducedMotion ? 1 : 1 - Math.exp(-dt * FOCUS_GLIDE_RATE);
        nudge(dx * share, dy * share, null);
        if (Math.abs(dx * (1 - share)) < FOCUS_SETTLED_UNITS && Math.abs(dy * (1 - share)) < FOCUS_SETTLED_UNITS) {
          focus.gliding = false;
        }
      }

      wallMotion.pan += wallMotion.pendingPan;
      for (let index = 0; index < wallMotion.scroll.length; index += 1) {
        wallMotion.scroll[index] += wallMotion.pendingScrollAll + wallMotion.pendingScroll[index];
        wallMotion.pendingScroll[index] = 0;
      }
      wallMotion.pendingPan = 0;
      wallMotion.pendingScrollAll = 0;
    };

    let columnTurn = new Float64Array(baseColumns.length);
    let columnCos = new Float64Array(baseColumns.length);
    let columnShown = new Uint8Array(baseColumns.length);
    let columnOffsets = new Float64Array(baseColumns.length);
    const growColumnBuffers = (length: number) => {
      wallMotion.scroll = grownFloat64(wallMotion.scroll, length);
      wallMotion.pendingScroll = grownFloat64(wallMotion.pendingScroll, length);
      columnTurn = grownFloat64(columnTurn, length);
      columnCos = grownFloat64(columnCos, length);
      columnOffsets = grownFloat64(columnOffsets, length);
      if (columnShown.length < length) columnShown = new Uint8Array(length);
    };
    const columnVisible = (dx: number, width: number) => {
      const turn = dx / view.radius;
      return (
        Math.abs(turn) <= MAX_CARD_ANGLE &&
        Math.cos(turn) >= view.horizon &&
        projectedOffset(view, turn) <= CULL_MARGIN * view.width + view.scale * width
      );
    };
    // Largest column-centre distance at which any column can still be drawn.
    // A seam farther than this from the view is off screen on both sides.
    const cullReach = () => {
      const width = Math.max(...COLUMN_WIDTHS);
      let low = 0;
      let high = MAX_CARD_ANGLE * view.radius;
      if (columnVisible(high, width)) return high;
      for (let step = 0; step < CULL_SEARCH_STEPS; step += 1) {
        const middle = (low + high) / 2;
        if (columnVisible(middle, width)) low = middle;
        else high = middle;
      }
      return high;
    };
    const placeCards = () => {
      const { radius, horizon, scale } = view;
      const viewX = cameraX();
      columns.forEach((column) => {
        const dx = wrap(column.x - viewX, wallWidth);
        columnTurn[column.index] = dx;
        columnCos[column.index] = Math.cos(dx / radius);
        columnOffsets[column.index] = columnOffset(column.index);
        columnShown[column.index] = columnVisible(dx, column.width) ? 1 : 0;
      });
      cards.forEach((card) => {
        const column = columns[card.column];
        const dy = wrap(card.centerY - columnOffsets[card.column], column.length);
        const tilt = dy / radius;
        const cosTurn = columnCos[card.column];
        card.turn = (columnTurn[card.column] + card.shift) / radius;
        card.tilt = tilt;
        card.visible =
          columnShown[card.column] === 1 &&
          Math.abs(tilt) <= MAX_CARD_ANGLE &&
          Math.cos(tilt) * cosTurn >= horizon &&
          projectedOffset(view, tilt, cosTurn) <= CULL_MARGIN * view.height + scale * card.height;
        if (card.visible) {
          const face = acquireFace(card.song);
          if (card !== activeCard) {
            const texture = face?.texture ?? null;
            if (card.uniforms.uMap.value !== texture) card.uniforms.uMap.value = texture;
          }
        }
        card.mesh.visible = card.visible && card.uniforms.uMap.value !== null;
        card.uniforms.uTurn.value = card.turn;
        card.uniforms.uTilt.value = card.tilt;
      });
    };

    const projectPoint = (turn: number, tilt: number, out: { x: number; y: number }) => {
      const { sphere, eye } = view;
      const scale = group.scale.x;
      const cosTilt = Math.cos(tilt);
      const x = sphere * cosTilt * Math.sin(turn) * scale + group.position.x;
      const y = -sphere * Math.sin(tilt) * scale + group.position.y;
      const z = sphere * (Math.cos(turn) * cosTilt - 1) * scale + group.position.z;
      const perspective = eye / (eye - z);
      out.x = view.width / 2 + x * perspective;
      out.y = view.height / 2 - y * perspective;
      return out;
    };
    const boundsPoint = { x: 0, y: 0 };
    const cardBounds = (card: WallCard, turn = card.turn, tilt = card.tilt) => {
      const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let u = -0.5; u <= 0.5; u += 0.25) {
        for (let v = -0.5; v <= 0.5; v += 0.25) {
          if (Math.abs(u) !== 0.5 && Math.abs(v) !== 0.5) continue;
          projectPoint(turn + (u * card.width) / view.radius, tilt + (v * card.height) / view.radius, boundsPoint);
          bounds.left = Math.min(bounds.left, boundsPoint.x);
          bounds.right = Math.max(bounds.right, boundsPoint.x);
          bounds.top = Math.min(bounds.top, boundsPoint.y);
          bounds.bottom = Math.max(bounds.bottom, boundsPoint.y);
        }
      }
      return bounds;
    };

    const hitCard = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const scale = group.scale.x;
      const { sphere, eye } = view;
      const originX = -group.position.x / scale;
      const originY = -group.position.y / scale;
      const originZ = (eye - group.position.z) / scale + sphere;
      const directionX = clientX - rect.left - view.width / 2;
      const directionY = -(clientY - rect.top - view.height / 2);
      const directionZ = -eye;
      const a = directionX * directionX + directionY * directionY + directionZ * directionZ;
      const b = 2 * (originX * directionX + originY * directionY + originZ * directionZ);
      const c = originX * originX + originY * originY + originZ * originZ - sphere * sphere;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) return null;
      const distance = (-b - Math.sqrt(discriminant)) / (2 * a);
      const hitX = originX + distance * directionX;
      const hitY = originY + distance * directionY;
      const hitZ = originZ + distance * directionZ;
      const turn = Math.atan2(hitX, hitZ);
      const tilt = Math.asin(THREE.MathUtils.clamp(-hitY / sphere, -1, 1));
      return (
        cards.find(
          (card) =>
            card.visible &&
            Math.abs(turn - card.turn) <= card.width / 2 / view.radius &&
            Math.abs(tilt - card.tilt) <= card.height / 2 / view.radius,
        ) ?? null
      );
    };

    const nearestCopy = (songId: string, preferredInstance: number | null) => {
      const preferred = preferredInstance === null ? undefined : cardByInstance.get(preferredInstance);
      if (preferred && preferred.song.id === songId) return preferred;
      let best: WallCard | null = null;
      let bestDistance = Infinity;
      for (const card of cards) {
        if (card.song.id !== songId) continue;
        const { dx, dy } = cardOffset(card);
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance - 1e-6) {
          best = card;
          bestDistance = distance;
        }
      }
      return best;
    };

    const syncActiveFace = () => {
      const index = selectedInstanceRef.current;
      const card = index === null ? null : cardByInstance.get(index) ?? null;
      if (card === activeCard) return;
      if (activeCard) activeCard.uniforms.uMap.value = acquireFace(activeCard.song)?.texture ?? null;
      activeCard = card;
      activeFace.instanceIndex = card?.instanceIndex ?? -1;
      if (!card) return;
      const face = acquireFace(card.song);
      activeFace.song = card.song;
      activeFace.image = face?.image ?? null;
      activeFace.ambience = face?.ambience ?? null;
      card.uniforms.uMap.value = activeFace.texture;
      drawCard(
        activeFace,
        cardVisual(activeFace, playingIdRef.current, progressRef.current, selectedIdRef.current, index),
      );
    };

    const createCardMesh = (): CardMesh => {
      const uniforms: CardUniforms = {
        ...sharedUniforms,
        uMap: { value: null },
        uTurn: { value: 0 },
        uTilt: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) },
      };
      const material = new THREE.ShaderMaterial({
        uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
        vertexShader: cardVertexShader,
        fragmentShader: cardFragmentShader,
        transparent: true,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      return { mesh, uniforms };
    };

    // Meshes and materials are pooled and textures are per song, so a
    // relayout only reassigns slots; nothing is re-fetched or redrawn.
    const relayout = (nextColumns: WallColumn[], signature: string) => {
      const previousSongId = activeCard?.song.id ?? selectedIdRef.current ?? playingIdRef.current;
      columns = nextColumns;
      layoutSignature = signature;
      const nextCards: WallCard[] = [];
      columns.forEach((column) => {
        column.slots.forEach((slot, slotIndex) => {
          const count = slot.songs.length;
          const cardWidth = (column.width - WALL_GAP * (count - 1)) / count;
          slot.songs.forEach((song, half) => {
            const pooled = meshPool[nextCards.length] ?? createCardMesh();
            meshPool[nextCards.length] = pooled;
            pooled.uniforms.uMap.value = faces.get(song.id)?.texture ?? null;
            pooled.uniforms.uSize.value.set(cardWidth, slot.height);
            nextCards.push({
              ...pooled,
              song,
              instanceIndex: (column.index * MAX_SLOTS_PER_COLUMN + slotIndex) * 2 + half,
              column: column.index,
              shift: (half - (count - 1) / 2) * (cardWidth + WALL_GAP),
              centerY: slot.top + slot.height / 2,
              width: cardWidth,
              height: slot.height,
              turn: 0,
              tilt: 0,
              visible: false,
            });
          });
        });
      });
      while (meshPool.length > nextCards.length) {
        const extra = meshPool.pop();
        if (!extra) break;
        group.remove(extra.mesh);
        extra.mesh.material.dispose();
      }
      cards = nextCards;
      cardByInstance = new Map(cards.map((card) => [card.instanceIndex, card]));
      activeCard = null;
      placeCards();

      const selected = selectedInstanceRef.current;
      const kept = selected === null ? undefined : cardByInstance.get(selected);
      if (selected !== null && (!kept || kept.song.id !== previousSongId)) {
        selectedInstanceRef.current = previousSongId ? nearestCopy(previousSongId, null)?.instanceIndex ?? null : null;
      }
      if (focus.songId) {
        const instance = selectedInstanceRef.current;
        focus.card = instance === null ? null : cardByInstance.get(instance) ?? null;
      } else {
        focus.card = null;
        focus.gliding = false;
      }
      syncActiveFace();
    };

    const applyViewport = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      view = makeView(width, height);
      renderer.setSize(width, height, false);
      camera.fov = view.fov;
      camera.aspect = width / height;
      camera.near = 1;
      camera.far = view.eye + view.sphere * 4;
      camera.position.set(0, 0, view.eye);
      camera.updateProjectionMatrix();
      sharedUniforms.uRadius.value = view.radius;
      sharedUniforms.uSphere.value = view.sphere;
      sharedUniforms.uHorizon.value = view.horizon;
      seamClearUnits = cullReach() + WALL_GAP;
      layoutWall();
    };

    const layoutWall = () => {
      const nextColumns = extendColumns(baseColumns, (MIN_LOOP_SCREENS * view.height) / view.scale);
      const signature = nextColumns.map((column) => column.slots.length).join(",");
      if (signature !== layoutSignature) relayout(nextColumns, signature);
    };

    // Paging. The wall has one seam: the left edge of column 0, which is also
    // the right edge of the last column. New columns go in at the seam (after
    // the last column), so no existing column moves. A page is requested
    // when the seam comes near and committed only while the seam is beyond
    // `seamClearUnits` on both sides, so nothing on screen wraps differently.
    // Motion is untouched: loading never nudges the wall or changes speed.
    const catalog = {
      cursor: firstCursorRef.current,
      request: null as AbortController | null,
      timeout: 0,
      ready: [] as Song[],
      pages: 1,
      failures: 0,
      retryAt: 0,
      emptyPages: 0,
      // With reduced motion only a drag may start a load, so even the first
      // prefetch waits for horizontal travel.
      armed: !reducedMotion,
      travel: 0,
      lastPan: 0,
    };
    const screenUnits = () => view.width / view.scale;
    const seamDistance = () => Math.abs(wrap(-cameraX(), wallWidth));

    const requestPage = (cursor: string) => {
      const controller = new AbortController();
      catalog.request = controller;
      catalog.timeout = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
      fetch(`/api/catalog?cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`catalog ${response.status}`);
          return response.json() as Promise<CatalogPage>;
        })
        .then((page) => {
          if (disposed) return;
          catalog.failures = 0;
          catalog.cursor = page.nextCursor ?? null;
          const ids = new Set<string>();
          const keys = new Set<string>();
          const added = (page.songs ?? []).filter((song) => {
            const key = songKey(song);
            if (loadedIds.has(song.id) || loadedKeys.has(key) || ids.has(song.id) || keys.has(key)) return false;
            ids.add(song.id);
            keys.add(key);
            return true;
          });
          if (added.length) {
            catalog.ready = added;
            catalog.emptyPages = 0;
          } else {
            catalog.emptyPages += 1;
            if (catalog.emptyPages >= MAX_EMPTY_PAGES) catalog.cursor = null;
          }
        })
        .catch(() => {
          if (disposed) return;
          catalog.failures += 1;
          const now = performance.now();
          if (catalog.failures > LOAD_MAX_RETRIES) {
            catalog.failures = 0;
            catalog.retryAt = now + LOAD_COOLDOWN_MS;
          } else {
            catalog.retryAt = now + LOAD_RETRY_BASE_MS * 2 ** (catalog.failures - 1);
          }
        })
        .finally(() => {
          window.clearTimeout(catalog.timeout);
          if (catalog.request === controller) catalog.request = null;
        });
    };

    const commitPage = () => {
      const added = catalog.ready.slice(0, Math.max(0, MAX_LOADED_SONGS - loadedIds.size));
      catalog.ready = [];
      if (!added.length) return;
      const lap = cameraX() - (((cameraX() % wallWidth) + wallWidth) % wallWidth);
      wallOrigin += lap;
      const extra = buildExtraColumns(added, baseColumns.length, wallWidth, EXTRA_SHUFFLE_SEED + catalog.pages);
      baseColumns = [...baseColumns, ...extra.columns];
      wallWidth = extra.wallWidth;
      catalog.pages += 1;
      added.forEach((song) => {
        loadedIds.add(song.id);
        loadedKeys.add(songKey(song));
      });
      growColumnBuffers(baseColumns.length);
      catalog.armed = false;
      catalog.travel = 0;
      layoutWall();
      setLoadedCount(loadedIds.size);
    };

    const stepCatalog = (now: number) => {
      catalog.travel += Math.abs(wallMotion.pan - catalog.lastPan);
      catalog.lastPan = wallMotion.pan;
      if (!catalog.armed && catalog.travel >= LOAD_REARM_SCREENS * screenUnits()) catalog.armed = true;
      const seam = seamDistance();
      if (catalog.ready.length && seam > seamClearUnits) commitPage();
      if (
        catalog.armed &&
        catalog.cursor &&
        !catalog.request &&
        !catalog.ready.length &&
        loadedIds.size < MAX_LOADED_SONGS &&
        now >= catalog.retryAt &&
        seam < seamClearUnits + LOAD_AHEAD_SCREENS * screenUnits()
      ) {
        requestPage(catalog.cursor);
      }
    };

    // Screen area a focused card may use: the viewport minus a margin, minus
    // the result panel (beside the card on wide screens, below it on compact).
    const focusFrame = () => {
      const frame = {
        left: FOCUS_MARGIN_PX,
        top: FOCUS_MARGIN_PX,
        right: view.width - FOCUS_MARGIN_PX,
        bottom: view.height - FOCUS_MARGIN_PX,
      };
      const panel = resultPanelRef.current;
      if (view.width <= COMPACT_LAYOUT_MAX_WIDTH) {
        const panelTop = panel ? panel.offsetTop : view.height * RESULT_PANEL_COMPACT_TOP_SHARE;
        frame.bottom = Math.min(frame.bottom, panelTop - RESULT_PANEL_GAP_PX);
      } else {
        const panelWidth = Math.min(RESULT_PANEL_WIDTH_PX, view.width - RESULT_PANEL_EDGE_PX * 2);
        const panelLeft = panel
          ? panel.offsetLeft
          : Math.min(view.width / 2 + RESULT_PANEL_BESIDE_CENTER_PX, view.width - panelWidth - RESULT_PANEL_EDGE_PX);
        frame.right = Math.min(frame.right, panelLeft - RESULT_PANEL_GAP_PX);
      }
      return frame;
    };

    // Zoom stays at the preferred value unless the centred card would not fit
    // the frame; the whole wall then shifts on screen (never the wall offsets)
    // so the card sits inside the frame, nearest to the screen centre.
    const fitFocus = () => {
      const card = focus.card;
      if (!card) return;
      const frame = focusFrame();
      const cardWidth = 2 * projectedOffset(view, card.width / 2 / view.radius);
      const cardHeight = 2 * projectedOffset(view, card.height / 2 / view.radius);
      const preferred = view.width <= COMPACT_LAYOUT_MAX_WIDTH ? FOCUS_SCALE_COMPACT : FOCUS_SCALE_WIDE;
      targetScale = Math.max(
        Number.EPSILON,
        Math.min(preferred, (frame.right - frame.left) / cardWidth, (frame.bottom - frame.top) / cardHeight),
      );
      const halfWidth = (cardWidth * targetScale) / 2;
      const halfHeight = (cardHeight * targetScale) / 2;
      const centerX = view.width / 2;
      const centerY = view.height / 2;
      focusShiftTarget.set(
        Math.min(Math.max(centerX, frame.left + halfWidth), frame.right - halfWidth) - centerX,
        centerY - Math.min(Math.max(centerY, frame.top + halfHeight), frame.bottom - halfHeight),
      );
    };

    const focusSong = (songId: string) => {
      const card = nearestCopy(songId, selectedInstanceRef.current);
      if (!card) return;
      selectedInstanceRef.current = card.instanceIndex;
      focus.songId = songId;
      focus.card = card;
      focus.gliding = true;
      focus.holdX = 0;
      focus.holdY = 0;
      stopInertia();
      fitFocus();
      syncActiveFace();
    };

    // A clicked copy glides all the way to the centre, even when it is
    // already fully visible near the edge of the screen.
    const centreClickedCard = (card: WallCard) => {
      stopInertia();
      focus.card = card;
      focus.gliding = true;
      focus.holdX = 0;
      focus.holdY = 0;
    };

    const settleViewport = () => {
      placeCards();
      if (focus.songId) {
        focusSong(focus.songId);
        return;
      }
      const index = selectedInstanceRef.current;
      const card = index === null ? undefined : cardByInstance.get(index);
      if (!card) return;
      const bounds = cardBounds(card);
      const clipped =
        !card.visible || bounds.left < 0 || bounds.top < 0 || bounds.right > view.width || bounds.bottom > view.height;
      if (!clipped) return;
      const { dx, dy } = cardOffset(card);
      stopInertia();
      nudge(dx, dy, null);
    };

    // The only resize entry point. It observes the canvas box rather than the
    // window, because a window resize event can fire before layout has the
    // new canvas size.
    let resizeTimer = 0;
    const onResize = () => {
      applyViewport();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(settleViewport, RESIZE_SETTLE_MS);
    };

    const onReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        wallMotion.speed = STOPPED_SPEED;
        stopInertia();
      }
    };

    const clickSong = (clientX: number, clientY: number) => {
      const card = hitCard(clientX, clientY);
      if (!card) return;
      const audio = audioRef.current;
      const activeSongId = audio?.dataset.songId || playingIdRef.current;
      const sameSong = activeSongId === card.song.id;
      const sameInstance = sameSong && selectedInstanceRef.current === card.instanceIndex;
      selectedInstanceRef.current = card.instanceIndex;
      selectedIdRef.current = card.song.id;
      setSelectedId(card.song.id);
      syncActiveFace();
      centreClickedCard(card);
      if (sameInstance && audio && !audio.paused) {
        pausePlayback();
        return;
      }
      if (sameSong && audio && !audio.paused) return;
      void toggleSongRef.current(card.song);
    };

    const releaseVelocity = (time: number) => {
      const samples = pointer.samples;
      const last = samples[samples.length - 1];
      if (!last || reducedMotion || time - last.time > INERTIA_IDLE_RESET_MS) return null;
      const first = samples.find((sample) => last.time - sample.time <= INERTIA_SAMPLE_WINDOW_MS) ?? last;
      const seconds = (last.time - first.time) / 1000;
      if (seconds <= 0) return null;
      const units = unitsPerPixel();
      return { pan: (-(last.x - first.x) / seconds) * units, scroll: (-(last.y - first.y) / seconds) * units };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (pointer.pressed) return;
      pointer.pressed = true;
      pointer.id = event.pointerId;
      pointer.startX = pointer.lastX = event.clientX;
      pointer.startY = pointer.lastY = event.clientY;
      pointer.moved = 0;
      pointer.samples = [{ time: event.timeStamp, x: event.clientX, y: event.clientY }];
      pointer.column = hitCard(event.clientX, event.clientY)?.column ?? null;
      focus.gliding = false;
      stopInertia();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events (QA scripts) may carry ids that are not active pointers.
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.pressed) {
        const rect = canvas.getBoundingClientRect();
        parallaxTarget.set(
          THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
          THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1),
        );
        return;
      }
      if (event.pointerId !== pointer.id) return;
      const units = unitsPerPixel();
      nudge(
        -(event.clientX - pointer.lastX) * units,
        -(event.clientY - pointer.lastY) * units,
        DRAG_SCOPE === "all-columns" ? null : pointer.column,
      );
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      pointer.moved = Math.max(pointer.moved, Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY));
      pointer.samples.push({ time: event.timeStamp, x: event.clientX, y: event.clientY });
      while (pointer.samples.length > 2 && event.timeStamp - pointer.samples[0].time > INERTIA_SAMPLE_WINDOW_MS) {
        pointer.samples.shift();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointer.pressed || event.pointerId !== pointer.id) return;
      pointer.pressed = false;
      if (pointer.moved < CLICK_MOVE_TOLERANCE_PX) {
        clickSong(event.clientX, event.clientY);
        return;
      }
      const velocity = releaseVelocity(event.timeStamp);
      if (!velocity || Math.hypot(velocity.pan, velocity.scroll) < INERTIA_STOP_SPEED) return;
      wallMotion.velocityPan = velocity.pan;
      wallMotion.velocityScroll = velocity.scroll;
      wallMotion.velocityColumn = DRAG_SCOPE === "all-columns" ? null : pointer.column;
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointer.id) pointer.pressed = false;
    };
    const onPointerLeave = () => {
      if (!pointer.pressed) parallaxTarget.set(0, 0);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const units = unitsPerPixel();
      nudge(event.deltaX * units, event.deltaY * units, null);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);
    mediaQuery.addEventListener("change", onReducedMotionChange);
    applyViewport();

    sceneApiRef.current = {
      focus: focusSong,
      refit: fitFocus,
      reset() {
        focus.songId = null;
        focus.card = null;
        focus.gliding = false;
        focus.holdX = 0;
        focus.holdY = 0;
        targetScale = 1;
        focusShiftTarget.set(0, 0);
      },
      // Pick one record chooses among full-width cards already on screen, so
      // the focus glide never sweeps across a wall that is many screens wide
      // and the focused card is never a narrow half card.
      visibleCards() {
        const seen = new Map<string, { song: Song; instanceIndex: number }>();
        cards.forEach((card) => {
          if (card.visible && card.shift === 0 && !seen.has(card.song.id)) {
            seen.set(card.song.id, { song: card.song, instanceIndex: card.instanceIndex });
          }
        });
        return [...seen.values()];
      },
    };

    const syncFocusCard = () => {
      const overlay = focusCardRef.current;
      if (!overlay) return;
      const card = focus.songId ? focus.card : null;
      if (!card || !card.visible) {
        overlay.style.visibility = "hidden";
        return;
      }
      const bounds = cardBounds(card);
      const box = [bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top].map((value) =>
        value.toFixed(1),
      );
      const key = box.join(",");
      if (overlay.dataset.box !== key) {
        overlay.dataset.box = key;
        overlay.style.left = `${box[0]}px`;
        overlay.style.top = `${box[1]}px`;
        overlay.style.width = `${box[2]}px`;
        overlay.style.height = `${box[3]}px`;
      }
      overlay.style.visibility = "visible";
    };

    let frame = 0;
    let lastFrameTime = performance.now();
    const animate = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const dt = THREE.MathUtils.clamp((now - lastFrameTime) / 1000, 0, MAX_FRAME_SECONDS);
      lastFrameTime = Math.max(lastFrameTime, now);

      frameCount += 1;
      stepMotion(dt);
      stepCatalog(now);

      if (reducedMotion || pointer.pressed) {
        if (reducedMotion) parallaxCurrent.set(0, 0);
      } else {
        parallaxCurrent.lerp(parallaxTarget, 1 - Math.exp(-dt * PARALLAX_RATE));
      }
      const zoomShare = reducedMotion ? 1 : 1 - Math.exp(-dt * FOCUS_SCALE_RATE);
      group.scale.setScalar(group.scale.x + (targetScale - group.scale.x) * zoomShare);
      focusShiftCurrent.lerp(focusShiftTarget, zoomShare);
      group.position.set(
        parallaxCurrent.x * PARALLAX_SHIFT_X_PX + focusShiftCurrent.x,
        -parallaxCurrent.y * PARALLAX_SHIFT_Y_PX + focusShiftCurrent.y,
        0,
      );

      placeCards();
      syncActiveFace();
      syncFocusCard();
      if (frameCount % FACE_SWEEP_EVERY_FRAMES === 0) sweepFaces();
      renderer.render(scene, camera);
    };
    activeAnimationLoopCount += 1;
    animate(performance.now());

    // The debug hook is read-only. Do not add a playback-speed toggle.
    let removeDebugHook: (() => void) | null = null;
    if (process.env.NODE_ENV === "development") {
      const point = { x: 0, y: 0 };
      const drawnState = (card: WallCard) =>
        card.uniforms.uMap.value === activeFace.texture
          ? activeFace.visualState
          : faces.get(card.song.id)?.visualState ?? { playing: false, progress: 0, selected: false };
      const debugApi: JukeboxDebugApi = {
        memory() {
          const { geometries, textures } = renderer.info.memory;
          return { geometries, textures };
        },
        activeLoops() {
          return activeAnimationLoopCount;
        },
        highlights() {
          const selected = cards.filter((card) => drawnState(card).selected);
          const playing = cards.filter((card) => drawnState(card).playing);
          const card = selected[0];
          return {
            selectedCount: selected.length,
            playingCount: playing.length,
            songId: card?.song.id ?? null,
            instanceIndex: card?.instanceIndex ?? null,
            title: card?.song.title ?? null,
            artist: card?.song.artist ?? null,
          };
        },
        cardPoints() {
          const rect = canvas.getBoundingClientRect();
          return cards.map((card) => {
            projectPoint(card.turn, card.tilt, point);
            const bounds = cardBounds(card);
            const state = drawnState(card);
            return {
              instanceIndex: card.instanceIndex,
              songId: card.song.id,
              title: card.song.title,
              clientX: rect.left + point.x,
              clientY: rect.top + point.y,
              selected: state.selected,
              playing: state.playing,
              column: card.column,
              visible: card.visible,
              rect: {
                left: rect.left + bounds.left,
                top: rect.top + bounds.top,
                right: rect.left + bounds.right,
                bottom: rect.top + bounds.bottom,
              },
            };
          });
        },
        catalog() {
          return {
            loaded: loadedIds.size,
            pages: catalog.pages,
            pending: catalog.request !== null,
            ready: catalog.ready.length,
            hasNext: catalog.cursor !== null,
            armed: catalog.armed,
            retryAt: catalog.retryAt,
            columns: baseColumns.length,
            wallWidth,
            seamDistance: seamDistance(),
            seamClear: seamClearUnits,
            faces: faces.size,
            facesCap: facesCap(),
          };
        },
        motion() {
          return {
            targetSpeed: wallMotion.targetSpeed,
            speed: wallMotion.speed,
            reducedMotion,
            pressed: pointer.pressed,
            inertia: Math.hypot(wallMotion.velocityPan, wallMotion.velocityScroll),
            zoom: group.scale.x,
            columnOffsets: columns.map((column) => columnOffset(column.index)),
          };
        },
      };
      void import("./debug").then(({ installDebugHook }) => {
        if (!disposed) removeDebugHook = installDebugHook(debugApi);
      });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      activeAnimationLoopCount -= 1;
      removeDebugHook?.();
      window.clearTimeout(resizeTimer);
      if (pointer.pressed && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
      mediaQuery.removeEventListener("change", onReducedMotionChange);
      catalog.request?.abort();
      window.clearTimeout(catalog.timeout);
      meshPool.forEach(({ mesh }) => {
        mesh.material.uniforms.uMap.value = null;
        mesh.material.dispose();
      });
      meshPool.length = 0;
      [...faces.values()].forEach(releaseFace);
      activeFace.texture.dispose();
      geometry.dispose();
      group.clear();
      scene.clear();
      cards = [];
      cardByInstance.clear();
      facesRef.current = new Set();
      sceneApiRef.current = null;
    };
  // Rebuild only when the catalog changes. Resizing rescales the wall in
  // place (applyViewport); playback is read from refs, and card clicks call
  // toggleSongRef, so progress ticks and play/pause never rebuild the scene.
  }, [songs, pausePlayback]);

  const refreshCards = useCallback(
    (nextPlayingId = playingId, nextProgress = progress, nextSelectedId = selectedId) => {
      facesRef.current.forEach((card) => {
        const nextState = cardVisual(
          card,
          nextPlayingId,
          nextProgress,
          nextSelectedId,
          selectedInstanceRef.current,
        );
        const unchanged =
          card.visualState.playing === nextState.playing &&
          card.visualState.selected === nextState.selected &&
          Math.abs(card.visualState.progress - nextState.progress) < 0.002;
        if (!unchanged) drawCard(card, nextState);
      });
    },
    [playingId, progress, selectedId],
  );

  useEffect(() => {
    refreshCards();
  }, [refreshCards]);

  const toggleSong = useCallback(
    async (song: Song) => {
      const audio = audioRef.current;
      if (!audio || !song.previewUrl) return;

      if (playingIdRef.current === song.id && !audio.paused) {
        pausePlayback();
        return;
      }

      if (audio.dataset.songId !== song.id) {
        audio.src = song.previewUrl;
        audio.dataset.songId = song.id;
        setProgress(0);
      }

      try {
        await audio.play();
        setPlayingId(song.id);
      } catch {
        setPlayingId(null);
      }
    },
    [pausePlayback],
  );
  toggleSongRef.current = toggleSong;

  const chooseRandom = useCallback(() => {
    if (!songs.length || phase === "landing") return;
    const nearby = sceneApiRef.current?.visibleCards() ?? [];
    const candidates = nearby.length ? nearby : songs.map((song) => ({ song, instanceIndex: null }));
    const pool = candidates.filter((candidate) => candidate.song.id !== selectedSong?.id);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? candidates[0];
    const song = pick.song;
    setMatch(null);
    setSceneText("");
    setPhotoStatus("idle");
    // focus() glides to this copy of the song when it still exists.
    selectedInstanceRef.current = pick.instanceIndex;
    selectedIdRef.current = song.id;
    setPhase("landing");
    setSelectedId(song.id);
    setSelectedSong(song);
    sceneApiRef.current?.focus(song.id);
    void toggleSong(song);
    window.setTimeout(() => setPhase("reveal"), 760);
  }, [phase, selectedSong?.id, songs, toggleSong]);

  const handlePhoto = useCallback(async (file: File) => {
    photoRequestRef.current?.abort();
    const controller = new AbortController();
    photoRequestRef.current = controller;
    const run = ++photoRunRef.current;
    photoStartedRef.current = Date.now();
    setElapsed(0);
    setSceneText("");
    setPhotoError("");
    setMatch(null);
    setPhotoStatus("reading");
    pausePlayback();
    setPhase("idle");
    setSelectedSong(null);
    setSelectedId(null);
    selectedInstanceRef.current = null;
    sceneApiRef.current?.reset();

    let scene: string;
    try {
      const image = await jpegForGemini(file);
      if (controller.signal.aborted) return;
      scene = await describeScene(image, controller.signal, (text) => {
        if (run === photoRunRef.current) setSceneText(text);
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhotoError(error instanceof Error ? error.message : "读图失败，请重试");
      setPhotoStatus("image-error");
      return;
    }

    if (controller.signal.aborted) return;
    setSceneText(scene);
    setPhotoStatus("choosing");
    try {
      const catalogResponse = await fetch("/api/recommendation-catalog", { signal: controller.signal });
      if (!catalogResponse.ok) throw new Error("曲库暂时不可用，请重试");
      const catalog = await catalogResponse.json() as { songs?: Song[] };
      const result = await chooseSong(scene, catalog.songs ?? [], controller.signal);
      if (controller.signal.aborted || run !== photoRunRef.current) return;
      setMatch(result);
      setPhotoStatus("done");
      selectedInstanceRef.current = null;
      selectedIdRef.current = result.song.id;
      setSelectedId(result.song.id);
      setSelectedSong(result.song);
      setPhase("landing");
      sceneApiRef.current?.focus(result.song.id);
      window.setTimeout(() => {
        if (run === photoRunRef.current) setPhase("reveal");
      }, 760);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhotoError(error instanceof Error ? error.message : "选歌失败，请重试");
      setPhotoStatus("song-error");
    }
  }, [pausePlayback]);

  const reset = useCallback(() => {
    photoRequestRef.current?.abort();
    photoRunRef.current += 1;
    setPhotoStatus("idle");
    setMatch(null);
    setSceneText("");
    pausePlayback();
    setPhase("idle");
    setSelectedId(null);
    setSelectedSong(null);
    selectedInstanceRef.current = null;
    sceneApiRef.current?.reset();
  }, [pausePlayback]);

  const restartSelected = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !selectedSong) return;
    if (audio.dataset.songId === selectedSong.id) audio.currentTime = 0;
    if (audio.paused || audio.dataset.songId !== selectedSong.id) void toggleSong(selectedSong);
  }, [selectedSong, toggleSong]);

  // The focus frame was predicted before the panel existed; measure it now.
  useEffect(() => {
    if (phase === "reveal") sceneApiRef.current?.refit();
  }, [phase, selectedSong]);

  // Only Chinese titles get a lang; zh-HK, because zh-Hant resolves to
  // Noto Sans CJK JP on Linux.
  const selectedLang =
    selectedSong && (HAN_PATTERN.test(selectedSong.title) || HAN_PATTERN.test(selectedSong.artist))
      ? "zh-HK"
      : undefined;

  return (
    <main className="jukebox-shell">
      <canvas
        ref={canvasRef}
        className="scene-canvas"
        aria-label="可拖拽的歌曲唱片墙。点击卡片可以播放试听。"
      />
      <div className="vignette" aria-hidden="true" />

      <header className="brand">
        <h1>Music Box</h1>
      </header>

      <div className="corner-index" aria-hidden="true">
        <span />
        <span>{loadedCount || "—"} records in rotation</span>
      </div>

      {phase === "loading" ? <p className="loading-copy">Cataloguing the room</p> : null}

      <input
        ref={photoInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        aria-label="上传照片"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void handlePhoto(file);
        }}
      />

      {(photoStatus === "reading" || photoStatus === "choosing" || photoStatus === "image-error" || photoStatus === "song-error") && (
        <section className="analysis-panel" aria-live="polite">
          <p className="result-kicker">Photo to music</p>
          {sceneText ? <p className="analysis-scene">{sceneText}</p> : null}
          {photoStatus === "reading" || photoStatus === "choosing" ? (
            <p className="analysis-status">{photoStatus === "reading" ? "正在读图" : "正在选歌"} · 已过 {elapsed} 秒</p>
          ) : (
            <>
              <p className="analysis-error">{photoStatus === "image-error" ? "读图失败" : "选歌失败"}：{photoError}</p>
              <button type="button" className="result-action" onClick={() => photoInputRef.current?.click()}>换张照片</button>
            </>
          )}
        </section>
      )}

      <AnimatePresence>
        {phase === "reveal" && selectedSong ? (
          <>
            <motion.div
              className="result-scrim"
              onClick={reset}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <div ref={focusCardRef} className="focus-card-anchor" style={{ visibility: "hidden" }}>
              <motion.article
                className="focus-card"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              >
                {selectedSong.artworkUrl ? (
                  <div
                    className="focus-card-ambience"
                    style={{ backgroundImage: `url(${JSON.stringify(selectedSong.artworkUrl)})` }}
                    aria-hidden="true"
                  />
                ) : null}
                <div className="focus-card-art">
                  {selectedSong.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote iTunes artwork, already sized by the CDN
                    <img src={selectedSong.artworkUrl} alt="" />
                  ) : null}
                </div>
                <p className="focus-card-title" lang={selectedLang}>
                  {selectedSong.title} • {selectedSong.artist}
                </p>
                <p className="focus-card-subtitle">Listening on Music Box</p>
                <div className="focus-card-progress" aria-hidden="true">
                  <span
                    style={{
                      width: `${(playingId === selectedSong.id ? Math.min(1, progress) : 0) * 100}%`,
                    }}
                  />
                </div>
                <div className="focus-card-time" aria-hidden="true">
                  <span>{formatTime(PREVIEW_SECONDS * (playingId === selectedSong.id ? Math.min(1, progress) : 0))}</span>
                  <span>
                    -{formatTime(PREVIEW_SECONDS * (1 - (playingId === selectedSong.id ? Math.min(1, progress) : 0)))}
                  </span>
                </div>
                <div className="focus-card-controls">
                  <button type="button" aria-label="从头播放" onClick={restartSelected}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 6 3 12l8 6zM21 6l-8 6 8 6z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="focus-card-play"
                    aria-label={playingId === selectedSong.id ? "暂停" : "播放"}
                    onClick={() => void toggleSong(selectedSong)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {playingId === selectedSong.id ? (
                        <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                      ) : (
                        <path d="M7 4v16l13-8z" />
                      )}
                    </svg>
                  </button>
                  <button type="button" aria-label="换一首" onClick={chooseRandom}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m3 6 8 6-8 6zM13 6l8 6-8 6z" />
                    </svg>
                  </button>
                </div>
              </motion.article>
            </div>
            <motion.section
              ref={resultPanelRef}
              className="result-panel"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            >
              {match && sceneText ? <p className="result-scene">{sceneText}</p> : null}
              {match && selectedSong.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- catalog artwork is already CDN sized
                <img className="result-artwork" src={selectedSong.artworkUrl} alt="" />
              ) : null}
              <p className="result-kicker">Selected for right now</p>
              <h2 lang={selectedLang}>{selectedSong.title}</h2>
              <p className="result-artist" lang={selectedLang}>{selectedSong.artist}</p>
              {match ? (
                <div className="match-details">
                  <p>匹配概率（决选） <strong>{percent(match.probability)}</strong> · 把握 <strong>{typeof match.confidence === "number" ? percent(match.confidence) : match.confidence}</strong></p>
                  <p className="match-alternatives-label">决选概率次高的 3 首</p>
                  <ol>
                    {match.alternatives.map(({ song, probability }) => (
                      <li key={song.id}><span>{song.title} · {song.artist}</span><span>{percent(probability)}</span></li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <div className="result-actions">
                {match ? <button type="button" className="result-action result-action-primary" onClick={() => photoInputRef.current?.click()}>换张照片</button> : null}
                <button type="button" className="result-action result-action-primary" onClick={chooseRandom}>
                  <span aria-hidden="true">↻</span> Another record
                </button>
                {selectedSong.externalUrl ? (
                  <a
                    className="result-action result-action-secondary"
                    href={selectedSong.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apple Music <span aria-hidden="true">↗</span>
                  </a>
                ) : null}
              </div>
              <button type="button" className="result-back" onClick={reset}>
                Back to the wall
              </button>
            </motion.section>
          </>
        ) : null}
      </AnimatePresence>

      {phase !== "reveal" ? (
        <div className="dock-anchor">
          <motion.section
            className="dock"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="dock-copy">
              <strong>Let the room choose.</strong>
              <span>{SOURCE_LABELS[source]}</span>
            </div>
            <LocalContext />
            <div className="dock-actions">
              <button className="primary-action" onClick={chooseRandom} disabled={phase !== "idle" || !songs.length}>
                {phase === "landing" ? "Bringing one forward…" : "Pick one record"}
              </button>
              <button className="ghost-action" onClick={() => photoInputRef.current?.click()} disabled={!songs.length}>
                上传照片
              </button>
            </div>
          </motion.section>
        </div>
      ) : null}

      <p className="source-note">Previews provided by the iTunes catalog · streamed, never stored</p>

      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlayingId(audioRef.current?.dataset.songId ?? null)}
        onPause={() => {
          playingIdRef.current = null;
          setPlayingId(null);
        }}
        onEnded={() => {
          playingIdRef.current = null;
          setPlayingId(null);
          setProgress(0);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
          setProgress(audio.currentTime / audio.duration);
        }}
      />
    </main>
  );
}
