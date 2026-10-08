"use client";

import { useEffect, useState } from "react";
import type { WeatherState } from "../../lib/participant-config";
import { placeQueryKey } from "../../lib/place-lookup";
import {
  WEATHER_CACHE_MS,
  WEATHER_ERROR_CACHE_MS,
  cachedWeather,
  loadWeatherState,
  weatherCacheKey,
} from "../../lib/weather";

// Failed loads retry with doubling delays (60s, 120s, 240s), then fall back to the
// normal cache cadence, so a broken provider is never polled faster than a healthy one.
export const WEATHER_QUICK_RETRIES = 3;
const MIN_REFRESH_MS = 1000;

// Mounted widgets refresh when the shared cache entry expires; the cache and its
// in-flight map still decide whether a request is actually sent, so widgets that
// share coordinates never duplicate it.
export function weatherRefreshDelay(state: WeatherState, failures: number, now: number): number {
  if (state.status === "ready") {
    const expires = Date.parse(state.updatedAt) + WEATHER_CACHE_MS;
    return Math.max(MIN_REFRESH_MS, Number.isFinite(expires) ? expires - now : WEATHER_CACHE_MS);
  }
  return failures <= WEATHER_QUICK_RETRIES
    ? Math.min(WEATHER_ERROR_CACHE_MS * 2 ** (failures - 1), WEATHER_CACHE_MS)
    : WEATHER_CACHE_MS;
}

// One side of Here & There. Saved coordinates are used directly; a bare place
// name is geocoded first. Both steps are cached, so repeat renders stay quiet
// and the widget only re-resolves when the place actually changes.
export function useWeatherState(
  label: string | null,
  latitude: number | null,
  longitude: number | null,
): WeatherState {
  const placeName =
    latitude === null || longitude === null ? (label?.trim() || null) : null;
  const coordinates =
    latitude !== null && longitude !== null ? { latitude, longitude } : null;
  const key = coordinates
    ? weatherCacheKey(coordinates)
    : placeName
      ? `place:${placeQueryKey(placeName)}`
      : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    state: WeatherState;
  } | null>(null);
  const cached = coordinates ? cachedWeather(coordinates) : null;

  useEffect(() => {
    if (!key) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const target =
      latitude !== null && longitude !== null
        ? { label: null, coordinates: { latitude, longitude } }
        : { label: placeName, coordinates: null };
    const load = () => {
      void loadWeatherState(target).then((state) => {
        // Unmount, a place change or a late response ends this load's ownership.
        if (!active) return;
        // A failed refresh keeps the last good reading for this place.
        setLoaded((previous) =>
          state.status === "error" && previous?.key === key && previous.state.status === "ready"
            ? previous
            : { key, state },
        );
        if (state.status === "not-configured") return;
        failures = state.status === "error" ? failures + 1 : 0;
        timer = setTimeout(load, weatherRefreshDelay(state, failures, Date.now()));
      });
    };
    load();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, latitude, longitude, placeName]);

  if (!key) return { status: "not-configured" };
  if (loaded?.key === key) return loaded.state;
  return cached ?? { status: "loading" };
}
