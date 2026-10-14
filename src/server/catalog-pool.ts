import { createHash } from "node:crypto";
import snapshotFile from "@/data/catalog-snapshot.json";
import { songKey } from "@/lib/song-key";
import type { Song } from "@/types/song";

interface SeedTerm {
  term: string;
  country: string;
}

interface ChartFeed {
  country: string;
  genre: number;
}

// English artists stay on the US store. Chinese artists are searched on HK or
// TW: those stores return traditional-Chinese artist names and preview URLs,
// while the US store labels the same artists in English and the CN store has
// no music.
const SEED_TERMS: SeedTerm[] = [
  { term: "Sade", country: "US" },
  { term: "Portishead", country: "US" },
  { term: "Ryuichi Sakamoto", country: "US" },
  { term: "The Postal Service", country: "US" },
  { term: "Cocteau Twins", country: "US" },
  { term: "Massive Attack", country: "US" },
  { term: "陳奕迅", country: "HK" },
  { term: "方大同", country: "HK" },
  { term: "林俊傑", country: "TW" },
  { term: "鄧紫棋", country: "TW" },
  { term: "周杰倫", country: "TW" },
  { term: "李榮浩", country: "TW" },
  { term: "孫燕姿", country: "TW" },
  { term: "蔡依林", country: "TW" },
  { term: "五月天", country: "TW" },
  { term: "陶喆", country: "TW" },
];

// Apple genre ids: 2 Blues, 5 Classical, 6 Country, 7 Electronic, 10
// Singer/Songwriter, 11 Jazz, 14 Pop, 15 R&B/Soul, 16 Soundtrack, 17 Dance,
// 18 Hip-Hop/Rap, 20 Alternative, 21 Rock, 27 J-Pop, 51 K-Pop,
// 1250 Mandopop, 1251 Cantopop.
const POOL_FEEDS: ChartFeed[] = [
  ...[14, 15, 21, 20, 11, 7, 16, 2, 10, 6].map((genre) => ({ country: "US", genre })),
  ...[1251, 1250, 14, 15, 21, 7, 16, 5, 27, 51].map((genre) => ({ country: "HK", genre })),
  ...[27, 14, 21, 20, 11, 7, 16, 18, 17, 15].map((genre) => ({ country: "JP", genre })),
  ...[1250, 1251, 14, 51, 27, 15, 21, 11, 16, 10].map((genre) => ({ country: "TW", genre })),
];

const SEED_LIMIT = 96;
const SEED_RESULTS_PER_TERM = 10;
const FEED_LIMIT = 100;
export const POOL_LIMIT = 1200;
// A handful of successful feeds is too narrow for photo matching. Prefer the
// bundled 200-song snapshot until the live catalog offers at least as much.
export const MIN_POOL_SIZE = 200;
const UPSTREAM_TIMEOUT_MS = 5_000;
const UPSTREAM_CONCURRENCY = 6;
const UPSTREAM_REVALIDATE_SECONDS = 60 * 60 * 6;
const POOL_TTL_MS = 60 * 60 * 6 * 1000;
const PARTIAL_POOL_TTL_MS = 5 * 60 * 1000;
const POOL_VERSION_LENGTH = 16;
const ARTWORK_SIZE = 400;
const ARTWORK_THUMB_SIZE = 200;
const DEFAULT_ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const DEFAULT_ITUNES_RSS_URL = "https://itunes.apple.com";

const ACCENTS = ["#e05b3f", "#c8923d", "#5f8c83", "#8a6ba8", "#b84d6a", "#667fb8"];

function configuredUrl(name: string, fallback: string) {
  const configured = process.env[name]?.trim();
  return (configured ? configured : fallback).replace(/\/+$/, "");
}

interface ITunesTrack {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  primaryGenreName?: string;
}

interface RssLabel {
  label?: string;
}

interface RssLink {
  attributes?: { rel?: string; href?: string };
}

interface RssEntry {
  "im:name"?: RssLabel;
  "im:artist"?: RssLabel;
  "im:image"?: RssLabel[];
  "im:collection"?: { "im:name"?: RssLabel };
  link?: RssLink | RssLink[];
  id?: { attributes?: { "im:id"?: string } };
  category?: { attributes?: { term?: string } };
}

function artworkAt(base: string, size: number) {
  return `${base}/${size}x${size}bb.jpg`;
}

