import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage, type ChatStorageChange } from "../lib/chat/storage";

// Uses Node's real BroadcastChannel (asynchronous delivery between channel objects of the same name).
// It does not model browser differences such as Safari's throttling of background tabs or storage
// partitioning, and one process stands in for several windows, so each ChatStorage is one "window".
type RealChannel = BroadcastChannel & { unref?: () => void };
const RealBroadcastChannel = globalThis.BroadcastChannel;
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function withChannels(run: (env: { channels: RealChannel[] }) => Promise<void>) {
  const channels: RealChannel[] = [];
  class TrackedChannel extends RealBroadcastChannel {
    constructor(name: string) { super(name); (this as RealChannel).unref?.(); channels.push(this); }
  }
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: TrackedChannel });
  try { await run({ channels }); }
  finally {
    channels.forEach((channel) => channel.close());
    Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: RealBroadcastChannel });
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window");
  }
}
const windows = (count = 2) => { const factory = new IDBFactory(); return Array.from({ length: count }, () => new ChatStorage(() => factory)); };
const record = (storage: ChatStorage) => {
  const seen: ChatStorageChange[] = [];
  return { seen, stop: storage.subscribe((change) => { seen.push(change); }) };
};

test("a window that never subscribed still notifies a window that is listening", async () => {
  await withChannels(async () => {
    const [writer, listener] = windows();
    const heard = record(listener);
    const beforeRevision = listener.changeRevision();
    const session = await writer.openSession("peter"); // the writer has never called subscribe()
    await writer.send(session.id, "hello");
    await settle();
    assert.deepEqual(heard.seen.map((change) => change.domain), ["session", "messages"]);
    assert.equal(listener.changeRevision(), beforeRevision + 2, "remote session and message changes invalidate chat seeds");
    assert.deepEqual(heard.seen.at(-1), { domain: "messages", sessionId: session.id });
    heard.stop();
  });
});

test("a subscribed writer notifies each other window once per write and itself once", async () => {
  await withChannels(async () => {
    const [writer, listener] = windows();
    const own = record(writer), heard = record(listener);
    const session = await writer.openSession("peter");
    await writer.send(session.id, "one");
    await writer.send(session.id, "two");
    await settle();
    assert.equal(heard.seen.length, 3, "session + two messages, no duplicate broadcast");
    assert.equal(own.seen.length, 3, "the writer's own listener hears each write once");
    own.stop(); heard.stop();
  });
});

test("after unsubscribing a window hears nothing more but can still publish", async () => {
  await withChannels(async () => {
    const [first, second] = windows();
    const firstHeard = record(first), secondHeard = record(second);
    const session = await first.openSession("peter");
    await settle();
    secondHeard.stop();
    const before = secondHeard.seen.length;
    await first.send(session.id, "ignored by the unsubscribed window");
    await settle();
    assert.equal(secondHeard.seen.length, before);
    const heardBefore = firstHeard.seen.filter((change) => change.domain === "messages").length;
    await second.send(session.id, "still published by the unsubscribed window");
    await settle();
    assert.equal(firstHeard.seen.filter((change) => change.domain === "messages").length, heardBefore + 1,
      "an unsubscribed window still publishes its writes");
    firstHeard.stop();
  });
});

test("a write that fails or is aborted sends no notification", async () => {
  await withChannels(async () => {
    const [writer, listener] = windows();
    const session = await writer.openSession("peter");
    const heard = record(listener);
    await settle();
    const probe = await new Promise<Record<string, unknown>>((resolve) => {
      const open = new IDBFactory().open("probe");
      open.onupgradeneeded = () => resolve(Object.getPrototypeOf(open.result.createObjectStore("s")));
    });
    const original = probe.put as (this: IDBObjectStore, ...args: unknown[]) => IDBRequest;
    const failures: Array<[string, (this: IDBObjectStore, ...args: unknown[]) => IDBRequest]> = [
      ["the write throws", function () { throw new Error("storage failed"); }],
      // The write is issued, then the transaction is aborted before it can commit.
      ["the transaction aborts", function (this: IDBObjectStore, ...args: unknown[]) {
        const result = original.apply(this, args);
        queueMicrotask(() => { try { this.transaction.abort(); } catch { /* already finished */ } });
        return result;
      }],
    ];
    for (const [label, failing] of failures) {
      probe.put = failing;
      try { await assert.rejects(writer.send(session.id, `never stored ${label}`), Error); }
      finally { probe.put = original; }
      await settle();
      assert.deepEqual(heard.seen, [], `no change was announced when ${label}`);
    }
    assert.equal((await writer.readSession(session.id)).messages.length, 0);
    heard.stop();
  });
});

test("repeated subscribe and unsubscribe keeps one channel and one handler and never doubles delivery", async () => {
  await withChannels(async ({ channels }) => {
    const [writer, listener] = windows();
    for (let round = 0; round < 5; round++) record(listener).stop();
    const heard = record(listener);
    const second = record(listener);
    const session = await writer.openSession("peter");
    await settle();
    assert.equal(channels.length, 2, "one channel for the publishing window and one for the listening window, however often it subscribed");
    assert.equal(heard.seen.length, 1);
    assert.equal(second.seen.length, 1, "each live listener hears a change exactly once");
    heard.stop(); second.stop();
    await writer.send(session.id, "x");
    await settle();
    assert.equal(heard.seen.length, 1, "no listener is called after the last unsubscribe");
    assert.equal(channels.filter((channel) => channel.onmessage !== null).length, 2, "each window keeps exactly one receive handler");
  });
});

test("windows writing in turn never echo each other's changes back", async () => {
  await withChannels(async () => {
    const [a, b] = windows();
    const heardByA = record(a), heardByB = record(b);
    const session = await a.openSession("peter");
    await settle();
    const baseA = heardByA.seen.length, baseB = heardByB.seen.length;
    for (let round = 0; round < 3; round++) {
      await a.send(session.id, `a${round}`); await settle(15);
      await b.send(session.id, `b${round}`); await settle(15);
    }
    await settle(120); // time for any echo to appear
    // Each window hears its own 3 writes locally once and the other window's 3 writes once.
    assert.equal(heardByA.seen.length - baseA, 6);
    assert.equal(heardByB.seen.length - baseB, 6);
    heardByA.stop(); heardByB.stop();
  });
});

test("a window with no listener still sees a remote background change in its revision", async () => {
  await withChannels(async () => {
    const [writer, reader] = windows();
    const session = await writer.openSession("peter");
    record(reader).stop(); // listened once, now has no listener
    const before = reader.backgroundRevision();
    await writer.updateSessionSettings(session.id, { backgroundBlur: 5 });
    await settle();
    assert(reader.backgroundRevision() > before, "a cached background snapshot can be validated without a listener");
  });
});
