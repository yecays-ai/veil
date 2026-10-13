import { memoryFingerprint } from "./fingerprint";
import type { MemoryStorage } from "./storage";
import { JOURNAL_KIND } from "./journal";
import { MEMORY_TEXT_CHARACTERS, type Memory, type MemoryDraft, type MemoryOperation, type MemoryOrigin, type MemoryStatus } from "./types";

/**
 * Memory Bank: the user's own view and edits of one Character's memories. Every write here is a user operation,
 * so it is recorded for undo (last five per Character) and always leaves a `manual` memory.
 */

/** Kinds a user can pick when adding or editing: all five approved kinds. */
export const MANUAL_MEMORY_KINDS = ["fact", "event", "ongoing", "relationship", "continuity"] as const;
/**
 * Who a memory is about. Memory belongs to the Character and records its own experiences and views (v2), so a new
 * manual memory defaults to the Character itself. Linking "other" to a specific person is later work.
 */
export const MEMORY_SUBJECTS = ["character", "user", "other"] as const;
export const DEFAULT_MEMORY_SUBJECT = "character";
export const MEMORY_KIND_LABEL: Record<string, string> = {
  fact: "Fact / preference", event: "Event", ongoing: "Ongoing", relationship: "Relationship", continuity: "Conversation continuity",
};
export const MEMORY_STATUS_LABEL: Record<MemoryStatus, string> = { active: "Active", superseded: "Superseded", archived: "Archived", flagged: "Flagged" };
export const MEMORY_ORIGIN_LABEL: Record<MemoryOrigin, string> = { manual: "Added by you", auto: "Automatic", journal: "Journal" };

export const MEMORY_SUBJECT_LABEL: Record<string, string> = { character: "The Character", user: "You", other: "Someone else" };

export type MemoryEdit = { kind: string; text: string; subject?: string };

const clean = (edit: MemoryEdit) => {
  const text = edit.text.trim();
  if (!memoryFingerprint(text)) throw new Error("Write something for this memory.");
  if (text.length > MEMORY_TEXT_CHARACTERS) throw new Error(`A memory can have at most ${MEMORY_TEXT_CHARACTERS} characters.`);
  return { kind: edit.kind, text, subject: edit.subject };
};

const newId = () => crypto.randomUUID();

export async function addManualMemory(storage: MemoryStorage, characterId: string, edit: MemoryEdit): Promise<MemoryOperation> {
  const { kind, text, subject = DEFAULT_MEMORY_SUBJECT } = clean(edit);
  return storage.applyChange(characterId, "Added a memory", {
    put: [{ id: newId(), characterId, kind, text, subject, status: "active", origin: "manual", sources: [], lineage: {} }],
  });
}

/**
 * Save the user's edit of `memory` (as it was read). The result is `manual`. If the text changed, the old text is
 * suppressed so automatic maintenance cannot bring it back. Returns undefined when nothing changed.
 */
export async function editMemory(storage: MemoryStorage, memory: Memory, edit: MemoryEdit): Promise<MemoryOperation | undefined> {
  const { kind, text, subject = memory.subject } = clean(edit);
  const textChanged = memoryFingerprint(text) !== memory.fingerprint;
  if (!textChanged && kind === memory.kind && text === memory.text && subject === memory.subject && memory.origin === "manual") return undefined;
  // The user takes the memory over: automatic ongoing review data does not follow it.
  const { fingerprint: _f, createdAt: _c, updatedAt: _u, ongoing: _o, ...draft } = memory;
  void [_f, _c, _u, _o];
  return storage.applyChange(memory.characterId, "Edited a memory", {
    put: [{ ...draft, kind, text, subject, origin: "manual" }],
    suppress: textChanged ? [{ id: newId(), fingerprint: memory.fingerprint, reason: "corrected", sources: memory.sources }] : [],
  }, { expectUpdatedAt: { [memory.id]: memory.updatedAt } });
}

