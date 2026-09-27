import type { Song } from "@/types/song";

const COLORS = [
  "#e05b3f",
  "#c8923d",
  "#5f8c83",
  "#8a6ba8",
  "#b84d6a",
  "#667fb8",
  "#9e7f67",
  "#4f7863",
];

const NAMES = [
  ["Afterimage", "Nora Vale"],
  ["Slow Signal", "The Glass Hours"],
  ["Half-Light", "Mori & June"],
  ["Velvet Static", "Aster Club"],
  ["Rain on Film", "Sunday Cinema"],
  ["Unsaid Things", "Pale Harbour"],
  ["A Room at 3AM", "Night Inventory"],
  ["Open Window", "Field Notes"],
  ["Soft Geometry", "Lucent"],
  ["Somewhere Else", "Northern Lines"],
  ["Warm Machines", "Low Season"],
  ["The Long Way Home", "Silver Hours"],
  ["Paper Moon", "Common Weather"],
  ["Borrowed Time", "Modern Choir"],
  ["Blue Corridor", "The Still Life"],
  ["Last Train", "Parallel Parks"],
  ["Minor Satellites", "Quiet Assembly"],
  ["Between Stations", "Distant Rooms"],
];

export const fallbackSongs: Song[] = NAMES.map(([title, artist], index) => ({
  id: `fallback-${index + 1}`,
  title,
  artist,
  album: "Music Box Studies",
  genre: "Alternative",
  accent: COLORS[index % COLORS.length],
}));
