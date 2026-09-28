import type { Song } from "@/types/song";

// Same recording released on several albums gets several track ids; this key
// catches those so the wall does not show the same title twice.
export function songKey(song: Pick<Song, "title" | "artist">) {
  const clean = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return `${clean(song.title)}|${clean(song.artist)}`;
}
