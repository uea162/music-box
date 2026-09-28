export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("Authorization") ??
    (process.env.TYPESAFE_API_KEY ? `Bearer ${process.env.TYPESAFE_API_KEY}` : null);
  if (!authorization) return Response.json({ error: "TYPESAFE_API_KEY 未配置" }, { status: 503 });

  let body: string;
  try {
    body = await request.text();
    JSON.parse(body);
  } catch {
    return Response.json({ error: "选歌请求格式错误" }, { status: 400 });
  }

  try {
    const upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body,
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
