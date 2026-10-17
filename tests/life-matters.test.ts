import assert from "node:assert/strict";
import test from "node:test";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import type { LifeThread } from "../lib/life/activity";
import { ensureDayPlan } from "../lib/life/day-plan";
import { MATTER_IDLE_PAUSE_MS, MATTER_PAUSED_EXPIRE_MS, activeMatters, applyMatterUpdates, parseMatterUpdates, settleMatters } from "../lib/life/matters";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { createPresenceStorage, presenceRecord, removePresence, setLifeState, setRoutine, normalizePresenceDocument } from "../lib/presence/storage";

const ID = "char-a", DAY = 86_400_000, NOW = Date.UTC(2026, 9, 16, 8, 0);
const thread = (n: number, state: LifeThread["state"] = "active", updatedAt = NOW - DAY): LifeThread =>
  ({ id: `t${n}`, title: `Matter ${n}`, progress: `done ${n}`, next: `do ${n}`, state, createdAt: updatedAt - DAY + n, updatedAt });
const codes = (list: LifeThread[]) => new Map(list.map((item, index) => [`M${index + 1}`, item.id] as const));
const apply = (list: LifeThread[] | undefined, updates: Parameters<typeof applyMatterUpdates>[1]) =>
  applyMatterUpdates(list, updates, codes(list ?? []), NOW, "m");

test("a bad matters list changes nothing; bad entries are skipped", () => {
  for (const bad of ["", "{", "{}", '{"matters":"x"}', '{"matters":[{"do":"continue"}]}']) assert.deepEqual(parseMatterUpdates(bad), [], bad);
  const updates = parseMatterUpdates(JSON.stringify({ matters: [
    { do: "continue", matter: "M1", progress: "Moved", next: "Then this" }, { do: "continue", matter: "M2" }, { do: "pause", matter: "x" },
    { do: "FINISH", matter: "M3" }, { do: "new", title: "Move house", progress: "Looking", next: "Visit flats" }, { do: "new", title: "No next", progress: "x" },
    { do: "continue", matter: "M1", progress: "p".repeat(281) }] }));
  assert.deepEqual(updates, [{ do: "continue", matter: "M1", progress: "Moved", next: "Then this" }, { do: "finish", matter: "M3" },
    { do: "new", title: "Move house", progress: "Looking", next: "Visit flats" }]);
});

test("caps: a fourth matter enters paused, a sixth paused one is refused, nothing is dropped", () => {
  let list = [thread(1), thread(2), thread(3)];
  list = apply(list, [{ do: "new", title: "Fourth", progress: "a", next: "b" }])!;
  assert.deepEqual(list.map((item) => item.state), ["active", "active", "active", "paused"]);
  for (let index = 0; index < 4; index++) list = apply(list, [{ do: "new", title: `P${index}`, progress: "a", next: "b" }])!;
  assert.equal(list.length, 8);
  const full = apply(list, [{ do: "new", title: "Refused", progress: "a", next: "b" }])!;
  assert.equal(full.length, 8);
  assert.ok(!full.some((item) => item.title === "Refused"));
});

test("pause, resume, finish and cancel; resuming needs a free active place", () => {
  const list = [thread(1), thread(2), thread(3), thread(4, "paused")];
  assert.equal(apply(list, [{ do: "continue", matter: "M4", progress: "back" }])![3].state, "paused", "no free active place");
  const freed = apply(list, [{ do: "finish", matter: "M1" }, { do: "continue", matter: "M3", progress: "back" }]);
  assert.deepEqual(freed!.map((item) => item.id), ["t2", "t3", "t4"]);
  const resumed = applyMatterUpdates(list, [{ do: "finish", matter: "M1" }, { do: "continue", matter: "M4", progress: "back" }], codes(list), NOW, "m")!;
  assert.equal(resumed.find((item) => item.id === "t4")!.state, "active");
  assert.equal(resumed.find((item) => item.id === "t4")!.progress, "back");
  assert.equal(apply(list, [{ do: "pause", matter: "M2" }])![1].state, "paused");
  assert.equal(apply([thread(1)], [{ do: "cancel", matter: "M1" }]), undefined, "an empty list is absent, not []");
  assert.deepEqual(apply(list, [{ do: "finish", matter: "M9" }]), list, "an unknown code changes nothing");
});

