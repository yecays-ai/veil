import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultDesktop, normalizeDesktop } from "../lib/desktop-layout";
import {
  PLACE_ERROR_CACHE_MS,
  clearPlaceCache,
  geocodingUrl,
  lookupPlace,
  parseGeocodingResult,
  placeQueryKey,
} from "../lib/place-lookup";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import {
  WEATHER_CACHE_MS,
  WEATHER_ERROR_CACHE_MS,
  cachedWeather,
  clearWeatherCache,
  fetchCurrentWeather,
  loadWeatherState,
  openMeteoUrl,
  parseOpenMeteoCurrent,
  weatherCacheKey,
  weatherCodeSummary,
} from "../lib/weather";

const CHENGDU = {
  id: 1815286,
  name: "Chengdu",
  latitude: 30.66667,
  longitude: 104.06667,
  timezone: "Asia/Shanghai",
  admin1: "Sichuan",
  country: "China",
};
const geocodingBody = (results: unknown[]) => JSON.stringify({ results });
const weatherBody = (temperature: number, code: number) =>
  JSON.stringify({ current: { temperature_2m: temperature, weather_code: code } });

function fetcherFor(routes: { geocoding?: unknown[]; weather?: string }): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchStub: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://geocoding-api.open-meteo.com"))
      return new Response(geocodingBody(routes.geocoding ?? []), { status: 200 });
    return new Response(routes.weather ?? weatherBody(17, 3), { status: 200 });
  };
  return { fetch: fetchStub, calls };
}

test("Here & There keeps the plain time config", () => {
  assert.deepEqual(WIDGET_REGISTRY["here-there"].normalizeConfig({ hour12: true }), {
    hour12: true, showSeconds: false,
  });
  assert.deepEqual(normalizeDesktop(defaultDesktop()).widgets, defaultDesktop().widgets);
});

test("geocoding turns a typed location name into weather coordinates", () => {
  assert.equal(placeQueryKey("  New   York "), "new york");
  const url = geocodingUrl("Chengdu");
  assert.match(url, /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?/);
  assert.match(url, /name=Chengdu/);
  assert.match(url, /count=1/);
  assert.doesNotMatch(url, /key|token|secret/i);
  assert.deepEqual(parseGeocodingResult({ results: [CHENGDU] }), {
    label: "Chengdu",
    detail: "Sichuan, China",
    coordinates: { latitude: 30.66667, longitude: 104.06667 },
    timezone: "Asia/Shanghai",
  });
  assert.equal(parseGeocodingResult({ results: [] }), null);
  assert.equal(parseGeocodingResult({}), null);
  assert.equal(parseGeocodingResult({ results: [{ name: "Nowhere" }] }), null);
  assert.equal(
    parseGeocodingResult({ results: [{ ...CHENGDU, latitude: 999 }] }),
    null,
  );
});

test("an unknown or failed place lookup resolves to null and is cached", async () => {
  clearPlaceCache();
  const { fetch: stub, calls } = fetcherFor({ geocoding: [] });
  assert.equal(await lookupPlace("Nowhereville", stub, 0), null);
  assert.equal(calls.length, 1);
  assert.equal(await lookupPlace("Nowhereville", stub, PLACE_ERROR_CACHE_MS - 1), null);
  assert.equal(calls.length, 1);

  const offline: typeof fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await lookupPlace("Chengdu", offline, 0), null);
});

test("Here & There weather comes from the saved profile location", async () => {
  clearWeatherCache();
  clearPlaceCache();
  const { fetch: stub } = fetcherFor({ geocoding: [CHENGDU] });
  // 1. A profile with only a location name is geocoded before the weather call.
  const named = await loadWeatherState(
    { label: "Chengdu", coordinates: null },
    stub,
    1000,
  );
  assert.deepEqual(named, {
    status: "ready",
    temperatureC: 17,
    summary: "Overcast",
    icon: "☁️",
    updatedAt: new Date(1000).toISOString(),
  });
  assert.ok(cachedWeather({ latitude: 30.66667, longitude: 104.06667 }, 1000));
  // 2. A profile that already stores coordinates skips geocoding entirely.
  const stored = await loadWeatherState(
    { label: "Chengdu", coordinates: { latitude: 30.66667, longitude: 104.06667 } },
    stub,
    2000,
  );
  assert.equal(stored.status, "ready");
  // 3. No location at all stays a quiet, concise unavailable state.
  assert.deepEqual(await loadWeatherState({ label: null, coordinates: null }, stub, 0), {
    status: "not-configured",
  });
  assert.deepEqual(await loadWeatherState({ label: "  ", coordinates: null }, stub, 0), {
    status: "not-configured",
  });
});

