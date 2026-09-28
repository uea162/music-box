import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { parseCoarseLocation } from "@/lib/local-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "";
  const candidate = forwarded.split(",")[0]?.trim() ?? "";
  if (!isIP(candidate)) return null;
  if (candidate === "::1" || candidate.startsWith("127.") || candidate.startsWith("10.") || candidate.startsWith("192.168.")) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(candidate)) return null;
  return candidate;
}

export async function GET(request: NextRequest) {
  const ip = publicIp(request);
  if (!ip) return NextResponse.json({ location: null }, { headers: { "Cache-Control": "private, no-store" } });

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Location lookup failed");
    const location = parseCoarseLocation(await response.json());
    return NextResponse.json({ location }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ location: null }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
