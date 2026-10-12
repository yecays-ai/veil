import assert from "node:assert/strict";
import test from "node:test";
import { selectMemoryContext, type MemoryConversation } from "../lib/memory/context";
import type { Memory } from "../lib/memory/types";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { selectMemoryContext as m4 } from "./memory-m4-baseline";

const row = (id: string, text: string, extra: Partial<Memory> = {}): Memory => ({ id, characterId: "a", text,
  kind: "fact", subject: "character", origin: "auto", status: "active", sources: [], lineage: {},
  fingerprint: memoryFingerprint(text), createdAt: 1, updatedAt: 1, ...extra });
const query = (content: string, recent: readonly [string, string][] = [], earlier: string[] = []): MemoryConversation => ({
  current: [{ role: "user", content }], recent: recent.map(([user, assistant]) => [{ role: "user", content: user }, { role: "assistant", content: assistant }]),
  earlier: earlier.map((text) => ({ role: "user", content: text })),
});

test("inflected generic actions and nearby unrelated work do not become employment or adoption anchors", () => {
  const memories = [row("job", "I resigned from my job."), row("dog", "I am adopting a dog.")];
  for (const text of ["Have you resigned this chess match?", "We are adopting a new policy.",
    "I quit caffeine at work.", "I left coffee in the office."])
    assert.deepEqual(selectMemoryContext("a", memories, query(text)).ids, [], text);
});
test("a pronoun with coordinated referents is declined even if one referent has no Memory row", () => {
  const memories = [row("canoe", "I restored a canoe.")];
  assert.deepEqual(selectMemoryContext("a", memories, query("Is it ready?",
    [["What are you fixing?", "Both the canoe and the scooter need repairs."]])).ids, []);
  assert.deepEqual(selectMemoryContext("a", memories, query("How is the canoe?",
    [["What are you fixing?", "Both the canoe and the scooter need repairs."]])).ids, ["canoe"]);
});
test("coordinated predicates about one topic do not masquerade as competing objects", () => {
  assert.deepEqual(selectMemoryContext("a", [row("canoe", "I restored a canoe.")], query("Is it ready?",
    [["How is the canoe?", "The canoe is restored and afloat."]])).ids, ["canoe"]);
  assert.deepEqual(selectMemoryContext("a", [row("puppy", "I adopted a puppy.")], query("How is he doing?",
    [["How is the puppy?", "The puppy is safe and healthy."]])).ids, ["puppy"]);
});
test("unrelated Memory cannot cross a sentence or conjunction through another topic's anchor", () => {
  const memories = [row("wallet", "I found a wallet.")];
  assert.deepEqual(selectMemoryContext("a", memories, query("How is your rescue?",
    [["What happened?", "I rescued a puppy and found a wallet."]])).ids, []);
});
test("explicit current topics take priority over recent and older manual topics; no filler", () => {
  const rows = [row("canoe", "I restored a canoe.", { origin: "manual" }), row("orchids", "I grow orchids."),
    row("manual-older", "I learned to paint.", { origin: "manual" })];
  assert.deepEqual(selectMemoryContext("a", rows, query("How are the orchids?",
    [["Any news?", "I grow orchids. The canoe is ready."]], ["We talked about painting."])).ids, ["orchids"]);
});
test("earlier History alone cannot qualify candidates, including an active ongoing Memory", () => {
  const rows = [row("gardening", "I am growing orchids.", { kind: "ongoing" })];
  assert.deepEqual(selectMemoryContext("a", rows, query("Is the station open?", [], ["How are the orchids?"])).ids, []);
});
test("Character and state filters apply before referent competition is considered", () => {
  const rows = [row("canoe", "I restored a canoe."), row("other", "I am repairing a scooter.", { characterId: "b" }),
    row("archived", "I am fixing a motorbike.", { status: "archived" })];
  assert.deepEqual(selectMemoryContext("a", rows, query("Is it ready?", [["What are you repairing?", "The canoe."]])).ids, ["canoe"]);
});
test("repeated selection is stable, read-only and subject to the same limits", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`m${i}`, `I grow orchids in section ${i}.`));
  const original = structuredClone(rows), input = query("orchids");
  const first = selectMemoryContext("a", rows, input);
  assert.equal(first.ids.length, 5);
  assert(first.characterLength <= 2_000);
  assert.deepEqual(selectMemoryContext("a", [...rows].reverse(), input), first);
  assert.deepEqual(rows, original);
});
test("a discriminating current term outranks a frequent term before timestamps break ties", () => {
  const rows = [row("specific", "I grow orchids beside the observatory."),
    ...Array.from({ length: 6 }, (_, i) => row(`general${i}`, `I grow orchids in greenhouse section ${i}.`, { updatedAt: 100 }))];
  const text = "Tell me about the orchids, greenhouse and observatory.";
  assert.equal(m4("a", rows, [text]).ids.includes("specific"), false);
  assert.equal(selectMemoryContext("a", rows, query(text)).ids.includes("specific"), true);
});
