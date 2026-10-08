export type ChatDiagnosticDetails = Record<string, unknown>;
export type ChatDiagnosticEvent = {
  sequence: number; navigationId: string | null; monotonicMs: number;
  fromPointerDownMs: number | null; fromClickMs: number | null;
  route: string | null; character: string | null; name: string;
  details: Record<string, string | number | boolean | null>;
};
type Navigation = { id: string; startedAt: number; clickedAt: number | null };
const MAX_EVENTS = 3000;
const SAFE_DETAIL_KEYS = new Set([
  "provider", "source", "outcome", "ready", "hasSession", "messageCount", "visibleMessageCount",
  "nodeCount", "error", "pending", "cached", "selection", "hasImage", "customCss", "rulesCount",
  "resolvedCount", "durationMs", "urlKind", "pointerType", "inputType", "target", "component",
  "phase", "navigationType", "domContentLoadedMs", "loadEventEndMs", "enabled", "count",
]);

function normalizedRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.split(/[?#]/, 1)[0] || "/";
  return path.replace(/^\/messages\/group\/[^/]+$/, "/messages/group/[session]")
    .replace(/^\/messages\/[^/]+$/, "/messages/[character]")
    .replace(/^\/contacts\/[^/]+$/, "/contacts/[character]");
}

export function createChatDiagnosticRecorder(now: () => number = () => performance.now()) {
  let enabled = false;
  let sequence = 0;
  let navigationSequence = 0;
  let current: Navigation | null = null;
  let route: string | null = null;
  let currentCharacterId: string | null = null;
  const events: ChatDiagnosticEvent[] = [];
  const aliases = new Map<string, string>();
  function aliasFor(value: string | null | undefined) {
    if (!value) return null;
    let alias = aliases.get(value);
    if (!alias) { alias = `character-${aliases.size + 1}`; aliases.set(value, alias); }
    return alias;
  }
  function safeDetails(details: ChatDiagnosticDetails = {}) {
    const safe: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(details)) {
      if (key === "characterId") continue;
      if ((key === "route" || key === "target") && typeof value === "string") {
        safe[key] = key === "route" || value.startsWith("/") ? normalizedRoute(value) : "navigation-control";
        continue;
      }
      if (!SAFE_DETAIL_KEYS.has(key)) continue;
      if (typeof value === "string") safe[key] = value.slice(0, 120);
      else if (typeof value === "number" && Number.isFinite(value)) safe[key] = Math.round(value * 10) / 10;
      else if (typeof value === "boolean" || value === null) safe[key] = value;
    }
    return safe;
  }
  function record(name: string, details: ChatDiagnosticDetails = {}, at = now()) {
    if (!enabled) return;
    events.push({
      sequence: ++sequence, navigationId: current?.id ?? null,
      monotonicMs: Math.round(at * 10) / 10,
      fromPointerDownMs: current ? Math.round((at - current.startedAt) * 10) / 10 : null,
      fromClickMs: !current || current.clickedAt === null ? null : Math.round((at - current.clickedAt) * 10) / 10,
      route, character: aliasFor(typeof details.characterId === "string" ? details.characterId : currentCharacterId),
      name: name.slice(0, 80), details: safeDetails(details),
    });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }
  function currentNavigation() {
    return current ? {
      id: current.id,
      elapsedSinceClickMs: Math.max(0, now() - (current.clickedAt ?? current.startedAt)),
      events: events.filter((event) => event.navigationId === current?.id),
    } : { id: null, elapsedSinceClickMs: 0, events: [] as ChatDiagnosticEvent[] };
  }
  return {
    setEnabled(value: boolean) { enabled = value; },
    isEnabled() { return enabled; },
    setRoute(value: string | null, characterId?: string | null) {
      route = normalizedRoute(value);
      const segment = value?.split(/[?#]/, 1)[0]?.split("/").filter(Boolean) ?? [];
      let routeCharacter: string | null = null;
      if (segment[0] === "messages" && segment.length === 2) routeCharacter = segment[1];
      if (segment[0] === "contacts" && segment.length === 2) routeCharacter = segment[1];
      try { currentCharacterId = characterId ?? (routeCharacter ? decodeURIComponent(routeCharacter) : null); }
      catch { currentCharacterId = characterId ?? routeCharacter; }
    },
    ensureNavigation(target: string) {
      if (current) return current.id;
      const at = now(); current = { id: `nav-${++navigationSequence}`, startedAt: at, clickedAt: null };
      record("document-or-route-start", { target }, at);
      return current.id;
    },
    beginNavigation(target: string, pointerDownAt?: number, pointerType = "keyboard") {
      if (!enabled) return null;
      const at = now(), startedAt = Number.isFinite(pointerDownAt) ? pointerDownAt! : at;
      current = { id: `nav-${++navigationSequence}`, startedAt, clickedAt: at };
      record("user-input-start", { inputType: pointerType }, startedAt);
      record("click", { target }, at);
      return current.id;
    },
    record,
    recordNavigationCall(target: string) { record("navigation-call", { target }); },
    currentNavigation,
    clearCurrentNavigation() {
      if (current) {
        for (let index = events.length - 1; index >= 0; index--)
          if (events[index].navigationId === current.id) events.splice(index, 1);
      } else events.length = 0;
    },
    exportCurrentNavigation() {
      const snapshot = currentNavigation();
      return JSON.stringify({
        schema: "veil-chat-first-paint-diagnostics-v1",
        clock: "performance.now milliseconds; React commit and image decode are not screen-paint proof",
        navigationId: snapshot.id, events: snapshot.events,
      }, null, 2);
    },
  };
}

export const chatDiagnosticRecorder = createChatDiagnosticRecorder();
export const recordChatDiagnostic = chatDiagnosticRecorder.record;
export const isChatDiagnosticsEnabled = chatDiagnosticRecorder.isEnabled;

export async function measureChatDiagnostic<T>(
  source: string, details: ChatDiagnosticDetails, operation: () => Promise<T>,
  summarize?: (value: T) => ChatDiagnosticDetails,
): Promise<T> {
  if (!chatDiagnosticRecorder.isEnabled()) return operation();
  const startedAt = performance.now();
  chatDiagnosticRecorder.record(`${source}-start`, details, startedAt);
  try {
    const value = await operation();
    chatDiagnosticRecorder.record(`${source}-complete`, {
      ...details, ...summarize?.(value), durationMs: performance.now() - startedAt,
    });
    return value;
  } catch (error) {
    chatDiagnosticRecorder.record(`${source}-failed`, {
      ...details, error: true, durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}
