export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  artworkThumbUrl?: string;
  previewUrl?: string;
  /** Full recording length supplied by the catalog, in milliseconds. */
  durationMs?: number;
  /** Position of the preview within the recording, when a source provides it. */
  previewStartMs?: number;
  externalUrl?: string;
  genre?: string;
  mood?: string;
  storefront?: string;
  accent: string;
}

export type CatalogSource = "itunes" | "snapshot" | "fallback";

export interface CatalogPage {
  songs: Song[];
  nextCursor: string | null;
  total: number;
  poolVersion: string;
  source: CatalogSource;
}
