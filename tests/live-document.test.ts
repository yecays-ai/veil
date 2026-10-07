import assert from "node:assert/strict";
import test from "node:test";
import { createLiveDocument } from "../lib/live-document";
import { createContactStorage, CONTACT_STORAGE_KEY, addContact } from "../lib/contact-storage";
import { createBindingStorage, BINDING_STORAGE_KEY } from "../lib/binding-storage";
import { liveContacts, liveBindings } from "../lib/contacts-bindings-live";
import { regressionContract } from "./regression-contract";

function environment() {
  const events = new EventTarget();
  const values = new Map<string, string>();
  let reads = 0, attached = 0;
  const localStorage = {
    getItem: (key: string) => { reads++; return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const owner = { localStorage, addEventListener: (type: string, listener: EventListener) => {
    attached++; events.addEventListener(type, listener);
  } } as unknown as Window;
  const external = (key: string | null, storageArea: unknown = localStorage) => {
    const event = new Event("storage");
    Object.assign(event, { key, storageArea });
    events.dispatchEvent(event);
  };
  return { events, values, localStorage, owner, external, reads: () => reads, attached: () => attached };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

regressionContract("contacts-bindings.shared-hydration", "storage-read-budget",
  "the app-session Contacts and Bindings instances are lazy and share real storage reads", async () => {
  const env = environment();
  const previousWindow = globalThis.window;
  globalThis.window = env.owner as Window & typeof globalThis;
  try {
    assert.equal(env.reads(), 0);
    const stops = [liveContacts.subscribe(() => {}), liveContacts.subscribe(() => {}),
      liveBindings.subscribe(() => {}), liveBindings.subscribe(() => {})];
    await settle();
    assert.equal(env.reads(), 2);
    assert.equal(env.attached(), 4);
    stops.forEach((stop) => stop());
    const contacts = liveContacts.getSnapshot(), bindings = liveBindings.getSnapshot();
    const stopContacts = liveContacts.subscribe(() => {}), stopBindings = liveBindings.subscribe(() => {});
    await settle();
    assert.equal(env.reads(), 2);
    assert.equal(liveContacts.getSnapshot(), contacts);
    assert.equal(liveBindings.getSnapshot(), bindings);
    env.external(CONTACT_STORAGE_KEY);
    await settle();
    assert.equal(env.reads(), 3);
    assert.equal(liveBindings.getSnapshot(), bindings);
    stopContacts(); stopBindings();
  } finally { globalThis.window = previousWindow; }
});

for (const domain of ["Contacts", "Bindings"] as const) {
  regressionContract(`${domain.toLowerCase()}.route-remount-snapshot`, "render-lifecycle",
    `${domain}: repeated consumers and navigation hydrate once and keep scoped synchronization`, async () => {
    const env = environment();
    const storage = domain === "Contacts" ? createContactStorage(() => env.localStorage)
      : createBindingStorage(() => env.localStorage);
    const key = domain === "Contacts" ? CONTACT_STORAGE_KEY : BINDING_STORAGE_KEY;
    const event = domain === "Contacts" ? "veil-contacts-change" : "veil-bindings-change";
    const live = createLiveDocument<object>({ initial: {}, load: storage.load, key, event, error: "failed", getWindow: () => env.owner });
    const first = live.subscribe(() => {}), second = live.subscribe(() => {});
    await settle();
    assert.equal(env.reads(), 1);
    assert.equal(env.attached(), 2);
    const hydrated = live.getSnapshot();
    first(); second();
    for (let route = 0; route < 10; route++) {
      const unmount = live.subscribe(() => {});
      assert.equal(live.getSnapshot(), hydrated);
      unmount();
    }
    await settle();
    assert.equal(env.reads(), 1);
    env.external("veil.unrelated"); env.external(key, {});
    env.events.dispatchEvent(new Event("veil-unrelated-change"));
    await settle();
    assert.equal(env.reads(), 1);
    const next = domain === "Contacts" ? addContact({ version: 1, contacts: [] }, "peter")
      : { global: { presetId: "new" }, characters: {} };
    env.values.set(key, JSON.stringify(next));
    env.external(key);
    await settle();
    assert.deepEqual(live.getSnapshot().document, next);
    assert.equal(env.reads(), 2);
    const remount = live.subscribe(() => {});
    await settle();
    assert.equal(env.reads(), 2);
    env.events.dispatchEvent(new Event(event));
    await settle();
    assert.equal(env.reads(), 3);
    env.values.clear(); env.external(null);
    await settle();
    assert.deepEqual(live.getSnapshot().document, hydrated.document);
    assert.equal(env.reads(), 4);
    remount();
    assert.deepEqual(live.getServerSnapshot(), { document: {}, ready: false, error: "" });
  });
}

test("failed hydration retries on remount; refresh failure retains the last good document", async () => {
  const env = environment();
  let fail = true, reads = 0;
  const live = createLiveDocument({ initial: 0, load: async () => {
    reads++; if (fail) throw new Error("private details"); return 7;
  }, key: "key", event: "change", error: "failed", getWindow: () => env.owner });
  const unmount = live.subscribe(() => {});
  await settle();
  assert.deepEqual(live.getSnapshot(), { document: 0, ready: false, error: "failed" });
  unmount(); fail = false;
  const again = live.subscribe(() => {});
  await settle();
  assert.equal(reads, 2);
  assert.deepEqual(live.getSnapshot(), { document: 7, ready: true, error: "" });
  fail = true; env.events.dispatchEvent(new Event("change"));
  await settle();
  assert.deepEqual(live.getSnapshot(), { document: 7, ready: true, error: "failed" });
  fail = false; await live.retry();
  assert.equal(live.getSnapshot().error, "");
  again();
});

regressionContract("shared-document.stale-hydration", "async-race-safety",
  "changes during hydration coalesce and cannot publish an obsolete document or error", async () => {
  for (const rejectOld of [false, true]) {
    const env = environment();
    const requests: { resolve: (value: number) => void; reject: (error: Error) => void }[] = [];
    const live = createLiveDocument({ initial: 0, load: () => new Promise<number>((resolve, reject) => {
      requests.push({ resolve, reject });
    }), key: "key", event: "change", error: "failed", getWindow: () => env.owner });
    const seen: number[] = [];
    const stop = live.subscribe(() => { seen.push(live.getSnapshot().document); });
    await settle();
    env.events.dispatchEvent(new Event("change")); env.external("key");
    live.subscribe(() => {})();
    assert.equal(requests.length, 1);
    if (rejectOld) requests[0].reject(new Error("obsolete")); else requests[0].resolve(1);
    await settle();
    assert.deepEqual(seen, []);
    assert.equal(requests.length, 2);
    requests[1].resolve(2);
    await settle();
    assert.deepEqual(seen, [2]);
    stop();
  }
});

regressionContract("contacts-bindings.consumer-unsubscribe", "subscription-hygiene",
  "unmounted consumers stop receiving updates without duplicating app-session listeners", async () => {
    for (const domain of ["Contacts", "Bindings"] as const) {
      const env = environment();
      const storage = domain === "Contacts" ? createContactStorage(() => env.localStorage)
        : createBindingStorage(() => env.localStorage);
      const event = domain === "Contacts" ? "veil-contacts-change" : "veil-bindings-change";
      const key = domain === "Contacts" ? CONTACT_STORAGE_KEY : BINDING_STORAGE_KEY;
      const live = createLiveDocument<object>({ initial: {}, load: storage.load, key, event,
        error: "failed", getWindow: () => env.owner });
      let removedCalls = 0, activeCalls = 0;
      const stop = live.subscribe(() => { removedCalls++; });
      await settle();
      assert.equal(removedCalls, 1);
      stop();
      const stopActive = live.subscribe(() => { activeCalls++; });
      env.events.dispatchEvent(new Event(event));
      await settle();
      assert.equal(removedCalls, 1);
      assert.equal(activeCalls, 1);
      assert.equal(env.attached(), 2);
      stopActive();
      env.events.dispatchEvent(new Event(event));
      await settle();
      assert.equal(activeCalls, 1);
      assert.equal(env.attached(), 2);
    }
  });

test("transactions read durable storage, failed writes do not change the snapshot, and restore synchronizes", async () => {
  const env = environment();
  const previousWindow = globalThis.window;
  Object.assign(env.owner, { dispatchEvent: env.events.dispatchEvent.bind(env.events) });
  globalThis.window = env.owner as Window & typeof globalThis;
  try {
    let failWrite = false;
    const storage = createContactStorage(() => ({ ...env.localStorage, setItem: (key, value) => {
      if (failWrite) throw new Error("quota"); env.localStorage.setItem(key, value);
    } }));
    const live = createLiveDocument({ initial: { version: 1 as const, contacts: [] }, load: storage.load,
      key: CONTACT_STORAGE_KEY, event: "veil-contacts-change", error: "failed", getWindow: () => env.owner });
    const stop = live.subscribe(() => {});
    await settle();
    const external = addContact({ version: 1, contacts: [] }, "external");
    env.values.set(CONTACT_STORAGE_KEY, JSON.stringify(external));
    await storage.transact((current) => addContact(current, "local"));
    await settle();
    assert.deepEqual(live.getSnapshot().document.contacts.map((row) => row.characterId), ["external", "local"]);
    const good = live.getSnapshot();
    failWrite = true;
    await assert.rejects(storage.transact((current) => addContact(current, "failed")));
    assert.equal(live.getSnapshot(), good);
    failWrite = false;
    await storage.restorePortable(JSON.stringify(addContact({ version: 1, contacts: [] }, "restored")));
    await settle();
    assert.equal(live.getSnapshot().document.contacts.length, 3);
    stop();
  } finally { globalThis.window = previousWindow; }
});
