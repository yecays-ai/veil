import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory = resolve("node_modules/.cache/veil-desktop-tests/tests");
const files = readdirSync(directory).filter((name) => name.endsWith(".test.js"))
  .sort().map((name) => resolve(directory, name));
if (!files.length) throw new Error("No compiled test files found.");
mkdirSync(resolve("node_modules/.cache"), { recursive: true });
const reporter = new URL("./regression-contract-reporter.mjs", import.meta.url).href;
const result = spawnSync(process.execPath, ["--test",
  "--test-reporter=spec", "--test-reporter-destination=stdout",
  `--test-reporter=${reporter}`,
  `--test-reporter-destination=${resolve("node_modules/.cache/veil-regression-contracts.json")}`,
  ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