test("an unresolvable profile location reports unavailable instead of empty", async () => {
  clearWeatherCache();
  clearPlaceCache();
  const { fetch: stub } = fetcherFor({ geocoding: [] });
  assert.deepEqual(
    await loadWeatherState({ label: "Nowhereville", coordinates: null }, stub, 0),
    { status: "error", message: "Weather unavailable" },
  );
  const offline: typeof fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(
    (await loadWeatherState({ label: "New York", coordinates: null }, offline, 0)).status,
    "error",
  );
  assert.equal(
    (
      await loadWeatherState(
        { label: null, coordinates: { latitude: 1, longitude: 2 } },
        offline,
        0,
      )
    ).status,
    "error",
  );
});

test("weather codes become a short label with an icon", () => {
  assert.deepEqual(weatherCodeSummary(0), { label: "Clear", icon: "☀️" });
  assert.equal(weatherCodeSummary(3).label, "Overcast");
  assert.equal(weatherCodeSummary(95).label, "Thunderstorm");
  assert.equal(weatherCodeSummary(1234).label, "Weather");
  assert.equal(weatherCodeSummary("nope").label, "Weather");
  assert.equal(weatherCodeSummary(undefined).label, "Weather");
});

test("the Open-Meteo request only needs saved coordinates", () => {
  const url = openMeteoUrl({ latitude: 31.23, longitude: 121.47 });
  assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(url, /latitude=31\.23/);
  assert.match(url, /longitude=121\.47/);
  assert.match(url, /current=temperature_2m%2Cweather_code/);
  assert.match(url, /temperature_unit=celsius/);
  assert.doesNotMatch(url, /key|token|secret/i);
});

test("a successful reading is rounded, cached and refreshed only when stale", async () => {
  clearWeatherCache();
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(weatherBody(21.6, 3), { status: 200 });
  };
  const coordinates = { latitude: 1.5, longitude: 2.5 };
  const request = { coordinates };
  const first = await fetchCurrentWeather(request, fetcher, 1000);
  assert.deepEqual(first, {
    status: "ready",
    temperatureC: 22,
    summary: "Overcast",
    icon: "☁️",
    updatedAt: new Date(1000).toISOString(),
  });
  assert.equal(calls.length, 1);
  assert.equal(await fetchCurrentWeather(request, fetcher, 2000), first);
  assert.equal(calls.length, 1);
  assert.equal(cachedWeather(coordinates, 1000 + WEATHER_CACHE_MS - 1), first);
  assert.equal(cachedWeather(coordinates, 1000 + WEATHER_CACHE_MS + 1), null);
  assert.equal(weatherCacheKey(coordinates), "1.50,2.50");
});

test("failures fall back to an error state without throwing", async () => {
  clearWeatherCache();
  const offline: typeof fetch = async () => {
    throw new Error("offline");
  };
  const coordinates = { latitude: 3.5, longitude: 4.5 };
  const failed = await fetchCurrentWeather(
    { coordinates },
    offline,
    5000,
  );
  assert.deepEqual(failed, { status: "error", message: "Weather unavailable" });
  assert.deepEqual(cachedWeather(coordinates, 5000 + WEATHER_ERROR_CACHE_MS - 1), failed);
  assert.equal(cachedWeather(coordinates, 5000 + WEATHER_ERROR_CACHE_MS + 1), null);

  const serverError: typeof fetch = async () => new Response("nope", { status: 500 });
  assert.equal(
    (
      await fetchCurrentWeather(
        { coordinates: { latitude: 5.5, longitude: 6.5 } },
        serverError,
        0,
      )
    ).status,
    "error",
  );
  // Missing fetcher (for example a non-browser render) is still graceful and
  // must not leak onto Node's real global network implementation.
  const originalFetch = globalThis.fetch;
  let globalFetchCalls = 0;
  globalThis.fetch = async () => {
    globalFetchCalls += 1;
    return new Response(JSON.stringify({ current: { temperature_2m: 22, weather_code: 0 } }));
  };
  try {
    assert.equal(
      (
        await fetchCurrentWeather(
          { coordinates: { latitude: 7.5, longitude: 8.5 } },
          undefined,
          0,
        )
      ).status,
      "error",
    );
    assert.equal(globalFetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(parseOpenMeteoCurrent({}, 0).status, "error");
  assert.equal(parseOpenMeteoCurrent({ current: { temperature_2m: "x" } }, 0).status, "error");
});

test("Here & There owns no place state and asks for no device location", () => {
  const widget = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  const hook = readFileSync("components/widgets/use-weather.ts", "utf8");
  const css = readFileSync("app/desktop.css", "utf8");
  assert.deepEqual(Object.keys(WIDGET_REGISTRY).sort(), ["clock", "here-there"]);
  // Locations come from the profiles, never from widget config or geolocation.
  assert.match(widget, /document\.user\.location\?\.label/);
  assert.match(widget, /character\?\.location\?\.label/);
  assert.match(widget, /character\?\.location\?\.coordinates\?\.latitude/);
  assert.doesNotMatch(widget, /geolocation|widget\.config\.here|widget\.config\.there/);
  assert.doesNotMatch(widget, /<input/);
  assert.match(hook, /loadWeatherState\(/);
  assert.doesNotMatch(css, /here-there-places/);
});
