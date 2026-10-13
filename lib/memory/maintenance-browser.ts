import { browserApiConfigStorage } from "../api-config-storage";
import { browserBindingStorage } from "../binding-storage";
import { browserDocumentStorage } from "../core-document-storage";
import { FOUNDATION_STORAGE_KEY, browserFoundationStorage } from "../foundation-storage";
import { normalizeFoundation } from "../foundation-types";
import { chatStorage } from "../chat/storage";
import { openAITextProvider } from "../chat/provider";
import { browserMemoryStorage } from "./browser";
import { maintenanceEnabled } from "./maintenance-config";
import { createMaintenanceDiagnostics } from "./maintenance-diagnostics";
import { resolveMaintenanceModel } from "./maintenance-binding";
import { MemoryProgressProtocol } from "./progress";
import { runMaintenance } from "./maintenance-runner";
import { createMaintenanceScheduler } from "./maintenance-scheduler";

/** Mounted under RestoreGate, once per page. No initialization or requests while the release is off. */
export function startBrowserMaintenance(): () => void {
  if (!maintenanceEnabled() || !navigator.locks) return () => undefined;
  const memory = browserMemoryStorage;
  const protocol = new MemoryProgressProtocol(memory, {
    readFoundation: (scope) => browserDocumentStorage.readExisting(FOUNDATION_STORAGE_KEY, scope),
    readChat: (sessionId, scope) => chatStorage.readMemorySources(sessionId, scope),
    readStateSources: (sessionId, ids, scope) => chatStorage.readStateSources(sessionId, ids, scope),
  }, navigator.locks, true);
  const sessions = () => memory.withExclusive((scope) => chatStorage.listExistingSessions(scope));
  const deps = { protocol, memory, enabled: () => maintenanceEnabled() && document.visibilityState === "visible", now: Date.now, provider: openAITextProvider,
    readChat: (id: string, scope: Parameters<typeof chatStorage.listExistingSessions>[0]) => chatStorage.readMemorySources(id, scope),
    diagnostics: createMaintenanceDiagnostics(),
    sessions: (scope?: Parameters<typeof chatStorage.listExistingSessions>[0]) => scope ? chatStorage.listExistingSessions(scope) : sessions(),
    model: async (characterId: string, scope?: Parameters<typeof chatStorage.listExistingSessions>[0]) => {
      const raw = await browserDocumentStorage.readExisting(FOUNDATION_STORAGE_KEY, scope);
      if (!raw) throw new Error("Memory Character authority unavailable.");
      const foundation = normalizeFoundation(JSON.parse(raw));
      const character = foundation.characters.find((c) => c.characterId === characterId);
      if (!character) throw new Error("Memory Character authority unavailable.");
      const config = await resolveMaintenanceModel(await browserBindingStorage.load(), characterId,
        (id) => browserApiConfigStorage.getApiConfig(id, scope));
      return { config, timezone: foundation.user.timezone ?? undefined, context: JSON.stringify({ name: character.name, characterId, personality: character.personality,
        speakingStyle: character.speakingStyle, user: foundation.user.name, worldSetting: foundation.universe.worldSetting }) };
    } };
  const scheduler = createMaintenanceScheduler({ ...deps, sessions, cursors: (id) => memory.listCursors(id),
    runnable: () => document.visibilityState === "visible",
    run: (id, signal) => runMaintenance(id, deps, signal),
    setTimer: (cb, delay) => window.setTimeout(cb, delay), clearTimer: (id) => window.clearTimeout(id as number) });
  const wake = () => { void scheduler.wake().catch(() => undefined); };
  const unsubscribe = chatStorage.subscribe((change) => { if (change.domain === "messages" || change.domain === "session") wake(); });
  const foundationUnsubscribe = browserFoundationStorage.subscribe(wake);
  window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
  const stop = () => scheduler.stop(); window.addEventListener("pagehide", stop);
  wake();
  return () => {
    scheduler.stop(); unsubscribe(); foundationUnsubscribe();
    window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("pagehide", stop);
  };
}
