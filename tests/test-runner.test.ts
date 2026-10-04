import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
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
