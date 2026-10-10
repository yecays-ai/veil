import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The compiled test directory is never cleaned, so it can hold output for tests whose
// source was deleted. The sources in tests/ decide what runs; every source must have
// compiled output, otherwise a test would be skipped silently.
export function compiledTestFiles(sourceDir, compiledDir) {
  const sources = readdirSync(sourceDir).filter((name) => name.endsWith(".test.ts")).sort();
  const missing = sources.filter((name) => !existsSync(resolve(compiledDir, name.replace(/\.ts$/, ".js"))));
  if (missing.length) throw new Error(`No compiled output for: ${missing.join(", ")}`);
  return sources.map((name) => resolve(compiledDir, name.replace(/\.ts$/, ".js")));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [sourceDir, compiledDir] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(compiledTestFiles(sourceDir, compiledDir)));
}
