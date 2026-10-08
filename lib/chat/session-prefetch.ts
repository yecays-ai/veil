import type { ChatStorage } from "./storage";
import type { ChatMessage, ChatSession } from "./types";

// A chat opened from the list can paint its history in the first frame if its read started when the finger
// went down, before navigation. This is a display seed, not a session cache: it is valid only while no chat
// change has happened since the read started, it never touches generation state, and the route's own
// lifecycle still reads storage and replaces it. Bounded and per storage instance.
type Snapshot = { session: ChatSession; messages: ChatMessage[] };
const MAX_SEEDS = 4;
const seeds = new WeakMap<object, Map<string, { snapshot: Snapshot; revision: number }>>();
const reading = new WeakMap<object, Set<string>>();

export function prefetchChatSession(characterId: string, storage: Pick<ChatStorage, "peekExistingSession" | "changeRevision">) {
  if (!characterId) return;
  const revision = storage.changeRevision();
  if (seeds.get(storage)?.get(characterId)?.revision === revision) return;
  const inFlight = reading.get(storage) ?? new Set<string>();
  if (inFlight.has(characterId)) return;
  inFlight.add(characterId); reading.set(storage, inFlight);
  void storage.peekExistingSession(characterId).then((snapshot) => {
    // A change during the read (or an unreadable chat) leaves no seed rather than a stale one.
    if (!snapshot || storage.changeRevision() !== revision) return;
    const known = seeds.get(storage) ?? new Map<string, { snapshot: Snapshot; revision: number }>();
    known.delete(characterId);
    known.set(characterId, { snapshot, revision });
    while (known.size > MAX_SEEDS) known.delete(known.keys().next().value as string);
    seeds.set(storage, known);
  }).catch(() => {}).finally(() => { inFlight.delete(characterId); });
}

export function prefetchedChatSession(characterId: string, storage: Pick<ChatStorage, "changeRevision">): Snapshot | null {
  const seed = seeds.get(storage)?.get(characterId);
  return seed && seed.revision === storage.changeRevision() ? seed.snapshot : null;
}
