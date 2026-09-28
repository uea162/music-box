import { fallbackSongs } from "@/data/fallback-songs";
import { catalogSnapshot, getCatalogPool } from "@/server/catalog-pool";
import { withSongDurations } from "@/server/song-duration";
import type { CatalogPage } from "@/types/song";

export const runtime = "nodejs";

const PAGE_SIZE = 96;
const MIN_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 144;
const CURSOR_VERSION = 1;
const PAGE_CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=3600";
const RETRY_AFTER_SECONDS = 30;

interface Cursor {
  v: number;
  pool: string;
  offset: number;
}

function encodeCursor(pool: string, offset: number) {
  const cursor: Cursor = { v: CURSOR_VERSION, pool, offset };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

// A cursor from another pool version still carries a usable offset; the
// client dedupes by id, so slicing the new pool at that offset is enough.
function cursorOffset(raw: string | null): number {
  if (!raw) return 0;
  try {
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    const offset = Number(cursor.offset);
    return Number.isInteger(offset) && offset > 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function pageSize(raw: string | null) {
  const requested = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(requested)) return PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, requested));
}

function page(body: CatalogPage, cacheControl: string) {
  return Response.json(body, { headers: { "Cache-Control": cacheControl } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawCursor = params.get("cursor");
  const limit = pageSize(params.get("limit"));

  const pool = await getCatalogPool().catch(() => null);

  if (!pool) {
    if (rawCursor) {
      return Response.json(
        { error: "catalog unavailable" },
        {
          status: 503,
          headers: { "Retry-After": String(RETRY_AFTER_SECONDS), "Cache-Control": "no-store" },
        },
      );
    }
    const snapshot = catalogSnapshot();
    if (snapshot) {
      return page(
        {
          songs: await withSongDurations(snapshot.songs),
          nextCursor: null,
          total: snapshot.songs.length,
          poolVersion: snapshot.version,
          source: "snapshot",
        },
        "no-store",
      );
    }
    return page(
      {
        songs: fallbackSongs,
        nextCursor: null,
        total: fallbackSongs.length,
        poolVersion: "fallback",
        source: "fallback",
      },
      "no-store",
    );
  }

  const offset = cursorOffset(rawCursor);
  const end = offset + limit;
  return page(
    {
      songs: await withSongDurations(pool.songs.slice(offset, end)),
      nextCursor: end < pool.songs.length ? encodeCursor(pool.version, end) : null,
      total: pool.songs.length,
      poolVersion: pool.version,
      source: "itunes",
    },
    PAGE_CACHE_CONTROL,
  );
}
