import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const latitudeParam = request.nextUrl.searchParams.get("latitude");
  const longitudeParam = request.nextUrl.searchParams.get("longitude");
  const latitude = Number(latitudeParam);
  const longitude = Number(longitudeParam);
  if (!latitudeParam || !longitudeParam || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("forecast_days", "1");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4500), next: { revalidate: 600 } });
    if (!response.ok) throw new Error("Weather lookup failed");
    const data: unknown = await response.json();
    const current = (data as { current?: { temperature_2m?: unknown; weather_code?: unknown } }).current;
    if (!current || typeof current.temperature_2m !== "number" || typeof current.weather_code !== "number") {
      throw new Error("Invalid weather response");
    }
    return NextResponse.json({ weather: { temperatureC: current.temperature_2m, weatherCode: current.weather_code } });
  } catch {
    return NextResponse.json({ weather: null }, { status: 503 });
  }
}
