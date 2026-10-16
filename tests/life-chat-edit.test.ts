import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIFE_EDIT_COOLDOWN_MS, applyLifeEdit, lifeChoices } from "../lib/life/chat-edit";
import { normalizeLifeState, type LifeActivity, type LifeState } from "../lib/life/activity";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { characterActionApplier, splitActions } from "../lib/presence/actions";
import { normalizeCharacterInput } from "../lib/foundation-types";
import { addSituation, createPresenceStorage, emptyPresenceDocument, normalizePresenceDocument, presenceRecord, setLifeState, setRoutine } from "../lib/presence/storage";

const HOUR = 3_600_000, NOON = Date.UTC(2026, 9, 12, 12);
const mark = { changedAt: 0, source: null } as never;
const character = { characterId: "a", ...normalizeCharacterInput({ name: "A", timezone: "UTC" }) };
const row = (id: string, startsAt: number, endsAt: number, extra: Partial<LifeActivity> = {}): LifeActivity =>
  ({ id: `life:${id}`, occurrenceKey: `a|${id}`, kind: "work", title: `T-${id}`, startsAt, endsAt, ...extra });
const docWith = (activities: LifeActivity[], extra: Partial<LifeState> = {}) =>
  setLifeState(emptyPresenceDocument(), "a", { activities, reconciledAt: NOON, ...extra });
const base = () => docWith([
  row("done", NOON - 3 * HOUR, NOON - HOUR, { moment: "Earlier." }),
  row("run", NOON - HOUR, NOON + HOUR, { moment: "Revealed later." }),
  row("p1", NOON + 2 * HOUR, NOON + 3 * HOUR, { origin: "plan", moment: "Unstarted." }),
  row("p2", NOON + 4 * HOUR, NOON + 5 * HOUR, { origin: "plan" }),
  row("skel", NOON + 5 * HOUR, NOON + 6 * HOUR)]);
const life = (document: ReturnType<typeof base>) => presenceRecord(document, "a")!.life!;
const find = (document: ReturnType<typeof base>, id: string) => life(document).activities.find((item) => item.id === `life:${id}`);

test("choices are the running activity and own plan rows still ahead today, coded for this reply", () => {
  const choices = lifeChoices(life(base()), NOON, "UTC");
  assert.deepEqual(choices.map((item) => [item.code, item.id, item.running]), [["L1", "life:run", true], ["L2", "life:p1", false], ["L3", "life:p2", false]]);
  assert.deepEqual(lifeChoices(life(docWith([row("skel", NOON + HOUR, NOON + 2 * HOUR)])), NOON, "UTC"), [], "Routine rows ahead are not offered");
  assert.deepEqual(lifeChoices(life(docWith(base() && [row("run", NOON - HOUR, NOON + HOUR)], { actedAt: NOON - 10 * 60_000 })), NOON, "UTC"), [], "inside the cooldown nothing is offered");
});

test("cancel: an unstarted plan row is kept as cancelled; the running one is cut at now and what happened stays", () => {
  const planned = applyLifeEdit(base(), "a", { action: "cancel", id: "life:p1" }, NOON, "m1");
  assert.equal(find(planned, "p1")?.state, "cancelled");
  assert.equal(life(planned).actedAt, NOON);
  const running = applyLifeEdit(base(), "a", { action: "cancel", id: "life:run" }, NOON, "m1");
  assert.equal(find(running, "run")?.endsAt, NOON);
  assert.equal(find(running, "run")?.moment, undefined, "an unrevealed Moment is not kept");
  assert.deepEqual(find(running, "done"), find(base(), "done"), "finished history is untouched");
});

test("replace: retitles an unstarted plan row; cuts the running activity and continues it under the new title", () => {
  const planned = applyLifeEdit(base(), "a", { action: "replace", id: "life:p1", title: "Dentist" }, NOON, "m1");
  assert.equal(find(planned, "p1")?.title, "Dentist");
  assert.equal(find(planned, "p1")?.moment, undefined);
  const running = applyLifeEdit(base(), "a", { action: "replace", id: "life:run", title: "Called away" }, NOON, "m2");
  assert.deepEqual([find(running, "run")?.endsAt, find(running, "a:chat:m2")?.title, find(running, "a:chat:m2")?.startsAt, find(running, "a:chat:m2")?.endsAt, find(running, "a:chat:m2")?.origin],
    [NOON, "Called away", NOON, NOON + HOUR, "plan"]);
});

