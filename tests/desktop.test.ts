import assert from "node:assert/strict";
import test from "node:test";
import { APP_IDS } from "../lib/app-registry";
import {
  buildOccupancy,
  canPlace,
  defaultDesktop,
  GRID_COLS,
  GRID_ROWS,
  MAX_PAGES,
  moveDesktopItem,
  normalizeDesktop,
} from "../lib/desktop-layout";
import { WIDGET_SIZES } from "../lib/widget-types";
import {
  defaultSnapshot,
  normalizeDocument,
  normalizeSnapshot,
} from "../lib/theme-types";
import { exportTheme, importTheme } from "../lib/theme-package";
import { applyPreset, deletePreset, savePreset } from "../lib/theme-presets";
import { localTime, resolveTimezone } from "../lib/participant-config";

test("default App and Widget footprints share a non-overlapping four-column grid", () => {
  const layout = defaultDesktop();
  const expected =
    layout.iconLayout.length +
    layout.widgets.reduce(
      (sum, w) => sum + WIDGET_SIZES[w.size].cols * WIDGET_SIZES[w.size].rows,
      0,
    );
  assert.equal(buildOccupancy(layout).size, expected);
  assert.deepEqual(WIDGET_SIZES["4x2"], { cols: 4, rows: 2 });
  assert.equal(GRID_COLS, 4);
});

test("moves, cross-page moves and resizes reject occupied and out-of-bounds cells", () => {
  const layout = defaultDesktop(),
    app = layout.iconLayout[0];
  assert.throws(
    () =>
      moveDesktopItem(
        layout,
        { kind: "app", id: app.id },
        { page: 1, row: 1, col: 1 },
      ),
    /occupied/,
  );
  assert.throws(
    () =>
      moveDesktopItem(
        layout,
        { kind: "widget", id: layout.widgets[0].id },
        { page: 1, row: 1, col: 1 },
        "4x2",
      ),
    /occupied/,
  );
  assert.throws(
    () =>
      moveDesktopItem(
        layout,
        { kind: "widget", id: layout.widgets[0].id },
        { page: 2, row: 6, col: 1 },
      ),
    /outside/,
  );
  const moved = moveDesktopItem(
    layout,
    { kind: "app", id: app.id },
    { page: 2, row: 6, col: 4 },
  );
  assert.deepEqual(moved.iconLayout[0], {
    id: app.id,
    page: 2,
    row: 6,
    col: 4,
  });
  const resized = moveDesktopItem(
    moved,
    { kind: "widget", id: layout.widgets[0].id },
    { page: 2, row: 1, col: 1 },
    "4x2",
  );
  assert.equal(resized.widgets[0].size, "4x2");
  assert.equal(
    canPlace(buildOccupancy(resized), { page: 2, row: 1, col: 3 }, "1x1"),
    false,
  );
});

test("normalization repairs collisions, removes unknown IDs and keeps Apps reachable", () => {
  const defaults = defaultDesktop();
  const raw = {
    ...defaults,
    iconLayout: [
      { id: APP_IDS[0], page: 1, row: 1, col: 1 },
      { id: "legacy-business-app", page: 1, row: 5, col: 1 },
    ],
    widgets: [
      ...defaults.widgets,
      { ...defaults.widgets[0], id: "another-clock" },
    ],
  };
  const layout = normalizeDesktop(raw);
  const area =
    layout.iconLayout.length +
    layout.widgets.reduce(
      (sum, w) => sum + WIDGET_SIZES[w.size].cols * WIDGET_SIZES[w.size].rows,
      0,
    );
  assert.equal(buildOccupancy(layout).size, area);
  assert.deepEqual(
    layout.iconLayout.map((a) => a.id),
    APP_IDS,
  );
  assert.deepEqual(normalizeDesktop(layout), layout);
  const full = normalizeDesktop({
    widgets: Array.from({ length: 32 }, (_, i) => ({
      ...defaults.widgets[1],
      id: `full-${i}`,
    })),
  });
  assert.equal(full.iconLayout.length, APP_IDS.length);
  assert(buildOccupancy(full).size <= MAX_PAGES * GRID_COLS * GRID_ROWS);
});

test("old appearance snapshots and presets migrate without losing decoration or App order", () => {
  const old = {
    profile: {
      ...defaultSnapshot().profile,
      colors: { ...defaultSnapshot().profile.colors, accent: "#112233" },
    },
    iconLayout: [...APP_IDS].reverse(),
    dockLayout: APP_IDS,
  };
  const document = normalizeDocument({
    current: old,
    presets: [{ id: "old", name: "Old theme", snapshot: old }],
  });
  assert.equal(document.current.profile.colors.accent, "#112233");
  assert.equal(document.current.iconLayout[0].id, APP_IDS.at(-1));
  assert.equal(document.current.widgets.length, 2);
  assert.deepEqual(document.presets[0].snapshot, document.current);
});

test("theme packages and presets round-trip positions, sizes and config without identity data", () => {
  const current = {
    ...defaultSnapshot(),
    ...moveDesktopItem(
      defaultDesktop(),
      { kind: "widget", id: "clock-default" },
      { page: 2, row: 2, col: 1 },
      "4x2",
    ),
  };
  const exported = exportTheme({
    ...current,
    user: { name: "private" },
    character: { name: "private" },
  } as typeof current);
  assert(!exported.includes("private"));
  assert.deepEqual(importTheme(exported), current);
  const document = savePreset(
    { version: 1, current, presets: [] },
    "Desktop",
    current,
  );
  const applied = applyPreset(
    { ...document, current: defaultSnapshot() },
    document.presets[0].id,
  );
  assert.deepEqual(applied.current, current);
  assert.deepEqual(
    deletePreset(applied, document.presets[0].id).current,
    current,
  );
  assert.deepEqual(normalizeSnapshot(current), current);
});

test("IANA local times account for DST and invalid/unset zones have explicit device fallback", () => {
  assert.equal(
    localTime(new Date("2026-07-01T12:00:00Z"), "America/New_York"),
    "08:00",
  );
  assert.equal(
    localTime(new Date("2026-01-01T12:00:00Z"), "America/New_York"),
    "07:00",
  );
  assert.equal(
    localTime(new Date("2026-07-01T12:00:00Z"), "Asia/Tokyo"),
    "21:00",
  );
  assert.equal(resolveTimezone(null).state, "device");
  assert.equal(resolveTimezone("invalid-zone").state, "invalid");
  assert.equal(resolveTimezone("UTC").state, "configured");
});
