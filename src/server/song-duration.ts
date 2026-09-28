import type { Song } from "@/types/song";

const LOOKUP_BATCH_SIZE = 50;
const LOOKUP_TIMEOUT_MS = 5_000;

interface LookupTrack {
  trackId?: number;
  trackTimeMillis?: number;
}

// RSS entries contain preview URLs but no song length. Look up only the songs
// about to be sent to the client, and keep the original data if lookup fails.
export async function withSongDurations(songs: Song[]): Promise<Song[]> {
  const missing = songs.filter((song) => !song.durationMs && /^\d+$/.test(song.id));
  if (!missing.length) return songs;

  const byStorefront = new Map<string, Song[]>();
  for (const song of missing) {
    const storefront = song.storefront ?? "US";
    const group = byStorefront.get(storefront) ?? [];
    group.push(song);
    byStorefront.set(storefront, group);
  }
  const batches: Array<{ songs: Song[]; country: string }> = [];
  for (const [country, group] of byStorefront) {
    for (let index = 0; index < group.length; index += LOOKUP_BATCH_SIZE) {
      batches.push({ songs: group.slice(index, index + LOOKUP_BATCH_SIZE), country });
    }
  }
  const found = new Map<string, number>();
  await Promise.all(batches.map(async ({ songs: batch, country }) => {
    const params = new URLSearchParams({ id: batch.map((song) => song.id).join(","), entity: "song", country });
    try {
      const response = await fetch(`https://itunes.apple.com/lookup?${params}`, {
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        next: { revalidate: 60 * 60 * 6 },
      });
      if (!response.ok) return;
      const data = await response.json() as { results?: LookupTrack[] };
      for (const track of data.results ?? []) {
        if (track.trackId && track.trackTimeMillis && track.trackTimeMillis > 0) {
          found.set(String(track.trackId), track.trackTimeMillis);
        }
      }
    } catch {
      // Song playback remains usable when Apple's metadata lookup is down.
    }
  }));

  return songs.map((song) => found.has(song.id) ? { ...song, durationMs: found.get(song.id) } : song);
}
