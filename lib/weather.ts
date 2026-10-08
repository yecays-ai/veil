import type {
  Coordinates,
  WeatherRequest,
  WeatherProvider,
  WeatherState,
} from "./participant-config";
import { lookupPlace } from "./place-lookup";
import { AUX_REQUEST_TIMEOUT_MS, withRequestTimeout } from "./request-timeout";

// Open-Meteo is keyless, so a small in-memory cache is enough to keep Home from
// re-requesting on every render. Successful readings live longer than failures.
export const WEATHER_CACHE_MS = 10 * 60 * 1000;
export const WEATHER_ERROR_CACHE_MS = 60 * 1000;
export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

type Summary = { label: string; icon: string };

const SUMMARIES: Record<number, Summary> = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤️" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫️" },
  48: { label: "Rime fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  53: { label: "Drizzle", icon: "🌦️" },
  55: { label: "Dense drizzle", icon: "🌧️" },
  56: { label: "Freezing drizzle", icon: "🌧️" },
  57: { label: "Freezing drizzle", icon: "🌧️" },
  61: { label: "Light rain", icon: "🌦️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy rain", icon: "🌧️" },
  66: { label: "Freezing rain", icon: "🌧️" },
  67: { label: "Freezing rain", icon: "🌧️" },
  71: { label: "Light snow", icon: "🌨️" },
  73: { label: "Snow", icon: "🌨️" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "🌨️" },
  80: { label: "Light showers", icon: "🌦️" },
  81: { label: "Showers", icon: "🌧️" },
  82: { label: "Heavy showers", icon: "🌧️" },
  85: { label: "Snow showers", icon: "🌨️" },
  86: { label: "Snow showers", icon: "🌨️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
  96: { label: "Storm with hail", icon: "⛈️" },
  99: { label: "Storm with hail", icon: "⛈️" },
};

export function weatherCodeSummary(code: unknown): Summary {
  return typeof code === "number" && Number.isFinite(code) && SUMMARIES[code]
    ? SUMMARIES[code]
    : { label: "Weather", icon: "🌡️" };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function weatherCacheKey(coordinates: Coordinates): string {
  return `${coordinates.latitude.toFixed(2)},${coordinates.longitude.toFixed(2)}`;
}

export function openMeteoUrl(coordinates: Coordinates): string {
  const query = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    current: "temperature_2m,weather_code",
    temperature_unit: "celsius",
  });
  return `${OPEN_METEO_URL}?${query.toString()}`;
}

export function parseOpenMeteoCurrent(
  payload: unknown,
  at: number = Date.now(),
): WeatherState {
  const current = record(record(payload).current);
  const temperature = current.temperature_2m;
  if (typeof temperature !== "number" || !Number.isFinite(temperature))
    return { status: "error", message: "Weather unavailable" };
  const summary = weatherCodeSummary(current.weather_code);
  return {
    status: "ready",
    temperatureC: Math.round(temperature),
    summary: summary.label,
    icon: summary.icon,
    updatedAt: new Date(at).toISOString(),
  };
}

type CacheEntry = { state: WeatherState; at: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<WeatherState>>();

export function clearWeatherCache() {
  cache.clear();
  inflight.clear();
}

// Returns a cached reading while it is still fresh; errors expire quickly so a
// later render can retry without hammering the provider in the meantime.
export function cachedWeather(
  coordinates: Coordinates,
  now: number = Date.now(),
): WeatherState | null {
  const entry = cache.get(weatherCacheKey(coordinates));
  if (!entry) return null;
  const lifetime =
    entry.state.status === "error" ? WEATHER_ERROR_CACHE_MS : WEATHER_CACHE_MS;
  return now - entry.at < lifetime ? entry.state : null;
}

// Never throws: an offline device, a bad payload or a failed request all become
// an "error" state so Home keeps rendering the widget.
export async function fetchCurrentWeather(
  request: WeatherRequest,
  fetcher?: typeof fetch,
  now: number = Date.now(),
  timeoutMs: number = AUX_REQUEST_TIMEOUT_MS,
): Promise<WeatherState> {
  // An omitted provider uses the browser fetch. Explicit undefined represents
  // a non-browser runtime and must not accidentally make a real network call.
  const provider = arguments.length < 2 ? globalThis.fetch : fetcher;
  const key = weatherCacheKey(request.coordinates);
  const fresh = cachedWeather(request.coordinates, now);
  if (fresh) return fresh;
  const pending = inflight.get(key);
  // A joining caller keeps its own deadline; leaving early does not cancel the request others share.
  if (pending)
    return withRequestTimeout(timeoutMs, () => pending).catch((): WeatherState => ({ status: "error", message: "Weather unavailable" }));
  const operation = (async (): Promise<WeatherState> => {
    if (typeof provider !== "function")
      return { status: "error", message: "Weather unavailable" };
    let state: WeatherState;
    try {
      // One deadline covers the request and its body, and clears the shared in-flight entry when it passes.
      state = await withRequestTimeout(timeoutMs, async (signal) => {
        const response = await provider(openMeteoUrl(request.coordinates), {
          headers: { accept: "application/json" },
          signal,
        });
        return response.ok
          ? parseOpenMeteoCurrent(await response.json(), now)
          : ({ status: "error", message: "Weather unavailable" } as WeatherState);
      });
    } catch {
      state = { status: "error", message: "Weather unavailable" };
    }
    cache.set(key, { state, at: now });
    return state;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, operation);
  return operation;
}

export const openMeteoWeatherProvider: WeatherProvider = {
  getWeather: (request) => fetchCurrentWeather(request),
};

// One side of Here & There: saved coordinates win, otherwise the place name is
// geocoded first. A name that cannot be resolved reports an error instead of
// pretending the place was never set.
export async function loadWeatherState(
  target: { label: string | null; coordinates: Coordinates | null },
  fetcher: typeof fetch | undefined = globalThis.fetch,
  now: number = Date.now(),
  timeoutMs: number = AUX_REQUEST_TIMEOUT_MS,
): Promise<WeatherState> {
  if (target.coordinates)
    return fetchCurrentWeather(
      { coordinates: target.coordinates, timezone: "UTC" },
      fetcher,
      now,
      timeoutMs,
    );
  const name = target.label?.trim();
  if (!name) return { status: "not-configured" };
  // The name lookup and the weather request share one deadline, so a caller never waits longer than it.
  const started = Date.now();
  const match = await lookupPlace(name, fetcher, now, timeoutMs);
  if (!match) return { status: "error", message: "Weather unavailable" };
  return fetchCurrentWeather(
    { coordinates: match.coordinates, timezone: match.timezone ?? "UTC" },
    fetcher,
    now,
    Math.max(1, timeoutMs - (Date.now() - started)),
  );
}
