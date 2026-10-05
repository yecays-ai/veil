import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultDesktop, normalizeDesktop } from "../lib/desktop-layout";
import { resolveParticipantPlace, type ParticipantConfig } from "../lib/participant-config";
import { defaultSnapshot, normalizeSnapshot } from "../lib/theme-types";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { normalizeWidgetPlace, type WidgetPlace } from "../lib/widget-types";
import {
  WEATHER_CACHE_MS,
  WEATHER_ERROR_CACHE_MS,
  cachedWeather,
  clearWeatherCache,
  fetchCurrentWeather,
  openMeteoUrl,
  parseOpenMeteoCurrent,
  weatherCacheKey,
  weatherCodeSummary,
} from "../lib/weather";

const hereThere = WIDGET_REGISTRY["here-there"];

const shanghai: WidgetPlace = {
  label: "Shanghai",
  latitude: 31.23,
  longitude: 121.47,
  timezone: "Asia/Shanghai",
};

test("legacy Here & There configs stay valid and keep their exact shape", () => {
  // Unset places stay omitted, so loading Home never rewrites legacy layouts.
  assert.deepEqual(hereThere.normalizeConfig({ hour12: true, showSeconds: true }), {
    hour12: true, showSeconds: true,
  });
  assert.deepEqual(hereThere.normalizeConfig(undefined), {
    hour12: false, showSeconds: false,
  });
  assert.deepEqual(hereThere.normalizeConfig({ hour12: true, here: null }), {
    hour12: true, showSeconds: false,
  });
  assert.deepEqual(hereThere.normalizeConfig({ here: shanghai }), {
    hour12: false, showSeconds: false, here: shanghai,
  });
  // Clock keeps its own config shape: no place fields leak across types.
  assert.deepEqual(WIDGET_REGISTRY.clock.normalizeConfig({ hour12: true }), {
    hour12: true, showSeconds: false,
  });
  const legacy = defaultDesktop();
  legacy.widgets[0].config = { hour12: false, showSeconds: false };
  const reloaded = normalizeDesktop(JSON.parse(JSON.stringify(legacy)));
  assert.equal(reloaded.widgets.length, 1);
  assert.equal(reloaded.widgets[0].type, "here-there");
  assert.deepEqual(reloaded.widgets[0].config, {
    hour12: false, showSeconds: false,
  });
});

test("saved places survive the layout document round trip", () => {
  const widgets = [{
    ...defaultDesktop().widgets[0],
    config: {
      hour12: true,
      showSeconds: false,
      here: shanghai,
      there: { label: "", latitude: null, longitude: null, timezone: "UTC" },
    },
  }];
  const snapshot = normalizeSnapshot({ ...defaultSnapshot(), widgets });
  assert.deepEqual(snapshot.widgets[0].config.here, shanghai);
  assert.deepEqual(snapshot.widgets[0].config.there, {
    label: "", latitude: null, longitude: null, timezone: "UTC",
  });
  assert.equal(snapshot.widgets[0].config.hour12, true);
});

test("partial, out-of-range and invalid place fields are dropped safely", () => {
  assert.equal(normalizeWidgetPlace(null), null);
  assert.equal(normalizeWidgetPlace({}), null);
  assert.equal(normalizeWidgetPlace({ label: "   " }), null);
  assert.equal(normalizeWidgetPlace({ latitude: 999, longitude: 13.4 }), null);
  assert.deepEqual(
    normalizeWidgetPlace({ label: "Berlin", latitude: 52.52, longitude: 999 }),
    { label: "Berlin", latitude: null, longitude: null, timezone: null },
  );
  assert.deepEqual(normalizeWidgetPlace({ label: "Berlin", latitude: 52.52, longitude: 13.4 }), {
    label: "Berlin", latitude: 52.52, longitude: 13.4, timezone: null,
  });
  assert.deepEqual(normalizeWidgetPlace({ label: "Nowhere", timezone: "Mars/Olympus" }), {
    label: "Nowhere", latitude: null, longitude: null, timezone: null,
  });
});

