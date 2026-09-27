import { fallbackSongs } from "@/data/fallback-songs";
import type { Song } from "@/types/song";

export const runtime = "nodejs";

interface SeedTerm {
  term: string;
  country: string;
}

// The original six stay on the US store. 陳奕迅 and 方大同 are searched on HK:
// that store returns traditional-Chinese artist names and preview URLs, while
// the US store labels the same artists in English.
const SEED_TERMS: SeedTerm[] = [
  { term: "Sade", country: "US" },
  { term: "Portishead", country: "US" },
  { term: "Ryuichi Sakamoto", country: "US" },
  { term: "The Postal Service", country: "US" },
  { term: "Cocteau Twins", country: "US" },
  { term: "Massive Attack", country: "US" },
  { term: "陳奕迅", country: "HK" },
  { term: "方大同", country: "HK" },
];

const CATALOG_LIMIT = 54;

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

function songsFromTracks(tracks: ITunesTrack[]): Song[] {
  return tracks
    .map(normalize)
    .filter((song): song is Song => Boolean(song?.previewUrl));
}

function interleaveUnique(groups: Song[][], limit: number): Song[] {
  const seen = new Set<string>();
  const cursors = groups.map(() => 0);
  const songs: Song[] = [];

  while (songs.length < limit) {
    let progressed = false;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      let cursor = cursors[groupIndex];
      while (cursor < group.length && seen.has(group[cursor].id)) cursor += 1;
      cursors[groupIndex] = cursor;
      if (cursor >= group.length) continue;
      seen.add(group[cursor].id);
      songs.push(group[cursor]);
      cursors[groupIndex] = cursor + 1;
      progressed = true;
      if (songs.length >= limit) break;
    }
    if (!progressed) break;
  }

  return songs;
}

async function songsForTerm({ term, country }: SeedTerm): Promise<Song[]> {
  try {
    const params = new URLSearchParams({
      term,
      media: "music",
      entity: "song",
      country,
      limit: "10",
    });
    const response = await fetch(`https://itunes.apple.com/search?${params}`, {
      next: { revalidate: 60 * 60 * 6 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { results?: ITunesTrack[] };
    return songsFromTracks(data.results ?? []);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const groups = await Promise.all(SEED_TERMS.map((seed) => songsForTerm(seed)));

    const songs = interleaveUnique(groups, CATALOG_LIMIT);

    return Response.json({
      songs: songs.length >= 12 ? songs : fallbackSongs,
      source: songs.length >= 12 ? "itunes" : "fallback",
    });
  } catch {
    return Response.json({ songs: fallbackSongs, source: "fallback" });
  }
}
