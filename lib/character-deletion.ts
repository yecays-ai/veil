import { browserPersistenceWriteGate, withPersistenceWriteScope, type PersistenceWriteGate, type PersistenceWriteScope } from "./backup/persistence-write-gate";
import { withoutCharacterBindings, type BindingDocument } from "./bindings";
import { browserBindingStorage } from "./binding-storage";
import { browserContactStorage, removeContact, type ContactDocument } from "./contact-storage";
import { chatStorage, type ChatStorage } from "./chat/storage";
import type { ChatSession } from "./chat/types";
import { deleteCharacter } from "./foundation";
import type { Character, FoundationDocument } from "./foundation-types";
import { browserPresenceStorage, presenceRecord, removePresence, type PresenceDocument } from "./presence/storage";
import { countHereThereReferences, unbindHereThereCharacters } from "./here-there-binding";
import { browserThemeStorage } from "./theme-storage";
import type { ThemeDocument } from "./theme-types";

type Access<D> = { load(): Promise<D>; update(update: (document: D) => D, scope?: PersistenceWriteScope): Promise<unknown> };
/** The stores a Character's data lives in, besides Foundation itself. */
export type CleanupDeps = {
  theme: Access<ThemeDocument>;
  contacts: Access<ContactDocument>;
  bindings: Access<BindingDocument>;
  presence: Access<PresenceDocument>;
  chat: Pick<ChatStorage, "listSessions" | "countMessages" | "deleteSession" | "removeGroupMembers">;
};
/** `updateTheme` should be the mounted ThemeProvider's commit, so the open page sees the change. */
export function browserCleanupDeps(updateTheme: Access<ThemeDocument>["update"]): CleanupDeps {
  return {
    theme: { load: () => browserThemeStorage.load(), update: updateTheme },
    contacts: { load: () => browserContactStorage.load(), update: (update, scope) => browserContactStorage.transact(update, scope) },
    bindings: { load: () => browserBindingStorage.load(), update: (update, scope) => browserBindingStorage.transact(update, scope) },
    presence: { load: () => browserPresenceStorage.load(), update: (update, scope) => browserPresenceStorage.transact(update, scope) },
    chat: chatStorage,
  };
}

export type CleanupStep = "widgets" | "groups" | "conversation" | "contact" | "bindings" | "presence";
export type CleanupReport = { completed: CleanupStep[]; failed: { step: CleanupStep; message: string }[] };
export const CLEANUP_STEP_LABEL: Record<CleanupStep, string> = {
  widgets: "Here & There widget links and comments", groups: "group memberships",
  conversation: "private conversation", contact: "contact record", bindings: "Binding overrides", presence: "presence data",
};
const directSession = (sessions: readonly ChatSession[], characterId: string) =>
  sessions.find((session) => session.type !== "group" && session.characterId === characterId);

/** Everything a deletion will remove or detach, read without changing anything. */
export type DeletionImpact = {
  conversation: { messages: number; hasBackground: boolean } | null;
  groups: { id: string; title: string }[];
  contact: boolean;
  widgets: { layout: number; presets: number };
  bindings: boolean;
  relations: number;
};
export async function previewCharacterDeletion(foundation: FoundationDocument, characterId: string, deps: CleanupDeps): Promise<DeletionImpact> {
  const [sessions, theme, contacts, bindings] = await Promise.all([
    deps.chat.listSessions(), deps.theme.load(), deps.contacts.load(), deps.bindings.load()]);
  const direct = directSession(sessions, characterId);
  return {
    conversation: direct ? { messages: await deps.chat.countMessages(direct.id), hasBackground: !!direct.backgroundImage } : null,
    groups: sessions.filter((session) => session.type === "group" && (session.participantIds ?? []).includes(characterId))
      .map((session) => ({ id: session.id, title: session.title ?? "Group" })),
    contact: contacts.contacts.some((contact) => contact.characterId === characterId),
    widgets: countHereThereReferences(theme, characterId),
    bindings: characterId in bindings.characters,
    relations: foundation.universe.relations.filter((r) => r.characterAId === characterId || r.characterBId === characterId).length,
  };
}

