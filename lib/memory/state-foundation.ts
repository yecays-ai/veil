import type { MemorySource } from "./types";

/** P1 storage contract only. No UI/model writer, Foundation mutation or Prompt integration. */
export type BackgroundSnapshot = {
  id: string; characterId: string; version: number; text: string | null; createdAt: number;
};
export type CharacterStateVersion = {
  id: string; characterId: string; key: string; version: number; value: string;
  previousId: string | null; backgroundId: string; sources: MemorySource[];
  /** An explicit verdict, never a similarity score. Missing/current-basis mismatch means pending. */
  review: { backgroundId: string; verdict: "compatible" | "conflict" } | null;
  /** P2 evidence digests detect same-ID edits from older tabs; no chat text is copied. */
  sourceHashes?: { sessionId: string; messageId: string; hash: string }[];
  createdAt: number;
};
export type StateFoundation = { backgrounds: BackgroundSnapshot[]; states: CharacterStateVersion[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const exact = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((key) => Object.hasOwn(v, key));
export function backgroundSnapshotValid(v: unknown): v is BackgroundSnapshot {
  return object(v) && exact(v, ["id", "characterId", "version", "text", "createdAt"])
    && identifier(v.id) && identifier(v.characterId) && integer(v.version) && v.version > 0
    && (v.text === null || typeof v.text === "string") && integer(v.createdAt);
}
export function characterStateVersionValid(v: unknown): v is CharacterStateVersion {
  return object(v) && exact(v, ["id", "characterId", "key", "version", "value", "previousId", "backgroundId", "sources", "review", "createdAt", ...(Object.hasOwn(v, "sourceHashes") ? ["sourceHashes"] : [])])
    && identifier(v.id) && identifier(v.characterId) && identifier(v.key) && integer(v.version) && v.version > 0
    && identifier(v.value) && (v.previousId === null || identifier(v.previousId)) && identifier(v.backgroundId) && integer(v.createdAt)
    && Array.isArray(v.sources) && v.sources.length > 0 && v.sources.every((s) => object(s) && exact(s, ["sessionId", "messageId"])
      && identifier(s.sessionId) && identifier(s.messageId))
    && new Set(v.sources.map((s) => `${s.sessionId}\0${s.messageId}`)).size === v.sources.length
    && (v.sourceHashes === undefined || (Array.isArray(v.sourceHashes) && v.sourceHashes.length === v.sources.length
      && v.sourceHashes.every((s) => object(s) && exact(s, ["sessionId", "messageId", "hash"]) && identifier(s.sessionId) && identifier(s.messageId)
        && typeof s.hash === "string" && /^[a-f0-9]{64}$/.test(s.hash) && Array.isArray(v.sources) && v.sources.some((source: MemorySource) => source.sessionId === s.sessionId && source.messageId === s.messageId))
      && new Set(v.sourceHashes.map((s) => `${s.sessionId}\0${s.messageId}`)).size === v.sources.length))
    && (v.review === null || (object(v.review) && exact(v.review, ["backgroundId", "verdict"])
      && identifier(v.review.backgroundId) && ["compatible", "conflict"].includes(String(v.review.verdict))));
}

/** Strict graph validation is shared by backup and pure planners. No invented missing ancestors. */
export function stateFoundationValid(data: StateFoundation): boolean {
  if (!data.backgrounds.every(backgroundSnapshotValid) || !data.states.every(characterStateVersionValid)) return false;
  const backgrounds = new Map(data.backgrounds.map((r) => [r.id, r])), states = new Map(data.states.map((r) => [r.id, r]));
  if (backgrounds.size !== data.backgrounds.length || states.size !== data.states.length) return false;
  const basisVersions = new Set<string>(), stateVersions = new Set<string>(), successors = new Set<string>();
  for (const r of data.backgrounds) {
    const key = `${r.characterId}\0${r.version}`;
    if (basisVersions.has(key)) return false; basisVersions.add(key);
  }
  for (const r of data.states) {
    const key = `${r.characterId}\0${r.key}\0${r.version}`;
    if (stateVersions.has(key)) return false; stateVersions.add(key);
    if (backgrounds.get(r.backgroundId)?.characterId !== r.characterId
      || (r.review && backgrounds.get(r.review.backgroundId)?.characterId !== r.characterId)) return false;
    if (r.previousId !== null) {
      const previous = states.get(r.previousId);
      if (!previous || previous.characterId !== r.characterId || previous.key !== r.key || previous.version >= r.version
        || successors.has(previous.id)) return false;
      successors.add(previous.id);
    }
  }
  // A key is a single version chain; unrelated roots cannot silently compete for authority.
  const roots = new Set<string>();
  for (const r of data.states.filter((r) => r.previousId === null)) {
    const key = `${r.characterId}\0${r.key}`;
    if (roots.has(key)) return false; roots.add(key);
  }
  return true;
}
const valid = (data: StateFoundation) => { if (!stateFoundationValid(data)) throw new Error("Invalid State foundation."); };
/** Original and subsequent Background snapshots are append-only; compare expected id to reject stale plans. */
export function appendBackgroundSnapshot(data: StateFoundation, characterId: string, text: string | null,
  expectedId: string | null, id: string, now: number): StateFoundation {
  valid(data);
  const latest = data.backgrounds.filter((r) => r.characterId === characterId).sort((a, b) => b.version - a.version)[0];
  if ((latest?.id ?? null) !== expectedId) throw new Error("Stale Background basis.");
  const next = structuredClone(data);
  if (latest && latest.text === text) return next;
  next.backgrounds.push({ id, characterId, text, version: (latest?.version ?? 0) + 1, createdAt: now });
  valid(next); return next;
}
/** Pure plan only. P2 must authorize and validate message evidence through the existing owner/ticket protocol. */
export function appendCharacterState(data: StateFoundation, row: CharacterStateVersion, expectedHead: string | null): StateFoundation {
  valid(data);
  const basis = data.backgrounds.filter((r) => r.characterId === row.characterId).sort((a, b) => b.version - a.version)[0];
  if (basis?.id !== row.backgroundId || (row.review && row.review.backgroundId !== basis.id)) throw new Error("Stale State basis.");
  const head = data.states.filter((r) => r.characterId === row.characterId && r.key === row.key).sort((a, b) => b.version - a.version)[0];
  if ((head?.id ?? null) !== expectedHead || row.previousId !== expectedHead || row.version !== (head?.version ?? 0) + 1)
    throw new Error("Stale State version.");
  const next = structuredClone(data); next.states.push(structuredClone(row)); valid(next); return next;
}
/** D1 is explicit review data, not a local classifier. Applying reviews to a stale Background is rejected. */
export function reviewCharacterState(data: StateFoundation, characterId: string, backgroundId: string,
  verdicts: readonly { stateId: string; verdict: "compatible" | "conflict" }[]): StateFoundation {
  valid(data);
  const latest = data.backgrounds.filter((r) => r.characterId === characterId).sort((a, b) => b.version - a.version)[0];
  if (latest?.id !== backgroundId || new Set(verdicts.map((v) => v.stateId)).size !== verdicts.length) throw new Error("Stale State review.");
  const next = structuredClone(data);
  for (const verdict of verdicts) {
    const row = next.states.find((r) => r.characterId === characterId && r.id === verdict.stateId);
    if (!row) throw new Error("Invalid State review target.");
    row.review = { backgroundId, verdict: verdict.verdict };
  }
  valid(next); return next;
}
export function effectiveCharacterStates(data: StateFoundation, characterId: string) {
  valid(data);
  const background = data.backgrounds.filter((r) => r.characterId === characterId).sort((a, b) => b.version - a.version)[0];
  const replaced = new Set(data.states.flatMap((r) => r.previousId ? [r.previousId] : []));
  return data.states.filter((r) => r.characterId === characterId && !replaced.has(r.id)).map((row) => ({ row: structuredClone(row),
    status: !row.review || row.review.backgroundId !== background?.id ? "pending" as const
      : row.review.verdict === "conflict" ? "suspended" as const : "active" as const }));
}
/** D2: any deleted contributor invalidates the whole value, including mixed-source/merged prose.
 * Physically remove affected values; splice only version pointers, so an independently supported ancestor returns.
 * Broken affected graphs fail closed: the transaction/intent stays retryable, never guessed restored.
 */
export function cleanCharacterStates(data: StateFoundation, hit: (source: MemorySource) => boolean): StateFoundation {
  valid(data);
  const removed = new Set(data.states.filter((r) => r.sources.some(hit)).map((r) => r.id)), byId = new Map(data.states.map((r) => [r.id, r]));
  const next = structuredClone(data);
  next.states = next.states.filter((r) => !removed.has(r.id));
  for (const row of next.states) while (row.previousId && removed.has(row.previousId)) row.previousId = byId.get(row.previousId)!.previousId;
  valid(next); return next;
}
