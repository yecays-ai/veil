import { affectsChatSession, type ChatStorage } from "./storage";
import type { ChatMessage, ChatSession } from "./types";

type Snapshot = { session: ChatSession; messages: ChatMessage[] };
type Storage = Pick<ChatStorage, "readExistingSession" | "openSession" | "readSession" | "subscribe">;

/** Per-route request owner, not a shared session cache. */
export function createChatSessionLifecycle(characterId: string, storage: Storage,
  publish: (snapshot: Snapshot | null, error: string) => void, stop: (sessionId: string) => void) {
  let active = false, enabled = false, checkedExisting = false, revision = 0;
  let sessionId: string | undefined, snapshot: Snapshot | null = null, error = "";
  let running: Promise<void> | undefined;
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
          if (!checkedExisting) {
            next = await storage.readExistingSession(characterId);
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
        if (sessionId) stop(sessionId);
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
      else notify();
    },
    unmount() {
      active = false;
      unsubscribe();
      changedBeforeResolution.clear();
      if (enabled && sessionId) stop(sessionId);
      enabled = false;
    },
  };
}
