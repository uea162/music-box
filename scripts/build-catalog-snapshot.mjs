// Regenerates src/data/catalog-snapshot.json from a running server.
//
//   npm run dev                       (in another terminal)
//   npm run catalog:snapshot          (or: node scripts/build-catalog-snapshot.mjs http://localhost:3002)
//
// The snapshot is the first-page fallback when every iTunes source fails.
// Preview and artwork URLs rotate, so rerun this when previews start to 404.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SNAPSHOT_SIZE = 200;
const REQUEST_LIMIT = 144;
const MAX_REQUESTS = 10;
const OUTPUT = fileURLToPath(new URL("../src/data/catalog-snapshot.json", import.meta.url));
const baseUrl = (process.argv[2] ?? process.env.CATALOG_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const songs = [];
const seen = new Set();
let cursor = null;
let poolVersion = null;

for (let request = 0; request < MAX_REQUESTS && songs.length < SNAPSHOT_SIZE; request += 1) {
  const params = new URLSearchParams({ limit: String(REQUEST_LIMIT) });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${baseUrl}/api/catalog?${params}`);
  if (!response.ok) throw new Error(`GET /api/catalog failed: HTTP ${response.status}`);
  const page = await response.json();
  if (page.source !== "itunes") {
    throw new Error(`catalog source is "${page.source}", not "itunes"; refusing to overwrite the snapshot`);
  }
  poolVersion ??= page.poolVersion;
  for (const song of page.songs) {
    if (seen.has(song.id) || !song.previewUrl) continue;
    seen.add(song.id);
    songs.push(song);
  }
  cursor = page.nextCursor;
  if (!cursor) break;
}

const picked = songs.slice(0, SNAPSHOT_SIZE);
if (picked.length < 100) throw new Error(`only ${picked.length} songs, expected at least 100`);

const lines = picked.map((song) => `    ${JSON.stringify(song)}`).join(",\n");
const body = `{
  "generatedAt": ${JSON.stringify(new Date().toISOString())},
  "poolVersion": ${JSON.stringify(poolVersion)},
  "songs": [
${lines}
  ]
}
`;
await writeFile(OUTPUT, body, "utf8");
console.log(`wrote ${picked.length} songs to ${OUTPUT}`);
