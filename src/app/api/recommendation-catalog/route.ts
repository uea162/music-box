import { catalogSnapshot, getCatalogPool } from "@/server/catalog-pool";
import { songWithMood } from "@/server/song-mood";

export const runtime = "nodejs";

export async function GET() {
  const pool = await getCatalogPool().catch(() => null);
  const songs = pool?.songs.length ? pool.songs : catalogSnapshot()?.songs;
  if (!songs?.length) return Response.json({ error: "曲库暂时不可用" }, { status: 503 });
  return Response.json(
    { songs: songs.map(songWithMood), source: pool?.songs.length ? "itunes" : "snapshot" },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
