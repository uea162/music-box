export const runtime = "nodejs";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = [
  { id: "gemini-3.6-flash", thinkingLevel: "minimal", timeoutMs: 7_000 },
  { id: "gemini-3.1-flash-lite", thinkingLevel: "minimal", timeoutMs: 7_000 },
  { id: "gemini-3.5-flash", thinkingLevel: "minimal", timeoutMs: 7_000 },
  { id: "gemini-3.8-flash", thinkingLevel: "low", timeoutMs: 7_000 },
] as const;
const MODEL_COOLDOWN = new Map<string, number>();
const FALLBACK_STATUSES = new Set([403, 404, 429, 500, 502, 503, 504]);

function visibleTextInSse(payload: string): boolean {
  for (const event of payload.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      };
      if (chunk.candidates?.[0]?.content?.parts?.some((part) => !part.thought && part.text?.trim())) return true;
    } catch {
      // A malformed event cannot count as a successful description.
    }
  }
  return false;
}

function recordCooldown(model: string, status: number, errorBody: string) {
  if (status === 429) {
    const daily = /quota_exceeded|daily|per.?day|requests.per.day|\bRPD\b/i.test(errorBody);
    MODEL_COOLDOWN.set(model, Date.now() + (daily ? 60 * 60_000 : 60_000));
  } else if (status === 403 || status === 404) {
    MODEL_COOLDOWN.set(model, Date.now() + 10 * 60_000);
  }
}

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

  const contents = [{ role: "user", parts: [
    { text: "请用一句中文描述这张图片的画面，涵盖地点、光线、天气或室内外、氛围和主要物体。只输出这一句，不要推荐歌曲，不要分点。" },
    { inline_data: { mime_type: "image/jpeg", data: image } },
  ] }];

  for (const model of MODELS) {
    if (request.signal.aborted) break;
    if ((MODEL_COOLDOWN.get(model.id) ?? 0) > Date.now()) continue;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(model.timeoutMs)]);
    try {
      const upstream = await fetch(`${API_BASE}/${model.id}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 200,
            thinkingConfig: { thinkingLevel: model.thinkingLevel },
          },
        }),
        signal,
        cache: "no-store",
      });
      if (!upstream.ok) {
        const errorBody = await upstream.text().catch(() => "");
        if (!FALLBACK_STATUSES.has(upstream.status)) {
          return Response.json({ error: `读图请求失败 (${upstream.status})` }, { status: 502 });
        }
        recordCooldown(model.id, upstream.status, errorBody);
        continue;
      }
      const payload = await upstream.text();
      if (!visibleTextInSse(payload)) continue;
      return new Response(payload, {
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch {
      if (request.signal.aborted) break;
      // A slow or unreachable model should not hold up the next one.
    }
  }
  return Response.json({ error: "读图服务暂时不可用，已尝试备用模型" }, { status: 502 });
}
