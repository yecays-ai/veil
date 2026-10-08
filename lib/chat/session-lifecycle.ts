import { affectsChatSession, type ChatStorage } from "./storage";
import type { ChatMessage, ChatSession } from "./types";

type Snapshot = { session: ChatSession; messages: ChatMessage[] };
type Storage = Pick<ChatStorage, "readExistingSession" | "openSession" | "readSession" | "subscribe">;

/**
 * Per-route request owner, not a shared session cache. `seed()` is only what the route already shows
 * (a one-shot display seed): it is republished until this owner's own read replaces it, so enabling the
 * route never blanks a seeded first frame. It is not treated as loaded: the owner still reads storage.
 */
export function createChatSessionLifecycle(characterId: string, storage: Storage,
  publish: (snapshot: Snapshot | null, error: string) => void, stop: (sessionId: string) => void) {
  let active = false, enabled = false, checkedExisting = false, revision = 0;
  let sessionId: string | undefined, snapshot: Snapshot | null = null, error = "";
  // The seeded chat is on screen and can be acted on before this owner has read storage, so leaving must still stop it.
  let seededId: string | undefined;
  let running: Promise<void> | undefined;
  let awaitingExisting = false;
  let completedRevision = 0;
  let unsubscribe = () => {};
  const changedBeforeResolution = new Set<string>();
  const notify = () => { if (active && enabled) publish(snapshot, error); };
  const load = (): Promise<void> => {
    if (running) return running;
    running = Promise.resolve().then(async () => {
      let observed: number;
      do {
        observed = revision;
        try {
          let next: Snapshot | null = null;
          if (!checkedExisting && !enabled) {
            awaitingExisting = true;
            next = await storage.readExistingSession(characterId);
            awaitingExisting = false;
            if (!active) return;
            if (observed !== revision) continue;
            checkedExisting = true;
            if (next) {
              sessionId = next.session.id;
              if (changedBeforeResolution.has(sessionId)) revision++;
            }
            changedBeforeResolution.clear();
          } else if (sessionId) {
            next = await storage.readSession(sessionId);
          }
          if (!active) return;
          if (!sessionId && enabled) {
            const opened = await storage.openSession(characterId);
            if (!active) return;
            if (observed !== revision) continue;
            checkedExisting = true;
            sessionId = opened.id;
            changedBeforeResolution.clear();
            next = await storage.readSession(sessionId);
          }
          if (!active) return;
          if (observed !== revision) continue;
          snapshot = next;
          error = "";
          notify();
        } catch {
          awaitingExisting = false;
          if (!active) return;
          if (observed !== revision) continue;
          error = sessionId
            ? "Could not load this conversation. Existing messages have not been changed."
            : "Chat storage is unavailable. Existing messages have not been changed.";
          notify();
        }
      } while (observed !== revision);
      completedRevision = observed;
    }).finally(() => {
      running = undefined;
      if (active && (completedRevision !== revision || (enabled && checkedExisting && !sessionId && !error)))
        return load();
    });
    return running;
  };
  return {
    seed(initial: Snapshot | null) { if (!active && !snapshot) { snapshot = initial; seededId = initial?.session.id; } },
    mount(validCharacter: boolean) {
      if (active) return;
      active = true;
      enabled = validCharacter;
      unsubscribe = storage.subscribe((change) => {
        if (!sessionId) {
          if (change.domain === "session" || change.domain === "messages") changedBeforeResolution.add(change.sessionId);
        } else if (affectsChatSession(change, sessionId)) {
          revision++;
          void load();
        }
      });
      void load();
    },
    setEnabled(validCharacter: boolean) {
      if (!active || enabled === validCharacter) return;
      enabled = validCharacter;
      if (!enabled) {
        const id = sessionId ?? seededId;
        if (id) stop(id);
        revision++;
        checkedExisting = false;
        sessionId = undefined;
        snapshot = null;
        error = "";
        changedBeforeResolution.clear();
        publish(null, "");
        return;
      }
      if (!running && (!sessionId || error)) void load();
      else {
        notify();
        const pending = running, enabledRevision = revision;
        if (pending && awaitingExisting) void pending.then(() => {
          if (active && enabled && revision === enabledRevision && !checkedExisting && !sessionId && error) void load();
        });
      }
    },
    unmount() {
      active = false;
      unsubscribe();
      changedBeforeResolution.clear();
      const id = sessionId ?? seededId;
      if (enabled && id) stop(id);
      enabled = false;
    },
  };
}