// "…/<sku>.jpg/100x100bb.jpg" → "…/<sku>.jpg"
function artworkBase(url: string | undefined) {
  if (!url) return undefined;
  const base = url.replace(/\/\d+x\d+bb\.\w+$/, "");
  return base === url ? undefined : base;
}

function searchTrackToSong(track: ITunesTrack, index: number, storefront: string): Song | null {
  if (!track.trackId || !track.trackName || !track.artistName || !track.previewUrl) return null;
  const base = artworkBase(track.artworkUrl100);
  return {
    id: String(track.trackId),
    title: track.trackName,
    artist: track.artistName,
    album: track.collectionName,
    artworkUrl: base ? artworkAt(base, ARTWORK_SIZE) : undefined,
    artworkThumbUrl: base ? artworkAt(base, ARTWORK_THUMB_SIZE) : undefined,
    previewUrl: track.previewUrl,
    externalUrl: track.trackViewUrl,
    genre: track.primaryGenreName,
    storefront,
    accent: ACCENTS[index % ACCENTS.length],
  };
}

function rssEntryToSong(entry: RssEntry, index: number, storefront: string): Song | null {
  const id = entry.id?.attributes?.["im:id"];
  const title = entry["im:name"]?.label;
  const artist = entry["im:artist"]?.label;
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
  const previewUrl = links.find((link) => link.attributes?.rel === "enclosure")?.attributes?.href;
  const externalUrl = links.find((link) => link.attributes?.rel === "alternate")?.attributes?.href;
  if (!id || !title || !artist || !previewUrl) return null;
  const images = entry["im:image"] ?? [];
  const base = artworkBase(images[images.length - 1]?.label);
  return {
    id,
    title,
    artist,
    album: entry["im:collection"]?.["im:name"]?.label,
    artworkUrl: base ? artworkAt(base, ARTWORK_SIZE) : undefined,
    artworkThumbUrl: base ? artworkAt(base, ARTWORK_THUMB_SIZE) : undefined,
    previewUrl,
    externalUrl,
    genre: entry.category?.attributes?.term,
    storefront,
    accent: ACCENTS[index % ACCENTS.length],
  };
}

function withoutNulls(songs: (Song | null)[]) {
  return songs.filter((song): song is Song => song !== null);
}

async function fetchJson(url: string, label: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      next: { revalidate: UPSTREAM_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // Next.js 15.5 only writes fetch Data Cache entries for HTTP 200
    // (patch-fetch.js; docs under cache: force-cache). 403/429/503 are not
    // stored, so a failed source is retried on the next pool build.
    if (!response.ok) {
      console.warn(`iTunes ${label} failed status=${response.status}`);
      return null;
    }
    return await response.json();
  } catch {
    console.warn(`iTunes ${label} failed status=unavailable`);
    return null;
  }
}

async function songsForTerm({ term, country }: SeedTerm): Promise<Song[] | null> {
  const params = new URLSearchParams({
    term,
    media: "music",
    entity: "song",
    country,
    limit: String(SEED_RESULTS_PER_TERM),
  });
  const data = (await fetchJson(
    `${configuredUrl("ITUNES_SEARCH_URL", DEFAULT_ITUNES_SEARCH_URL)}?${params}`,
    `search term=${term} country=${country}`,
  )) as { results?: ITunesTrack[] } | null;
  if (!data) return null;
  return withoutNulls((data.results ?? []).map((track, index) => searchTrackToSong(track, index, country)));
}

async function songsForFeed({ country, genre }: ChartFeed): Promise<Song[] | null> {
  const base = configuredUrl("ITUNES_RSS_URL", DEFAULT_ITUNES_RSS_URL);
  const data = (await fetchJson(
    `${base}/${country.toLowerCase()}/rss/topsongs/limit=${FEED_LIMIT}/genre=${genre}/json`,
    `chart country=${country} genre=${genre}`,
  )) as { feed?: { entry?: RssEntry | RssEntry[] } } | null;
  if (!data) return null;
  const entry = data.feed?.entry;
  const entries = Array.isArray(entry) ? entry : entry ? [entry] : [];
  return withoutNulls(entries.map((item, index) => rssEntryToSong(item, index, country)));
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Round-robin across groups so no single artist or chart fills a run of
// columns. Shared `seenIds` / `seenKeys` carry dedupe across calls.
function interleaveUnique(
  groups: Song[][],
  limit: number,
  seenIds: Set<string>,
  seenKeys: Set<string>,
): Song[] {
  const cursors = groups.map(() => 0);
  const songs: Song[] = [];

  while (songs.length < limit) {
    let progressed = false;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      let cursor = cursors[groupIndex];
      while (
        cursor < group.length &&
        (seenIds.has(group[cursor].id) || seenKeys.has(songKey(group[cursor])))
      ) {
        cursor += 1;
      }
      cursors[groupIndex] = cursor;
      if (cursor >= group.length) continue;
      const song = group[cursor];
      seenIds.add(song.id);
      seenKeys.add(songKey(song));
      songs.push(song);
      cursors[groupIndex] = cursor + 1;
      progressed = true;
      if (songs.length >= limit) break;
    }
    if (!progressed) break;
  }

  return songs;
}

