import type { Presence } from "../foundation-types";
import type { ChatSession } from "./types";
import { attemptsAllow, statusMayInitiate } from "./proactive";

export const PROACTIVE_CHECK_INTERVAL_MS = 15 * 60_000;
const FIRST_CHECK_DELAY_MS = 10_000;

export type ProactiveCheckDeps = {
  sessions: () => Promise<readonly ChatSession[]>;
  /** The Character's effective status now: null when it has no routine yet, undefined when the Character no longer exists. */
  status: (characterId: string, now: number) => Promise<Presence | null | undefined>;
  isGenerating: (sessionId: string) => boolean;
  initiate: (sessionId: string) => Promise<unknown>;
  now: () => number;
};

/**
 * One pass over the direct conversations. Each Character with a free budget and an available status gets at most one
 * attempt, one after another; the storage budget check stays the final authority. Nothing is stored about missed passes, so being away never builds up a backlog.
 */
export async function runProactiveCheck(deps: ProactiveCheckDeps, alive: () => boolean): Promise<number> {
  let started = 0;
  for (const session of await deps.sessions()) {
    if (!alive()) break;
    if (session.type === "group" || !session.characterId || session.generation || deps.isGenerating(session.id)) continue;
    // An earlier attempt can take a while, so the clock and the Character's status are read fresh for each one.
    const now = deps.now();
    if (!attemptsAllow(session.proactiveAttempts, now)) continue;
    const status = await deps.status(session.characterId, now);
    if (status === undefined || !statusMayInitiate(status)) continue;
    if (!alive()) break;
    started++;
    // A failed attempt is not retried; it already counted, and the next pass sees the budget.
    await deps.initiate(session.id).catch(() => undefined);
  }
  return started;
}

type Timers = {
  setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void;
  setInterval: (run: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void;
};
const realTimers: Timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (h) => clearTimeout(h as never),
  setInterval: (run, ms) => setInterval(run, ms), clearInterval: (h) => clearInterval(h as never) };

/**
 * Page-lifetime trigger: one first pass shortly after start, then one every 15 minutes, and one whenever the page
 * becomes visible again (`wake`). Passes only run while visible and never overlap; `stop` ends it and cuts a running pass short.
 */
export function createProactiveScheduler(check: (alive: () => boolean) => Promise<unknown>, visible: () => boolean,
  timers: Timers = realTimers) {
  let stopped = true, running = false, first: unknown, interval: unknown;
  const alive = () => !stopped && visible();
  const pass = async () => {
    if (!alive() || running) return;
    running = true;
    try { await check(alive); } catch { /* A failed pass is simply skipped; the next trigger tries again. */ }
    finally { running = false; }
  };
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      first = timers.setTimeout(() => { void pass(); }, FIRST_CHECK_DELAY_MS);
      interval = timers.setInterval(() => { void pass(); }, PROACTIVE_CHECK_INTERVAL_MS);
    },
    wake() { void pass(); },
    stop() {
      stopped = true;
      if (first !== undefined) timers.clearTimeout(first);
      if (interval !== undefined) timers.clearInterval(interval);
      first = interval = undefined;
    },
  };
}
