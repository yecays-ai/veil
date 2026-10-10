import assert from "node:assert/strict";
import test from "node:test";
import { LAST_ONLINE_LOOKBACK_MS, SITUATION_MAX_MS, effectivePresence, lastOnlineAt, type PresenceRoutine } from "../lib/presence/compute";
import { MAX_STORED_SITUATIONS, PRESENCE_STORAGE_KEY, addSituation, advanceLastSeen, cancelUpcoming, createPresenceStorage, emptyPresenceDocument,
  endSituation, markSignatureChange, normalizePresenceDocument, normalizeRoutine, presenceRecord, removePresence, setRoutine } from "../lib/presence/storage";

const KEY = PRESENCE_STORAGE_KEY, A = "char-a", B = "char-b", HOUR = 3_600_000;
const routine: PresenceRoutine = { blocks: [{ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080, status: "busy" }], defaultStatus: "online", jitterMinutes: 30 };
const mark = (changedAt: number, source: string | null = null) => ({ changedAt, source });
const away = (startsAt: number, endsAt: number, reason: string | null = null) => ({ status: "away" as const, reason, startsAt, endsAt });

function origin() {
  const values = new Map<string, string>(), writes: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const locks = { request: (async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
    const run = tail.then(() => callback({}), () => callback({}));
    tail = run.then(() => {}, () => {});
    return run;
  }) as unknown as LockManager["request"] };
  const backend = (failWrites = false) => ({ getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error("Quota exceeded"); writes.push(value); values.set(key, value); } });
  return { values, writes, tab: (failWrites = false) => createPresenceStorage(() => backend(failWrites), () => locks) };
}

test("each Character has its own record and changing one never touches another", () => {
  let document = setRoutine(emptyPresenceDocument(), A, routine, mark(1, "generated"));
  document = addSituation(document, B, away(10, 20), mark(10, "msg-1"), 10);
  const a = presenceRecord(document, A)!, b = presenceRecord(document, B)!;
  assert.deepEqual([a.routine?.routine, a.situations.length], [routine, 0]);
  assert.deepEqual([b.routine, b.situations.length], [null, 1]);
  const next = advanceLastSeen(document, B, { lastMessageAt: 15 }, 20);
  assert.equal(presenceRecord(next, A), a, "A is the very same record");
  assert.equal(presenceRecord(removePresence(next, B), A), a);
  assert.equal(presenceRecord(removePresence(next, B), B), undefined);
  assert.equal(removePresence(next, "nobody"), next);
  assert.throws(() => setRoutine(document, "__proto__", routine, mark(1)), /Invalid Character ID/);
});

test("Last Seen values only move forward; lower, equal, invalid and far-future values are ignored", () => {
  const start = advanceLastSeen(emptyPresenceDocument(), A, { lastOnlineAt: 1_000, lastMessageAt: 2_000 }, 3_000);
  const read = (document: typeof start) => { const r = presenceRecord(document, A)!; return [r.lastOnlineAt, r.lastMessageAt]; };
  assert.deepEqual(read(start), [1_000, 2_000]);
  const raised = advanceLastSeen(start, A, { lastOnlineAt: 2_500, lastMessageAt: 1_500 }, 3_000);
  assert.deepEqual(read(raised), [2_500, 2_000], "each value is judged on its own");
  for (const bad of [{ lastOnlineAt: 100 }, { lastOnlineAt: 2_500 }, { lastOnlineAt: NaN }, { lastOnlineAt: -5 }, { lastMessageAt: null },
    { lastOnlineAt: 3_000 + 3_600_000 }, {}]) assert.equal(advanceLastSeen(raised, A, bad, 3_000), raised, JSON.stringify(bad));
  assert.deepEqual(read(advanceLastSeen(raised, A, { lastOnlineAt: 3_030 }, 3_000)), [3_030, 2_000], "a small clock skew is allowed");
  // A first value for a Character that has no record yet is stored; an invalid first one creates nothing.
  assert.equal(advanceLastSeen(emptyPresenceDocument(), A, { lastOnlineAt: NaN }, 1).characters.length, 0);
});

