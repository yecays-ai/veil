"use client";
import { useState } from "react";
import { addJournalEntry, deleteJournalEntry, editJournalEntry } from "../lib/memory/bank";
import { JOURNAL_LIMITS, parseKeywords } from "../lib/memory/journal";
import { MemoryConflictError, MemoryDuplicateError, type MemoryStorage } from "../lib/memory/storage";
import type { Memory } from "../lib/memory/types";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { Alert } from "./settings/ui/feedback";
import { BottomSheet, ConfirmDialog } from "./settings/ui/modal";

type Draft = { entry: Memory | null; text: string; keywords: string };

const failureText = (error: unknown) =>
  error instanceof MemoryConflictError ? "This entry changed somewhere else. Close it and open it again."
    : error instanceof MemoryDuplicateError ? "This Character already has a Journal entry with the same text."
      : error instanceof Error ? error.message : "The Journal entry could not be saved.";

/**
 * The Journal section of the Memory Bank: the user's own keyword-triggered notes for this Character. Entries are
 * only added, edited and deleted here; automatic maintenance never touches them.
 */
export function MemoryJournal({ characterId, characterName, entries, storage, busy, write }: {
  characterId: string; characterName: string; entries: readonly Memory[]; storage: MemoryStorage; busy: boolean;
  write: (run: () => Promise<unknown>, done?: () => void) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Memory | null>(null);
  const [error, setError] = useState("");
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

  async function save(current: Draft) {
    const edit = { text: current.text, keywords: parseKeywords(current.keywords) };
    const failure = await write(() => current.entry ? editJournalEntry(storage, current.entry, edit) : addJournalEntry(storage, characterId, edit),
      () => { setDraft(null); setError(""); });
    if (failure) setError(failureText(failure));
  }

  return <section className="memory-journal" aria-label="Journal">
    <h2>Journal</h2>
    <p className="subtle">
      Notes you write for {characterName}. An entry is added to a reply only when one of its keywords appears in the newest messages;
      at most one entry per reply. Automatic memory never changes them.
    </p>
    <button className="settings-button" disabled={busy} onClick={() => { setError(""); setDraft({ entry: null, text: "", keywords: "" }); }}>Add Journal entry</button>
    {!sorted.length ? <p className="empty-copy subtle">No Journal entries yet.</p> : (
      <ul className="memory-bank-list" aria-label="Journal entries">
        {sorted.map((row) => <li key={row.id} className="profile-card">
          <p className="memory-bank-text">{row.text}</p>
          <small className="subtle">Keywords: {(row.keywords ?? []).join(", ")}</small>
          <div className="foundation-actions">
            <button disabled={busy} onClick={() => { setError(""); setDraft({ entry: row, text: row.text, keywords: (row.keywords ?? []).join(", ") }); }}>{C.common.edit}</button>
            <button className="danger-button" disabled={busy} onClick={() => setRemoving(row)}>{C.common.delete}</button>
          </div>
        </li>)}
      </ul>
    )}
    {draft && <BottomSheet title={draft.entry ? "Edit Journal entry" : "Add Journal entry"} onClose={() => !busy && setDraft(null)}>
      <form className="foundation-form" onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
        <label>Journal text
          <textarea value={draft.text} rows={5} maxLength={JOURNAL_LIMITS.textCharacters} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
        </label>
        <small className="subtle">{draft.text.length}/{JOURNAL_LIMITS.textCharacters}</small>
        <label>Keywords
          <textarea value={draft.keywords} rows={2} placeholder="Separate with commas" onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} />
        </label>
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="settings-action-row">
          <button type="button" className="settings-button" disabled={busy} onClick={() => setDraft(null)}>{C.common.cancel}</button>
          <button type="submit" className="settings-button" disabled={busy || !draft.text.trim() || !parseKeywords(draft.keywords).length}>{C.common.save}</button>
        </div>
      </form>
    </BottomSheet>}
    {removing && <ConfirmDialog title="Delete Journal entry" confirmLabel={C.common.delete} busy={busy}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void write(() => deleteJournalEntry(storage, removing), () => setRemoving(null))}>
      {characterName} will no longer see this entry. You can undo it from this page.
    </ConfirmDialog>}
  </section>;
}
