import { memoryFingerprint } from "./fingerprint";
import type { MemoryStorage } from "./storage";
import type { Memory, MemoryOperation, MemoryOrigin, MemoryStatus } from "./types";

/**
 * Memory Bank: the user's own view and edits of one Character's memories. Every write here is a user operation,
 * so it is recorded for undo (last five per Character) and always leaves a `manual` memory.
 */

/** Kinds a user can pick when adding or editing. "continuity" is kept up by automatic maintenance only. */
export const MANUAL_MEMORY_KINDS = ["fact", "event", "ongoing", "relationship"] as const;
export const MEMORY_KIND_LABEL: Record<string, string> = {
  fact: "Fact / preference", event: "Event", ongoing: "Ongoing", relationship: "Relationship", continuity: "Conversation continuity",
};
export const MEMORY_STATUS_LABEL: Record<MemoryStatus, string> = { active: "Active", superseded: "Superseded", archived: "Archived", flagged: "Flagged" };
export const MEMORY_ORIGIN_LABEL: Record<MemoryOrigin, string> = { manual: "Added by you", auto: "Automatic" };

export type MemoryEdit = { kind: string; text: string };

const clean = (edit: MemoryEdit): MemoryEdit => {
  const text = edit.text.trim();
  if (!memoryFingerprint(text)) throw new Error("Write something for this memory.");
  return { kind: edit.kind, text };
};

const newId = () => crypto.randomUUID();

export async function addManualMemory(storage: MemoryStorage, characterId: string, edit: MemoryEdit): Promise<MemoryOperation> {
  const { kind, text } = clean(edit);
  // Subject is left empty for manual memories until automatic maintenance defines its meaning.
  return storage.applyChange(characterId, "Added a memory", {
    put: [{ id: newId(), characterId, kind, text, subject: "", status: "active", origin: "manual", sources: [], lineage: {} }],
  });
}

/**
 * Save the user's edit of `memory` (as it was read). The result is `manual`. If the text changed, the old text is
 * suppressed so automatic maintenance cannot bring it back. Returns undefined when nothing changed.
 */
export async function editMemory(storage: MemoryStorage, memory: Memory, edit: MemoryEdit): Promise<MemoryOperation | undefined> {
  const { kind, text } = clean(edit);
  const textChanged = memoryFingerprint(text) !== memory.fingerprint;
  if (!textChanged && kind === memory.kind && text === memory.text && memory.origin === "manual") return undefined;
  const { fingerprint: _f, createdAt: _c, updatedAt: _u, ...draft } = memory;
  void [_f, _c, _u];
  return storage.applyChange(memory.characterId, "Edited a memory", {
    put: [{ ...draft, kind, text, origin: "manual" }],
    suppress: textChanged ? [{ id: newId(), fingerprint: memory.fingerprint, reason: "corrected", sources: memory.sources }] : [],
  }, { expectUpdatedAt: { [memory.id]: memory.updatedAt } });
}

/** Delete `memory` (as it was read) and suppress its text so automatic maintenance cannot bring it back. */
export async function deleteMemory(storage: MemoryStorage, memory: Memory): Promise<MemoryOperation> {
  return storage.applyChange(memory.characterId, "Deleted a memory", {
    remove: [memory.id],
    suppress: [{ id: newId(), fingerprint: memory.fingerprint, reason: "deleted", sources: memory.sources }],
  }, { expectUpdatedAt: { [memory.id]: memory.updatedAt } });
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
