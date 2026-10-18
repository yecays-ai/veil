import assert from "node:assert/strict";
import test from "node:test";
import { progressFixture } from "./memory-progress-fixture";
import { MemoryProgressProtocol } from "../lib/memory/progress";
import { ChatStorage } from "../lib/chat/storage";
import { createIndexedDBFoundationStorage, FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { runMaintenance, type MaintenanceRunnerDependencies } from "../lib/memory/maintenance-runner";
import { extractJsonObject, parseMaintenanceOperations, scanJson } from "../lib/memory/maintenance-operations";
import { createMaintenanceDiagnostics, describeMaintenanceResult, pairMaintenanceResults, type MaintenanceDiagnostic, type MaintenanceDiagnosticStore } from "../lib/memory/maintenance-diagnostics";
import { allowFailedRetry } from "../lib/memory/maintenance-retry";
import type { TextProvider } from "../lib/chat/provider";

const SECRET_WORDS = ["Peter loves the harbour at dawn", "SECRET-CANDIDATE-TEXT", "RAW-MODEL-RESPONSE-MARKER"];

async function fixture() {
  const f = await progressFixture(); let output = ""; const queue: string[] = []; const inputs: string[] = [];
  const character = { characterId: "c", ...normalizeCharacterInput({ name: "Peter", backstory: "A quiet student.", personality: "calm", speakingStyle: "short" }) };
  await f.core.replaceIfCurrent(FOUNDATION_STORAGE_KEY, await f.core.read(FOUNDATION_STORAGE_KEY), JSON.stringify({ ...defaultFoundation(), characters: [character] }));
  const chat = new ChatStorage(() => f.factory, () => f.locks, f.gate, true, f.memory);
  createIndexedDBFoundationStorage(f.core, f.memory);
  const source = { ...f.source, readChat: chat.readMemorySources.bind(chat), readStateSources: chat.readStateSources.bind(chat) };
  const protocol = new MemoryProgressProtocol(f.memory, source, f.locks, true);
  const diagnostics = createMaintenanceDiagnostics(true);
  const deps: MaintenanceRunnerDependencies = { protocol, memory: f.memory, readChat: chat.readMemorySources.bind(chat),
    sessions: (scope) => scope ? chat.listExistingSessions(scope) : chat.listSessions(),
    model: async () => ({ config: { id: "selected", baseUrl: "https://example.invalid/v1", apiKey: "stub-only", model: "stub" }, context: "{}" }),
    enabled: () => true, now: () => Date.now() + 310_000, triggerSequences: 1, diagnostics,
    provider: (async function* (_c, messages) { inputs.push(messages.map((m) => m.content).join("\n")); yield queue.length ? queue.shift()! : output; }) as TextProvider };
  return { ...f, chat, deps, diagnostics, say: (text: string) => { output = text; queue.length = 0; }, script: (...texts: string[]) => { queue.splice(0, queue.length, ...texts); }, inputs, send: (text: string) => chat.send(f.session.id, text),
    progress: async () => (await f.memory.listCursors("c"))[0]?.extraction,
    run: () => runMaintenance("c", deps, new AbortController().signal) };
}
const last = (f: Awaited<ReturnType<typeof fixture>>) => f.diagnostics.read().at(-1)!;

test("IGNORE is committed as ok with zero written; the usage row's 'completed' no longer stands for success", async () => {
  const f = await fixture(); await f.send(SECRET_WORDS[0]);
  f.say(JSON.stringify({ operations: [{ op: "IGNORE" }] }));
  assert.equal(await f.run(), true);
  const d = last(f);
  assert.equal(d.stage, "ok"); assert.equal(d.operationCount, 1);
  assert.deepEqual(d.counts, { ignored: 1, created: 0, updated: 0, state: 0, droppedManual: 0, droppedTooLong: 0, droppedProtected: 0, droppedDuplicate: 0 });
  assert.match(describeMaintenanceResult(d), /1 ignored, 0 actionable\)\. Written: 0 created, 0 updated, 0 state/);
  assert.equal((await f.memory.listMemories("c")).length, 0);
});