/**
 * The cleanup that follows a Character's deletion. Each step is independent, keyed only by that
 * Character's ID and idempotent, so a failed step never blocks the others and running it again is safe.
 * Widgets go first: a Here & There remark still being generated can only be written into a widget that
 * is linked to the Character, so once the link is cleared a late result lands nowhere.
 */
export function cleanupCharacterData(characterId: string, deps: CleanupDeps, writeGate: PersistenceWriteGate = browserPersistenceWriteGate): Promise<CleanupReport> {
  return inScope(writeGate, async (scope, done) => { const report = await cleanupInScope(characterId, deps, scope); done(report); return report; });
}

/**
 * Cleanup steps are always awaited and their failures belong in the report. The scope also re-throws a
 * rejected child when it closes, so once the report exists it wins; a failure before any report (the lease
 * itself, the Foundation commit) still propagates.
 */
async function inScope(writeGate: PersistenceWriteGate, work: (scope: PersistenceWriteScope, done: (report: CleanupReport) => void) => Promise<CleanupReport>): Promise<CleanupReport> {
  let finished: CleanupReport | undefined;
  try { return await withPersistenceWriteScope(writeGate, (scope) => work(scope, (report) => { finished = report; })); }
  catch (error) { if (finished) return finished; throw error; }
}

async function cleanupInScope(characterId: string, deps: CleanupDeps, scope: PersistenceWriteScope): Promise<CleanupReport> {
  const report: CleanupReport = { completed: [], failed: [] };
  const run = async (step: CleanupStep, work: () => Promise<void>) => {
    try { await work(); report.completed.push(step); }
    catch (reason) { report.failed.push({ step, message: reason instanceof Error ? reason.message : String(reason) }); }
  };
  const is = (id: string) => id === characterId;
  await run("widgets", async () => {
    const theme = await deps.theme.load();
    if (unbindHereThereCharacters(theme, is) !== theme) await deps.theme.update((current) => unbindHereThereCharacters(current, is), scope);
  });
  await run("groups", async () => { await deps.chat.removeGroupMembers([characterId], scope); });
  await run("conversation", async () => {
    const direct = directSession(await deps.chat.listSessions(scope), characterId);
    if (!direct) return;
    try { await deps.chat.deleteSession(direct.id, scope); }
    catch (reason) { if (!(reason instanceof Error && reason.message === "Conversation not found.")) throw reason; }
  });
  await run("contact", async () => {
    if ((await deps.contacts.load()).contacts.some((contact) => contact.characterId === characterId))
      await deps.contacts.update((contacts) => removeContact(contacts, characterId), scope);
  });
  await run("bindings", async () => {
    if (characterId in (await deps.bindings.load()).characters)
      await deps.bindings.update((bindings) => withoutCharacterBindings(bindings, is), scope);
  });
  await run("presence", async () => {
    if (presenceRecord(await deps.presence.load(), characterId))
      await deps.presence.update((presence) => removePresence(presence, characterId), scope);
  });
  return report;
}

/**
 * Deletes a Character under one backup shared lease. The Foundation delete is the single commit point: everything before it only
 * reads, so if it throws, nothing was changed anywhere. After it, the Character is gone and the cleanup
 * report says exactly which dependent steps finished; failed ones are repeated with cleanupCharacterData.
 */
export async function deleteCharacterWithData(options: {
  characterId: string; baseline?: Omit<Character, "characterId">;
  commitFoundation: (update: (document: FoundationDocument) => FoundationDocument, scope?: PersistenceWriteScope) => Promise<unknown>;
  deps: CleanupDeps;
  writeGate?: PersistenceWriteGate;
}): Promise<CleanupReport> {
  const { characterId, baseline, commitFoundation, deps, writeGate = browserPersistenceWriteGate } = options;
  const direct = directSession(await deps.chat.listSessions(), characterId);
  if (direct?.generation)
    throw new Error("A reply is being generated in this Character's conversation. Stop it, then delete the Character. Nothing was changed.");
  // The commit and every cleanup step hold one shared lease, so a backup snapshot never lands between
  // "Character gone" and "its references removed". The generation check above stays outside it.
  return inScope(writeGate, async (scope, done) => {
    await commitFoundation((document) => deleteCharacter(document, characterId, baseline), scope);
    const report = await cleanupInScope(characterId, deps, scope);
    done(report);
    return report;
  });
}
