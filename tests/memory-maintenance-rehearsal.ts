import { progressFixture } from "./memory-progress-fixture";
import { buildMaintenanceInput } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { createMaintenanceDiagnostics } from "../lib/memory/maintenance-diagnostics";

/** Test/dev exercise only: new fake IndexedDB per run; no provider/config/network/browser storage. */
export async function rehearseMaintenance(reply: string | Error, beforeCommit?: (f: Awaited<ReturnType<typeof progressFixture>>) => Promise<void>) {
  const f = await progressFixture(); await f.send("I adopted a little rescue cat yesterday.");
  const trace = createMaintenanceDiagnostics(true); let stubCalls = 0;
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1);
    const snapshot = await f.protocol.readInput(ticket);
    const input = buildMaintenanceInput(snapshot, { characterId: "c", context: "An ordinary Character." });
    const metric = { messageCount: snapshot.messages.length, candidateCount: 0,
      inputCharacters: input.reduce((n, m) => n + m.content.length, 0), operationCount: 0, discarded: 0, durationMs: 0 };
    trace.record({ ...metric, outcome: "prepared" });
    await f.protocol.claim(ticket, 1); await f.protocol.transition(ticket, "in-flight");
    // This deterministic stub cannot call an API. A scripted error is a known failed exercise response.
    stubCalls++;
    if (reply instanceof Error) { await f.protocol.transition(ticket, "failed"); trace.record({ ...metric, outcome: "rejected" }); return; }
    const raw = reply.replaceAll("$MESSAGE", snapshot.messages[0].id);
    let result;
    try { result = parseMaintenanceOperations(raw, snapshot); }
    catch { await f.protocol.transition(ticket, "failed"); trace.record({ ...metric, outcome: "rejected" }); return; }
    trace.record({ ...metric, operationCount: result.operationCount, discarded: result.discarded, outcome: "validated" });
    await f.protocol.transition(ticket, "commit-pending");
    if (beforeCommit) await beforeCommit(f);
    try { await f.protocol.commitAutomatic(ticket, { put: result.put }); trace.record({ ...metric, outcome: "committed" }); }
    catch { trace.record({ ...metric, outcome: "commit-failed" }); }
  });
  return { memories: await f.memory.listMemories("c"), progress: await f.progress(), diagnostics: trace.read(), stubCalls };
}
