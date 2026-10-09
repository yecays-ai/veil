import type { ChatStorage } from "./storage";
import type { ChatMessage, ChatSession } from "./types";

type Snapshot = { session: ChatSession; messages: ChatMessage[] };
type Seed = { snapshot: Snapshot; revision: number };
type PrefetchStorage = Pick<ChatStorage, "peekExistingSession" | "changeRevision">;
const MAX_SEEDS = 4;
const seeds = new WeakMap<object, Map<string, Seed>>();
const reading = new WeakMap<object, Map<string, number>>();

/** Start the read on row press. A change during the read discards its result. */
export function prefetchChatSession(characterId: string, storage: PrefetchStorage): Promise<void> {
  if (!characterId) return Promise.resolve();
  const revision = storage.changeRevision();
  if (prefetchedChatSession(characterId, storage)) return Promise.resolve();
  const inFlight = reading.get(storage) ?? new Map<string, number>();
  if (inFlight.get(characterId) === revision) return Promise.resolve();
  inFlight.set(characterId, revision);
  reading.set(storage, inFlight);

  return Promise.resolve().then(() => storage.peekExistingSession(characterId)).then((snapshot) => {
    if (!snapshot || storage.changeRevision() !== revision || inFlight.get(characterId) !== revision) return;
    const known = seeds.get(storage) ?? new Map<string, Seed>();
    known.delete(characterId);
    known.set(characterId, { snapshot, revision });
    while (known.size > MAX_SEEDS) known.delete(known.keys().next().value as string);
    seeds.set(storage, known);
  }).catch(() => {}).finally(() => {
    if (inFlight.get(characterId) === revision) inFlight.delete(characterId);
  });
}

/** Non-consuming lookup for a pure render initializer. */
export function prefetchedChatSessionEntry(characterId: string, storage: Pick<ChatStorage, "changeRevision">): Seed | null {
  const seed = seeds.get(storage)?.get(characterId);
  return seed?.revision === storage.changeRevision() ? seed : null;
}

export function prefetchedChatSession(characterId: string, storage: Pick<ChatStorage, "changeRevision">): Snapshot | null {
  return prefetchedChatSessionEntry(characterId, storage)?.snapshot ?? null;
}

/** Consume a valid first-paint seed once. */
export function takePrefetchedChatSession(characterId: string, storage: Pick<ChatStorage, "changeRevision">): Seed | null {
  const entry = prefetchedChatSessionEntry(characterId, storage);
  seeds.get(storage)?.delete(characterId);
  return entry;
}
