import { browserFoundationStorage } from "../foundation-storage";
import { browserPresenceStorage, presenceRecord } from "../presence/storage";
import { chatEngine } from "./engine";
import { chatStorage } from "./storage";
import { hasComposingDraft, subscribeComposing } from "./composition";
import { createLifeReplyWatcher } from "./life-reply-watcher";

const visible = () => document.visibilityState === "visible";

/** Starts the page-lifetime owner of Life Mode replies. Returns its cleanup. */
export function startBrowserLifeReply(): () => void {
  const watcher = createLifeReplyWatcher({
    sessions: () => chatStorage.listSessions(),
    session: (id) => chatStorage.readSession(id),
    presence: async (characterId) => {
      const [foundation, presence] = await Promise.all([browserFoundationStorage.load(), browserPresenceStorage.load()]);
      const character = foundation.characters.find((item) => item.characterId === characterId);
      if (!character) return undefined;
      const record = presenceRecord(presence, characterId);
      return { characterId, timezone: character.timezone, routine: record?.routine?.routine ?? null, situations: record?.situations ?? [] };
    },
    isGenerating: (id) => chatEngine.isGenerating(id),
    composing: hasComposingDraft,
    reply: (id) => chatEngine.requestReply(id, undefined, "life-reply"),
    now: Date.now,
    visible,
  });
  const unsubscribe = chatStorage.subscribe((change) => {
    if (change.domain === "messages" || change.domain === "session") watcher.touch(change.sessionId);
  });
  const unsubscribeComposing = subscribeComposing((id) => { if (!hasComposingDraft(id)) watcher.touch(id); });
  const onVisibility = () => { if (visible()) void watcher.wake(); else watcher.suspend(); };
  document.addEventListener("visibilitychange", onVisibility);
  watcher.start();
  return () => { document.removeEventListener("visibilitychange", onVisibility); unsubscribe(); unsubscribeComposing(); watcher.stop(); };
}
