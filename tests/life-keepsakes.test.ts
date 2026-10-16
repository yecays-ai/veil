import assert from "node:assert/strict";
import test from "node:test";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import type { LifeKeepsake } from "../lib/life/activity";
import { ensureDayPlan } from "../lib/life/day-plan";
import { addKeepsake, applyKeepsakeUpdates, keepsakeCodes, parseKeepsakeUpdates, topKeepsakes } from "../lib/life/keepsakes";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { characterActionApplier, splitActions } from "../lib/presence/actions";
import { createPresenceStorage, emptyPresenceDocument, normalizePresenceDocument, presenceRecord, removePresence, setLifeState, setRoutine } from "../lib/presence/storage";

const ID = "char-a", NOW = Date.UTC(2026, 9, 16, 8, 0), DAY = 86_400_000;
const keep = (n: number, weight: LifeKeepsake["weight"] = 3, createdAt = NOW - n * DAY): LifeKeepsake =>
  ({ id: `k${n}`, text: `Kept ${n}`, weight, createdAt, updatedAt: createdAt });
const full = (weight: LifeKeepsake["weight"] = 3) => Array.from({ length: 20 }, (_, index) => keep(index + 1, weight));

test("the keepsakes list of a reply is read strictly; bad entries are skipped", () => {
  for (const bad of ["", "{", "{}", '{"keepsakes":"x"}']) assert.deepEqual(parseKeepsakeUpdates(bad), [], bad);
  assert.deepEqual(parseKeepsakeUpdates(JSON.stringify({ keepsakes: [{ add: " Lost  a close friend. ", weight: 5 }, { add: "x", weight: 6 }, { add: "x", weight: 2.5 },
    { retire: "K2" }, { add: "", weight: 3 }, { retire: "x" }, { add: "a".repeat(281), weight: 1 }] })),
  [{ do: "add", text: "Lost a close friend.", weight: 5 }, { do: "retire", keepsake: "K2" }]);
});

test("a full list: the lowest-weight oldest is replaced only by one at least as heavy; otherwise refused and nothing is lost", () => {
  const list = [...full(3).slice(0, 19), keep(20, 2, NOW - 100 * DAY)];
  assert.equal(addKeepsake(list, { text: "Light", weight: 1 }, NOW, "n"), null);
  const replaced = addKeepsake(list, { text: "Equal to lowest", weight: 2 }, NOW, "n")!;
  assert.equal(replaced.length, 20);
  assert.ok(!replaced.some((item) => item.id === "k20") && replaced.some((item) => item.id === "n"));
  const sameWeight = addKeepsake(full(3), { text: "Heavier", weight: 3 }, NOW, "n")!;
  assert.ok(!sameWeight.some((item) => item.id === "k20"), "among equals the oldest goes (k20 was created longest ago)");
  assert.equal(addKeepsake(full(5), { text: "Four", weight: 4 }, NOW, "n"), null, "importance beats recency: nothing heavier is displaced");
});

test("the same text raises weight and never duplicates; retire is by code; retires run before adds", () => {
  const list = [keep(1, 2), keep(2, 4)];
  assert.deepEqual(addKeepsake(list, { text: "kept 1", weight: 5 }, NOW, "n")!.map((item) => [item.id, item.weight]), [["k1", 5], ["k2", 4]]);
  assert.deepEqual(addKeepsake(list, { text: "kept 2", weight: 1 }, NOW, "n"), list);
  const codes = new Map(keepsakeCodes(list).map((item) => [item.code, item.id] as const));
  const next = applyKeepsakeUpdates(full(3), [{ do: "add", text: "New", weight: 3 }, { do: "retire", keepsake: "K1" }], new Map([["K1", "k1"]]), NOW, "p")!;
  assert.equal(next.length, 20);
  assert.ok(next.some((item) => item.text === "New") && !next.some((item) => item.id === "k1"));
  assert.equal(applyKeepsakeUpdates([keep(1)], [{ do: "retire", keepsake: "K1" }], codes, NOW, "p"), undefined, "an empty list is absent");
});