/** Superseded originals that led to `memory`, through every layer of merges. They are its history, so they go with it. */
export function memoryHistoryOf(memory: Memory, rows: readonly Memory[]): Memory[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const found = new Map<string, Memory>(), queue = [...memory.lineage.mergedFrom ?? []];
  while (queue.length) {
    const id = queue.pop()!, row = byId.get(id);
    if (!row || found.has(id) || id === memory.id || row.characterId !== memory.characterId) continue;
    found.set(id, row); queue.push(...row.lineage.mergedFrom ?? []);
  }
  return [...found.values()];
}

/**
 * Delete `memory` (as it was read) with its history, and suppress their texts so automatic maintenance cannot bring
 * them back. Deleting leaves no earlier version of the text readable anywhere (see MemoryStorage.recordOperation).
 */
export async function deleteMemory(storage: MemoryStorage, memory: Memory): Promise<MemoryOperation> {
  const history = memoryHistoryOf(memory, await storage.listMemories(memory.characterId));
  return storage.applyChange(memory.characterId, "Deleted a memory", {
    remove: [memory.id, ...history.map((row) => row.id)],
    suppress: [memory, ...history].map((row) => ({ id: newId(), fingerprint: row.fingerprint, reason: "deleted" as const, sources: row.sources })),
  }, { expectUpdatedAt: Object.fromEntries([memory, ...history].map((row) => [row.id, row.updatedAt])) });
}

export type JournalEdit = { text: string; keywords: string[] };

const journalDraft = (characterId: string, id: string, edit: JournalEdit): MemoryDraft => ({
  id, characterId, kind: JOURNAL_KIND, text: edit.text.trim(), subject: "character", status: "active", origin: "journal",
  sources: [], lineage: {}, keywords: edit.keywords.map((keyword) => keyword.trim()) });

/** Journal entries are the user's own; the store validates limits. They write no suppressions. */
export async function addJournalEntry(storage: MemoryStorage, characterId: string, edit: JournalEdit): Promise<MemoryOperation> {
  return storage.applyChange(characterId, "Added a Journal entry", { put: [journalDraft(characterId, newId(), edit)] });
}

export async function editJournalEntry(storage: MemoryStorage, entry: Memory, edit: JournalEdit): Promise<MemoryOperation> {
  return storage.applyChange(entry.characterId, "Edited a Journal entry", { put: [journalDraft(entry.characterId, entry.id, edit)] },
    { expectUpdatedAt: { [entry.id]: entry.updatedAt } });
}

export async function deleteJournalEntry(storage: MemoryStorage, entry: Memory): Promise<MemoryOperation> {
  return storage.applyChange(entry.characterId, "Deleted a Journal entry", { remove: [entry.id] }, { expectUpdatedAt: { [entry.id]: entry.updatedAt } });
}

export type MemoryFilter = { query?: string; kind?: string; status?: MemoryStatus; origin?: MemoryOrigin };

const searchable = (value: string) => value.normalize("NFKC").toLowerCase();

/** Local search and filters; newest change first. Nothing leaves the device. */
export function filterMemories(rows: readonly Memory[], filter: MemoryFilter): Memory[] {
  const words = searchable(filter.query ?? "").split(/\s+/).filter(Boolean);
  return rows.filter((row) => (!filter.kind || row.kind === filter.kind) && (!filter.status || row.status === filter.status)
    && (!filter.origin || row.origin === filter.origin) && words.every((word) => searchable(row.text).includes(word)))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export type SourceSummary = { sessionId: string; name: string | null; messages: number; present: number };

/**
 * Where a memory came from, without chat text: the conversation's name (null when the conversation is gone) and
 * how many of its referenced messages still exist. Read failures propagate; the caller shows them, never "gone".
 */
export async function describeSources(memory: Memory, deps: {
  sessionName(sessionId: string): string | null;
  existingMessageIds(sessionId: string, ids: readonly string[]): Promise<Set<string>>;
}): Promise<SourceSummary[]> {
  const bySession = new Map<string, string[]>();
  for (const source of memory.sources) bySession.set(source.sessionId, [...bySession.get(source.sessionId) ?? [], source.messageId]);
  return Promise.all([...bySession].map(async ([sessionId, ids]) => {
    const name = deps.sessionName(sessionId);
    const present = name === null ? 0 : (await deps.existingMessageIds(sessionId, ids)).size;
    return { sessionId, name, messages: ids.length, present };
  }));
}
