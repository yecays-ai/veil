import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const output = resolve("node_modules/.cache/veil-memory-evaluation");
const reportOnly = process.argv.slice(2).includes("--report-only");
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: reportOnly ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (reportOnly && result.stdout) process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
}
// Always compile current sources; the explicit list below never runs stale or unrelated tests.
run([require.resolve("typescript/bin/tsc"), "--project", "tsconfig.memory-evaluation.json"]);
const { evaluateMemoryP4 } = require(resolve(output, "tests/memory-retrieval-p4-evaluation.js"));
const report = await evaluateMemoryP4();
const json = JSON.stringify(report, null, 2) + "\n";
writeFileSync(resolve(output, "report.json"), json);
if (reportOnly) console.log(json);
else {
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Full deterministic report: ${resolve(output, "report.json")}`);
  for (const row of [...report.quality, ...report.boundaries, ...report.sources])
    for (const reason of row.failures) console.error(`${row.id}: ${reason}`);
}
if (report.summary.failed) process.exitCode = 1;
// Persist the report even when a subsequent Node test fails, so failures can still be compared.
if (!reportOnly) run(["--test", ...["memory-context", "memory-retrieval-quality", "memory-retrieval-safety", "memory-retrieval-p4"]
  .map((name) => resolve(output, `tests/${name}.test.js`))]);
