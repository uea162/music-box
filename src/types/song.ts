export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  artworkThumbUrl?: string;
  previewUrl?: string;
  externalUrl?: string;
  genre?: string;
  mood?: string;
  storefront?: string;
  accent: string;
}

export type CatalogSource = "itunes" | "snapshot" | "fallback";

export interface CatalogPage {
  songs: Song[];
  recommendationSongs?: Song[];
  nextCursor: string | null;
  total: number;
  poolVersion: string;
  source: CatalogSource;
}
