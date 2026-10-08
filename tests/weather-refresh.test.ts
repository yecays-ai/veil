import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";
import { WEATHER_CACHE_MS, WEATHER_ERROR_CACHE_MS, clearWeatherCache } from "../lib/weather";
import { weatherRefreshDelay } from "../components/widgets/use-weather";

type Plan = "ok" | "fail" | "hang";
async function harness(context: TestContext) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) install(name, dom.window[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  clearWeatherCache();
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const calls: string[] = [];
  const hanging: Array<(response: Response) => void> = [];
  let temperature = 10;
  const plan = { current: "ok" as Plan };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (plan.current === "fail") return new Response("no", { status: 500 });
    const body = () => new Response(JSON.stringify({ current: { temperature_2m: temperature, weather_code: 0 } }));
    if (plan.current === "hang") return new Promise<Response>((resolve) => hanging.push(() => resolve(body())));
    return body();
  }) as typeof fetch;
  const { createRoot } = await import("react-dom/client");
  const { useWeatherState } = await import("../components/widgets/use-weather");
  type Props = { places: Array<[number, number]> };
  function Probe({ places }: Props) {
    return createElement("div", null, places.map(([lat, lon], index) =>
      createElement(Widget, { key: index, lat, lon, index })));
  }
  function Widget({ lat, lon, index }: { lat: number; lon: number; index: number }) {
    const state = useWeatherState(null, lat, lon);
    return createElement("span", { "data-w": index }, state.status === "ready" ? `${state.temperatureC}C` : state.status);
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  const render = (places: Props["places"]) => act(async () => { root.render(createElement(Probe, { places })); });
  const advance = async (ms: number) => { await act(async () => { context.mock.timers.tick(ms); }); await flush(); };
  const texts = () => [...dom.window.document.querySelectorAll("span")].map((el) => el.textContent);
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    globalThis.fetch = realFetch; clearWeatherCache(); dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { calls, hanging, plan, render, advance, flush, texts, root, cleanup,
    setTemperature: (value: number) => { temperature = value; },
    unmount: () => act(async () => { root.unmount(); }) };
}
const CHENGDU: [number, number] = [30.67, 104.07];
const PARIS: [number, number] = [48.85, 2.35];

regressionContract("weather.mounted-expiry-refresh", "async-race-safety",
  "mounted Weather reuses a fresh cache, refreshes once at expiry and dedupes shared widgets", async (t) => {
    const h = await harness(t);
    try {
      await h.render([CHENGDU, CHENGDU]); await h.flush();
      assert.deepEqual(h.texts(), ["10C", "10C"]);
      assert.equal(h.calls.length, 1, "two widgets share one request");
      h.setTemperature(21);
      await h.advance(WEATHER_CACHE_MS - 5000);
      assert.equal(h.calls.length, 1, "fresh cache is reused");
      assert.deepEqual(h.texts(), ["10C", "10C"]);
      await h.advance(5000);
      assert.equal(h.calls.length, 2, "one refresh for both widgets at expiry");
      assert.deepEqual(h.texts(), ["21C", "21C"]);
      await h.advance(WEATHER_CACHE_MS);
      assert.equal(h.calls.length, 3, "keeps refreshing while mounted");
    } finally { await h.cleanup(); }
  });

regressionContract("weather.failure-bounded-retry", "async-race-safety",
  "failed refresh keeps the last reading and retries with bounded backoff", async (t) => {
    const h = await harness(t);
    try {
      await h.render([CHENGDU]); await h.flush();
      assert.deepEqual(h.texts(), ["10C"]);
      h.plan.current = "fail";
      await h.advance(WEATHER_CACHE_MS);
      assert.equal(h.calls.length, 2);
      assert.deepEqual(h.texts(), ["10C"], "stale reading survives the failure");
      // Backoff 60s, 120s, 240s; nothing fires early.
      await h.advance(WEATHER_ERROR_CACHE_MS - 1); assert.equal(h.calls.length, 2);
      await h.advance(1); assert.equal(h.calls.length, 3);
      await h.advance(2 * WEATHER_ERROR_CACHE_MS - 1); assert.equal(h.calls.length, 3);
      await h.advance(1); assert.equal(h.calls.length, 4);
      await h.advance(4 * WEATHER_ERROR_CACHE_MS); assert.equal(h.calls.length, 5);
      // After the quick retries the cadence is the normal cache lifetime, never faster.
      await h.advance(WEATHER_CACHE_MS - 1); assert.equal(h.calls.length, 5);
      await h.advance(1); assert.equal(h.calls.length, 6);
      // Recovery shows fresh data and returns to the healthy cadence.
      h.plan.current = "ok"; h.setTemperature(7);
      await h.advance(WEATHER_CACHE_MS);
      assert.deepEqual(h.texts(), ["7C"]);
      const before = h.calls.length;
      await h.advance(WEATHER_CACHE_MS - 1); assert.equal(h.calls.length, before);
    } finally { await h.cleanup(); }
  });

regressionContract("weather.lifecycle-guards", "async-race-safety",
  "unmount, place change and late responses neither refresh nor overwrite newer data", async (t) => {
    const h = await harness(t);
    try {
      // Place change while the old request is still in flight: the late response is ignored.
      h.plan.current = "hang";
      await h.render([CHENGDU]); await h.flush();
      assert.deepEqual(h.texts(), ["loading"]);
      h.plan.current = "ok"; h.setTemperature(3);
      await h.render([PARIS]); await h.flush();
      assert.deepEqual(h.texts(), ["3C"]);
      await act(async () => { h.hanging.splice(0).forEach((release) => release({} as Response)); });
      await h.flush();
      assert.deepEqual(h.texts(), ["3C"], "late Chengdu response does not overwrite Paris");
      // Unmount cancels the refresh timer.
      const calls = h.calls.length;
      await h.unmount();
      await act(async () => { t.mock.timers.tick(WEATHER_CACHE_MS * 3); });
      await h.flush();
      assert.equal(h.calls.length, calls, "no request after unmount");
      // A response arriving after unmount is dropped without error.
    } finally { await h.cleanup(); }
  });

test("refresh delay is derived from the reading age and never below the floor", () => {
  const ready = { status: "ready" as const, temperatureC: 1, summary: "x", icon: "x",
    updatedAt: new Date(1_000_000).toISOString() };
  assert.equal(weatherRefreshDelay(ready, 0, 1_000_000), WEATHER_CACHE_MS);
  assert.equal(weatherRefreshDelay(ready, 0, 1_000_000 + WEATHER_CACHE_MS + 5), 1000);
  const error = { status: "error" as const, message: "x" };
  assert.deepEqual([1, 2, 3, 4, 50].map((n) => weatherRefreshDelay(error, n, 0)),
    [60000, 120000, 240000, WEATHER_CACHE_MS, WEATHER_CACHE_MS]);
});
