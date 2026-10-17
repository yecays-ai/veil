import { browserFoundationStorage } from "../foundation-storage";
import { ensureDayPlan } from "../life/day-plan";
import { browserPresenceStorage, presenceRecord } from "../presence/storage";
import { chatEngine } from "./engine";
import { chatStorage } from "./storage";
import { createProactiveScheduler, runProactiveCheck } from "./proactive-scheduler";
import { selfState } from "./self-context";

const visible = () => document.visibilityState === "visible";

/** Starts the page-lifetime trigger for Characters writing first. Returns its cleanup. */
export function startBrowserProactive(): () => void {
  const scheduler = createProactiveScheduler(async (alive) => {
    await runProactiveCheck({
      sessions: () => chatStorage.listSessions(),
      status: async (characterId, now) => {
        // Read per Character, right before its attempt, so a status change during an earlier attempt is seen.
        const [foundation, presence] = await Promise.all([browserFoundationStorage.load(), browserPresenceStorage.load()]);
        const character = foundation.characters.find((item) => item.characterId === characterId);
        return character ? selfState(character, undefined, presenceRecord(presence, characterId), now, null, false, false).status : undefined;
      },
      isGenerating: (id) => chatEngine.isGenerating(id),
      // Today's plan first, so the message can draw on it. At most one request a day per Character (the plan's own claim).
      prepare: (characterId) => ensureDayPlan(characterId),
      initiate: (id) => chatEngine.initiate(id),
      now: Date.now,
    }, alive);
  }, visible);
  const onVisible = () => { if (visible()) scheduler.wake(); };
  document.addEventListener("visibilitychange", onVisible);
  scheduler.start();
  return () => { document.removeEventListener("visibilitychange", onVisible); scheduler.stop(); };
}
