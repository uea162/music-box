import type { CoarseLocation, CurrentWeather } from "@/types/local-context";

export function parseCoarseLocation(value: unknown): CoarseLocation | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.error === true || data.success === false) return null;
  const latitude = typeof data.latitude === "number" && Number.isFinite(data.latitude) && Math.abs(data.latitude) <= 90
    ? data.latitude : null;
  const longitude = typeof data.longitude === "number" && Number.isFinite(data.longitude) && Math.abs(data.longitude) <= 180
    ? data.longitude : null;
  const read = (key: string) => typeof data[key] === "string" && (data[key] as string).trim()
    ? (data[key] as string).trim().slice(0, 100) : null;
  const city = read("city");
  const region = read("region");
  const country = read("country_name") ?? read("country");
  const countryCode = read("country_code") ?? read("country");
  if (!city && !region && !country && latitude === null) return null;
  return { city, region, country, countryCode, latitude, longitude };
}

export function weatherLabel(code: number): string {
  if (code === 0) return "晴";
  if (code <= 3) return "多云";
  if (code === 45 || code === 48) return "有雾";
  if (code >= 51 && code <= 67) return "有雨";
  if (code >= 71 && code <= 86) return "有雪";
  if (code >= 95) return "雷雨";
  if (code >= 80 && code <= 82) return "阵雨";
  return "天气未知";
}

export function formatWeather(weather: CurrentWeather | null): string {
  return weather ? `${weatherLabel(weather.weatherCode)} ${Math.round(weather.temperatureC)}°C` : "天气暂不可用";
}
