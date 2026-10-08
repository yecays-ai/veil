import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { bindHereThereCharacter, resolveHereThereCharacter } from "../lib/here-there-binding";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { normalizeDocument } from "../lib/theme-types";
import { browserThemeStorage } from "../lib/theme-storage";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { loadWeatherState, clearWeatherCache } from "../lib/weather";
import { localTime, resolveTimezone } from "../lib/participant-config";

function foundation() {
  return { ...defaultFoundation(), characters: [
    { ...normalizeCharacterInput({ name: "A", timezone: "Asia/Shanghai",
      location: { label: "Chengdu", coordinates: { latitude: 30.66, longitude: 104.06 } } }), characterId: "a" },
    { ...normalizeCharacterInput({ name: "B", timezone: "America/New_York",
      location: { label: "New York", coordinates: { latitude: 40.71, longitude: -74 } } }), characterId: "b" },
  ] };
}

test("Here & There normalization retains only time flags and a Character ID", () => {
  const normalize = WIDGET_REGISTRY["here-there"].normalizeConfig;
  assert.deepEqual(normalize({ hour12: true, characterId: "a",
    here: { label: "Old place" }, there: { timezone: "UTC" } }),
    { hour12: true, showSeconds: false, characterId: "a" });
  assert.deepEqual(normalize({}), { hour12: false, showSeconds: false });
  assert.deepEqual(WIDGET_REGISTRY.clock.normalizeConfig({ characterId: "a" }),
    { hour12: false, showSeconds: false });
});

test("explicit widget bindings persist independently across Theme reload", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { indexedDB: new IDBFactory(), localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  } } });
  try {
    const document = foundation();
    let theme = bindHereThereCharacter(normalizeDocument(null), "here-there-default", "a");
    assert.equal(resolveHereThereCharacter(theme.current.widgets[0].config, document)?.characterId, "a");
    theme.current.widgets.push({ ...theme.current.widgets[0], id: "second", page: 2 });
    theme = bindHereThereCharacter(theme, "second", "b");
    await browserThemeStorage.save(normalizeDocument(theme));
    theme = await browserThemeStorage.load();
    assert.equal(theme.current.widgets[0].config.characterId, "a");
    assert.equal(theme.current.widgets[1].config.characterId, "b");
    assert.equal(resolveHereThereCharacter(theme.current.widgets[0].config, document)?.characterId, "a");
    assert.deepEqual(bindHereThereCharacter(theme, "missing-widget", "b"), theme);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("choosing B updates only its widget and resolves B's profile time and weather", async () => {
  clearWeatherCache();
  const document = foundation();
  const original = normalizeDocument(null);
  const changed = normalizeDocument(bindHereThereCharacter(original, original.current.widgets[0].id, "b"));
  const character = resolveHereThereCharacter(changed.current.widgets[0].config, document)!;
  assert.equal(character.name, "B");
  assert.equal(character.location?.label, "New York");
  assert.equal(localTime(new Date("2026-10-05T12:00:00Z"), resolveTimezone(character.timezone).timezone, false, false), "08:00");
  const calls: string[] = [];
  const weather = await loadWeatherState(character.location!, async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ current: { temperature_2m: 20, weather_code: 0 } }));
  }, 0);
  assert.equal(weather.status, "ready");
  assert.match(calls[0], /latitude=40\.71/);
  assert.match(calls[0], /longitude=-74/);
  assert.deepEqual(changed.current.profile, original.current.profile);
  assert.equal(document.user.location, null);
});

test("invalid or deleted explicit bindings never silently select a different Character", () => {
  const document = foundation();
  assert.equal(resolveHereThereCharacter({ hour12: false, showSeconds: false, characterId: "deleted" }, document), undefined);
  assert.equal(resolveHereThereCharacter({ hour12: false, showSeconds: false, characterId: "a" },
    { ...document, characters: document.characters.filter((item) => item.characterId !== "a") }), undefined);
  assert.equal(resolveHereThereCharacter({ hour12: false, showSeconds: false },
    { ...document, characters: [] }), undefined);
});

test("Character name picker commits the instance binding while weather continues using profiles", () => {
  const source = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  assert.match(source, /onChooseCharacter=\{\(\) => setPickerOpen\(true\)\}/);
  assert.match(source, /bindHereThereCharacter\(theme, widget\.id, characterId\)/);
  assert.match(source, /document\.characters\.map/);
  assert.match(source, /aria-pressed=\{character\?\.characterId === item\.characterId\}/);
  assert.match(source, /setPickerOpen\(false\)/);
  assert.doesNotMatch(source, /geolocation|Places|widget\.config\.(here|there)/);
});

test("picker touch focus suppression is local and keyboard interaction restores visible focus", () => {
  const source = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  const css = readFileSync("app/desktop.css", "utf8");
  assert.match(source, /data-input-modality=\{inputModality\}/);
  assert.match(source, /event\.pointerType === "touch"/);
  assert.match(source, /onKeyDownCapture=.*touchInteraction\.current = false; setInputModality\("keyboard"\)/);
  assert.match(source, /window\.addEventListener\("keydown", keyboardInteraction, true\)/);
  assert.match(source, /window\.removeEventListener\("keydown", keyboardInteraction, true\)/);
  assert.match(source, /touchInteraction\.current && focused instanceof HTMLElement && focused\.closest\("\.desktop-home"\)\) focused\.blur\(\)/);
  assert.match(css, /\.here-there-widget\[data-input-modality="touch"\] :focus-visible \{ outline: none; \}/);
  assert.match(css, /\.desktop-home :focus-visible \{\s*outline: 2px solid/);
});
