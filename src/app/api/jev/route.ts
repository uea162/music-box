import { catalogSnapshot, getCatalogPool } from "@/server/catalog-pool";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return Response.json({ error: "TYPESAFE_API_KEY 未配置" }, { status: 503 });

  let scene: string;
  let songIds: string[];
  try {
    const raw = await request.text();
    if (raw.length > 8_000) throw new Error("Request too large");
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("Invalid request");
    const value = data as Record<string, unknown>;
    if (typeof value.scene !== "string" || !value.scene.trim() || value.scene.length > 500 ||
      !Array.isArray(value.songIds) || value.songIds.length < 1 || value.songIds.length > 255 ||
      value.songIds.some((id) => typeof id !== "string" || id.length > 100) ||
      new Set(value.songIds).size !== value.songIds.length) throw new Error("Invalid request");
    scene = value.scene.trim();
    songIds = value.songIds as string[];
  } catch {
    return Response.json({ error: "选歌请求格式错误" }, { status: 400 });
  }

  const pool = await getCatalogPool().catch(() => null);
  const songs = pool?.songs.length ? pool.songs : catalogSnapshot()?.songs;
  if (!songs?.length) return Response.json({ error: "曲库暂时不可用" }, { status: 503 });
  const byId = new Map(songs.map((song) => [song.id, song]));
  const candidates = songIds.map((id) => byId.get(id));
  if (candidates.some((song) => !song)) {
    return Response.json({ error: "选歌列表已过期，请重试" }, { status: 400 });
  }
  const criteria = Object.fromEntries(candidates.map((candidate) => {
    const song = candidate!;
    return [song.id, [
      `${song.title} — ${song.artist}`,
      song.genre ? `曲风：${song.genre}` : null,
      song.album ? `专辑：${song.album}` : null,
    ].filter(Boolean).join("；")];
  }));

  try {
    const upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "jev-latest",
        state: { scene },
        questions: { song: {
          type: "choice",
          instructions: "选一首听感和画面情绪最契合的歌。综合 scene 的人物、环境、光线、天气和情绪，以及歌曲已知的风格；不要只凭歌名的字面词或专辑封面联想，也不要把未知的歌曲特征当作事实。",
          criteria,
        } },
      }),
      signal: request.signal,
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "无法连接选歌服务" }, { status: 502 });
  }
}
