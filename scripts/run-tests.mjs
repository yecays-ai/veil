import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory = resolve("node_modules/.cache/veil-desktop-tests/tests");
const files = readdirSync(directory).filter((name) => name.endsWith(".test.js"))
  .sort().map((name) => resolve(directory, name));
if (!files.length) throw new Error("No compiled test files found.");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