export interface CatalogPool {
  songs: Song[];
  version: string;
}

function poolVersion(songs: Song[]) {
  const hash = createHash("sha1");
  for (const song of songs) hash.update(`${song.id},`);
  return hash.digest("hex").slice(0, POOL_VERSION_LENGTH);
}

async function buildPool(): Promise<{ pool: CatalogPool | null; complete: boolean }> {
  type Source = { kind: "seed"; seed: SeedTerm } | { kind: "feed"; feed: ChartFeed };
  const sources: Source[] = [
    ...SEED_TERMS.map((seed): Source => ({ kind: "seed", seed })),
    ...POOL_FEEDS.map((feed): Source => ({ kind: "feed", feed })),
  ];
  const results = await mapLimited(sources, UPSTREAM_CONCURRENCY, (source) =>
    source.kind === "seed" ? songsForTerm(source.seed) : songsForFeed(source.feed),
  );
  const complete = results.every((songs) => songs !== null);
  const seedGroups = results.slice(0, SEED_TERMS.length).map((songs) => songs ?? []);
  const feedGroups = results.slice(SEED_TERMS.length).map((songs) => songs ?? []);

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const seeds = interleaveUnique(seedGroups, SEED_LIMIT, seenIds, seenKeys);
  const charts = interleaveUnique(feedGroups, POOL_LIMIT - seeds.length, seenIds, seenKeys);
  const songs = [...seeds, ...charts];
  if (songs.length < MIN_POOL_SIZE) return { pool: null, complete: false };
  return { pool: { songs, version: poolVersion(songs) }, complete };
}

let cachedPool: { pool: CatalogPool; expiresAt: number } | null = null;
let pendingPool: Promise<CatalogPool | null> | null = null;

// Built once per server instance and kept in memory, so every page of one
// client's walk slices the same list. Upstream responses sit in the fetch
// Data Cache; a pool missing some sources is rebuilt sooner.
export async function getCatalogPool(): Promise<CatalogPool | null> {
  if (cachedPool && cachedPool.expiresAt > Date.now()) return cachedPool.pool;
  if (!pendingPool) {
    pendingPool = buildPool()
      .then(({ pool, complete }) => {
        // Keep the broader pool when a refresh loses upstream feeds.
        const bestPool = pool && (!cachedPool || complete || pool.songs.length >= cachedPool.pool.songs.length)
          ? pool : cachedPool?.pool ?? null;
        if (bestPool) {
          cachedPool = {
            pool: bestPool,
            expiresAt: Date.now() + (complete ? POOL_TTL_MS : PARTIAL_POOL_TTL_MS),
          };
        }
        return bestPool;
      })
      .finally(() => {
        pendingPool = null;
      });
  }
  return pendingPool;
}

export interface CatalogSnapshot {
  songs: Song[];
  version: string;
}

function isSnapshotSong(value: unknown): value is Song {
  if (typeof value !== "object" || value === null) return false;
  const song = value as Record<string, unknown>;
  return (
    typeof song.id === "string" &&
    typeof song.title === "string" &&
    typeof song.artist === "string" &&
    typeof song.accent === "string"
  );
}

// CATALOG_SNAPSHOT_DISABLED=1 is a server-only switch for testing the last
// fallback layer, like ITUNES_SEARCH_URL / ITUNES_RSS_URL.
export function catalogSnapshot(): CatalogSnapshot | null {
  if (process.env.CATALOG_SNAPSHOT_DISABLED === "1") return null;
  const file = snapshotFile as { generatedAt?: string | null; songs?: unknown[] };
  const songs = (file.songs ?? []).filter(isSnapshotSong);
  if (songs.length < MIN_POOL_SIZE) return null;
  return { songs, version: `snapshot-${file.generatedAt ?? "unknown"}` };
}
