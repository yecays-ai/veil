"use client";

import { useEffect, useState } from "react";
import type { WeatherState } from "../../lib/participant-config";
import { placeQueryKey } from "../../lib/place-lookup";
import { cachedWeather, loadWeatherState, weatherCacheKey } from "../../lib/weather";

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
    const target =
      latitude !== null && longitude !== null
        ? { label: null, coordinates: { latitude, longitude } }
        : { label: placeName, coordinates: null };
    void loadWeatherState(target).then((state) => {
      if (active) setLoaded({ key, state });
    });
    return () => {
      active = false;
    };
  }, [key, latitude, longitude, placeName]);

  if (!key) return { status: "not-configured" };
  if (loaded?.key === key) return loaded.state;
  return cached ?? { status: "loading" };
}
