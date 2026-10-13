"use client";
import { useCallback, useEffect, useState } from "react";
import { chatStorage } from "../lib/chat/storage";
import {
  DEFAULT_MEMORY_SUBJECT, MANUAL_MEMORY_KINDS, MEMORY_KIND_LABEL, MEMORY_SUBJECTS, MEMORY_SUBJECT_LABEL, MEMORY_ORIGIN_LABEL, MEMORY_STATUS_LABEL,
  addManualMemory, deleteMemory, describeSources, editMemory, filterMemories,
  type MemoryFilter, type SourceSummary,
} from "../lib/memory/bank";
import { browserMemoryStorage } from "../lib/memory/browser";
import { MemoryConflictError, MemoryDuplicateError, type MemoryStorage } from "../lib/memory/storage";
import { MEMORY_TEXT_CHARACTERS, type Memory, type MemoryOperation, type MemoryOrigin, type MemoryStatus } from "../lib/memory/types";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { useFoundation } from "./foundation-provider";
import { MemoryJournal } from "./memory-journal";
import { PageShell } from "./page-shell";
import { useBackNavigation } from "./use-back-navigation";
import { Alert } from "./settings/ui/feedback";
import { Input, Select } from "./settings/ui/form";
import { BottomSheet, ConfirmDialog } from "./settings/ui/modal";

type Loaded = { memories: Memory[]; operations: MemoryOperation[]; sources: Record<string, SourceSummary[]> };
type Draft = { memory: Memory | null; kind: string; text: string; subject: string };

const message = (error: unknown) =>
  error instanceof MemoryDuplicateError ? "This Character already has a memory with the same text."
    : error instanceof Error ? error.message : "Memory could not be saved.";

async function readBank(storage: MemoryStorage, characterId: string): Promise<Loaded> {
  const [memories, operations] = await Promise.all([storage.listMemories(characterId), storage.listOperations(characterId)]);
  const sources: Record<string, SourceSummary[]> = {};
  const sourced = memories.filter((row) => row.sources.length);
  if (sourced.length) {
    const sessions = new Map((await chatStorage.listSessions()).map((session) => [session.id, session]));
    const sessionName = (id: string) => {
      const session = sessions.get(id);
      return !session ? null : session.type === "group" ? session.title || "Group chat" : "Private chat";
    };
    for (const row of sourced)
      sources[row.id] = await describeSources(row, { sessionName, existingMessageIds: (id, ids) => chatStorage.existingMessageIds(id, ids) });
  }
  return { memories, operations, sources };
}