test("chat sees the heaviest few, heaviest first, never the rest", () => {
  const list = [keep(1, 1), keep(2, 5), keep(3, 4), keep(4, 5, NOW - 100 * DAY), keep(5, 2), keep(6, 3), keep(7, 4)];
  assert.deepEqual(topKeepsakes(list).map((item) => item.id), ["k2", "k4", "k3", "k7", "k6"]);
  const record = { life: { activities: [], reconciledAt: NOW, keepsakes: list } } as never;
  const content = selfStateContent(selfState({ characterId: ID, timezone: "UTC", statusMessage: null }, undefined, record, NOW))!;
  assert.match(content, /Kept 2/);
  assert.doesNotMatch(content, /Kept 1"/);
  assert.match(content, /lifeKeepsake/);
  const noActions = selfStateContent(selfState({ characterId: ID, timezone: "UTC", statusMessage: null }, undefined, record, NOW, null, true, false))!;
  assert.doesNotMatch(noActions, /lifeKeepsake/);
});

const tag = (value: object) => `Hi.\n<veil-action>${JSON.stringify(value)}</veil-action>`;
test("the chat action is parsed strictly and applied once, without touching anything else", async () => {
  assert.deepEqual(splitActions(tag({ lifeKeepsake: { text: " Got  the job ", weight: 4 } })).actions?.lifeKeepsake, { text: "Got the job", weight: 4 });
  for (const bad of [{ text: "x", weight: 9 }, { text: "", weight: 3 }, { weight: 3 }, "x"]) assert.equal(splitActions(tag({ lifeKeepsake: bad })).actions?.lifeKeepsake, undefined);
  const values = new Map<string, string>();
  const store = createPresenceStorage(() => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }), () => undefined);
  const apply = characterActionApplier({ presence: store, foundation: { transact: async () => { throw new Error("unused"); } } as never });
  await apply(ID, { lifeKeepsake: { text: "Got the job", weight: 4 } }, NOW, "reply-1");
  await apply(ID, { lifeKeepsake: { text: "Got the job", weight: 4 } }, NOW + 1, "reply-2");
  const life = presenceRecord(await store.load(), ID)!.life!;
  assert.deepEqual(life.keepsakes!.map((item) => [item.text, item.weight]), [["Got the job", 4]]);
  assert.deepEqual(life.activities, []);
  const document = await store.load();
  assert.deepEqual(normalizePresenceDocument(JSON.parse(JSON.stringify(document))), document, "backup round trip");
  assert.ok(!JSON.stringify(removePresence(document, ID)).includes("Got the job"), "no residue after the Character is removed");
});

function fixture(text: string, keepsakes?: LifeKeepsake[]) {
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: ID, ...normalizeCharacterInput({ name: "Ada", timezone: "UTC" }) }];
  const values = new Map<string, string>();
  const store = createPresenceStorage(() => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }), () => undefined);
  const requests: string[] = [];
  const provider: TextProvider = async function* (_c, messages) { requests.push((messages as { content: string }[])[0].content); yield text; };
  const deps = { foundation: async () => foundation, presence: () => store.load(), bindings: async () => ({ global: {}, characters: {} }),
    presets: async () => createPresetDocument(), provider, write: (change: Parameters<typeof store.transact>[0]) => store.transact(change), now: () => NOW,
    api: async (id: string) => ({ id, apiKey: "k", model: "m", baseUrl: "https://example.test/v1" }) };
  const ready = store.transact((document) => {
    const withRoutine = setRoutine(document, ID, { defaultStatus: "online", jitterMinutes: 0, blocks: [] }, { changedAt: 0, source: null } as never);
    return keepsakes ? setLifeState(withRoutine, ID, { activities: [], reconciledAt: NOW, keepsakes }) : withRoutine;
  });
  return { deps, store, ready, requests };
}
const planWith = (keepsakes: object[]) => JSON.stringify({ activities: [{ start: "09:00", end: "11:00", kind: "work", title: "Rounds" }], keepsakes });

test("the day plan lists keepsakes with codes and applies adds and retires in the same write", async () => {
  const f = fixture(planWith([{ retire: "K2" }, { add: "Her mentor retired today.", weight: 4 }]), [keep(1, 2), keep(2, 5)]);
  await f.ready;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "generated");
  assert.match(f.requests[0], /K1 \(5\): Kept 2/);
  assert.match(f.requests[0], /K2 \(2\): Kept 1/);
  const life = presenceRecord(await f.store.load(), ID)!.life!;
  assert.deepEqual(life.keepsakes!.map((item) => item.text), ["Kept 2", "Her mentor retired today."]);
  assert.equal(life.plan!.status, "done");
});

test("without keepsakes nothing is stored or listed", async () => {
  const f = fixture(planWith([]));
  await f.ready;
  await ensureDayPlan(ID, undefined, f.deps);
  assert.equal("keepsakes" in presenceRecord(await f.store.load(), ID)!.life!, false);
  assert.doesNotMatch(f.requests[0], /lasting experiences \(code/);
  void emptyPresenceDocument;
});
