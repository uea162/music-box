"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { fallbackSongs } from "@/data/fallback-songs";
import type { Song } from "@/types/song";

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
const FOCUS_SCALE_WIDE = 1.38;
const FOCUS_SCALE_COMPACT = 1.1;
const COMPACT_FOCUS_BELOW_WIDTH = 820;
const FOCUS_GLIDE_RATE = 7.5;
const FOCUS_SETTLED_UNITS = 0.5;
const FOCUS_SCALE_RATE = 5;
const PARALLAX_SHIFT_X_PX = 10;
const PARALLAX_SHIFT_Y_PX = 6;
const PARALLAX_RATE = 2.8;
const RESIZE_SETTLE_MS = 150;
const CARD_TEXTURE_WIDTH = 420;
const CARD_TEXTURE_HEIGHT = 604;
const MAX_PIXEL_RATIO = 1.6;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const PALETTES = [
  ["#6f1d2b", "#140b10"],
  ["#99542d", "#21110c"],
  ["#255d5a", "#091a1a"],
  ["#504066", "#130f1c"],
  ["#744054", "#190c12"],
  ["#3f5273", "#0b111d"],
];

const labelFont =
  "'Avenir Next', 'PingFang TC', 'PingFang HK', 'PingFang SC', 'Hiragino Sans CNS', 'Hiragino Sans GB', 'Microsoft JhengHei', 'Microsoft YaHei', 'Noto Sans CJK TC', 'Noto Sans CJK SC', sans-serif";

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
  instanceIndex: number;
  visualState: { playing: boolean; progress: number; selected: boolean };
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

