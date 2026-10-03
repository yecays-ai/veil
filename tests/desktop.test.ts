import assert from "node:assert/strict";
import test from "node:test";
import { APP_IDS } from "../lib/app-registry";
import {
  buildOccupancy,
  canPlace,
  defaultDesktop,
  deleteEmptyDesktopPage,
  GRID_COLS,
  GRID_ROWS,
  MAX_PAGES,
  moveDesktopItem,
  moveDesktopItemToCell,
  normalizeDesktop,
} from "../lib/desktop-layout";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { WIDGET_SIZES } from "../lib/widget-types";
import {
  defaultSnapshot,
  normalizeDocument,
  normalizeSnapshot,
} from "../lib/theme-types";
import { exportTheme, importTheme } from "../lib/theme-package";
import { applyPreset, deletePreset, savePreset } from "../lib/theme-presets";
import { localTime, resolveTimezone } from "../lib/participant-config";

function desktopWithClock() {
  const layout = defaultDesktop();
  return {
    ...layout,
    iconLayout: APP_IDS.map((id, index) => ({
      id,
      page: 1,
      row: index < 4 ? 1 + Math.floor(index / 2) : 5,
      col: index < 4 ? 3 + (index % 2) : index - 3,
    })),
    widgets: [
      {
        id: "clock-default",
        type: "clock" as const,
        size: "2x2" as const,
        page: 1,
        row: 1,
        col: 1,
        config: { hour12: false, showSeconds: false },
      },
      { ...layout.widgets[0], row: 3 },
    ],
  };
}

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
  assert(!layout.widgets.some((w) => w.type === "clock"));
  assert(WIDGET_REGISTRY.clock);
  assert(
    normalizeDesktop(desktopWithClock()).widgets.some(
      (w) => w.type === "clock",
    ),
  );
});

test("default Messages is Dock-only while saved shortcuts and removals survive normalization", () => {
  const defaults = defaultSnapshot();
  assert(defaults.dockLayout.includes("messages"));
  assert(!defaults.iconLayout.some((app) => app.id === "messages"));
  const legacy = {
    ...defaults,
    iconLayout: [
      { id: "messages" as const, page: 1, row: 3, col: 1 },
      ...defaults.iconLayout,
    ],
  };
  assert.deepEqual(normalizeSnapshot(legacy), legacy);
  const removed = {
    ...legacy,
    iconLayout: legacy.iconLayout.filter((app) => app.id !== "appearance"),
  };
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify({ current: removed })));
  assert.deepEqual(reloaded.current, removed);
  assert.deepEqual(reloaded.current.dockLayout, legacy.dockLayout);
  assert.deepEqual(reloaded.current.widgets, legacy.widgets);
  const empty = normalizeSnapshot({ ...removed, iconLayout: [] });
  assert.deepEqual(empty.iconLayout, []);
  assert.deepEqual(normalizeSnapshot(empty), empty);
  assert(APP_IDS.includes("appearance"));
  assert(APP_IDS.includes("messages"));
});

test("deleting an empty page only renumbers subsequent pages and survives reload", () => {
  const initial = defaultSnapshot();
  const layout = {
    ...initial,
    pageCount: 3,
    widgets: initial.widgets.map((widget) => ({ ...widget, page: 3 })),
  };
  const deleted = { ...layout, ...deleteEmptyDesktopPage(layout, 2) };
  assert.equal(deleted.pageCount, 2);
  assert.deepEqual(deleted.iconLayout, layout.iconLayout);
  assert.deepEqual(deleted.widgets, layout.widgets.map((widget) => ({ ...widget, page: 2 })));
  assert.deepEqual(deleted.dockLayout, layout.dockLayout);
  assert.deepEqual(normalizeSnapshot(JSON.parse(JSON.stringify(deleted))), deleted);
  assert.equal(layout.pageCount, 3);
  assert.equal(layout.widgets[0].page, 3);
  assert.throws(() => deleteEmptyDesktopPage(layout, 1), /empty/);
  assert.throws(() => deleteEmptyDesktopPage(layout, 3), /empty/);
  assert.throws(() => deleteEmptyDesktopPage(layout, 0), /not found/);
  assert.throws(() => deleteEmptyDesktopPage(layout, 4), /not found/);
  assert.throws(() => deleteEmptyDesktopPage(layout, 1.5), /not found/);
  const firstEmpty = { ...layout, iconLayout: [] };
  assert.equal(deleteEmptyDesktopPage(firstEmpty, 1).widgets[0].page, 2);
  const single = { ...initial, ...deleteEmptyDesktopPage(initial, 2) };
  assert.equal(single.pageCount, 1);
  assert.deepEqual(single.iconLayout, initial.iconLayout);
  assert.deepEqual(single.widgets, initial.widgets);
  assert.deepEqual(normalizeSnapshot(single), single);
  assert.throws(() => deleteEmptyDesktopPage({ ...single, iconLayout: [], widgets: [] }, 1), /last/);
});

