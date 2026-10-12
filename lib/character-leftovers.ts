import { withoutCharacterBindings } from "./bindings";
import { removeContact } from "./contact-storage";
import type { CleanupDeps, CleanupReport, CleanupStep } from "./character-deletion";
import type { FoundationDocument } from "./foundation-types";
import { removePresence } from "./presence/storage";
import { unbindHereThereCharacters } from "./here-there-binding";

/**
 * Data left behind by Characters that were deleted before cleanup existed, or whose cleanup was cut short.
 * The only evidence of ownership is "this ID is not in a Foundation document that was just read
 * successfully". That is enough for references that carry no content, and never enough to delete
 * something the user wrote: conversations and contact records are only removed after an explicit confirmation.
 */
type FoundationRead = { load(): Promise<FoundationDocument> };

// A Foundation read that failed, or an empty catalogue, proves nothing about who is gone.
async function aliveIds(foundation: FoundationRead): Promise<ReadonlySet<string> | null> {
  try {
    const document = await foundation.load();
    return document.characters.length ? new Set(document.characters.map((c) => c.characterId)) : null;
  } catch { return null; }
}

/**
 * Removes references that hold no user content: Binding overrides, Here & There widget links (with their
 * generated remark) and group member IDs of Characters that no longer exist. Foundation is read again
 * right before each step, so a Character created in another tab a moment ago is never mistaken for a
 * missing one. Safe to run repeatedly; does nothing when Foundation cannot be read.
 */
export async function reconcileInertReferences(foundation: FoundationRead, deps: CleanupDeps): Promise<CleanupReport> {
  const report: CleanupReport = { completed: [], failed: [] };
  const run = async (step: CleanupStep, work: (alive: ReadonlySet<string>) => Promise<void>) => {
    const alive = await aliveIds(foundation);
    if (!alive) return;
    try { await work(alive); report.completed.push(step); }
    catch (reason) { report.failed.push({ step, message: reason instanceof Error ? reason.message : String(reason) }); }
  };
  await run("widgets", async (alive) => {
    const theme = await deps.theme.load(), dead = (id: string) => !alive.has(id);
    if (unbindHereThereCharacters(theme, dead) !== theme) await deps.theme.update((current) => unbindHereThereCharacters(current, dead));
  });
  await run("bindings", async (alive) => {
    const bindings = await deps.bindings.load(), dead = (id: string) => !alive.has(id);
    if (withoutCharacterBindings(bindings, dead) !== bindings) await deps.bindings.update((current) => withoutCharacterBindings(current, dead));
  });
  await run("presence", async (alive) => {
    const presence = await deps.presence.load();
    const dead = presence.characters.map((item) => item.characterId).filter((id) => !alive.has(id));
    if (dead.length) await deps.presence.update((current) => dead.reduce(removePresence, current));
  });
  await run("groups", async (alive) => {
    const sessions = await deps.chat.listSessions();
    const dead = new Set(sessions.filter((s) => s.type === "group").flatMap((s) => [...(s.participantIds ?? []), s.characterId])
      .filter((id) => id && !alive.has(id)));
    // A "" characterId is the deliberate marker of a group with no member left, not a dead reference.
    if (dead.size) await deps.chat.removeGroupMembers([...dead]);
  });
  return report;
}

export type Leftovers = {
  conversations: { sessionId: string; characterId: string; messages: number }[];
  contacts: { characterId: string }[];
};
export const hasLeftovers = (leftovers: Leftovers) => leftovers.conversations.length + leftovers.contacts.length > 0;

/** Read-only: user content whose Character no longer exists. Nothing here is removed automatically. */
export async function findLeftovers(foundation: FoundationRead, deps: CleanupDeps): Promise<Leftovers> {
  const empty: Leftovers = { conversations: [], contacts: [] };
  let document: FoundationDocument;
  try { document = await foundation.load(); } catch { return empty; }
  if (!document.characters.length) return empty;
  const alive = new Set(document.characters.map((c) => c.characterId));
  const [sessions, contacts] = await Promise.all([deps.chat.listSessions(), deps.contacts.load()]);
  const orphans = sessions.filter((s) => s.type !== "group" && s.characterId && !alive.has(s.characterId));
  return {
    conversations: await Promise.all(orphans.map(async (s) => ({ sessionId: s.id, characterId: s.characterId, messages: await deps.chat.countMessages(s.id) }))),
    contacts: contacts.contacts.filter((c) => !alive.has(c.characterId)).map((c) => ({ characterId: c.characterId })),
  };
}

/** Removes what the user confirmed. Each item is re-checked against a fresh Foundation read first. */
export async function removeLeftovers(leftovers: Leftovers, foundation: FoundationRead, deps: CleanupDeps): Promise<{ removed: number; skipped: number; failed: number }> {
  const result = { removed: 0, skipped: 0, failed: 0 };
  const stillMissing = async (characterId: string) => {
    const alive = await aliveIds(foundation);
    return alive !== null && !alive.has(characterId);
  };
  for (const item of leftovers.conversations) {
    if (!await stillMissing(item.characterId)) { result.skipped++; continue; }
    try { await deps.chat.deleteSession(item.sessionId); result.removed++; }
    catch (reason) {
      if (reason instanceof Error && reason.message === "Conversation not found.") result.removed++; else { result.failed++; continue; }
    }
    // The Character is confirmed gone, so whatever Memory it still owns goes with its conversation.
    try { await deps.memory.deleteCharacter(item.characterId); } catch { result.failed++; }
  }
  for (const item of leftovers.contacts) {
    if (!await stillMissing(item.characterId)) { result.skipped++; continue; }
    try { await deps.contacts.update((contacts) => removeContact(contacts, item.characterId)); result.removed++; }
    catch { result.failed++; continue; }
    try { await deps.memory.deleteCharacter(item.characterId); } catch { result.failed++; }
  }
  return result;
}
