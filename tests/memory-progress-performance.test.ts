import assert from "node:assert/strict";
import test from "node:test";
import { deferred, progressFixture } from "./memory-progress-fixture";
import type { MemoryDraft } from "../lib/memory/types";

test("measure warm protocol lease holds and queued writer contention without model/network calls", async (t) => {
  const f = await progressFixture(), initial = await f.send("seed");
  const candidates = Array.from({ length: 25 }, (_, i): MemoryDraft => ({ id: `seed${i}`, characterId: "c", kind: "fact", text: `seed fact ${i}`,
    subject: "user", status: "active", origin: "auto", sources: [{ sessionId: f.session.id, messageId: initial.id }], lineage: {} }));
  await f.memory.applyChange("c", "seed", { put: candidates });
  f.holds.length = 0; f.waits.length = 0;
  await f.protocol.withOwner("c", async (owner) => {
    for (let i = 0; i < 50; i++) {
      const message = await f.send(`new evidence ${i}`), seq = message.memorySequence!.seq!;
      const ticket = await f.protocol.prepare(owner, f.session.id, seq, seq, candidates.map((row) => row.id));
      await f.protocol.claim(ticket, 1); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
      await f.protocol.commitAutomatic(ticket, { put: [] });
    }
  });
  const sorted = [...f.holds].sort((a, b) => a - b), percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  t.diagnostic(JSON.stringify({ samples: sorted.length, messages: 51, candidates: 25, holdMs: { p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) },
    maxUncontendedWaitMs: Math.max(...f.waits), productionCalls: 0 }));
  const entered = deferred(), release = deferred(); let wrote = false;
  const holding = f.memory.withExclusive(async () => { entered.resolve(); await release.promise; }); await entered.promise;
  const queuedAt = performance.now(), writing = f.memory.applyChange("c", "queued", {}).then(() => { wrote = true; return performance.now() - queuedAt; });
  await new Promise((done) => setTimeout(done, 10)); assert.equal(wrote, false);
  release.resolve(); await holding; const waited = await writing;
  t.diagnostic(JSON.stringify({ injectedHoldMs: 10, queuedWriterMs: waited, writerProceededOnlyAfterRelease: true }));
});