test("valid, over-600, protected and duplicate operations are counted separately and only the valid one is written", async () => {
  const f = await fixture(); const m = await f.send(SECRET_WORDS[0]);
  const op = (text: string) => ({ op: "CREATE", messageIds: [m.id], text, kind: "fact", subject: "user" });
  f.say(JSON.stringify({ operations: [op("Peter likes the harbour."), op("x".repeat(601)), op("password: hunter2 is Peter's"), op("Peter likes the harbour."), { op: "IGNORE" }] }));
  assert.equal(await f.run(), true);
  const d = last(f), c = d.counts!;
  assert.equal(d.operationCount, 5);
  assert.deepEqual([c.created, c.updated, c.ignored, c.droppedTooLong, c.droppedProtected, c.droppedDuplicate], [1, 0, 1, 1, 1, 1]);
  assert.equal(d.discarded, 3);
  assert.equal((await f.memory.listMemories("c")).filter((r) => r.status === "active").length, 1);
  assert.match(describeMaintenanceResult(d), /Dropped: 1 over 600 characters, 1 protected, 1 duplicate\./);
});

test("unparseable JSON and a format violation are distinct stages, and the failed range stays recoverable", async () => {
  const f = await fixture(); const m = await f.send(SECRET_WORDS[0]); let calls = 0;
  const provider = f.deps.provider; f.deps.provider = (async function* (...args: Parameters<TextProvider>) { calls++; yield* provider(...args); }) as TextProvider;
  f.say("RAW-MODEL-RESPONSE-MARKER not json");
  assert.equal(await f.run(), false);
  assert.equal(last(f).stage, "json");
  assert.equal((await f.progress())!.batches[0].state, "failed");
  await f.send("another"); f.say(JSON.stringify({ operations: [{ op: "CREATE", messageIds: [m.id] }] }));
  await f.run();
  assert.equal(last(f).stage, "format");
  // The second run is the one allowed retry of the same range, so it spends exactly one request.
  assert.equal(calls, 2);
  assert.match(describeMaintenanceResult(last(f)), /^Retry\. Not written: .*no more automatic retries/);
});

test("results contain only numbers and enums: no chat text, candidate text or model response", async () => {
  const f = await fixture(); const m = await f.send(SECRET_WORDS[0]);
  f.say(JSON.stringify({ operations: [{ op: "CREATE", messageIds: [m.id], text: SECRET_WORDS[1], kind: "fact", subject: "user" }] }));
  await f.run(); f.say(SECRET_WORDS[2]); await f.send("more"); await f.run();
  const stored = JSON.stringify(f.diagnostics.read());
  for (const word of SECRET_WORDS) assert.ok(!stored.includes(word), word);
  assert.ok(!stored.includes(m.id));
});

test("stored results are validated, bounded to 20 and survive a reload; junk is dropped", () => {
  let saved: string | null = JSON.stringify([{ outcome: "committed", messageCount: 1, candidateCount: 0, inputCharacters: 5, operationCount: 1, discarded: 0, durationMs: 1,
    stage: "ok", text: "LEAK", counts: { ignored: 1, created: 0, updated: 0, state: 0, droppedManual: 0, droppedTooLong: 0, droppedProtected: 0, droppedDuplicate: 0 } },
    { outcome: "bogus" }, { outcome: "rejected", messageCount: -1 }, "text"]);
  const store: MaintenanceDiagnosticStore = { load: () => saved, save: (v) => { saved = v; } };
  const first = createMaintenanceDiagnostics(true, store);
  assert.equal(first.read().length, 1); assert.ok(!("text" in first.read()[0]));
  for (let i = 0; i < 30; i++) first.record({ outcome: "rejected", stage: "json", at: i, messageCount: 1, candidateCount: 0, inputCharacters: 1, operationCount: 0, discarded: 0, durationMs: 1 });
  assert.equal(createMaintenanceDiagnostics(true, store).read().length, 20);
  assert.ok(!saved!.includes("LEAK"));
  assert.equal(createMaintenanceDiagnostics(true, { load: () => "{broken", save: () => { throw new Error("full"); } }).read().length, 0);
  assert.equal(createMaintenanceDiagnostics(false, store).read().length, 0);
});

