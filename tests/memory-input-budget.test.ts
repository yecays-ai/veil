import assert from "node:assert/strict";
import test from "node:test";
import { MAINTENANCE_LIMITS, MaintenanceInputTooLarge, planMaintenanceInput, redactSecrets, fitBackground, type MaintenanceSnapshot } from "../lib/memory/maintenance-input";
import { STATE_MAINTENANCE_RULES } from "../lib/memory/state-maintenance";
import { MAINTENANCE_MESSAGE_CHARACTERS } from "../lib/memory/maintenance-runner";
import { createMaintenanceDiagnostics } from "../lib/memory/maintenance-diagnostics";
import type { ChatMessage } from "../lib/chat/types";
import type { Memory } from "../lib/memory/types";

const LIMIT = MAINTENANCE_LIMITS.inputCharacters;
const paragraphs = (length: number) => {
  const parts = ["Peter is a quiet student who keeps a notebook and speaks gently."];
  for (let i = 0; parts.join("\n\n").length < length; i++) parts.push(`Chapter ${i}: ${"A long sentence about the Character's past and the places he has lived. ".repeat(4)}`);
  return parts.join("\n\n").slice(0, length);
};
const message = (n: number, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m${n}`, sessionId: "s", role: n % 2 ? "user" : "assistant",
  turnId: `t${n}`, content, createdAt: 1_700_000_000_000 + n * 60_000, memorySequence: { epoch: "e", seq: n }, ...extra }) as ChatMessage;
const manualRow = (n: number, text: string): Memory => ({ id: `man${n}`, characterId: "c", text, kind: "fact", subject: "user", status: "active", origin: "manual",
  sources: [], lineage: {}, fingerprint: `fp${n}`, createdAt: 1, updatedAt: 1 }) as Memory;

type Shape = { backstory: number; stateHeads: number; messages: number[]; manual: number; context: number; state?: boolean };
function snapshot(shape: Shape): MaintenanceSnapshot {
  const background = { id: "bg", characterId: "c", version: 1, text: shape.backstory ? paragraphs(shape.backstory) : null, createdAt: 1 };
  const states = Array.from({ length: shape.stateHeads }, (_, i) => ({ id: `st${i}`, characterId: "c", key: `field-${i}`, version: 1, value: `State ${i}: ${"x".repeat(280)}`,
    previousId: null, backgroundId: "bg", sources: [{ sessionId: "s", messageId: "m1" }], review: { backgroundId: "bg", verdict: "compatible" as const }, createdAt: 1 }));
  return { characterId: "c", sessionId: "s",
    ...(shape.state === false ? {} : { state: { foundation: { backgrounds: [background], states }, background, sourceHashes: [] } }),
    messages: shape.messages.map((size, i) => message(i + 1, `orchid ${"m".repeat(Math.max(0, size - 7))}`)),
    candidates: [], manual: Array.from({ length: shape.manual }, (_, i) => manualRow(i, `Peter likes orchid number ${i} ${"y".repeat(150)}`)),
    suppressions: Array.from({ length: 300 }, (_, i) => ({ id: `sp${i}`, characterId: "c", fingerprint: `SUPPRESSED-${i}`, reason: "deleted", sources: [], createdAt: 1 })),
  } as unknown as MaintenanceSnapshot;
}
const character = (context: number) => ({ characterId: "c", context: JSON.stringify({ name: "Peter", personality: "p".repeat(context) }) });

test("common long-Backstory configurations always fit and keep the State lane: the budget never leaves a normal batch in too-large", () => {
  let checked = 0;
  for (const backstory of [0, 600, 3_000, 8_000, 12_000])
    for (const stateHeads of [0, 5, 15])
      for (const context of [200, 3_000, 12_000, 36_000])
        for (const messages of [[100], [1_000], [5_000], [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400], [1_500, 1_500, 1_500, 1_500, 1_500, 1_500]])
          for (const manual of [0, 40]) {
            const shape = { backstory, stateHeads, messages, manual, context };
            const plan = planMaintenanceInput(snapshot(shape), character(context));
            const text = plan.input.map((turn) => turn.content).join("\n");
            assert.ok(plan.input.reduce((n, turn) => n + turn.content.length, 0) <= LIMIT, JSON.stringify(shape));
            // Messages come first and are never cut; the State lane is complete.
            assert.equal(plan.messages.length, messages.length, JSON.stringify(shape));
            for (let i = 1; i <= messages.length; i++) assert.ok(text.includes(`"id":"m${i}"`));
            for (let i = 0; i < stateHeads; i++) assert.ok(text.includes(`"id":"st${i}"`), JSON.stringify(shape));
            assert.ok(text.includes(STATE_MAINTENANCE_RULES.slice(0, 60)));
            assert.ok(!text.includes("SUPPRESSED-"), "suppressions are checked locally and no longer sent");
            if (backstory) {
              assert.ok(text.includes("Peter is a quiet student"), "the first (core) paragraph is always kept");
              if (plan.stats.backgroundOmitted) assert.ok(text.includes("left out to fit this request"), "an omission is always marked");
            }
            checked++;
          }
  assert.equal(checked, 5 * 3 * 4 * 5 * 2);
});

test("a full 12,000-character Backstory with a normal batch is kept whole; a very long one is trimmed core-first with a mark", () => {
  const plan = planMaintenanceInput(snapshot({ backstory: 12_000, stateHeads: 5, messages: [400, 400, 400, 400, 400, 400, 400, 400, 400, 400], manual: 5, context: 1_000 }), character(1_000));
  assert.equal(plan.stats.backgroundOmitted, 0);
  const heavy = planMaintenanceInput(snapshot({ backstory: 12_000, stateHeads: 15, messages: [9_000], manual: 40, context: 12_000 }), character(12_000));
  assert.ok(heavy.stats.backgroundOmitted > 0); assert.ok(heavy.messages.length === 1);
});

test("a batch that cannot hold its messages and State lane is too large; State is never silently dropped", () => {
  assert.throws(() => planMaintenanceInput(snapshot({ backstory: 3_000, stateHeads: 5, messages: [31_000], manual: 0, context: 200 }), character(200)), MaintenanceInputTooLarge);
  assert.throws(() => planMaintenanceInput(snapshot({ backstory: 12_000, stateHeads: 5, messages: [5_000], manual: 0, context: 200 }), character(200), 9_000), MaintenanceInputTooLarge);
  // With State off nothing needs a Backstory and the same messages fit.
  assert.doesNotThrow(() => planMaintenanceInput(snapshot({ backstory: 0, stateHeads: 0, messages: [20_000], manual: 0, context: 200, state: false }), character(200)));
});

test("the message share used to cut a batch always leaves a normal request room", () => {
  const plan = planMaintenanceInput(snapshot({ backstory: 12_000, stateHeads: 15, messages: Array(20).fill(MAINTENANCE_MESSAGE_CHARACTERS / 20 - 120), manual: 40, context: 12_000 }), character(12_000));
  assert.equal(plan.messages.length, 20);
});

test("only manual memories this conversation touches are sent, and nothing local is skipped", () => {
  const s = snapshot({ backstory: 0, stateHeads: 0, messages: [200], manual: 40, context: 200, state: false });
  s.manual.push(manualRow(99, "Completely unrelated cooking note"));
  const plan = planMaintenanceInput(s, character(200)), text = plan.input[1].content;
  assert.ok(text.includes("orchid number") && !text.includes("cooking note"));
  assert.ok(plan.stats.manualSent > 0 && plan.stats.manualSent <= 40);
});

test("secrets are redacted locally: labelled ones to the end of the line, tokens alone, mostly-secret messages omitted", () => {
  assert.deepEqual(redactSecrets("my password: hunter2 and more\nnext line"), { text: "my [redacted]\nnext line", removed: "password: hunter2 and more".length });
  assert.equal(redactSecrets("use sk-abcdefghijklmnop please").text, "use [redacted] please");
  const s = snapshot({ backstory: 0, stateHeads: 0, messages: [200], manual: 0, context: 200, state: false });
  s.messages.push(message(2, "password: hunter2xyz"), message(3, "I adopted a rescue kitten last week and named her Biscuit, she sleeps all day. token ghp_abcdefghijklmnopqrstuvwxyz"));
  const plan = planMaintenanceInput(s, { characterId: "c", context: "api_key: topsecretvalue" });
  const all = plan.input.map((turn) => turn.content).join("\n");
  for (const secret of ["hunter2xyz", "topsecretvalue", "ghp_abcdefghijklmnopqrstuvwxyz"]) assert.ok(!all.includes(secret), secret);
  assert.deepEqual(plan.messages.map((m) => m.id), ["m1", "m3"], "one sensitive message is omitted without losing the batch");
  assert.equal(plan.stats.omittedMessages, 1); assert.ok(plan.stats.redactedCharacters > 0);
  // The model may only cite what it was shown.
  assert.ok(!plan.messages.some((m) => m.id === "m2"));
});

test("diagnostics keep counts only and never any text", () => {
  const diagnostics = createMaintenanceDiagnostics(true);
  diagnostics.record({ outcome: "rejected", messageCount: 1, candidateCount: 0, inputCharacters: 10, operationCount: 0, discarded: 0, durationMs: 1,
    sizeAttempts: 2, redactedCharacters: 5, omittedMessages: 1, backgroundOmitted: 7, manualSent: 3, secret: "hunter2xyz" } as never);
  const [record] = diagnostics.read();
  assert.deepEqual(Object.keys(record).sort(), ["backgroundOmitted", "candidateCount", "discarded", "durationMs", "inputCharacters", "manualSent", "messageCount",
    "omittedMessages", "operationCount", "outcome", "redactedCharacters", "sizeAttempts"]);
  assert.ok(!JSON.stringify(record).includes("hunter2xyz"));
});

test("fitBackground keeps core paragraphs first, then paragraphs the messages point at", () => {
  const text = ["Core identity paragraph that is always kept.", "[core] Voice: soft and slow.", ...Array.from({ length: 30 }, (_, i) => `Filler ${i} ${"z".repeat(300)}`),
    "The lighthouse keeper taught Peter to row."].join("\n\n");
  const fit = fitBackground(text, 1_200, "tell me about the lighthouse keeper");
  assert.ok(fit.text.length <= 1_200 + 8);
  for (const needle of ["Core identity paragraph", "Voice: soft and slow", "lighthouse keeper", "left out to fit"]) assert.ok(fit.text.includes(needle), needle);
  assert.ok(!fit.text.includes("Filler 9 "));
});
