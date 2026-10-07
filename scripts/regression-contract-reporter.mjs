/** A second node:test reporter: no test registry or execution of its own. */
export default async function* regressionContracts(source) {
  const contracts = new Map();
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const match = /^\[contract:(storage-read-budget|render-lifecycle|subscription-hygiene|async-race-safety):([a-z][a-z0-9.-]+)\] /.exec(event.data.name);
    if (!match) continue;
    const [, category, id] = match;
    if (contracts.has(id)) throw new Error(`Duplicate regression contract ID: ${id}`);
    contracts.set(id, { id, category, status: event.data.skip || event.data.todo ? "skipped"
      : event.type === "test:pass" ? "passed" : "failed" });
  }
  yield JSON.stringify({ schemaVersion: 1, project: "rendering-navigation-lifecycle",
    contracts: [...contracts.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }, null, 2) + "\n";
}