test("only one situation may be upcoming, a current one leaves it alone, and old ones are pruned", () => {
  const now = 100 * HOUR;
  let document = addSituation(emptyPresenceDocument(), A, away(now - HOUR, now + HOUR), mark(now - HOUR, "m1"), now - HOUR);
  document = addSituation(document, A, away(now + 5 * HOUR, now + 6 * HOUR), mark(now, "m2"), now);
  document = addSituation(document, A, away(now + 8 * HOUR, now + 9 * HOUR), mark(now, "m3"), now);
  const list = () => presenceRecord(document, A)!.situations.map((s) => s.source);
  assert.deepEqual(list(), ["m1", "m3"], "a new upcoming situation replaces the previous upcoming one");
  document = addSituation(document, A, away(now, now + 10 * HOUR), mark(now, "m4"), now);
  assert.deepEqual(list(), ["m1", "m4", "m3"], "a current situation does not remove the upcoming one");
  document = addSituation(document, A, away(now, now + HOUR), mark(now, "m5"), now);
  assert.deepEqual(list(), ["m1", "m5", "m3"], "a situation starting at the same moment replaces the one already stored");
  assert.deepEqual(presenceRecord(cancelUpcoming(document, A, now), A)!.situations.map((s) => s.source), ["m1", "m5"]);
  document = cancelUpcoming(document, A, now);
  const later = now + LAST_ONLINE_LOOKBACK_MS + 2 * HOUR;
  document = addSituation(document, A, away(later, later + HOUR), mark(later, "m6"), later);
  assert.deepEqual(list(), ["m6"], "situations that ended before the look-back are dropped");
  for (let i = 0; i < 20; i++) document = addSituation(document, A, away(later + i, later + i + 1), mark(later, `n${i}`), later + i);
  assert.equal(presenceRecord(document, A)!.situations.length, MAX_STORED_SITUATIONS);
  assert.throws(() => addSituation(document, A, away(5, 5), mark(1), 1), /Invalid situation/);
  assert.throws(() => addSituation(document, A, away(0, SITUATION_MAX_MS + 1), mark(1), 1), /Invalid situation/);
  assert.throws(() => addSituation(document, A, { ...away(1, 2), status: "gone" as never }, mark(1), 1), /Invalid situation/);
});

test("a routine is stored whole or not at all, and the signature keeps only its change mark", () => {
  assert.deepEqual(normalizeRoutine({ ...routine, jitterMinutes: 9_999 })?.jitterMinutes, 120);
  assert.deepEqual(normalizeRoutine({ ...routine, blocks: [{ ...routine.blocks[0], days: [1, 1, 0] }] })?.blocks[0].days, [0, 1]);
  for (const bad of [null, {}, { ...routine, defaultStatus: "gone" }, { ...routine, blocks: [{ ...routine.blocks[0], startMinute: 1440 }] },
    { ...routine, blocks: [{ ...routine.blocks[0], days: [7] }] }, { ...routine, blocks: [{ ...routine.blocks[0], days: [] }] },
    { ...routine, blocks: [routine.blocks[0], { days: [1], startMinute: 1, endMinute: 2, status: "x" }] },
    { ...routine, blocks: Array.from({ length: 25 }, () => routine.blocks[0]) }]) assert.equal(normalizeRoutine(bad), null, JSON.stringify(bad));
  assert.throws(() => setRoutine(emptyPresenceDocument(), A, { ...routine, defaultStatus: "gone" as never }, mark(1)), /Invalid routine/);
  const document = markSignatureChange(setRoutine(emptyPresenceDocument(), A, routine, mark(5, "generated")), A, mark(9, "msg-9"));
  const record = presenceRecord(document, A)!;
  assert.deepEqual([record.routine, record.signature], [{ routine, changedAt: 5, source: "generated" }, { changedAt: 9, source: "msg-9" }]);
});

test("reading tolerates damaged records: bad rows are dropped, good ones keep their values", () => {
  const raw = { version: 1, characters: [
    { characterId: A, routine: { routine, changedAt: 3, source: " x ".repeat(80) }, lastOnlineAt: 7, lastMessageAt: "soon",
      situations: [{ ...away(1, 2), changedAt: 1, source: null }, { ...away(5, 3) }, { status: "away" }, null],
      signature: { changedAt: 4, source: "msg" } },
    { characterId: A, lastOnlineAt: 99 }, { characterId: "" }, { characterId: "__proto__" }, null, "text", { routine }] };
  const document = normalizePresenceDocument(raw);
  assert.deepEqual(document.characters.map((c) => c.characterId), [A], "duplicates, empty and reserved IDs and non-records are dropped");
  const record = presenceRecord(document, A)!;
  assert.deepEqual([record.lastOnlineAt, record.lastMessageAt, record.situations.length, record.signature], [7, null, 1, { changedAt: 4, source: "msg" }]);
  assert.equal(record.routine!.source!.length <= 100, true);
  for (const junk of [null, undefined, 5, "x", [], { characters: "no" }]) assert.deepEqual(normalizePresenceDocument(junk), emptyPresenceDocument());
});

