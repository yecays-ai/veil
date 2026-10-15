import type { PresenceInputs } from "../presence/compute";
import type { ChatMessage, ChatSession } from "./types";
import { lifeReplyPlan } from "./life-reply";

/** A long wait is cut into pieces, so the status is looked at again now and then instead of trusting one distant timer. */
export const LIFE_REPLY_RECHECK_MS = 30 * 60_000;
const SETTLE_MS = 400;
/** Nobody answers sooner than this after the user's newest unanswered message, so a run of short messages is one turn. */
export const LIFE_REPLY_QUIET_MS = 3000;

export type LifeReplyDeps = {
  sessions: () => Promise<readonly ChatSession[]>;
  session: (sessionId: string) => Promise<{ session: ChatSession; messages: readonly ChatMessage[] }>;
  /** The Character's Presence inputs; undefined when the Character no longer exists. */
  presence: (characterId: string) => Promise<PresenceInputs | undefined>;
  isGenerating: (sessionId: string) => boolean;
  /** The user has text in this conversation's composer; the reply waits for it to be sent or cleared. */
  composing: (sessionId: string) => boolean;
  reply: (sessionId: string) => Promise<unknown>;
  now: () => number;
  visible: () => boolean;
};
type Timers = { setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
const realTimers: Timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (h) => clearTimeout(h as never) };

/**
 * Page-lifetime owner of Life Mode replies. For each direct conversation with Life Mode on and an unanswered user message
 * it keeps at most one timer, runs the normal reply path when the planned time comes, and never reuses a failed attempt:
 * unanswered messages whose reply was started once are left alone until the user writes again. Nothing is stored; the
 * due time is recomputed from the messages and the Character's Presence, so reopening the page resumes without a new wait.
 */
export function createLifeReplyWatcher(deps: LifeReplyDeps, timers: Timers = realTimers) {
  let stopped = true;
  const waiting = new Map<string, unknown>();
  const settling = new Map<string, unknown>();
  const attempted = new Map<string, string>();
  const checking = new Set<string>();
  const clear = (map: Map<string, unknown>, sessionId: string) => {
    const handle = map.get(sessionId);
    if (handle !== undefined) timers.clearTimeout(handle);
    map.delete(sessionId);
  };
  const live = () => !stopped && deps.visible();

  async function check(sessionId: string) {
    clear(waiting, sessionId);
    if (!live()) return;
    // Busy with a reply or another check: look again once it settles, so a message stored meanwhile is not forgotten.
    if (deps.isGenerating(sessionId) || checking.has(sessionId)) { api.touch(sessionId); return; }
    checking.add(sessionId);
    try {
      const listed = (await deps.sessions()).find((item) => item.id === sessionId);
      if (!live() || !listed || listed.type === "group" || !listed.characterId || listed.lifeMode !== true || listed.generation) {
        if (!listed || listed.lifeMode !== true) attempted.delete(sessionId);
        return;
      }
      const { session, messages } = await deps.session(sessionId);
      if (!live()) return;
      const pending = messages.filter((item) => item.role === "user" && item.status === "sent" && !item.requestedBy)
        .sort((a, b) => a.order - b.order);
      const first = pending[0];
      if (!first) { attempted.delete(sessionId); return; }
      // Keyed by the newest unanswered message: a failed attempt is not repeated, but a new message from the user is a new ask.
      const newest = pending[pending.length - 1];
      if (attempted.get(sessionId) === newest.id) return;
      const lastReplyAt = messages.reduce<number | null>((latest, item) =>
        item.role === "assistant" && item.status === "complete" && item.createdAt <= first.createdAt
          && (latest === null || item.createdAt > latest) ? item.createdAt : latest, null);
      const presence = await deps.presence(session.characterId);
      if (!live() || !presence) return;
      const plan = lifeReplyPlan({ pendingId: first.id, pendingAt: first.createdAt, lastReplyAt, presence });
      if (plan.kind === "parked") {
        // No available status is known yet; a changed situation or routine can unpark it, so look again now and then.
        waiting.set(sessionId, timers.setTimeout(() => { waiting.delete(sessionId); void check(sessionId); }, LIFE_REPLY_RECHECK_MS));
        return;
      }
      // Presence decides the rhythm; the quiet window only ever pushes it later, measured from the newest message.
      const wait = Math.max(plan.at, newest.createdAt + LIFE_REPLY_QUIET_MS) - deps.now();
      if (wait > 0) {
        waiting.set(sessionId, timers.setTimeout(() => { waiting.delete(sessionId); void check(sessionId); },
          Math.min(wait, LIFE_REPLY_RECHECK_MS)));
        return;
      }
      // One attempt per unanswered message: a failure never schedules another, and the reply path marks the message as asked.
      // Life Mode may have been turned off, or a newer message stored, while the status was being read; a newer message
      // restarts the quiet window, so it is looked at again from the start.
      const latest = await deps.session(sessionId);
      if (!live() || latest.session.lifeMode !== true) return;
      const newer = latest.messages.some((item) => item.role === "user" && item.status === "sent" && !item.requestedBy
        && item.order > newest.order);
      if (newer) { api.touch(sessionId); return; }
      // A draft in the composer holds the reply back for as long as it exists; clearing or sending it calls touch again.
      // Checked last, right before the reply starts, so a draft begun during the reads above is respected.
      if (deps.composing(sessionId)) return;
      attempted.set(sessionId, newest.id);
      await deps.reply(sessionId).catch(() => undefined);
    } catch {
      /* A failed check is skipped; the next event or visible page tries again, and it never reaches the model. */
    } finally {
      checking.delete(sessionId);
    }
  }

  const api = {
    start() { stopped = false; void this.wake(); },
    /** Looks at every conversation with Life Mode on: at start and whenever the page becomes visible. */
    async wake() {
      if (!live()) return;
      try {
        for (const session of await deps.sessions())
          if (session.lifeMode === true && session.type !== "group") await check(session.id);
      } catch { /* Looked at again on the next trigger. */ }
    },
    /** A stored change in one conversation: looked at once it settles, so a streaming reply is not re-read every chunk. */
    touch(sessionId: string) {
      if (stopped) return;
      clear(settling, sessionId);
      settling.set(sessionId, timers.setTimeout(() => { settling.delete(sessionId); void check(sessionId); }, SETTLE_MS));
    },
    /** The page is hidden: no timer keeps running; becoming visible calls wake. */
    suspend() {
      for (const id of [...waiting.keys()]) clear(waiting, id);
      for (const id of [...settling.keys()]) clear(settling, id);
    },
    stop() {
      stopped = true;
      this.suspend();
      attempted.clear();
    },
  };
  return api;
}
