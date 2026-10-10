import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function select(source: string, compiled: string): string[] {
  return JSON.parse(execFileSync(process.execPath,
    [join(process.cwd(), "scripts/test-files.mjs"), source, compiled], { encoding: "utf8" }));
}

function fixture(sources: string[], compiled: string[]) {
  const root = mkdtempSync(join(tmpdir(), "veil-test-files-"));
  const source = join(root, "tests"), out = join(root, "out");
  mkdirSync(source); mkdirSync(out);
  for (const name of sources) writeFileSync(join(source, name), "");
  for (const name of compiled) writeFileSync(join(out, name), "");
  return { root, source, out };
}

test("compiled output whose source was deleted is not selected", () => {
  const f = fixture(["a.test.ts", "b.test.ts", "helper.ts"],
    ["a.test.js", "b.test.js", "deleted.test.js", "helper.js"]);
  try {
    assert.deepEqual(select(f.source, f.out).map((p) => p.slice(f.out.length + 1)),
      ["a.test.js", "b.test.js"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("every existing test source is selected, in a stable order", () => {
  const f = fixture(["b.test.ts", "a.test.ts"], ["b.test.js", "a.test.js"]);
  try {
    assert.deepEqual(select(f.source, f.out).map((p) => p.slice(f.out.length + 1)),
      ["a.test.js", "b.test.js"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a test source without compiled output fails instead of being skipped", () => {
  const f = fixture(["a.test.ts", "b.test.ts"], ["a.test.js"]);
  try {
    assert.throws(() => select(f.source, f.out), /No compiled output for: b\.test\.ts/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
