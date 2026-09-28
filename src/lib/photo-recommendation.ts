import type { Song } from "@/types/song";

export interface SongMatch {
  song: Song;
  probability: number;
  confidence: number | string;
  alternatives: Array<{ song: Song; probability: number }>;
}

export async function jpegForGemini(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72).split(",", 2)[1];
  } finally {
    bitmap.close();
  }
}

export async function describeScene(image: string, signal: AbortSignal, onText: (text: string) => void) {
  const response = await fetch("/api/scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error("读图服务暂时不可用，请重试");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let visible = "";
  const consume = (event: string) => {
    const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    let chunk: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    try { chunk = JSON.parse(data); } catch { return; }
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (!part.thought && part.text) visible += part.text;
    }
    onText(visible.trim());
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  const scene = visible.trim().replace(/\s+/g, " ");
  if (!scene) throw new Error("读图没有返回画面描述，请重试");
  onText(scene);
  return scene;
}

async function askJev(scene: string, candidates: Song[], signal: AbortSignal): Promise<SongMatch> {
  if (!candidates.length) throw new Error("曲目尚未加载，请稍后重试");
  const response = await fetch("/api/jev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene, songIds: candidates.map((song) => song.id) }),
    signal,
  });
  if (!response.ok) throw new Error(`选歌服务暂时不可用 (${response.status})`);
  const data = await response.json() as { answers?: { song?: {
    choice?: string;
    probabilities?: Record<string, number>;
    confidence?: number | string;
  } } };
  const answer = data.answers?.song;
  const song = candidates.find((item) => item.id === answer?.choice);
  const probability = answer?.probabilities?.[answer.choice ?? ""];
  if (!song || typeof probability !== "number" || !Number.isFinite(probability)) {
    throw new Error("选歌结果格式异常，请重试");
  }
  const alternatives = candidates
    .filter((item) => item.id !== song.id && Number.isFinite(answer?.probabilities?.[item.id]))
    .map((item) => ({ song: item, probability: answer!.probabilities![item.id] }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
  return { song, probability, confidence: answer?.confidence ?? "—", alternatives };
}

export async function chooseSong(scene: string, songs: Song[], signal: AbortSignal): Promise<SongMatch> {
  if (!songs.length) throw new Error("曲目尚未加载，请稍后重试");
  const batches: Song[][] = [];
  for (let start = 0; start < songs.length; start += 255) batches.push(songs.slice(start, start + 255));
  if (batches.length === 1) return askJev(scene, batches[0], signal);

  // Every catalog track enters a first-round choice. The best four from each
  // batch then compete in a final choice, keeping every Jev call below 255.
  const shortlists = await Promise.all(batches.map(async (batch) => {
    const result = await askJev(scene, batch, signal);
    return [result.song, ...result.alternatives.map((item) => item.song)];
  }));
  return askJev(scene, shortlists.flat(), signal);
}
