import { universeForCharacter } from "../universe";
import { browserApiConfigStorage } from "../api-config-storage";
import { browserBindingStorage } from "../binding-storage";
import { browserDocumentStorage } from "../core-document-storage";
import { FOUNDATION_STORAGE_KEY, browserFoundationStorage } from "../foundation-storage";
import { normalizeFoundation } from "../foundation-types";
import { chatStorage } from "../chat/storage";
import type { ChatSession } from "../chat/types";
import { openAITextProvider } from "../chat/provider";
import { browserMemoryStorage } from "./browser";
import { maintenanceEnabled } from "./maintenance-config";
import { browserMaintenanceDiagnosticStore, createMaintenanceDiagnostics } from "./maintenance-diagnostics";
import { resolveMaintenanceModel } from "./maintenance-binding";
import { MemoryProgressProtocol } from "./progress";
import { summaryPossiblyDue } from "../chat/summary";
import { runMaintenance } from "./maintenance-runner";
import { runSummary, type SummaryOutcome } from "./summary-runner";
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
    diagnostics: createMaintenanceDiagnostics(true, browserMaintenanceDiagnosticStore),
    sessions: (scope?: Parameters<typeof chatStorage.listExistingSessions>[0]) => scope ? chatStorage.listExistingSessions(scope) : sessions(),
    model: async (characterId: string, scope?: Parameters<typeof chatStorage.listExistingSessions>[0]) => {
      const raw = await browserDocumentStorage.readExisting(FOUNDATION_STORAGE_KEY, scope);
      if (!raw) throw new Error("Memory Character authority unavailable.");
      const foundation = normalizeFoundation(JSON.parse(raw));
      const character = foundation.characters.find((c) => c.characterId === characterId);
      if (!character) throw new Error("Memory Character authority unavailable.");
      const config = await resolveMaintenanceModel(await browserBindingStorage.load(), characterId,
        (id) => browserApiConfigStorage.getApiConfig(id, scope));
      // Only hashed by the runner: it tells a paused too-large range that the Character, Backstory or profile changed.
      return { config, timezone: foundation.user.timezone ?? undefined, budget: JSON.stringify([character.backstory, foundation.user.name]), context: JSON.stringify({ name: character.name, characterId, personality: character.personality,
        speakingStyle: character.speakingStyle, user: foundation.user.name, worldSetting: universeForCharacter(foundation, character).worldSetting }) };
    } };
  // What this page already looked at (or failed to summarize) is not read or sent again until the chat or summary changes.
  const looked = new Map<string, string>();
  const key = (s: ChatSession) => `${s.nextOrder}:${s.summary?.digest ?? ""}`;
  const summaryDeps = { ...deps, commit: chatStorage.commitSummary.bind(chatStorage),
    settle: (s: ChatSession, outcome: SummaryOutcome) => { if (outcome !== "discarded") looked.set(s.id, key(s)); } };
  const scheduler = createMaintenanceScheduler({ ...deps, sessions, cursors: (id) => memory.listCursors(id),
    runnable: () => document.visibilityState === "visible",
    summaryDue: (all, id) => all.some((s) => s.characterId === id && summaryPossiblyDue(s) && looked.get(s.id) !== key(s)),
    run: async (id, signal, due) => {
      const first = due.memory ? await runMaintenance(id, deps, signal) : false;
      if (first === "busy") return "busy";
      const second = due.summary && !signal.aborted ? await runSummary(id, summaryDeps, signal) : false;
      return second === "busy" ? "busy" : first || second;
    },
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