test("an update that changes nothing writes nothing", async () => {
  const o = origin(), tab = o.tab();
  await tab.transact((d) => d);
  await tab.transact((d) => removePresence(d, A));
  assert.equal(o.writes.length, 0, "an empty store is never created just by reading or no-op updates");
  await tab.transact((d) => advanceLastSeen(d, A, { lastMessageAt: 50 }, 100));
  assert.equal(o.writes.length, 1);
  await tab.transact((d) => advanceLastSeen(d, A, { lastMessageAt: 40 }, 100));
  await tab.transact((d) => advanceLastSeen(d, A, { lastMessageAt: 50 }, 100));
  assert.equal(o.writes.length, 1, "lower and equal values do not rewrite the store");
});

test("stored data that cannot be read or is from a newer version is never overwritten", async () => {
  for (const stored of ["{not json", JSON.stringify({ version: 2, characters: [{ characterId: A, lastOnlineAt: 1 }] })]) {
    const o = origin(); o.values.set(KEY, stored);
    const tab = o.tab();
    await assert.rejects(tab.load());
    await assert.rejects(tab.transact((d) => advanceLastSeen(d, A, { lastOnlineAt: 5 }, 10)));
    assert.equal(o.values.get(KEY), stored);
    assert.equal(o.writes.length, 0);
  }
});

test("a failed write keeps the stored data and does not block later writes", async () => {
  const o = origin();
  await o.tab().transact((d) => advanceLastSeen(d, A, { lastMessageAt: 10 }, 20));
  const saved = o.values.get(KEY);
  const failing = o.tab(true);
  await assert.rejects(failing.transact((d) => advanceLastSeen(d, A, { lastMessageAt: 15 }, 20)), /Quota/);
  assert.equal(o.values.get(KEY), saved);
  await failing.transact((d) => d);
  await o.tab().transact((d) => advanceLastSeen(d, A, { lastMessageAt: 15 }, 20));
  assert.equal(presenceRecord(await o.tab().load(), A)!.lastMessageAt, 15);
});

test("writes from several tabs run one at a time, keep every Character's change and never lower Last Seen", async () => {
  const o = origin(), tabs = [o.tab(), o.tab(), o.tab()];
  await Promise.all([
    tabs[0].transact((d) => advanceLastSeen(d, A, { lastOnlineAt: 30 }, 100)),
    tabs[1].transact((d) => advanceLastSeen(d, A, { lastOnlineAt: 20 }, 100)),
    tabs[2].transact((d) => setRoutine(d, B, routine, mark(1))),
    tabs[1].transact((d) => advanceLastSeen(d, A, { lastOnlineAt: 10, lastMessageAt: 60 }, 100)),
  ]);
  const document = await o.tab().load();
  const a = presenceRecord(document, A)!;
  assert.deepEqual([a.lastOnlineAt, a.lastMessageAt, presenceRecord(document, B)!.routine?.routine], [30, 60, routine]);
});

test("a change in another tab between the read and the write is picked up by retrying", async () => {
  const o = origin();
  await o.tab().transact((d) => advanceLastSeen(d, A, { lastOnlineAt: 10 }, 100));
  let reads = 0;
  const racing = createPresenceStorage(() => ({ getItem: (key: string) => {
    if (++reads === 2) o.values.set(key, JSON.stringify({ version: 1, characters: [...JSON.parse(o.values.get(key)!).characters, { characterId: B, lastOnlineAt: 77 }] }));
    return o.values.get(key) ?? null;
  }, setItem: (key: string, value: string) => { o.values.set(key, value); } }), () => undefined);
  await racing.transact((d) => advanceLastSeen(d, A, { lastOnlineAt: 20 }, 100));
  const document = await o.tab().load();
  assert.deepEqual([presenceRecord(document, A)!.lastOnlineAt, presenceRecord(document, B)!.lastOnlineAt], [20, 77]);
});

// What storage hands the calculator: situations with their own original ends, at most two running at once. The
// calculator shows the one that started last, so a base shows again when the interruption on top of it ends.
type Doc = ReturnType<typeof emptyPresenceDocument>;
const stateAt = (document: Doc, at: number) =>
  effectivePresence({ characterId: A, timezone: "UTC", routine: null, situations: presenceRecord(document, A)?.situations ?? [] }, at);
