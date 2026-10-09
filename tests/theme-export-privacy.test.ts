import assert from "node:assert/strict";
import test from "node:test";
import { exportTheme, importTheme } from "../lib/theme-package";
import { defaultSnapshot, type ThemeSnapshot } from "../lib/theme-types";

function privateTheme(): ThemeSnapshot {
  const snapshot = structuredClone(defaultSnapshot());
  snapshot.pageCount = 3;
  snapshot.widgets = [
    { id: "here-peter", type: "here-there", size: "4x2", page: 2, row: 1, col: 1,
      config: { hour12: true, showSeconds: false, characterId: "private-peter-id",
        comment: { characterId: "private-peter-id", generatedAt: "2026-10-09T12:00:00.000Z",
          text: "D2_PRIVATE_COMMENT_PETER" } } },
    { id: "here-lan", type: "here-there", size: "2x2", page: 3, row: 2, col: 2,
      config: { hour12: false, showSeconds: true, characterId: "private-lan-id",
        comment: { characterId: "private-lan-id", generatedAt: "2026-10-09T12:01:00.000Z",
          text: "D2_PRIVATE_COMMENT_LAN" } } },
    { id: "clock", type: "clock", size: "2x2", page: 1, row: 3, col: 1,
      config: { hour12: true, showSeconds: true } },
  ];
  return snapshot;
}

test("Theme export excludes Here & There identity and comment data without changing the local snapshot", () => {
  const source = privateTheme();
  const before = structuredClone(source);

  const exported = exportTheme(source);
  const packageData = JSON.parse(exported) as { snapshot: ThemeSnapshot };

  for (const marker of ["private-peter-id", "private-lan-id", "D2_PRIVATE_COMMENT_PETER", "D2_PRIVATE_COMMENT_LAN"])
    assert.doesNotMatch(exported, new RegExp(marker));
  assert.deepEqual(source, before, "export works on a portable copy only");

  const hereThere = packageData.snapshot.widgets.filter((widget) => widget.type === "here-there");
  assert.equal(hereThere.length, 2);
  assert.deepEqual(hereThere.map((widget) => ({
    id: widget.id, size: widget.size, page: widget.page, row: widget.row, col: widget.col,
    config: widget.config,
  })), [
    { id: "here-peter", size: "4x2", page: 2, row: 1, col: 1,
      config: { hour12: true, showSeconds: false } },
    { id: "here-lan", size: "2x2", page: 3, row: 2, col: 2,
      config: { hour12: false, showSeconds: true } },
  ]);
  assert.deepEqual(packageData.snapshot.widgets.find((widget) => widget.id === "clock"), source.widgets[2]);

  const restored = importTheme(exported);
  assert.deepEqual(restored, packageData.snapshot);
});

test("ordinary Theme exports without Here & There remain import-compatible", () => {
  const source = defaultSnapshot();
  source.widgets = [{ id: "clock", type: "clock", size: "2x2", page: 1, row: 1, col: 1,
    config: { hour12: true, showSeconds: false } }];
  const exported = exportTheme(source);
  assert.deepEqual(importTheme(exported), source);
});

