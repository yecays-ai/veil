import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("test command fails instead of reporting success when compiled tests are missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "veil-test-runner-"));
  try {
    for (const emptyDirectory of [false, true]) {
      if (emptyDirectory) mkdirSync(join(directory, "node_modules/.cache/veil-desktop-tests/tests"), { recursive: true });
      const result = spawnSync(process.execPath, [resolve("scripts/run-tests.mjs")],
        { cwd: directory, encoding: "utf8" });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, emptyDirectory ? /No compiled test files/ : /ENOENT/);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("existing runner emits deterministic contract results without hiding failures or skips", () => {
  const directory = mkdtempSync(join(tmpdir(), "veil-contract-report-"));
  const compiled = join(directory, "node_modules/.cache/veil-desktop-tests/tests");
  const reportPath = join(directory, "node_modules/.cache/veil-regression-contracts.json");
  mkdirSync(compiled, { recursive: true });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = () => spawnSync(process.execPath, [resolve("scripts/run-tests.mjs")],
    { cwd: directory, encoding: "utf8", env });
  try {
    for (const failing of [false, true]) {
      writeFileSync(join(compiled, "fixture.test.js"), `
        const test = require('node:test');
        const assert = require('node:assert/strict');
        test('ordinary test', () => {});
        test('[contract:render-lifecycle:fixture.z] example', () => { assert.equal(${failing}, false); });
        test('[contract:async-race-safety:fixture.a] skipped example', { skip: true }, () => {});
      `);
      const result = run();
      assert.equal(result.error, undefined);
      assert.equal(result.status, failing ? 1 : 0);
      const serialized = readFileSync(reportPath, "utf8");
      assert.deepEqual(JSON.parse(serialized), {
        schemaVersion: 1, project: "rendering-navigation-lifecycle", contracts: [
          { id: "fixture.a", category: "async-race-safety", status: "skipped" },
          { id: "fixture.z", category: "render-lifecycle", status: failing ? "failed" : "passed" },
        ],
      });
      run();
      assert.equal(readFileSync(reportPath, "utf8"), serialized);
    }
    writeFileSync(join(compiled, "fixture.test.js"), `
      const test = require('node:test');
      test('[contract:render-lifecycle:fixture.duplicate] first', () => {});
      test('[contract:render-lifecycle:fixture.duplicate] second', () => {});
    `);
    const duplicate = run();
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Duplicate regression contract ID/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
