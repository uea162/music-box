// Development-only, read-only inspection hook. JukeboxExperience loads this
// module with a dynamic import inside a `NODE_ENV === "development"` branch,
// so production builds never compile it and the global name never ships.

export interface JukeboxDebugApi {
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
}

declare global {
  interface Window {
    __musicBoxDebug?: JukeboxDebugApi;
  }
}

export function installDebugHook(api: JukeboxDebugApi) {
  window.__musicBoxDebug = api;
  return () => {
    if (window.__musicBoxDebug === api) delete window.__musicBoxDebug;
  };
}
