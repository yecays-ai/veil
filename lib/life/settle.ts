import { presenceRecord, setLifeState, type PresenceDocument } from "../presence/storage";
import { reconcileProjectedLife } from "./plan";

/**
 * Brings one Character's stored Life up to `now` from its existing routine and situations, so any reader (chat reply,
 * Life Mode, proactive turn) sees the same finished time without the Life page having been opened. Pure document in,
 * document out: it adds no timer or model call, and returns the document itself when nothing changed, so repeated
 * calls write nothing.
 */
export function settleLifeDocument(document: PresenceDocument, characterId: string, timezone: string | null, now: number): PresenceDocument {
  const latest = presenceRecord(document, characterId);
  if (!latest?.routine && !latest?.situations.length && !latest?.life) return document;
  const life = reconcileProjectedLife(latest.life, { characterId, timezone, routine: latest.routine?.routine ?? null,
    situations: latest.situations }, now);
  if (latest.life && JSON.stringify(latest.life.activities) === JSON.stringify(life.activities)) return document;
  return setLifeState(document, characterId, life);
}
