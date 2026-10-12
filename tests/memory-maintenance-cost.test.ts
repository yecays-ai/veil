import assert from "node:assert/strict";
import test from "node:test";
import { selectMaintenanceCandidates } from "../lib/memory/maintenance-input";
import type { Memory } from "../lib/memory/types";

test("synthetic candidate comparison records serialized input growth and bounded selection cost", () => {
  const results = [10, 20, 100, 500].map((count) => {
    const rows: Memory[] = Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(4, "0"), characterId: "c", kind: "fact",
      text: (i % 10 === 0 ? "rescue cat " : "cooking pasta ") + "x".repeat(200), subject: "character", status: "active", origin: "auto",
      sources: [{ sessionId: "s", messageId: `m${i}` }], lineage: {}, fingerprint: `fact${i}`, createdAt: 1, updatedAt: 1 }));
    const start = performance.now();
    const selected = selectMaintenanceCandidates("c", rows, "How is the rescue cat doing?");
    const selectionMs = performance.now() - start;
    const selectedRows = rows.filter((r) => selected.ids.includes(r.id));
    const fullCharacters = rows.reduce((n, row) => n + JSON.stringify(row).length, 0);
    // The budget is measured on the fields actually sent to the model.
    const sent = (r: Memory) => JSON.stringify({ id: r.id, kind: r.kind, subject: r.subject, text: r.text, status: r.status }).length;
    const selectedCharacters = selectedRows.reduce((n, row) => n + sent(row), 0);
    assert.ok(selectedCharacters <= 8000);
    if (selected.mode === "limited") assert.ok(selectedRows.every((r) => r.text.startsWith("rescue cat")));
    return { count, mode: selected.mode, selected: selected.ids.length, fullCharacters, selectedCharacters,
      selectionMs: Number(selectionMs.toFixed(3)) };
  });
  console.info("[synthetic maintenance candidates]", JSON.stringify(results));
});