function buildBaseColumns(songs: Song[]) {
  let cursor = 0;
  const columns: WallColumn[] = COLUMN_WIDTHS.map((width, index) => {
    const column = { index, width, x: cursor + width / 2, length: 0, slots: [] };
    cursor += width + WALL_GAP;
    return column;
  });
  const queue = shuffleSongs(songs, SHUFFLE_SEED);
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

declare global {
  interface Window {
    __musicBoxDebug?: {
      memory: () => { geometries: number; textures: number };
      activeLoops: () => number;
      highlights: () => {
        selectedCount: number;
        playingCount: number;
        songId: string | null;
        instanceIndex: number | null;
        title: string | null;
        artist: string | null;
      };
      cardPoints: () => Array<{
        instanceIndex: number;
        songId: string;
        title: string;
        clientX: number;
        clientY: number;
        selected: boolean;
        playing: boolean;
        column: number;
        visible: boolean;
        rect: { left: number; top: number; right: number; bottom: number };
      }>;
      motion: () => {
        targetSpeed: number;
        speed: number;
        reducedMotion: boolean;
        pressed: boolean;
        inertia: number;
        zoom: number;
        columnOffsets: number[];
      };
    };
  }
}

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
  const palette = PALETTES[Math.abs(Number(song.id.replace(/\D/g, "").slice(-2)) || 0) % PALETTES.length];

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(2, 2, width - 4, height - 4, 46);
  ctx.clip();

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, song.accent || palette[0]);
  background.addColorStop(0.5, palette[0]);
  background.addColorStop(1, palette[1]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(7, 5, 6, .24)";
  ctx.fillRect(0, 0, width, height);

  const artX = 28;
  const artY = 28;
  const artSize = width - 56;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(artX, artY, artSize, artSize, 34);
  ctx.clip();

  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, artX, artY, artSize, artSize);
  } else {
    const art = ctx.createRadialGradient(width * 0.64, height * 0.18, 10, width * 0.5, height * 0.28, artSize);
    art.addColorStop(0, "rgba(255, 235, 196, .72)");
    art.addColorStop(0.34, song.accent || palette[0]);
    art.addColorStop(1, palette[1]);
    ctx.fillStyle = art;
    ctx.fillRect(artX, artY, artSize, artSize);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 2;
    for (let ring = 0; ring < 7; ring += 1) {
      ctx.beginPath();
      ctx.arc(width / 2, artY + artSize / 2, 24 + ring * 24, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.fillStyle = "#f5ede0";
  ctx.font = `600 27px ${labelFont}`;
  ctx.fillText(ellipsize(ctx, song.title, width - 56), 28, 430);
  ctx.fillStyle = "rgba(245,237,224,.66)";
  ctx.font = `500 17px ${labelFont}`;
  ctx.fillText(ellipsize(ctx, song.artist, width - 56), 28, 462);

  ctx.fillStyle = "rgba(245,237,224,.18)";
  ctx.fillRect(28, 505, width - 56, 5);
  ctx.fillStyle = state.playing ? "#f5ede0" : "rgba(245,237,224,.48)";
  ctx.fillRect(28, 505, (width - 56) * Math.max(0.04, state.progress), 5);

  ctx.font = "500 13px 'Avenir Next', sans-serif";
  ctx.fillStyle = "rgba(245,237,224,.48)";
  ctx.fillText(state.playing ? "PLAYING NOW" : "30 SEC PREVIEW", 28, 535);

  ctx.fillStyle = state.playing ? "#f5ede0" : "rgba(245,237,224,.84)";
  ctx.beginPath();
  if (state.playing) {
    ctx.fillRect(width / 2 - 11, 548, 8, 25);
    ctx.fillRect(width / 2 + 4, 548, 8, 25);
  } else {
    ctx.moveTo(width / 2 - 8, 546);
    ctx.lineTo(width / 2 + 15, 560);
    ctx.lineTo(width / 2 - 8, 574);
    ctx.closePath();
    ctx.fill();
  }

  if (state.selected) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 11;
    ctx.shadowColor = "rgba(255, 255, 255, .38)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(7, 7, width - 14, height - 14, 40);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
  card.texture.needsUpdate = true;
}

export function JukeboxExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const facesRef = useRef<CardTexture[]>([]);
  const sceneApiRef = useRef<{ focus: (songId: string) => void; reset: () => void } | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [source, setSource] = useState<"itunes" | "fallback">("fallback");
  const [phase, setPhase] = useState<Phase>("loading");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
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
      .then((data: { songs?: Song[]; source?: "itunes" | "fallback" }) => {
        if (cancelled) return;
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
        instanceIndex: -1,
        visualState: { playing: false, progress: 0, selected: false },
      };
    };
    const faces = new Map<string, CardTexture>();
    songs.forEach((song) => {
      if (faces.has(song.id)) return;
      const face = createFace(song);
      if (face) faces.set(song.id, face);
    });
    const wallSongs = [...faces.values()].map((face) => face.song);
    const activeFace = createFace(wallSongs[0] ?? songs[0]);
    if (!activeFace || wallSongs.length === 0) {
      faces.forEach((face) => face.texture.dispose());
      activeFace?.texture.dispose();
      geometry.dispose();
      return;
    }
    const allFaces = [...faces.values(), activeFace];
    allFaces.forEach((face) => {
      drawCard(face, face.visualState);
      renderer.initTexture(face.texture);
    });
    facesRef.current = allFaces;

    const artworkImages: HTMLImageElement[] = [];
    faces.forEach((face) => {
      const url = face.song.artworkUrl;
      if (!url) return;
      const image = new Image();
      image.crossOrigin = "anonymous";
      artworkImages.push(image);
      image.onload = () => {
        if (disposed) return;
        face.image = image;
        drawCard(face, face.visualState);
        if (activeFace.song.id === face.song.id) {
          activeFace.image = image;
          drawCard(activeFace, activeFace.visualState);
        }
      };
      image.onerror = () => {};
      image.src = url;
    });

    const base = buildBaseColumns(wallSongs);
    const wallWidth = base.wallWidth;
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
      scroll: new Float64Array(COLUMN_WIDTHS.length),
      pendingPan: 0,
      pendingScrollAll: 0,
      pendingScroll: new Float64Array(COLUMN_WIDTHS.length),
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
    const focus = {
      songId: null as string | null,
      card: null as WallCard | null,
      gliding: false,
    };
    let targetScale = 1;
    const parallaxCurrent = new THREE.Vector2();
    const parallaxTarget = new THREE.Vector2();

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
    const cameraX = () => columns[CENTER_COLUMN % columns.length].x + wallMotion.pan;
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
        const { dx, dy } = cardOffset(focus.card);
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

    const columnTurn = new Float64Array(COLUMN_WIDTHS.length);
    const columnCos = new Float64Array(COLUMN_WIDTHS.length);
    const columnShown = new Uint8Array(COLUMN_WIDTHS.length);
    const columnOffsets = new Float64Array(COLUMN_WIDTHS.length);
    const placeCards = () => {
      const { radius, horizon, scale } = view;
      const viewX = cameraX();
      columns.forEach((column) => {
        const dx = wrap(column.x - viewX, wallWidth);
        const turn = dx / radius;
        const cos = Math.cos(turn);
        columnTurn[column.index] = dx;
        columnCos[column.index] = cos;
        columnOffsets[column.index] = columnOffset(column.index);
        columnShown[column.index] =
          Math.abs(turn) <= MAX_CARD_ANGLE &&
          cos >= horizon &&
          projectedOffset(view, turn) <= CULL_MARGIN * view.width + scale * column.width
            ? 1
            : 0;
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
        card.mesh.visible = card.visible;
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
    const cardBounds = (card: WallCard) => {
      const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let u = -0.5; u <= 0.5; u += 0.25) {
        for (let v = -0.5; v <= 0.5; v += 0.25) {
          if (Math.abs(u) !== 0.5 && Math.abs(v) !== 0.5) continue;
          projectPoint(card.turn + (u * card.width) / view.radius, card.tilt + (v * card.height) / view.radius, boundsPoint);
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
      if (activeCard) activeCard.uniforms.uMap.value = faces.get(activeCard.song.id)?.texture ?? null;
      activeCard = card;
      activeFace.instanceIndex = card?.instanceIndex ?? -1;
      if (!card) return;
      activeFace.song = card.song;
      activeFace.image = faces.get(card.song.id)?.image ?? null;
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
      const nextColumns = extendColumns(base.columns, (MIN_LOOP_SCREENS * view.height) / view.scale);
      const signature = nextColumns.map((column) => column.slots.length).join(",");
      if (signature !== layoutSignature) relayout(nextColumns, signature);
    };

    const focusSong = (songId: string) => {
      const card = nearestCopy(songId, selectedInstanceRef.current);
      if (!card) return;
      selectedInstanceRef.current = card.instanceIndex;
      focus.songId = songId;
      focus.card = card;
      focus.gliding = true;
      stopInertia();
      targetScale = view.width < COMPACT_FOCUS_BELOW_WIDTH ? FOCUS_SCALE_COMPACT : FOCUS_SCALE_WIDE;
      syncActiveFace();
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
      reset() {
        focus.songId = null;
        focus.card = null;
        focus.gliding = false;
        targetScale = 1;
      },
    };

    let frame = 0;
    let lastFrameTime = performance.now();
    const animate = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const dt = THREE.MathUtils.clamp((now - lastFrameTime) / 1000, 0, MAX_FRAME_SECONDS);
      lastFrameTime = Math.max(lastFrameTime, now);

      stepMotion(dt);

      if (reducedMotion || pointer.pressed) {
        if (reducedMotion) parallaxCurrent.set(0, 0);
      } else {
        parallaxCurrent.lerp(parallaxTarget, 1 - Math.exp(-dt * PARALLAX_RATE));
      }
      group.position.set(parallaxCurrent.x * PARALLAX_SHIFT_X_PX, -parallaxCurrent.y * PARALLAX_SHIFT_Y_PX, 0);
      const zoomShare = reducedMotion ? 1 : 1 - Math.exp(-dt * FOCUS_SCALE_RATE);
      group.scale.setScalar(group.scale.x + (targetScale - group.scale.x) * zoomShare);

      placeCards();
      syncActiveFace();
      renderer.render(scene, camera);
    };
    activeAnimationLoopCount += 1;
    animate(performance.now());

    // The debug hook is read-only. Do not add a playback-speed toggle.
    if (process.env.NODE_ENV === "development") {
      const point = { x: 0, y: 0 };
      const drawnState = (card: WallCard) =>
        card.uniforms.uMap.value === activeFace.texture
          ? activeFace.visualState
          : faces.get(card.song.id)?.visualState ?? { playing: false, progress: 0, selected: false };
      window.__musicBoxDebug = {
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
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      activeAnimationLoopCount -= 1;
      if (process.env.NODE_ENV === "development") {
        delete window.__musicBoxDebug;
      }
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
      artworkImages.forEach((image) => {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      });
      meshPool.forEach(({ mesh }) => {
        mesh.material.uniforms.uMap.value = null;
        mesh.material.dispose();
      });
      meshPool.length = 0;
      allFaces.forEach((face) => face.texture.dispose());
      geometry.dispose();
      group.clear();
      scene.clear();
      cards = [];
      cardByInstance.clear();
      facesRef.current = [];
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
    const pool = songs.filter((song) => song.id !== selectedSong?.id);
    const song = pool[Math.floor(Math.random() * pool.length)] ?? songs[0];
    selectedInstanceRef.current = null;
    selectedIdRef.current = song.id;
    setPhase("landing");
    setSelectedId(song.id);
    setSelectedSong(song);
    sceneApiRef.current?.focus(song.id);
    void toggleSong(song);
    window.setTimeout(() => setPhase("reveal"), 760);
  }, [phase, selectedSong?.id, songs, toggleSong]);

  const reset = useCallback(() => {
    setPhase("idle");
    setSelectedId(null);
    setSelectedSong(null);
    selectedInstanceRef.current = null;
    sceneApiRef.current?.reset();
  }, []);

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
        <span>{songs.length || "—"} records in rotation</span>
      </div>

      {phase === "loading" ? <p className="loading-copy">Cataloguing the room</p> : null}

      <AnimatePresence>
        {phase === "reveal" && selectedSong ? (
          <>
            <motion.div
              className="result-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.section
              className="result-panel"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className="result-kicker">Selected for right now</p>
              <h2 lang="zh-Hant">{selectedSong.title}</h2>
              <p className="result-artist" lang="zh-Hant">{selectedSong.artist}</p>
              <p className="result-note">
                A warm, unhurried pick for the room you are in. The recommendation engine comes next;
                this prototype is proving the wall, the motion and the listening loop.
              </p>
              <div className="result-actions">
                <button className="primary-action" onClick={chooseRandom}>Another record</button>
                {selectedSong.externalUrl ? (
                  <a className="ghost-action" href={selectedSong.externalUrl} target="_blank" rel="noreferrer">
                    Open in Apple Music ↗
                  </a>
                ) : null}
                <button className="ghost-action" onClick={reset}>Back to the wall</button>
              </div>
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
              <span>{source === "itunes" ? "Live catalog · 30 sec previews" : "Offline study catalog"}</span>
            </div>
            <div className="dock-actions">
              <button className="primary-action" onClick={chooseRandom} disabled={phase !== "idle" || !songs.length}>
                {phase === "landing" ? "Bringing one forward…" : "Pick one record"}
              </button>
              <button className="ghost-action" onClick={() => canvasRef.current?.focus()}>
                Drag the wall to explore
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
        onPause={() => setPlayingId(null)}
        onEnded={() => {
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
