"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { fallbackSongs } from "@/data/fallback-songs";
import type { Song } from "@/types/song";

type Phase = "loading" | "idle" | "landing" | "reveal";

interface CardRecord {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  song: Song;
  image: HTMLImageElement | null;
  baseX: number;
  baseY: number;
  columnSpan: number;
  heightScale: number;
  visualState: { playing: boolean; progress: number; selected: boolean };
}

const CARD_WIDTH = 1.65;
const CARD_HEIGHT = 2.34;
const CARD_GAP_X = 0.22;
const CARD_GAP_Y = 0.22;
const CYLINDER_RADIUS = 15;
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

function seededNumber(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function wrap(value: number, span: number) {
  if (span <= 0) return value;
  return ((value + span / 2) % span + span) % span - span / 2;
}

function drawCard(
  card: CardRecord,
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
  const cardsRef = useRef<CardRecord[]>([]);
  const sceneApiRef = useRef<{ focus: (songId: string) => void; reset: () => void } | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [source, setSource] = useState<"itunes" | "fallback">("fallback");
  const [phase, setPhase] = useState<Phase>("loading");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [progress, setProgress] = useState(0);

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
    if (!canvas || songs.length === 0) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.z = 7.4;
    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT, 1, 1);
    // Render beyond every viewport edge so the cylindrical wall stays full-bleed
    // while it is being dragged. The extra rows are visual instances of the
    // catalog, each with its own id so selection remains local to one card.
    const columns = window.innerWidth < 720 ? 6 : window.innerWidth < 1180 ? 9 : 12;
    const rows = window.innerWidth < 720 ? 7 : window.innerWidth < 1180 ? 6 : 5;
    const minimumCardCount = columns * rows;
    const wallSongs = Array.from(
      { length: Math.max(songs.length, minimumCardCount) },
      (_, index) => {
        const song = songs[index % songs.length];
        if (index < songs.length) return song;
        return { ...song, id: `${song.id}-wall-${index}` };
      },
    );
    const cards: CardRecord[] = [];
    const columnHeights = Array.from({ length: columns }, () => 0);
    const horizontalPitch = CARD_WIDTH + CARD_GAP_X;
    const wallSpan = columns * horizontalPitch;

    wallSongs.forEach((song) => {
      const textureCanvas = document.createElement("canvas");
      textureCanvas.width = 420;
      textureCanvas.height = 604;
      const context = textureCanvas.getContext("2d");
      if (!context) return;

      const texture = new THREE.CanvasTexture(textureCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const seed = seededNumber(song.id);
      // The reference wall uses stable column widths. Variation belongs to card
      // height only; scaling the whole card is what made neighbouring cards collide.
      const heightScale = 0.94 + (seed % 5) * 0.025;
      const col = columnHeights.indexOf(Math.min(...columnHeights));
      const x = (col - (columns - 1) / 2) * horizontalPitch;
      const scaledHeight = CARD_HEIGHT * heightScale;
      const y = -(columnHeights[col] + scaledHeight / 2);
      columnHeights[col] += scaledHeight + CARD_GAP_Y;
      mesh.position.set(x, y, 0);
      mesh.userData.songId = song.id;
      mesh.userData.cardIndex = cards.length;
      group.add(mesh);

      const card: CardRecord = {
        mesh,
        canvas: textureCanvas,
        context,
        texture,
        song,
        image: null,
        baseX: x,
        baseY: y,
        columnSpan: 0,
        heightScale,
        visualState: { playing: false, progress: 0, selected: false },
      };
      cards.push(card);
      drawCard(card, card.visualState);

      if (song.artworkUrl) {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          card.image = image;
          drawCard(card, card.visualState);
        };
        image.src = song.artworkUrl;
      }
    });

    cards.forEach((card) => {
      const column = Math.round(card.baseX / horizontalPitch + (columns - 1) / 2);
      card.columnSpan = Math.max(columnHeights[column], 5.8);
      card.baseY += card.columnSpan / 2;
    });
    cardsRef.current = cards;

    const current = new THREE.Vector2(0, 0);
    const target = new THREE.Vector2(0, 0);
    const parallaxCurrent = new THREE.Vector2(0, 0);
    const parallaxTarget = new THREE.Vector2(0, 0);
    const targetGroupScale = new THREE.Vector3(1, 1, 1);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let targetScale = 1;
    let autoOffset = 0;
    let lastFrameTime = performance.now();
    const pointerStart = new THREE.Vector2();
    const targetStart = new THREE.Vector2();
    let dragging = false;
    let moved = 0;
    let frame = 0;

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const clickSong = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(group.children, false)[0];
      const cardIndex = hit?.object.userData.cardIndex as number | undefined;
      const card = typeof cardIndex === "number" ? cards[cardIndex] : undefined;
      if (!card) return;
      setSelectedId(card.song.id);
      void toggleSong(card.song);
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      pointerStart.set(event.clientX, event.clientY);
      targetStart.copy(target);
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      parallaxTarget.set(
        THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
        THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1),
      );
      if (!dragging) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      target.set(targetStart.x + dx * 0.008, targetStart.y - dy * 0.008);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (moved < 7) clickSong(event);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      target.x -= event.deltaX * 0.0025;
      target.y += event.deltaY * 0.0042;
    };
    const onPointerLeave = () => {
      if (!dragging) parallaxTarget.set(0, 0);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", resize);
    resize();

    sceneApiRef.current = {
      focus(songId: string) {
        const card = cards.find((item) => item.song.id === songId);
        if (!card) return;
        target.set(-card.baseX, -card.baseY);
        targetScale = window.innerWidth < 820 ? 1.1 : 1.38;
      },
      reset() {
        targetScale = 1;
      },
    };

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      const movementEase = 1 - Math.exp(-delta * 7.5);
      const ambientEase = 1 - Math.exp(-delta * 2.8);

      if (!reducedMotion) {
        autoOffset = wrap(autoOffset + delta * (dragging ? 0.025 : 0.105), wallSpan);
      }

      current.lerp(target, movementEase);
      parallaxCurrent.lerp(parallaxTarget, ambientEase);
      targetGroupScale.setScalar(targetScale);
      group.scale.lerp(targetGroupScale, 1 - Math.exp(-delta * 5));
      group.rotation.x = reducedMotion ? 0 : -parallaxCurrent.y * 0.014;
      group.rotation.y = reducedMotion ? 0 : parallaxCurrent.x * 0.022;
      group.position.x = reducedMotion ? 0 : parallaxCurrent.x * 0.07;
      group.position.y = reducedMotion ? 0 : -parallaxCurrent.y * 0.045;

      cards.forEach((card) => {
        const flatX = wrap(card.baseX + current.x + autoOffset, wallSpan);
        const y = wrap(card.baseY + current.y, card.columnSpan);
        const theta = flatX / CYLINDER_RADIUS;
        const cylinderX = Math.sin(theta) * CYLINDER_RADIUS;
        const cylinderZ = (Math.cos(theta) - 1) * CYLINDER_RADIUS;
        const centerDistance = Math.min(1, Math.abs(flatX) / (wallSpan * 0.5));
        const depthCurve = Math.pow(centerDistance, 1.25);
        const selectedLift = card.visualState.selected ? 0.28 : 0;
        const depthScale = 1 - depthCurve * 0.22;
        const selectedScale = card.visualState.selected ? 1.035 : 1;
        const brightness = card.visualState.selected ? 1 : 1 - depthCurve * 0.48;
        const opacity = card.visualState.selected ? 1 : 1 - depthCurve * 0.58;

        card.mesh.position.set(
          cylinderX,
          y,
          cylinderZ - depthCurve * 1.35 - 0.008 * y * y + selectedLift,
        );
        card.mesh.rotation.y = -theta * (0.96 + depthCurve * 0.24);
        card.mesh.rotation.x = y * 0.006;
        card.mesh.rotation.z = 0;
        card.mesh.scale.set(
          depthScale * selectedScale,
          card.heightScale * depthScale * selectedScale,
          1,
        );
        card.mesh.material.opacity = opacity;
        card.mesh.material.color.setScalar(brightness);
        card.mesh.renderOrder = card.visualState.selected ? 10 : 0;
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", resize);
      cards.forEach((card) => {
        card.texture.dispose();
        card.mesh.material.dispose();
      });
      geometry.dispose();
      renderer.dispose();
      cardsRef.current = [];
      sceneApiRef.current = null;
    };
  // The scene intentionally rebuilds only when the catalog changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs]);

  const refreshCards = useCallback(
    (nextPlayingId = playingId, nextProgress = progress, nextSelectedId = selectedId) => {
      cardsRef.current.forEach((card) => {
        const nextState = {
          playing: card.song.id === nextPlayingId,
          progress: card.song.id === nextPlayingId ? nextProgress : 0,
          selected: card.song.id === nextSelectedId,
        };
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

      if (playingId === song.id && !audio.paused) {
        audio.pause();
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
    [playingId],
  );

  const chooseRandom = useCallback(() => {
    if (!songs.length || phase === "landing") return;
    const pool = songs.filter((song) => song.id !== selectedSong?.id);
    const song = pool[Math.floor(Math.random() * pool.length)] ?? songs[0];
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
        <p>One record for this exact moment</p>
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
              <h2>{selectedSong.title}</h2>
              <p className="result-artist">{selectedSong.artist}</p>
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
