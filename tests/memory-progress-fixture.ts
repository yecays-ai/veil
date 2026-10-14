import { IDBFactory } from "fake-indexeddb";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { BACKUP_LOCK_NAME } from "../lib/backup/coordination";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { ChatStorage } from "../lib/chat/storage";
import { MemoryStorage } from "../lib/memory/storage";
import { MemoryProgressProtocol } from "../lib/memory/progress";
import { lockOrigin } from "./generation-lock-fixture";

export const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
export async function progressFixture() {
  const factory = new IDBFactory(), origin = lockOrigin(), client = origin.client(), raw = new Map<string, string>();
  const holds: number[] = [], waits: number[] = [];
  const locks = { request: ((name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    const queued = performance.now();
    return client.request(name, options, async (lock) => {
      const start = performance.now();
      try { return await callback(lock); } finally {
        if (name === BACKUP_LOCK_NAME && options.mode === "exclusive" && lock) { holds.push(performance.now() - start); waits.push(start - queued); }
      }
    });
  }) as LockManager["request"] } as LockManager;
  const gate = createPersistenceWriteGate(() => locks, () => ({ getItem: (key) => raw.get(key) ?? null }));
  const core = new IndexedDBDocumentStorage(() => factory, gate), chat = new ChatStorage(() => factory, () => locks, gate, true);
  const memory = new MemoryStorage(() => factory, () => 100, gate);
  await core.putIfAbsent(FOUNDATION_STORAGE_KEY, JSON.stringify({ version: 1, characters: [{ characterId: "c" }] }));
  const session = await chat.openSession("c");
  await memory.withExclusive((scope) => chat.activateMemoryTracking(session.id, scope));
  const source = { readFoundation: (scope: Parameters<typeof core.read>[1]) => core.readExisting(FOUNDATION_STORAGE_KEY, scope),
    readChat: chat.readMemorySources.bind(chat) };
  const protocol = new MemoryProgressProtocol(memory, source, locks);
  return { factory, origin, locks, raw, gate, core, chat, memory, protocol, source, session, holds, waits,
    send: (content = "A new fact") => chat.send(session.id, content),
    snapshot: () => memory.withExclusive((scope) => chat.readMemorySources(session.id, scope)),
    progress: async () => (await memory.listCursors("c"))[0]?.extraction };
}
