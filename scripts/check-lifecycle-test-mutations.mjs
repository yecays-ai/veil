// Run with npm run test:mutations. Mutate only the production module loaded by an isolated
// test process; neither source files nor compiled files are rewritten.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const compiled = resolve("node_modules/.cache/veil-desktop-tests");
const cases = [
  { name: "late background ownership", module: "components/chat/use-chat-background.js",
    test: "chat-first-paint.test.js", pattern: "chat.mounted-character-navigation",
    // Remove this early return only; markReady has a separate active guard.
    from: "return; // a late read from a route that has left must not create an object URL",
    to: "; // late-read ownership protection removed",
    assertion: "a late asset from the unmounted route never creates an object URL" },
  { name: "timer cancellation", module: "lib/chat/bubble-pacing.js",
    test: "bubble-pacing.test.js", pattern: "chat.mounted-bubble-timer-route-cleanup",
    from: "clearTimeout(this.timer);", to: "/* cancellation removed */",
    assertion: "route replacement physically cancels its timer" },
  { name: "disabled Switch interaction", module: "components/settings/ui/switch.js",
    test: "ui-save-consistency.test.js", pattern: "mounted disabled Switch",
    from: "disabled: disabled", to: "disabled: false",
    assertion: "disabled native and label activation never invokes onChange" },
];
const directory = mkdtempSync(join(tmpdir(), "veil-lifecycle-mutations-"));
function run(check, preload) {
  const result = spawnSync(process.execPath, [
    ...(preload ? ["--require", preload] : []), "--test", "--test-reporter=spec",
    `--test-name-pattern=${check.pattern}`, resolve(compiled, "tests", check.test),
  ], { encoding: "utf8", timeout: 30_000 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `${check.name}: test process must finish normally`);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
try {
  for (const check of cases) {
    const source = readFileSync(resolve(compiled, check.module), "utf8");
    const matches = source.split(check.from).length - 1;
    assert.equal(matches, 1,
      `${check.name}: mutation target must match exactly once in ${check.module}; found ${matches}`);
    const healthy = run(check);
    assert.equal(healthy.status, 0, healthy.output);
    assert.ok(healthy.output.includes(check.pattern), `${check.name}: target test must execute\n${healthy.output}`);
    const preload = join(directory, "mutation.cjs");
    writeFileSync(preload, `
const fs = require("node:fs"), Module = require("node:module");
const target = ${JSON.stringify(realpathSync(resolve(compiled, check.module)))};
const from = ${JSON.stringify(check.from)}, to = ${JSON.stringify(check.to)};
const original = Module._extensions[".js"];
Module._extensions[".js"] = (module, filename) => {
  if (filename !== target) return original(module, filename);
  const source = fs.readFileSync(filename, "utf8");
  if (source.split(from).length !== 2) throw new Error("Mutation must match exactly once");
  console.log("VEIL_MUTATION_APPLIED");
  module._compile(source.replace(from, to), filename);
};
`);
    const broken = run(check, preload);
    assert.equal(broken.status, 1, `${check.name}: mutated test must fail with exit 1\n${broken.output}`);
    assert.ok(broken.output.includes("VEIL_MUTATION_APPLIED"), `${check.name}: production mutation must execute\n${broken.output}`);
    assert.ok(broken.output.includes(check.assertion), `${check.name}: expected protection assertion must fail\n${broken.output}`);
    const restored = run(check);
    assert.equal(restored.status, 0, restored.output);
    assert.ok(restored.output.includes(check.pattern), `${check.name}: restored test must execute\n${restored.output}`);
    console.log(`${check.name}: healthy PASS (exit 0), mutated EXPECTED_FAIL (exit 1), restored PASS (exit 0)`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