test("each usage row pairs with the result of its own request, never an older or newer one", () => {
  const base = { outcome: "committed", messageCount: 1, candidateCount: 0, inputCharacters: 1, operationCount: 0, discarded: 0, durationMs: 1, stage: "ok" } as const;
  const a: MaintenanceDiagnostic = { ...base, at: 1_000 }, b: MaintenanceDiagnostic = { ...base, at: 500_000 };
  const rows = [{ at: 30_000 }, { at: 520_000 }, { at: 900_000 }];
  const { pairs, unpaired } = pairMaintenanceResults(rows, [a, b]);
  assert.equal(pairs.get(rows[0]), a); assert.equal(pairs.get(rows[1]), b); assert.equal(pairs.has(rows[2]), false); assert.equal(unpaired.length, 0);
});

const create = (id: string, text: string) => JSON.stringify({ operations: [{ op: "CREATE", messageIds: [id], text, kind: "fact", subject: "user" }] });
const bad = "```json\n{\"operations\": [ oops ]}\n```";

test("one complete JSON object is extracted from a fence or surrounding words; anything else is still a JSON failure", () => {
  const body = '{"operations":[{"op":"IGNORE"}]}';
  assert.equal(extractJsonObject("```json\n" + body + "\n```"), body);
  assert.equal(extractJsonObject("Here you go: " + body + " Done."), body);
  assert.equal(extractJsonObject('{"operations":[],"x":"a } b { c \\" }"}'), '{"operations":[],"x":"a } b { c \\" }"}');
  assert.equal(extractJsonObject(body + " " + body), undefined, "two objects are ambiguous");
  assert.equal(extractJsonObject('{"operations":['), undefined, "unbalanced");
  assert.equal(extractJsonObject("no object"), undefined);
});

test("an extracted object still goes through the full contract: bad shape stays a format failure, bad JSON a json failure", async () => {
  const f = await fixture(); await f.send("hello there friend");
  const snapshot = (await f.protocol.withOwner("c", async (owner) => f.protocol.readInput(await f.protocol.prepare(owner, f.session.id, 1, 1, []))))!;
  assert.deepEqual(parseMaintenanceOperations("```json\n" + JSON.stringify({ operations: [{ op: "IGNORE" }] }) + "\n```", snapshot).counts.ignored, 1);
  assert.throws(() => parseMaintenanceOperations("```json\n" + JSON.stringify({ operations: [{ op: "NOPE" }] }) + "\n```", snapshot), { stage: "format" });
  assert.throws(() => parseMaintenanceOperations(bad, snapshot), { stage: "json" });
  assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [], extra: 1 }), snapshot), { stage: "format" });
});

test("a failed range is retried once as the same range: sources kept, no new messages mixed in, memory committed, no duplicates", async () => {
  const f = await fixture(); const first = await f.send("RANGE-ONE Peter adopted a cat named Miso");
  f.script(bad, create(first.id, "I adopted a cat named Miso."));
  assert.equal(await f.run(), false);
  let progress = (await f.progress())!;
  assert.equal(progress.batches.length, 1); assert.equal(progress.batches[0].state, "failed"); assert.equal(progress.batches[0].attempts, 1);
  assert.deepEqual([progress.batches[0].fromSeq, progress.batches[0].toSeq], [1, 1]);
  assert.equal((await f.memory.listMemories("c")).length, 0);
  const shape = last(f).shape!;
  assert.deepEqual([shape.head, shape.tail, shape.fenced, shape.objects, shape.finish], ["fence", "fence", true, 1, "none"]);
  assert.ok(!JSON.stringify(f.diagnostics.read()).includes("oops"));
  const second = await f.send("RANGE-TWO a later message");
  assert.equal(await f.run(), true);
  assert.equal(f.inputs.length, 2);
  assert.ok(f.inputs[1].includes("RANGE-ONE") && !f.inputs[1].includes("RANGE-TWO"), "the retry carries its own range only");
  assert.equal(last(f).attempt, 2); assert.equal(last(f).stage, "ok");
  const [memory] = await f.memory.listMemories("c");
  assert.deepEqual(memory.sources, [{ sessionId: f.session.id, messageId: first.id }]);
  progress = (await f.progress())!;
  assert.equal(progress.batches.length, 0); assert.equal(progress.throughSeq, 1, "the range is complete only after the commit");
  // The later message is not lost or reordered: it is the next batch, and repeating the same memory is dropped, not duplicated.
  f.say(create(first.id, "I adopted a cat named Miso."));
  await f.send("RANGE-THREE"); await f.run();
  assert.equal((await f.memory.listMemories("c")).filter((r) => r.status === "active").length, 1);
  assert.ok(second.id);
});

