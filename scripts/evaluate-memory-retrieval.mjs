import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const compiled = resolve(process.argv[2] ?? "node_modules/.cache/veil-desktop-tests");
const { evaluateRetrieval } = require(resolve(compiled, "tests/memory-retrieval-evaluation.js"));
const { selectMemoryContext } = require(resolve(compiled, "lib/memory/context.js"));
const { selectMemoryContext: baseline } = require(resolve(compiled, "tests/memory-m4-baseline.js"));
const results = evaluateRetrieval();
const summary = {};
for (const language of ["en", "zh", "mixed"]) {
  const rows = results.filter((r) => r.language === language);
  const positive = rows.filter((r) => r.relevant), negative = rows.filter((r) => !r.relevant);
  const improved = rows.filter((r) => r.relevant ? !r.before && r.after : r.before && !r.after);
  const regressed = rows.filter((r) => r.relevant ? r.before && !r.after : !r.before && r.after);
  summary[language] = {
    positive: { total: positive.length, before: positive.filter((r) => r.before).length, after: positive.filter((r) => r.after).length },
    falseRecall: { total: negative.length, before: negative.filter((r) => r.before).length, after: negative.filter((r) => r.after).length },
    improved: improved.map((r) => r.id), regressed: regressed.map((r) => r.id),
    unchanged: rows.filter((r) => !improved.includes(r) && !regressed.includes(r)).map((r) => r.id),
    missed: positive.filter((r) => !r.after).map((r) => r.id),
  };
}

// CPU-only, deterministic candidate sizes; no IndexedDB, model, network or real-device timing.
const benchmark = [];
for (const size of [25, 100, 1_000]) {
  const rows = Array.from({ length: size }, (_, i) => ({ id: `m${i.toString().padStart(4, "0")}`, characterId: "a", kind: "fact",
    text: `I grow orchids in greenhouse section ${i}.`, subject: "character", status: "active", origin: "auto",
    sources: [], lineage: {}, fingerprint: "", createdAt: 1, updatedAt: 1 }));
  const history = Array.from({ length: 40 }, (_, i) => `We discussed the greenhouse in section ${i}.`);
  const current = "How are the orchids?";
  const conversation = { current: [{ role: "user", content: current }], recent: [], earlier: history.map((content) => ({ role: "user", content })) };
  const runBefore = () => baseline("a", rows, [...history, current]);
  const runAfter = () => selectMemoryContext("a", rows, conversation);
  const samples = { before: [], after: [] };
  for (let i = 0; i < 20; i++) { runBefore(); runAfter(); }
  for (let i = 0; i < 101; i++) {
    // Alternate execution order to reduce systematic warmup/order bias.
    for (const name of i % 2 ? ["after", "before"] : ["before", "after"]) {
      const start = performance.now(); (name === "before" ? runBefore : runAfter)();
      samples[name].push(performance.now() - start);
    }
  }
  const stats = (values) => {
    values.sort((a, b) => a - b);
    return { p50Ms: Number(values[50].toFixed(3)), p95Ms: Number(values[95].toFixed(3)) };
  };
  const before = runBefore(), after = runAfter();
  benchmark.push({ candidates: size, before: stats(samples.before), after: stats(samples.after),
    selectedBefore: before.ids.length, selectedAfter: after.ids.length,
    charactersBefore: before.characterLength, charactersAfter: after.characterLength });
}
console.log(JSON.stringify({ baseline: "9c93cf9d5302268659613444b64ccf67d50f28e7", node: process.version,
  original: { total: 10, before: results.filter((r) => r.set === "original" && r.before).length,
    after: results.filter((r) => r.set === "original" && r.after).length }, summary, benchmark, cases: results }, null, 2));
