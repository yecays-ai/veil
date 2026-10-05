"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { Input } from "../ui/form";
import { importWorldBookEntry, type WorldBook } from "../../../lib/worldbook";
import { downloadWorldBook } from "./files";
import { useWorldBooks } from "./use-worldbooks";

export function WorldBookDetail({ bookId }: { bookId: string }) {
  const library = useWorldBooks();
  const saved = library.document?.books.find((book) => book.id === bookId);
  if (!saved) return <PageShell className="settings-app worldbook-manager" title="WorldBook" backHref="/settings/worldbooks" backLabel="Back to WorldBooks">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "WorldBook not found." : "Loading WorldBook…"}</p>}
  </PageShell>;
  return <Detail key={bookId} saved={saved} library={library} />;
}

function Detail({ saved, library }: { saved: WorldBook; library: ReturnType<typeof useWorldBooks> }) {
  const { document, error, notice, busy, run, change, setNotice } = library;
  const [draft, setDraft] = useState(saved);
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const dirty = draft.name !== saved.name || draft.description !== saved.description || draft.enabled !== saved.enabled;
  const base = `/settings/worldbooks/${saved.id}`;
  return <PageShell className="settings-app worldbook-manager" title={saved.name} backHref="/settings/worldbooks" backLabel="Back to WorldBooks"
    rightAction={<button className="settings-header-action" disabled={!dirty || busy} onClick={() => void run(async () => {
      const name = draft.name.trim();
      await change((current) => ({ ...current, books: current.books.map((book) => book.id === saved.id
        ? { ...book, name, description: draft.description, enabled: draft.enabled } : book) }));
      setDraft((current) => ({ ...current, name }));
      setNotice("Saved.");
    })}>Save</button>}>
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    <section className="worldbook-section"><h2>WorldBook</h2><div className="settings-editor">
      <label>Name<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Description<textarea className="settings-input" rows={3} value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="worldbook-check"><input type="checkbox" checked={draft.enabled}
        onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label>
    </div></section>
    <div className="settings-action-row worldbook-actions">
      <button className="settings-button" disabled={busy || dirty} onClick={() => file.current?.click()}><Upload size={17} />Import Entry</button>
      <button className="settings-button" onClick={() => downloadWorldBook(saved)}><Download size={17} />Export Book</button>
      <Link className="settings-button" href={`${base}/entries/new`}><Plus size={17} />Add Entry</Link>
    </div>
    <input hidden ref={file} type="file" accept=".json,application/json" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = "";
      if (selected) void run(async () => {
        const json = await selected.text();
        await change((current) => importWorldBookEntry(current, saved.id, json));
        setNotice("Entry imported.");
      });
    }} />
    <section className="worldbook-section"><h2>Entries</h2>
      {saved.entries.length === 0 && <p>No Entries yet.</p>}
      <div className="worldbook-list">{saved.entries.map((entry, index) => <article className="worldbook-card" key={entry.id}>
        <Link className="worldbook-card-main" href={`${base}/entries/${entry.id}`}>
          <span><strong>{entry.name || "Untitled Entry"}</strong><small>{entry.content.slice(0, 100) || "Empty content"}</small>
            <small>{entry.enabled ? "Enabled" : "Disabled"} · {entry.position === "before" ? "Before" : "After"}</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
        <div className="worldbook-row-actions">
          <label><input type="checkbox" checked={entry.enabled} disabled={busy || dirty} onChange={(event) => void run(async () => {
            await change((current) => ({ ...current, books: current.books.map((book) => book.id !== saved.id ? book : {
              ...book, entries: book.entries.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item),
            }) }));
          })} />Enabled</label>
          <button aria-label={`Move ${entry.name} up`} disabled={busy || dirty || index === 0} onClick={() => void run(async () => {
            await change((current) => ({ ...current, books: current.books.map((book) => {
              if (book.id !== saved.id) return book;
              const entries = [...book.entries]; [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
              return { ...book, entries };
            }) }));
          })}><ArrowUp size={17} /></button>
          <button aria-label={`Move ${entry.name} down`} disabled={busy || dirty || index === saved.entries.length - 1} onClick={() => void run(async () => {
            await change((current) => ({ ...current, books: current.books.map((book) => {
              if (book.id !== saved.id) return book;
              const entries = [...book.entries]; [entries[index + 1], entries[index]] = [entries[index], entries[index + 1]];
              return { ...book, entries };
            }) }));
          })}><ArrowDown size={17} /></button>
          <button aria-label={`Export ${entry.name}`} onClick={() => downloadWorldBook(entry)}><Download size={17} /></button>
          <button aria-label={`Delete ${entry.name}`} disabled={busy || dirty} onClick={() => {
            if (!window.confirm(`Delete ${entry.name || "this Entry"}?`)) return;
            void run(async () => { await change((current) => ({ ...current, books: current.books.map((book) => book.id !== saved.id ? book : {
              ...book, entries: book.entries.filter((item) => item.id !== entry.id),
            }) })); });
          }}><Trash2 size={17} /></button>
        </div>
      </article>)}</div>
    </section>
    <button className="settings-button settings-danger" disabled={busy} onClick={() => {
      if (!window.confirm(`Delete ${saved.name} and all its Entries?`)) return;
      void run(async () => {
        await change((current) => ({ ...current, books: current.books.filter((book) => book.id !== saved.id) }));
        router.push("/settings/worldbooks");
      });
    }}><Trash2 size={17} />Delete WorldBook</button>
    {document && <span className="worldbook-count">{saved.entries.length} Entries</span>}
  </PageShell>;
}