test("a range gets at most two requests: the second failure leaves it failed and it is never requested again", async () => {
  const f = await fixture(); await f.send("LOST-RANGE content");
  f.script(bad, bad); await f.run();
  await f.send("next one"); assert.equal(await f.run(), false);
  assert.equal(f.inputs.length, 2);
  const batch = (await f.progress())!.batches[0];
  assert.equal(batch.state, "failed"); assert.equal(batch.attempts, 2);
  assert.match(describeMaintenanceResult(last(f)), /^Retry\. Not written: .*no more automatic retries/);
  f.say(JSON.stringify({ operations: [{ op: "IGNORE" }] }));
  for (let i = 0; i < 3; i++) { await f.send(`more ${i}`); await f.run(); }
  assert.ok(f.inputs.slice(2).every((text) => !text.includes("LOST-RANGE")), "the exhausted range is not sent again");
  assert.equal((await f.progress())!.batches.find((b) => b.id === batch.id)?.attempts, 2);
});

test("an uncertain range (request may have been received) is never retried automatically", async () => {
  const f = await fixture(); await f.send("UNSURE-RANGE content");
  const real = f.deps.provider;
  f.deps.provider = (async function* () { throw new Error("network dropped"); yield ""; }) as TextProvider;
  assert.equal(await f.run(), false);
  assert.equal((await f.progress())!.batches[0].state, "uncertain");
  f.deps.provider = real; f.say(JSON.stringify({ operations: [{ op: "IGNORE" }] }));
  await f.send("another"); await f.run(); await f.send("again"); await f.run();
  assert.ok(f.inputs.every((text) => !text.includes("UNSURE-RANGE")));
  assert.equal((await f.progress())!.batches[0].state, "uncertain");
});

const withText = (id: string, text: string, tail = "") => `{"operations":[{"op":"CREATE","messageIds":["${id}"],"text":"${text}","kind":"fact","subject":"user"}${tail}]}`;

test("scanJson counts raw control characters, trailing commas and stray quotes, and only repairs the first two", () => {
  const raw = '{"a":"x\ny\tz","b":[1,2,],"c":"she said "hi" ok"}';
  const { defects, text } = scanJson(raw, true);
  assert.deepEqual(defects, { controlChars: 2, trailingCommas: 1, strayQuotes: 1 });
  assert.ok(!text.includes("\n") && !text.includes(",]") && text.includes('"hi"'), "the stray quotes are left as they were");
  assert.deepEqual(scanJson('{"ok":"fine, \\"quoted\\" text"}').defects, { controlChars: 0, trailingCommas: 0, strayQuotes: 0 });
});

test("a raw newline in a memory text or a trailing comma no longer fails the batch, and the text is kept exactly", async () => {
  const f = await fixture(); const m = await f.send("Peter wrote a two-line note");
  f.say(withText(m.id, "Line one\nLine two") .replace("}]}", "},]}"));
  assert.equal(await f.run(), true);
  assert.equal(last(f).stage, "ok"); assert.equal(last(f).counts!.created, 1);
  assert.equal((await f.memory.listMemories("c"))[0].text, "Line one\nLine two");
  assert.equal(f.inputs.length, 1, "one request, no retry needed");
});