test("detail: adds one small thing to the running activity, never over an existing one or to anything else", () => {
  const none = docWith([row("run", NOON - HOUR, NOON + HOUR)]);
  assert.equal(find(applyLifeEdit(none, "a", { action: "detail", id: "life:run", moment: "Spilled coffee." }, NOON, "m"), "run")?.moment, "Spilled coffee.");
  const same = base();
  assert.equal(applyLifeEdit(same, "a", { action: "detail", id: "life:run", moment: "Overwrite." }, NOON, "m"), same, "an existing Moment is never overwritten");
  assert.equal(applyLifeEdit(same, "a", { action: "detail", id: "life:p1", moment: "Not started." }, NOON, "m"), same, "an unstarted row has nothing to add to");
  assert.equal(applyLifeEdit(same, "a", { action: "detail", id: "life:done", moment: "Late." }, NOON, "m"), same, "a finished row is history");
});

test("delay: moves an unstarted plan row later, yields to later plan rows and Situations, and Routine rows give way", () => {
  const moved = applyLifeEdit(base(), "a", { action: "delay", id: "life:p1", minutes: 30 }, NOON, "m");
  assert.deepEqual([find(moved, "p1")?.startsAt, find(moved, "p1")?.endsAt], [NOON + 2.5 * HOUR, NOON + 3.5 * HOUR]);
  const clipped = applyLifeEdit(base(), "a", { action: "delay", id: "life:p1", minutes: 90 }, NOON, "m");
  assert.deepEqual([find(clipped, "p1")?.startsAt, find(clipped, "p1")?.endsAt], [NOON + 3.5 * HOUR, NOON + 4 * HOUR], "the end yields to the later plan row");
  const over = docWith([row("p1", NOON + 2 * HOUR, NOON + 3 * HOUR, { origin: "plan" }), row("skel", NOON + 3 * HOUR, NOON + 5 * HOUR)]);
  const pushed = applyLifeEdit(over, "a", { action: "delay", id: "life:p1", minutes: 60 }, NOON, "m");
  assert.deepEqual([find(pushed, "p1")?.startsAt, find(pushed, "skel")], [NOON + 3 * HOUR, undefined], "an unstarted Routine row in the way is dropped, not overlapped");
});

test("delay refused: too small or large, inside a later plan row, a running or a Routine row", () => {
  const document = base();
  for (const minutes of [0, 4, 241, 1.5]) assert.equal(applyLifeEdit(document, "a", { action: "delay", id: "life:p1", minutes }, NOON, "m"), document);
  assert.equal(applyLifeEdit(document, "a", { action: "delay", id: "life:p1", minutes: 150 }, NOON, "m"), document, "would start inside the later plan row");
  assert.equal(applyLifeEdit(document, "a", { action: "delay", id: "life:run", minutes: 30 }, NOON, "m"), document, "a running activity is not moved");
  assert.equal(applyLifeEdit(document, "a", { action: "delay", id: "life:skel", minutes: 30 }, NOON, "m"), document, "a Routine row is not the Character's plan");
  const withSituation = addSituation(document, "a", { status: "busy", reason: "Meeting", startsAt: NOON + 2.5 * HOUR, endsAt: NOON + 3.5 * HOUR }, mark, NOON);
  assert.equal(applyLifeEdit(withSituation, "a", { action: "delay", id: "life:p1", minutes: 30 }, NOON, "m"), withSituation, "may not start inside a Situation");
});