const status = (value: Parameters<typeof addSituation>[2]["status"], startsAt: number, endsAt: number) => ({ status: value, reason: null, startsAt, endsAt });
const rows = (document: Doc) => presenceRecord(document, A)!.situations.map((s) => [s.source, s.startsAt, s.endsAt]);
const T = 100 * HOUR;
const trip = (document: Doc = emptyPresenceDocument()) => addSituation(document, A, status("away", T, T + 48 * HOUR), mark(T, "trip"), T);
const call = (document: Doc, at = T + 10 * HOUR, length = HOUR / 2) =>
  addSituation(document, A, status("busy", at, at + length), mark(at, "call"), at);

test("a short activity inside a long situation ends and the long one resumes, with its original end", () => {
  const document = call(trip());
  assert.deepEqual(rows(document), [["trip", T, T + 48 * HOUR], ["call", T + 10 * HOUR, T + 10.5 * HOUR]], "the trip keeps its original end");
  assert.deepEqual([T + 5 * HOUR, T + 10.25 * HOUR, T + 10.5 * HOUR, T + 47 * HOUR, T + 48 * HOUR].map((at) => stateAt(document, at).status),
    ["away", "busy", "away", "away", "offline"], "only after the trip ends does the routine (none here: offline) decide");
  // A third situation while two run replaces the middle one from that moment; the base is kept.
  const third = addSituation(document, A, status("dnd", T + 10.25 * HOUR, T + 10.4 * HOUR), mark(T + 10.25 * HOUR, "focus"), T + 10.25 * HOUR);
  assert.deepEqual(rows(third), [["trip", T, T + 48 * HOUR], ["call", T + 10 * HOUR, T + 10.25 * HOUR], ["focus", T + 10.25 * HOUR, T + 10.4 * HOUR]]);
  assert.deepEqual([T + 10.3 * HOUR, T + 10.45 * HOUR].map((at) => stateAt(third, at).status), ["dnd", "away"], "back to the trip, not to the call");
  for (const at of [T, T + 10 * HOUR, T + 10.25 * HOUR, T + 20 * HOUR])
    assert(presenceRecord(third, A)!.situations.filter((s) => s.startsAt <= at && at < s.endsAt).length <= 2);
});

test("a planned situation interrupts the running one when it starts, and a cancelled plan never takes effect", () => {
  let document = addSituation(trip(), A, status("busy", T + 30 * HOUR, T + 31 * HOUR), mark(T, "plan"), T);
  document = call(document, T + 10 * HOUR);
  assert.deepEqual(rows(document).map((row) => row[0]), ["trip", "call", "plan"], "a new current situation keeps the upcoming one");
  assert.deepEqual([T + 30.5 * HOUR, T + 32 * HOUR].map((at) => stateAt(document, at).status), ["busy", "away"]);
  const replaced = addSituation(document, A, status("dnd", T + 40 * HOUR, T + 41 * HOUR), mark(T + 11 * HOUR, "plan2"), T + 11 * HOUR);
  assert.deepEqual(rows(replaced).map((row) => row[0]), ["trip", "call", "plan2"], "replacing drops the old plan");
  assert.equal(stateAt(replaced, T + 30.5 * HOUR).status, "away");
  const cancelled = cancelUpcoming(document, A, T + 11 * HOUR);
  assert.deepEqual(rows(cancelled).map((row) => row[0]), ["trip", "call"]);
  assert.equal(stateAt(cancelled, T + 30.5 * HOUR).status, "away", "the cancelled plan is gone at its start time");
  assert.equal(cancelUpcoming(cancelled, A, T + 11 * HOUR), cancelled, "nothing to cancel changes nothing");
  // A plan that starts while two are running replaces the upper one at that moment.
  const crowded = addSituation(call(trip(), T + 10 * HOUR, 5 * HOUR), A, status("dnd", T + 12 * HOUR, T + 13 * HOUR), mark(T, "plan"), T + 11 * HOUR);
  assert.deepEqual(rows(crowded), [["trip", T, T + 48 * HOUR], ["call", T + 10 * HOUR, T + 12 * HOUR], ["plan", T + 12 * HOUR, T + 13 * HOUR]]);
});