test("an object that is only repaired still has to pass the full contract", async () => {
  const f = await fixture(); const m = await f.send("anything here");
  const snapshot = (await f.protocol.withOwner("c", async (owner) => f.protocol.readInput(await f.protocol.prepare(owner, f.session.id, 1, 1, []))))!;
  assert.throws(() => parseMaintenanceOperations(`{"operations":[{"op":"NOPE","messageIds":["${m.id}"],"text":"a\nb"}]}`, snapshot), { stage: "format" });
  assert.throws(() => parseMaintenanceOperations(withText(m.id, 'He said "hello" to me'), snapshot), { stage: "json" }, "stray quotes are never guessed");
});

test("a stray-quote failure records which kind of slip it was, as numbers and enums only", async () => {
  const f = await fixture(); const m = await f.send("anything here");
  f.say(withText(m.id, 'SECRET-QUOTE-TEXT "hello" there'));
  assert.equal(await f.run(), false);
  const { shape, stage } = last(f);
  assert.equal(stage, "json");
  assert.deepEqual([shape!.head, shape!.tail, shape!.objects, shape!.fenced, shape!.finish], ["brace", "brace", 1, false, "none"]);
  assert.ok(["expected-delimiter", "unexpected-token", "other"].includes(shape!.error!));
  assert.ok(shape!.strayQuotes! >= 1);
  assert.ok(!JSON.stringify(f.diagnostics.read()).includes("SECRET-QUOTE-TEXT"));
  assert.match(describeMaintenanceResult(last(f)), /stray quote/);
});

test("scanJson counts a raw newline after a backslash and repair keeps both the backslash and the newline", () => {
  const raw = '{"a":"path\\\n"}';
  assert.equal(scanJson(raw).defects.controlChars, 1);
  assert.equal(JSON.parse(scanJson(raw, true).text).a, "path\\\n");
});

test("allowing a retry gives an exhausted failed range exactly one more request, with the same range and no other change", async () => {
  const f = await fixture(); await f.send("LOST-RANGE content");
  f.script(bad, bad); await f.run(); await f.send("next one"); await f.run();
  const lost = (await f.progress())!.batches.find((b) => b.state === "failed")!;
  assert.equal(lost.attempts, 2);
  assert.equal(await allowFailedRetry(f.memory, f.locks, "c"), 1);
  const released = (await f.progress())!.batches.find((b) => b.id === lost.id)!;
  assert.deepEqual({ ...released, attempts: 2 }, lost, "only the attempt count changes");
  assert.equal(released.attempts, 1);
  assert.equal(await allowFailedRetry(f.memory, f.locks, "c"), 0, "a range below the cap is not changed again");
  f.say(JSON.stringify({ operations: [{ op: "IGNORE" }] }));
  const calls = f.inputs.length;
  for (let i = 0; i < 4; i++) await f.run();
  const retried = f.inputs.slice(calls).filter((text) => text.includes("LOST-RANGE"));
  assert.equal(retried.length, 1, "exactly one more request carries the released range");
  assert.ok(!retried[0].includes("next one"), "newer messages are not mixed in");
  assert.equal((await f.progress())!.batches.find((b) => b.id === lost.id), undefined, "the range completes only after its commit");
});

test("allowing a retry leaves uncertain and ready ranges alone and does nothing while another tab owns the Character", async () => {
  const f = await fixture(); await f.send("UNSURE-RANGE content");
  f.deps.provider = (async function* () { throw new Error("network dropped"); yield ""; }) as TextProvider;
  await f.run();
  assert.equal((await f.progress())!.batches[0].state, "uncertain");
  const snapshot = JSON.stringify(await f.progress());
  assert.equal(await allowFailedRetry(f.memory, f.locks, "c"), 0);
  assert.equal(JSON.stringify(await f.progress()), snapshot);
  const held = await f.protocol.withOwner("c", async () => allowFailedRetry(f.memory, f.locks, "c"));
  assert.equal(held, undefined);
});
