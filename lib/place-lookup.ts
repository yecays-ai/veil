import type { Coordinates } from "./participant-config";
import { AUX_REQUEST_TIMEOUT_MS, withRequestTimeout } from "./request-timeout";

// Place-name lookup supplies weather coordinates and the timezone used for local time.
export const OPEN_METEO_GEOCODING_URL =
  "https://geocoding-api.open-meteo.com/v1/search";
export const PLACE_CACHE_MS = 6 * 60 * 60 * 1000;
export const PLACE_ERROR_CACHE_MS = 60 * 1000;

export type PlaceMatch = {
  label: string;
  detail: string | null;
  coordinates: Coordinates;
  timezone: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, max = 120): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

export function placeQueryKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function geocodingUrl(name: string): string {
  const query = new URLSearchParams({
    name: name.trim(),
    count: "1",
    language: "en",
    format: "json",
  });
  return `${OPEN_METEO_GEOCODING_URL}?${query.toString()}`;
}

export function parseGeocodingResult(payload: unknown): PlaceMatch | null {
  const results = record(payload).results;
  if (!Array.isArray(results) || !results.length) return null;
  const first = record(results[0]);
  const label = text(first.name, 80);
  const latitude = first.latitude;
  const longitude = first.longitude;
  if (
    !label ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    return null;
  const detail = [text(first.admin1, 80), text(first.country, 80)]
    .filter(Boolean)
    .join(", ");
  return {
    label,
    detail: detail || null,
    coordinates: { latitude, longitude },
    timezone: text(first.timezone, 100),
  };
}

type CacheEntry = { match: PlaceMatch | null; at: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PlaceMatch | null>>();

export function clearPlaceCache() {
  cache.clear();
  inflight.clear();
}

// Never throws: an unknown name, an offline device or a bad payload all resolve
// to null so the editor can report it and the widget keeps rendering.
export async function lookupPlace(
  name: string,
  fetcher: typeof fetch | undefined = globalThis.fetch,
  now: number = Date.now(),
  timeoutMs: number = AUX_REQUEST_TIMEOUT_MS,
): Promise<PlaceMatch | null> {
  const key = placeQueryKey(name);
  if (!key) return null;
  const entry = cache.get(key);
  if (entry) {
    const lifetime = entry.match ? PLACE_CACHE_MS : PLACE_ERROR_CACHE_MS;
    if (now - entry.at < lifetime) return entry.match;
  }
  const pending = inflight.get(key);
  // A joining caller keeps its own deadline; leaving early does not cancel the request others share.
  if (pending) return withRequestTimeout(timeoutMs, () => pending).catch(() => null);
  const operation = (async (): Promise<PlaceMatch | null> => {
    if (typeof fetcher !== "function") return null;
    let match: PlaceMatch | null = null;
    try {
      // The deadline also clears the shared in-flight entry, so a later lookup can start again.
      match = await withRequestTimeout(timeoutMs, async (signal) => {
        const response = await fetcher(geocodingUrl(name), {
          headers: { accept: "application/json" },
          signal,
        });
        return response.ok ? parseGeocodingResult(await response.json()) : null;
      });
    } catch {
      match = null;
    }
    cache.set(key, { match, at: now });
    return match;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, operation);
  return operation;
}
