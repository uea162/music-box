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

export async function chooseSong(scene: string, songs: Song[], signal: AbortSignal): Promise<SongMatch> {
  const candidates = songs.slice(0, 255);
  if (!candidates.length) throw new Error("曲目尚未加载，请稍后重试");
  const criteria = Object.fromEntries(candidates.map((song) => [
    song.id, `${song.title} — ${song.artist}。${song.mood}`,
  ]));
  const response = await fetch("/api/jev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { scene },
      questions: { song: {
        type: "choice",
        instructions: "哪一首歌的氛围最贴近 `scene`？按光线、天气、地点和情绪选，不要按歌名里的字面词硬套。",
        criteria,
      } },
    }),
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