test("moves, cross-page moves and resizes reject occupied and out-of-bounds cells", () => {
  const layout = desktopWithClock(),
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

test("4x2 placement uses an in-bounds anchor before and after the 2x2 resize workaround", () => {
  const original = defaultDesktop();
  const item = { kind: "widget" as const, id: original.widgets[0].id };
  // Rows 5 and 6 are empty across all four columns. The user targets a
  // cell inside that rectangle, rather than precisely its top-left corner.
  const destination = { page: 1, row: 5, col: 2 };
  assert(canPlace(buildOccupancy(original), { ...destination, col: 1 }, "4x2"));
  const direct = moveDesktopItemToCell(original, item, destination);
  assert.deepEqual(direct.widgets[0], {
    ...original.widgets[0], row: 5, col: 1,
  });

  const small = moveDesktopItem(original, item, original.widgets[0], "2x2");
  // The reported workaround targets the leftmost cell in the same region.
  const movedSmall = moveDesktopItemToCell(small, item, {
    ...destination, col: 1,
  });
  const restored = moveDesktopItem(movedSmall, item, movedSmall.widgets[0], "4x2");
  assert.deepEqual(restored.widgets[0], direct.widgets[0]);
  for (const col of [1, 2, 3, 4]) {
    const movedBack = moveDesktopItemToCell(restored, item, { page: 1, row: 1, col });
    assert.deepEqual(movedBack.widgets[0], original.widgets[0]);
    // Moving within the current footprint must not collide with itself;
    // the last row resolves to the last in-bounds two-row anchor.
    const samePlace = moveDesktopItemToCell(restored, item, { page: 1, row: 6, col });
    assert.deepEqual(samePlace.widgets[0], restored.widgets[0]);
  }
  assert.deepEqual(direct.iconLayout, original.iconLayout);
  assert.deepEqual(original, defaultDesktop());
});

test("cell placement preserves 2x2 and app moves and rejects full-footprint collisions", () => {
  const original = defaultDesktop();
  const item = { kind: "widget" as const, id: original.widgets[0].id };
  const small = moveDesktopItem(original, item, original.widgets[0], "2x2");
  const moved = moveDesktopItemToCell(small, item, { page: 1, row: 6, col: 4 });
  assert.equal(moved.widgets[0].row, 5);
  assert.equal(moved.widgets[0].col, 3);
  // Resizing still validates the existing anchor, without moving the widget.
  assert.throws(() => moveDesktopItem(moved, item, moved.widgets[0], "4x2"), /outside/);
  const app = { kind: "app" as const, id: original.iconLayout[0].id };
  const appMove = moveDesktopItemToCell(original, app, { page: 1, row: 6, col: 4 });
  assert.deepEqual(appMove.iconLayout[0], { id: app.id, page: 1, row: 6, col: 4 });
  // A blocker in the far corner must fail, even though the anchor is empty.
  assert.throws(() => moveDesktopItemToCell(appMove, item, { page: 1, row: 5, col: 2 }), /occupied/);
  assert.deepEqual(appMove.widgets, original.widgets);
  assert.throws(() => moveDesktopItemToCell(original, item, { page: 1, row: 7, col: 1 }), /outside/);
  assert.throws(() => moveDesktopItemToCell(original, item, { page: 1, row: 5, col: 0 }), /outside/);
  const crossPage = moveDesktopItemToCell(original, item, { page: 2, row: 6, col: 4 });
  assert.deepEqual(crossPage.widgets[0], { ...original.widgets[0], page: 2, row: 5, col: 1 });
});

test("normalization repairs collisions and removes unknown IDs without adding shortcuts", () => {
  const defaults = desktopWithClock();
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
    [APP_IDS[0]],
  );
  assert.deepEqual(normalizeDesktop(layout), layout);
  const full = normalizeDesktop({
    widgets: Array.from({ length: 32 }, (_, i) => ({
      ...defaults.widgets[1],
      id: `full-${i}`,
    })),
  });
  assert.equal(full.iconLayout.length, defaultDesktop().iconLayout.length);
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
  assert.equal(document.current.widgets.length, 1);
  assert.deepEqual(document.presets[0].snapshot, document.current);
});

test("theme packages and presets round-trip positions, sizes and config without identity data", () => {
  const current = {
    ...defaultSnapshot(),
    ...moveDesktopItem(
      desktopWithClock(),
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
