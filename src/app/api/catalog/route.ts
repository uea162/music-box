import { fallbackSongs } from "@/data/fallback-songs";
import type { Song } from "@/types/song";

export const runtime = "nodejs";

const SEED_TERMS = [
  "Sade",
  "Portishead",
  "Ryuichi Sakamoto",
  "The Postal Service",
  "Cocteau Twins",
  "Massive Attack",
];

const ACCENTS = ["#e05b3f", "#c8923d", "#5f8c83", "#8a6ba8", "#b84d6a", "#667fb8"];

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

function normalize(track: ITunesTrack, index: number): Song | null {
  if (!track.trackId || !track.trackName || !track.artistName) return null;

  return {
    id: String(track.trackId),
    title: track.trackName,
    artist: track.artistName,
    album: track.collectionName,
    artworkUrl: track.artworkUrl100?.replace("100x100bb", "400x400bb"),
    previewUrl: track.previewUrl,
    externalUrl: track.trackViewUrl,
    genre: track.primaryGenreName,
    accent: ACCENTS[index % ACCENTS.length],
  };
}

export async function GET() {
  try {
    const responses = await Promise.all(
      SEED_TERMS.map(async (term) => {
        const params = new URLSearchParams({
          term,
          media: "music",
          entity: "song",
          country: "US",
          limit: "10",
        });
        const response = await fetch(`https://itunes.apple.com/search?${params}`, {
          next: { revalidate: 60 * 60 * 6 },
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as { results?: ITunesTrack[] };
        return data.results ?? [];
      }),
    );

    const seen = new Set<string>();
    const songs = responses
      .flat()
      .map(normalize)
      .filter((song): song is Song => Boolean(song?.previewUrl))
      .filter((song) => {
        if (seen.has(song.id)) return false;
        seen.add(song.id);
        return true;
      })
      .slice(0, 54);

    return Response.json({
      songs: songs.length >= 12 ? songs : fallbackSongs,
      source: songs.length >= 12 ? "itunes" : "fallback",
    });
  } catch {
    return Response.json({ songs: fallbackSongs, source: "fallback" });
  }
}
