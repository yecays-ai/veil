"use client";

import { useEffect, useState } from "react";
import type { WeatherState } from "../../lib/participant-config";
import {
  cachedWeather,
  fetchCurrentWeather,
  weatherCacheKey,
} from "../../lib/weather";

// One request per side per session: the cache answers repeat renders, and the
// hook only re-fetches when the saved coordinates actually change.
export function useWeatherState(
  latitude: number | null,
  longitude: number | null,
): WeatherState {
  const [fetched, setFetched] = useState<{
    key: string;
    state: WeatherState;
  } | null>(null);
  const cached =
    latitude === null || longitude === null
      ? null
      : cachedWeather({ latitude, longitude });

  useEffect(() => {
    if (latitude === null || longitude === null) return;
    const coordinates = { latitude, longitude };
    const key = weatherCacheKey(coordinates);
    // The render-time cache check above is only a hint; re-read at request time.
    if (cachedWeather(coordinates)) return;
    let active = true;
    void fetchCurrentWeather({ coordinates, timezone: "UTC" }).then((next) => {
      if (active) setFetched({ key, state: next });
    });
    return () => {
      active = false;
    };
  }, [latitude, longitude]);

  if (latitude === null || longitude === null)
    return { status: "not-configured" };
  if (fetched && fetched.key === weatherCacheKey({ latitude, longitude }))
    return fetched.state;
  return cached ?? { status: "loading" };
}