export function MemoryBankPage({ characterId, storage = browserMemoryStorage, backHref, backLabel = "Back to Character" }: {
  characterId: string; storage?: MemoryStorage; backHref?: string; backLabel?: string;
}) {
  const { document, ready } = useFoundation();
  const back = useBackNavigation();
  const character = document.characters.find((item) => item.characterId === characterId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<MemoryFilter>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Memory | null>(null);
  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    void readBank(storage, characterId).then((next) => { if (active) { setLoaded(next); setLoadError(""); } },
      // A failed read never shows an empty Bank: the last good list stays, with the error.
      (error) => { if (active) setLoadError(message(error)); });
    return () => { active = false; };
  }, [characterId, storage, reloads]);

  useEffect(() => {
    // Another tab may have changed this Character's memories; refresh when the page is shown again.
    const visible = () => { if (window.document.visibilityState === "visible") load(); };
    window.document.addEventListener("visibilitychange", visible);
    return () => window.document.removeEventListener("visibilitychange", visible);
  }, [load]);

  /** Run one write, then reload. Returns the error, if any, after showing it. */
  async function write(run: () => Promise<unknown>, done?: () => void): Promise<unknown> {
    setBusy(true); setNotice("");
    let failure: unknown;
    try { await run(); done?.(); }
    catch (error) { failure = error; setNotice(message(error)); }
    finally { setBusy(false); load(); }
    return failure;
  }

  async function saveDraft(current: Draft) {
    const failure = await write(() => current.memory ? editMemory(storage, current.memory, current) : addManualMemory(storage, characterId, current),
      () => setDraft(null));
    if (!(failure instanceof MemoryConflictError) || !current.memory) return;
    // The memory changed in another tab. Keep the user's text and retarget the edit at what is stored now.
    const fresh = await storage.getMemory(current.memory.id).catch(() => undefined);
    setDraft({ ...current, memory: fresh ?? null });
    setNotice(fresh ? "This memory changed somewhere else. Your text is kept; saving again replaces the newer version."
      : "This memory was deleted somewhere else. Your text is kept; saving adds it as a new memory.");
  }

  const shell = (children: React.ReactNode) => (
    <PageShell title="Memory" backHref={backHref ?? `/characters/${encodeURIComponent(characterId)}`} {...back}
      backLabel={backLabel} bodyClassName="foundation-page memory-bank" guardLeave={!!draft}>
      {children}
    </PageShell>
  );
  if (!ready) return shell(<p>{C.common.loading}</p>);
  if (!character) return shell(<p>{C.characters.notFound}</p>);

  const last = loaded?.operations.at(-1);
  const regular = loaded?.memories.filter((row) => row.origin !== "journal") ?? [];
  const journal = loaded?.memories.filter((row) => row.origin === "journal") ?? [];
  const rows = loaded ? filterMemories(regular, filter) : [];
  const kinds = [...new Set([...MANUAL_MEMORY_KINDS, ...regular.map((row) => row.kind)])];
  return shell(<>
    <p className="subtle">What {character.name} remembers. Only you can see and change this list.</p>
    <div className="settings-action-row memory-bank-actions">
      <button className="settings-button" disabled={busy || !loaded} onClick={() => setDraft({ memory: null, kind: MANUAL_MEMORY_KINDS[0], text: "", subject: DEFAULT_MEMORY_SUBJECT })}>
        Add memory
      </button>
      <button className="settings-button" disabled={busy || !last} onClick={() => last && void write(() => storage.undoLastOperation(characterId, last))}>
        {last ? `Undo: ${last.label}` : "Nothing to undo"}
      </button>
    </div>
    {last && <p className="subtle memory-bank-hint">You can undo your last {loaded!.operations.length} change{loaded!.operations.length === 1 ? "" : "s"}.</p>}
    <div className="memory-bank-filters">
      <Input type="search" aria-label="Search memories" placeholder="Search" value={filter.query ?? ""}
        onChange={(event) => setFilter({ ...filter, query: event.target.value })} />
      <Select aria-label="Type" value={filter.kind ?? ""} onChange={(event) => setFilter({ ...filter, kind: event.target.value || undefined })}>
        <option value="">All types</option>
        {kinds.map((kind) => <option key={kind} value={kind}>{MEMORY_KIND_LABEL[kind] ?? kind}</option>)}
      </Select>
      <Select aria-label="Status" value={filter.status ?? ""} onChange={(event) => setFilter({ ...filter, status: (event.target.value || undefined) as MemoryStatus | undefined })}>
        <option value="">Any status</option>
        {Object.entries(MEMORY_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <Select aria-label="Added by" value={filter.origin ?? ""} onChange={(event) => setFilter({ ...filter, origin: (event.target.value || undefined) as MemoryOrigin | undefined })}>
        <option value="">Anyone</option>
        {Object.entries(MEMORY_ORIGIN_LABEL).filter(([value]) => value !== "journal").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    </div>
    {notice && !draft && <Alert variant="danger">{notice}</Alert>}
    {loadError && <Alert variant="danger">{loadError} <button className="text-button" onClick={load}>Try again</button></Alert>}
    {!loaded ? (!loadError && <p>{C.common.loading}</p>) : !regular.length ? (
      <p className="empty-copy subtle">No memories yet.</p>
    ) : !rows.length ? (
      <p className="empty-copy subtle">No memories match.</p>
    ) : (
      <ul className="memory-bank-list" aria-label="Memories">
        {rows.map((row) => <li key={row.id} className="profile-card">
          <p className="memory-bank-text">{row.text}</p>
          <small className="subtle">
            {[MEMORY_KIND_LABEL[row.kind] ?? row.kind,
              row.subject === "character" ? `About ${character.name}` : row.subject === "user" ? "About you" : row.subject === "other" ? "About someone else" : "",
              MEMORY_ORIGIN_LABEL[row.origin],
              row.ongoing?.ended === "presumed" ? "Presumed ended" : row.ongoing?.ended === "explicit" ? "Ended" : "",
              row.status === "active" ? "" : MEMORY_STATUS_LABEL[row.status],
              new Date(row.updatedAt).toLocaleString()].filter(Boolean).join(" · ")}
          </small>
          {loaded.sources[row.id]?.map((source) => <small key={source.sessionId} className="subtle memory-bank-source">
            {source.name === null ? "From a deleted conversation"
              : `From ${source.name} · ${source.present === source.messages ? "message still there" : source.present ? `${source.present} of ${source.messages} messages still there` : "message deleted"}`}
          </small>)}
          <div className="foundation-actions">
            <button disabled={busy} onClick={() => setDraft({ memory: row, kind: row.kind, text: row.text, subject: row.subject })}>{C.common.edit}</button>
            <button className="danger-button" disabled={busy} onClick={() => setRemoving(row)}>{C.common.delete}</button>
          </div>
        </li>)}
      </ul>
    )}
    {loaded && <MemoryJournal characterId={characterId} characterName={character.name} entries={journal} storage={storage} busy={busy} write={write} />}
    {draft && <BottomSheet title={draft.memory ? "Edit memory" : "Add memory"} onClose={() => !busy && setDraft(null)}>
      <form className="foundation-form" onSubmit={(event) => {
        event.preventDefault();
        void saveDraft(draft);
      }}>
        <label>Type
          <Select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            {[...new Set([...MANUAL_MEMORY_KINDS, draft.kind])].map((kind) => <option key={kind} value={kind}>{MEMORY_KIND_LABEL[kind] ?? kind}</option>)}
          </Select>
        </label>
        <label>About
          <Select value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })}>
            {[...new Set([...MEMORY_SUBJECTS, draft.subject])].map((subject) => <option key={subject} value={subject}>
              {subject === "character" ? character.name : MEMORY_SUBJECT_LABEL[subject] ?? (subject || "Not set")}</option>)}
          </Select>
        </label>
        <label>Memory
          <textarea value={draft.text} rows={4} maxLength={MEMORY_TEXT_CHARACTERS} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
        </label>
        {notice && <Alert variant="danger">{notice}</Alert>}
        <div className="settings-action-row">
          <button type="button" className="settings-button" disabled={busy} onClick={() => setDraft(null)}>{C.common.cancel}</button>
          <button type="submit" className="settings-button" disabled={busy || !draft.text.trim()}>{C.common.save}</button>
        </div>
      </form>
    </BottomSheet>}
    {removing && <ConfirmDialog title="Delete memory" confirmLabel={C.common.delete} busy={busy}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void write(() => deleteMemory(storage, removing), () => setRemoving(null))}>
      {character.name} will forget this. You can undo it from this page.
    </ConfirmDialog>}
  </>);
}
