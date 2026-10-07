import test from "node:test";

export type LifecycleCategory = "storage-read-budget" | "render-lifecycle"
  | "subscription-hygiene" | "async-race-safety";

/** Metadata lives in the native test name; assertions and failures remain node:test's. */
export function regressionContract(id: string, category: LifecycleCategory, title: string,
  check: () => void | Promise<void>) {
  if (!/^[a-z][a-z0-9.-]+$/.test(id)) throw new Error("Invalid regression contract ID.");
  return test(`[contract:${category}:${id}] ${title}`, check);
}