test("unknown, finished, cancelled and missing rows, and a second change inside the cooldown, change nothing", () => {
  const document = base();
  for (const id of ["life:nope", "life:done", "life:other:a"]) assert.equal(applyLifeEdit(document, "a", { action: "cancel", id }, NOON, "m"), document);
  assert.equal(applyLifeEdit(document, "b", { action: "cancel", id: "life:p1" }, NOON, "m"), document, "another Character's data is never touched");
  const first = applyLifeEdit(document, "a", { action: "cancel", id: "life:p1" }, NOON, "m");
  assert.equal(applyLifeEdit(first, "a", { action: "cancel", id: "life:p2" }, NOON + 60_000, "m2"), first, "cooldown");
  assert.equal(find(applyLifeEdit(first, "a", { action: "cancel", id: "life:p2" }, NOON + LIFE_EDIT_COOLDOWN_MS, "m3"), "p2")?.state, "cancelled");
  assert.equal(applyLifeEdit(first, "a", { action: "cancel", id: "life:p1" }, NOON + LIFE_EDIT_COOLDOWN_MS, "m4"), first, "already cancelled");
});

test("the record round-trips through backup normalization and an invalid actedAt is left out", () => {
  const document = applyLifeEdit(base(), "a", { action: "cancel", id: "life:p1" }, NOON, "m");
  assert.deepEqual(normalizePresenceDocument(JSON.parse(JSON.stringify(document))), document);
  assert.equal(normalizeLifeState({ ...life(document), actedAt: -5 })?.actedAt, undefined);
  assert.equal(life(base()).actedAt, undefined, "absent until the first change");
});

test("the action line is parsed strictly and only a coded entry of this reply is offered", () => {
  const tag = (value: object) => `Hi.<veil-action>${JSON.stringify(value)}</veil-action>`;
  assert.deepEqual(splitActions(tag({ life: { action: "delay", target: "L2", minutes: 30 } })).actions?.life, { action: "delay", target: "L2", minutes: 30 });
  assert.deepEqual(splitActions(tag({ life: { action: "replace", target: "L1", title: " Called  away " } })).actions?.life, { action: "replace", target: "L1", title: "Called away" });
  for (const bad of [{ action: "delay", target: "L2" }, { action: "replace", target: "L1" }, { action: "detail", target: "L1", moment: "" },
    { action: "erase", target: "L1" }, { action: "cancel", target: "life:p1" }, { action: "cancel", target: "L100" }, { action: "cancel" }])
    assert.equal(splitActions(tag({ life: bad })).actions?.life, undefined, JSON.stringify(bad));
  const record = presenceRecord(base(), "a");
  const text = selfStateContent(selfState(character, undefined, record, NOON))!;
  assert.match(text, /L1 = 12:00–13:00 = "T-run"|L1 = 11:00–13:00 = "T-run" \(happening now\)/);
  assert.match(text, /L2 = 14:00–15:00 = "T-p1"/);
  assert.match(text, /"life": \{"action"/);
  assert.equal(selfState(character, undefined, record, NOON, null, true, false).lifeChoices, undefined, "Continue offers nothing");
  const cooled = presenceRecord(applyLifeEdit(base(), "a", { action: "cancel", id: "life:p1" }, NOON, "m"), "a");
  assert.doesNotMatch(selfStateContent(selfState(character, undefined, cooled, NOON + 60_000))!, /"life": \{"action"/);
});

test("the applier saves the change once through Presence, and a failure never throws", async () => {
  const values = new Map<string, string>();
  const store = createPresenceStorage(() => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }), () => undefined);
  await store.transact(() => base());
  const apply = characterActionApplier({ presence: store, foundation: { transact: async () => { throw new Error("unused"); } } as never });
  await apply("a", { life: { action: "cancel", target: "life:p1" } }, NOON, "reply-1");
  assert.equal(find(await store.load() as never, "p1")?.state, "cancelled");
  await apply("a", { life: { action: "cancel", target: "life:p2" } }, NOON + 1000, "reply-2");
  assert.equal(find(await store.load() as never, "p2")?.state, undefined, "second change inside the cooldown");
  await apply("a", { life: { action: "cancel", target: "life:missing" } }, NOON + LIFE_EDIT_COOLDOWN_MS + 5, "reply-3");
  void setRoutine;
});

test("the chat engine swaps the code for a row ID only from this reply's offered list", () => {
  const engine = readFileSync("lib/chat/engine.ts", "utf8");
  assert.match(engine, /offered\?\.lifeChoices\?\.find\(\(item\) => item\.code === ownChanges\.life!\.target\)/);
  assert.match(engine, /else delete ownChanges\.life/);
});
