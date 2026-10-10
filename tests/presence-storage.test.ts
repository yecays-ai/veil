import assert from "node:assert/strict";
import test from "node:test";
import { LAST_ONLINE_LOOKBACK_MS, SITUATION_MAX_MS, type PresenceRoutine } from "../lib/presence/compute";
import { MAX_STORED_SITUATIONS, PRESENCE_STORAGE_KEY, addSituation, advanceLastSeen, createPresenceStorage, emptyPresenceDocument,
  markSignatureChange, normalizePresenceDocument, normalizeRoutine, presenceRecord, removePresence, setRoutine } from "../lib/presence/storage";

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

test("one situation may be upcoming, a current one replaces only what it overlaps, and old ones are pruned", () => {
  const now = 100 * HOUR;
  let document = addSituation(emptyPresenceDocument(), A, away(now - HOUR, now + HOUR), mark(now - HOUR, "m1"), now - HOUR);
  document = addSituation(document, A, away(now + 5 * HOUR, now + 6 * HOUR), mark(now, "m2"), now);
  document = addSituation(document, A, away(now + 8 * HOUR, now + 9 * HOUR), mark(now, "m3"), now);
  const list = () => presenceRecord(document, A)!.situations.map((s) => s.source);
  assert.deepEqual(list(), ["m1", "m3"], "a new upcoming situation replaces the previous upcoming one");
  document = addSituation(document, A, away(now, now + 10 * HOUR), mark(now, "m4"), now);
  assert.deepEqual(list(), ["m1", "m4"], "a current situation overlapping the upcoming one removes it");
  document = addSituation(document, A, away(now, now + HOUR), mark(now, "m5"), now);
  assert.deepEqual(list(), ["m1", "m4", "m5"], "ended and current ones are kept for the Last Seen look-back");
  const later = now + LAST_ONLINE_LOOKBACK_MS + 2 * HOUR;
  document = addSituation(document, A, away(later, later + HOUR), mark(later, "m6"), later);
  assert.deepEqual(list(), ["m4", "m6"], "situations that ended before the look-back are dropped; m4 still runs until after it");
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
