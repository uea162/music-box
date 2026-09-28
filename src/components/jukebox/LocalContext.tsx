"use client";

import { useEffect, useState } from "react";
import { formatWeather, parseCoarseLocation } from "@/lib/local-context";
import type { CoarseLocation, CurrentWeather } from "@/types/local-context";

function localTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function LocalContext() {
  const [location, setLocation] = useState<CoarseLocation | null>(null);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(true);

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
      if (!found || found.latitude === null || found.longitude === null) return;

      try {
        const params = new URLSearchParams({ latitude: String(found.latitude), longitude: String(found.longitude) });
        const response = await fetch(`/api/weather?${params}`, { signal: controller.signal });
        if (response.ok) {
          const data: { weather?: CurrentWeather | null } = await response.json();
          if (!controller.signal.aborted) setWeather(data.weather ?? null);
        }
      } catch { /* Weather is optional context. */ }
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
      <span>{loading ? "正在读取天气" : formatWeather(weather)}</span>
      <time>{time || "读取时间中"}</time>
    </div>
  );
}