test("ending the current situation reveals the one under it; ending all returns to the routine; upcoming ones stay", () => {
  const planned = addSituation(call(trip()), A, status("dnd", T + 30 * HOUR, T + 31 * HOUR), mark(T, "plan"), T + 10.1 * HOUR);
  const now = T + 10.25 * HOUR;
  const current = endSituation(planned, A, now, "current");
  assert.deepEqual(rows(current), [["trip", T, T + 48 * HOUR], ["call", T + 10 * HOUR, now], ["plan", T + 30 * HOUR, T + 31 * HOUR]]);
  assert.deepEqual([now, T + 11 * HOUR].map((at) => stateAt(current, at).status), ["away", "away"]);
  const all = endSituation(planned, A, now, "all");
  assert.deepEqual(rows(all), [["trip", T, now], ["call", T + 10 * HOUR, now], ["plan", T + 30 * HOUR, T + 31 * HOUR]]);
  assert.deepEqual([now, T + 11 * HOUR, T + 30.5 * HOUR].map((at) => stateAt(all, at).status), ["offline", "offline", "dnd"], "the routine, then the plan still happens");
  const peeled = endSituation(current, A, now, "current");
  assert.deepEqual(rows(peeled), [["trip", T, now], ["call", T + 10 * HOUR, now], ["plan", T + 30 * HOUR, T + 31 * HOUR]], "ending again peels the next layer");
  assert.equal(endSituation(emptyPresenceDocument(), A, now, "all").characters.length, 0);
  assert.equal(endSituation(all, A, now, "all"), all, "nothing running changes nothing");
  // A situation that started this very moment is removed outright rather than stored with no length.
  const fresh = endSituation(call(trip(), T + 10 * HOUR), A, T + 10 * HOUR, "current");
  assert.deepEqual(rows(fresh).map((row) => row[0]), ["trip"]);
});

test("Last Seen looks back through the same layers: a call during a trip counts, the trip does not", () => {
  const document = call(trip(), T + 10 * HOUR);
  const inputs = { characterId: A, timezone: "UTC", routine: { blocks: [], defaultStatus: "offline" as const, jitterMinutes: 0 },
    situations: presenceRecord(document, A)!.situations.map((s) => ({ ...s, status: s.source === "call" ? "online" as const : "away" as const })) };
  assert.equal(lastOnlineAt(inputs, T + 20 * HOUR), T + 10.5 * HOUR, "the call ended at 10.5h; the trip took over again");
  assert.equal(lastOnlineAt(inputs, T + 10.25 * HOUR), T + 10.25 * HOUR);
});

test("overlapping stored situations are limited to two layers when read, the same for any stored order", () => {
  const stored = [
    { ...status("away", 0, 40 * HOUR), changedAt: 0, source: "trip" }, { ...status("busy", 4 * HOUR, 20 * HOUR), changedAt: 4 * HOUR, source: "call" },
    { ...status("dnd", 6 * HOUR, 9 * HOUR), changedAt: 6 * HOUR, source: "focus" }, { ...status("offline", 6 * HOUR, 8 * HOUR), changedAt: 6 * HOUR + 1, source: "later" },
    { ...status("busy", 50 * HOUR, 51 * HOUR), changedAt: 1, source: "next" }];
  const read = (order: typeof stored) => presenceRecord(normalizePresenceDocument({ version: 1, characters: [{ characterId: A, situations: order }] }), A)!.situations;
  const expected = [["trip", 0, 40 * HOUR], ["call", 4 * HOUR, 6 * HOUR], ["later", 6 * HOUR, 8 * HOUR], ["next", 50 * HOUR, 51 * HOUR]];
  for (const order of [stored, [...stored].reverse(), [stored[3], stored[0], stored[4], stored[2], stored[1]]])
    assert.deepEqual(read(order).map((s) => [s.source, s.startsAt, s.endsAt]), expected);
});

test("the size cap and pruning never drop a long situation that is still running", () => {
  let document = trip();
  for (let i = 0; i < 12; i++) document = call(document, T + (i + 1) * 3 * HOUR, HOUR);
  const list = presenceRecord(document, A)!.situations;
  assert.equal(list.length, MAX_STORED_SITUATIONS);
  assert(list.some((s) => s.source === "trip"), "the trip started before every kept call but is still running");
  assert.equal(stateAt(document, T + 12 * 3 * HOUR + 2 * HOUR).status, "away", "after the last call the trip shows again");
  // Writing after everything ended prunes it all, including the trip.
  const later = T + 48 * HOUR + LAST_ONLINE_LOOKBACK_MS + HOUR;
  const pruned = addSituation(document, A, status("busy", later, later + HOUR), mark(later, "late"), later);
  assert.deepEqual(presenceRecord(pruned, A)!.situations.map((s) => s.source), ["late"]);
});