test("a widget place overrides the profile field by field", () => {
  const profile: ParticipantConfig = {
    name: "A",
    location: { label: "Kyoto", coordinates: { latitude: 35, longitude: 135.8 } },
    timezone: "Asia/Tokyo",
  };
  assert.deepEqual(resolveParticipantPlace(null, profile), {
    label: "Kyoto",
    timezone: "Asia/Tokyo",
    coordinates: { latitude: 35, longitude: 135.8 },
  });
  // Label-only override keeps the profile's timezone and weather coordinates.
  assert.deepEqual(
    resolveParticipantPlace(
      { label: "Osaka", latitude: null, longitude: null, timezone: null },
      profile,
    ),
    { label: "Osaka", timezone: "Asia/Tokyo", coordinates: { latitude: 35, longitude: 135.8 } },
  );
  // Weather coordinates override without touching the timezone concept.
  assert.deepEqual(
    resolveParticipantPlace(
      { label: "", latitude: 64.15, longitude: -21.94, timezone: null },
      profile,
    ),
    { label: "Kyoto", timezone: "Asia/Tokyo", coordinates: { latitude: 64.15, longitude: -21.94 } },
  );
  assert.deepEqual(resolveParticipantPlace(shanghai, profile), {
    label: "Shanghai",
    timezone: "Asia/Shanghai",
    coordinates: { latitude: 31.23, longitude: 121.47 },
  });
  assert.deepEqual(
    resolveParticipantPlace(null, { name: "B", location: null, timezone: null }),
    { label: null, timezone: null, coordinates: null },
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
    return new Response(
      JSON.stringify({ current: { temperature_2m: 21.6, weather_code: 3 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const coordinates = { latitude: 1.5, longitude: 2.5 };
  const request = { coordinates, timezone: "UTC" };
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

test("concurrent requests for the same place share one fetch", async () => {
  clearWeatherCache();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ current: { temperature_2m: 5, weather_code: 0 } }), {
      status: 200,
    });
  };
  const request = { coordinates: { latitude: 9.5, longitude: 10.5 }, timezone: "UTC" };
  const [a, b] = await Promise.all([
    fetchCurrentWeather(request, fetcher, 0),
    fetchCurrentWeather(request, fetcher, 0),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.status, "ready");
});

test("failures fall back to an error state without throwing or hammering", async () => {
  clearWeatherCache();
  const offline: typeof fetch = async () => {
    throw new Error("offline");
  };
  const coordinates = { latitude: 3.5, longitude: 4.5 };
  const failed = await fetchCurrentWeather(
    { coordinates, timezone: "UTC" },
    offline,
    5000,
  );
  assert.deepEqual(failed, { status: "error", message: "Weather unavailable" });
  assert.deepEqual(cachedWeather(coordinates, 5000 + WEATHER_ERROR_CACHE_MS - 1), failed);
  assert.equal(cachedWeather(coordinates, 5000 + WEATHER_ERROR_CACHE_MS + 1), null);

  const serverError: typeof fetch = async () => new Response("nope", { status: 500 });
  assert.equal(
    (await fetchCurrentWeather(
      { coordinates: { latitude: 5.5, longitude: 6.5 }, timezone: "UTC" },
      serverError,
      0,
    )).status,
    "error",
  );
  // Missing fetcher (for example a non-browser render) is still graceful.
  assert.equal(
    (await fetchCurrentWeather(
      { coordinates: { latitude: 7.5, longitude: 8.5 }, timezone: "UTC" },
      undefined,
      0,
    )).status,
    "error",
  );
  assert.equal(parseOpenMeteoCurrent({}, 0).status, "error");
  assert.equal(parseOpenMeteoCurrent({ current: { temperature_2m: "x" } }, 0).status, "error");
});

test("weather is part of Here & There and never asks for device location", () => {
  const widget = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  const renderer = readFileSync("components/widgets/widget-renderer.tsx", "utf8");
  assert.deepEqual(Object.keys(WIDGET_REGISTRY).sort(), ["clock", "here-there"]);
  assert.doesNotMatch(widget, /geolocation/);
  assert.match(widget, /useWeatherState\(/);
  assert.match(widget, /resolveParticipantPlace\(widget\.config\.here/);
  assert.match(widget, /resolveParticipantPlace\(widget\.config\.there/);
  assert.match(widget, /className="participant-weather"/);
  assert.doesNotMatch(widget, /status: "not-configured"/);
  assert.match(renderer, /<View widget=\{widget\} editing=\{editing\} \/>/);
});
