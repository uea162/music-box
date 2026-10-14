import type { Song } from "@/types/song";

// Same recording released on several albums gets several track ids; this key
// catches those so the wall does not show the same title twice.
export function songKey(song: Pick<Song, "title" | "artist">) {
  const clean = (value: string) => value.normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  // iTunes often lists the same recording again under a remastered release.
  const title = clean(song.title)
    .replace(/\s*[([](?:\d{4}\s*)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?[)\]]/gi, "")
    .replace(/\s*[-–—]\s*(?:\d{4}\s*)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?$/gi, "")
    .trim();
  return `${title}|${clean(song.artist)}`;
}
