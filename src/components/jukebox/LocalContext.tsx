"use client";

import { useEffect, useState } from "react";
import { parseCoarseLocation, weatherLabel } from "@/lib/local-context";
import type { CoarseLocation, CurrentWeather } from "@/types/local-context";

function localTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function WeatherIcon({ code }: { code: number }) {
  const clear = code === 0;
  const fog = code === 45 || code === 48;
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const thunder = code >= 95;

  return (
    <svg className="weather-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {clear ? (
        <>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </>
      ) : fog ? (
        <path d="M4 8h16M2 12h17M5 16h16" />
      ) : (
        <>
          {!rain && !snow && !thunder ? <circle cx="8" cy="8" r="3" /> : null}
          <path d="M6 17h12a4 4 0 0 0 .1-8 6 6 0 0 0-11.3 1.1A3.5 3.5 0 0 0 6 17Z" />
          {rain ? <path d="m8 19-1 2m6-2-1 2m6-2-1 2" /> : null}
          {snow ? <path d="M8 20h.01M13 20h.01M18 20h.01" /> : null}
          {thunder ? <path d="m13 14-2 4h3l-2 4" /> : null}
        </>
      )}
    </svg>
  );
}

export function LocalContext() {
  const [location, setLocation] = useState<CoarseLocation | null>(null);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [weatherLoading, setWeatherLoading] = useState(true);

  useEffect(() => {
    setTime(localTime(new Date()));
    const timer = window.setInterval(() => setTime(localTime(new Date())), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let found: CoarseLocation | null = null;
      try {
        const response = await fetch("/api/context", { signal: controller.signal });
        if (response.ok) {
          const data: { location?: CoarseLocation | null } = await response.json();
          found = data.location ?? null;
        }
      } catch { /* The browser fallback below still works without the app's lookup. */ }

      // Local development has no forwarded visitor IP. Ask the same coarse IP
      // service from the browser so the feature can still be tried locally.
      if (!found && !controller.signal.aborted) {
        try {
          const response = await fetch("https://ipwho.is/", { signal: controller.signal });
          if (response.ok) found = parseCoarseLocation(await response.json());
        } catch { /* Time remains available if location cannot be determined. */ }
      }
      if (controller.signal.aborted) return;
      setLocation(found);
      setLoading(false);
      if (!found || found.latitude === null || found.longitude === null) {
        setWeatherLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({ latitude: String(found.latitude), longitude: String(found.longitude) });
        const response = await fetch(`/api/weather?${params}`, { signal: controller.signal });
        if (response.ok) {
          const data: { weather?: CurrentWeather | null } = await response.json();
          if (!controller.signal.aborted) setWeather(data.weather ?? null);
        }
      } catch { /* Weather is optional context. */ }
      finally {
        if (!controller.signal.aborted) setWeatherLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const place = location
    ? [location.country, location.region, location.city].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ")
    : loading ? "正在读取地区" : "地区暂不可用";

  return (
    <div className="local-context" aria-label="当前地区、天气和本地时间">
      <span>{place}</span>
      {weather ? (
        <span className="weather-context" aria-label={`${weatherLabel(weather.weatherCode)}，${Math.round(weather.temperatureC)} 摄氏度`}>
          <WeatherIcon code={weather.weatherCode} />
          {Math.round(weather.temperatureC)}°C
        </span>
      ) : <span>{weatherLoading ? "正在读取天气" : "天气暂不可用"}</span>}
      <time>{time || "读取时间中"}</time>
    </div>
  );
}