test("14 idle days pauses an active matter, 30 paused days removes it; a full paused list keeps it active", () => {
  const idle = thread(1, "active", NOW - MATTER_IDLE_PAUSE_MS), old = thread(2, "paused", NOW - MATTER_PAUSED_EXPIRE_MS), fresh = thread(3, "paused", NOW - DAY);
  const settled = settleMatters([idle, old, fresh], NOW);
  assert.deepEqual(settled.map((item) => [item.id, item.state]), [["t1", "paused"], ["t3", "paused"]]);
  assert.equal(settled[0].updatedAt, NOW, "the 30 day clock starts when it paused");
  assert.deepEqual(settleMatters(settled, NOW), settled, "idempotent");
  const paused = [1, 2, 3, 4, 5].map((n) => thread(n + 10, "paused"));
  assert.equal(settleMatters([idle, ...paused], NOW)[0].state, "active");
  assert.deepEqual(activeMatters([idle, thread(5)], NOW).map((item) => item.id), ["t5"]);
});

test("chat context shows active matters only, and nothing when there are none", () => {
  const record = { life: { activities: [], reconciledAt: NOW, threads: [thread(1), thread(2, "paused")] } } as never;
  const content = selfStateContent(selfState({ characterId: ID, timezone: "UTC", statusMessage: null }, undefined, record, NOW))!;
  assert.match(content, /Matter 1/);
  assert.doesNotMatch(content, /Matter 2/);
  assert.doesNotMatch(selfStateContent(selfState({ characterId: ID, timezone: "UTC", statusMessage: null }, undefined, undefined, NOW)) ?? "", /several days/);
});

function fixture(text: string, threads?: LifeThread[]) {
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
    return threads ? setLifeState(withRoutine, ID, { activities: [], reconciledAt: NOW, threads }) : withRoutine;
  });
  return { deps, store, ready, requests };
}
const planWith = (matters: object[]) => JSON.stringify({ activities: [{ start: "09:00", end: "11:00", kind: "work", title: "Rounds" }], matters });

test("the day plan shows open matters with codes, applies the model's updates in the same write, and survives backup normalization", async () => {
  const f = fixture(planWith([{ do: "continue", matter: "M2", progress: "Signed", next: "Move boxes" }, { do: "finish", matter: "M1" },
    { do: "new", title: "Learn the cello", progress: "Rented one", next: "First lesson" }]), [thread(1), thread(2), thread(3, "paused")]);
  await f.ready;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "generated");
  assert.match(f.requests[0], /M1: Matter 1\. done 1\. Next: do 1/);
  assert.match(f.requests[0], /M3 \(paused\): Matter 3/);
  const life = presenceRecord(await f.store.load(), ID)!.life!;
  assert.deepEqual(life.threads!.map((item) => [item.title, item.state, item.progress]), [
    ["Matter 2", "active", "Signed"], ["Matter 3", "paused", "done 3"], ["Learn the cello", "active", "Rented one"]]);
  assert.equal(life.plan!.status, "done");
  const document = await f.store.load();
  assert.deepEqual(normalizePresenceDocument(JSON.parse(JSON.stringify(document))), document);
});

test("a finished matter is gone from the next prompt and from chat; a Character without matters keeps none", async () => {
  const f = fixture(planWith([{ do: "finish", matter: "M1" }]), [thread(1)]);
  await f.ready;
  await ensureDayPlan(ID, undefined, f.deps);
  const life = presenceRecord(await f.store.load(), ID)!.life!;
  assert.equal("threads" in life, false);
  const plain = fixture(planWith([]));
  await plain.ready;
  await ensureDayPlan(ID, undefined, plain.deps);
  assert.equal("threads" in presenceRecord(await plain.store.load(), ID)!.life!, false);
  assert.doesNotMatch(plain.requests[0], /Matters in their life/);
});

test("removing the Character's Presence record leaves no matters behind", async () => {
  const f = fixture(planWith([]), [thread(1)]);
  await f.ready;
  const document = await f.store.load();
  assert.equal(presenceRecord(removePresence(document, ID), ID), undefined);
  assert.ok(!JSON.stringify(removePresence(document, ID)).includes("Matter 1"));
});

test("updates are applied so a later finish still frees a place for an earlier resume, and new ids never collide", () => {
  const list = [thread(1), thread(2), thread(3), thread(4, "paused")];
  const resumed = apply(list, [{ do: "continue", matter: "M4", progress: "back" }, { do: "finish", matter: "M1" }])!;
  assert.equal(resumed.find((item) => item.id === "t4")!.state, "active");
  const first = apply([], [{ do: "new", title: "A", progress: "a", next: "b" }])!, second = apply(first, [{ do: "new", title: "B", progress: "a", next: "b" }])!;
  assert.equal(new Set(second.map((item) => item.id)).size, 2);
});
