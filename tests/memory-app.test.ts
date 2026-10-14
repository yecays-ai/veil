import assert from "node:assert/strict";
import test from "node:test";
import { APP_IDS, APP_REGISTRY } from "../lib/app-registry";
import { addAppToDesktop, defaultDesktop, normalizeDesktop } from "../lib/desktop-layout";
import { countActiveMemories, isActiveMemory } from "../lib/memory/bank";
import type { Memory } from "../lib/memory/types";

const row = (over: Partial<Memory>) => ({ status: "active", origin: "auto", ...over }) as Memory;

test("Memory App: Active counts long-term memories only, never Journal, superseded or archived", () => {
  const rows = [row({}), row({ origin: "manual" }), row({ origin: "journal" }), row({ status: "superseded" }),
    row({ status: "archived" }), row({ status: "flagged" })];
  assert.equal(countActiveMemories(rows), 2);
  assert.equal(isActiveMemory(row({ origin: "journal" })), false);
  assert.equal(countActiveMemories([]), 0);
});

test("Memory App: registered with its route; new installs get it on the Home screen", () => {
  assert.deepEqual(APP_REGISTRY.find((app) => app.id === "memory"), { id: "memory", label: "Memory", href: "/memory", glyph: "◈" });
  assert.ok(defaultDesktop().iconLayout.some((app) => app.id === "memory"));
});

test("Memory App: a saved Home layout without it is not rewritten; it stays available to add", () => {
  const saved = defaultDesktop();
  const old = { ...saved, iconLayout: saved.iconLayout.filter((app) => app.id !== "memory") };
  const normalized = normalizeDesktop(JSON.parse(JSON.stringify(old)));
  assert.equal(normalized.iconLayout.some((app) => app.id === "memory"), false);
  assert.ok(APP_IDS.includes("memory"));
  const added = addAppToDesktop(normalized, "memory", 1);
  assert.ok(added.iconLayout.some((app) => app.id === "memory"));
});
