export const runtime = "nodejs";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse";

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "GEMINI_API_KEY 未配置" }, { status: 503 });

  let image: unknown;
  try {
    image = (await request.json()).image;
  } catch {
    return Response.json({ error: "图片请求格式错误" }, { status: 400 });
  }
  if (typeof image !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 3_000_000) {
    return Response.json({ error: "图片格式或大小无效" }, { status: 400 });
  }

  try {
    const upstream = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: "请用一句中文描述这张图片的画面，涵盖地点、光线、天气或室内外、氛围和主要物体。只输出这一句，不要推荐歌曲，不要分点。" },
          { inline_data: { mime_type: "image/jpeg", data: image } },
        ] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 200,
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
      signal: request.signal,
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: `读图服务失败 (${upstream.status})` }, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "无法连接读图服务" }, { status: 502 });
  }
}
