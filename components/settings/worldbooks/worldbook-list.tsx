"use client";
import { useFoundation } from "../../foundation-provider";
import { allUniverses } from "../../../lib/universe";
import { useState } from "react";
import Link from "next/link";
import { useRef } from "react";
import { ArrowDown, ArrowUp, BookOpen, ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { importWorldBook, normalizeWorldBook } from "../../../lib/worldbook";
import { downloadWorldBook } from "./files";
import { useWorldBooks } from "./use-worldbooks";
import { Switch } from "../ui/switch";

export function WorldBookList() {
  const { document, error, notice, busy, loading, loadError, retry, run, change, removeBook, setNotice } = useWorldBooks();
  const { document: foundation, ready } = useFoundation();
  const [selection, setUniverseId] = useState(foundation.universe.id);
  const universes = allUniverses(foundation);
  const universeId = universes.some((u) => u.id === selection) ? selection : foundation.universe.id;
  // Reset the remembered selection as well as the rendered value when authority changes.
  if (selection !== universeId) setUniverseId(universeId);
  const visible = document?.books.filter((book) => (book.universeId ?? foundation.universe.id) === universeId) ?? [];
  const moveBook = (id: string, direction: number) => change((current) => {
    const indexes = current.books.flatMap((b, i) => (b.universeId ?? foundation.universe.id) === universeId ? [i] : []);
    const at = indexes.findIndex((i) => current.books[i].id === id);
    if (at < 0 || at + direction < 0 || at + direction >= indexes.length) return current;
    const books = [...current.books], a = indexes[at], b = indexes[at + direction];
    [books[a], books[b]] = [books[b], books[a]]; return { ...current, books };
  });
  const file = useRef<HTMLInputElement>(null);
  return <PageShell className="settings-app worldbook-manager" title="WorldBooks" backHref="/settings" backLabel="Back to Settings">
    <label>Universe<select value={universeId} disabled={!ready || busy} onChange={(event) => setUniverseId(event.target.value)}>
      {universes.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select></label>
    <div className="settings-action-row worldbook-actions">
      <button className="settings-button" disabled={!document || !ready || busy} onClick={() => file.current?.click()}><Upload size={17} />Import</button>
      <button className="settings-button" disabled={!document || !ready || busy} onClick={() => void run(async () => {
        const book = normalizeWorldBook({ name: "New WorldBook", entries: [], universeId });
        await change((current) => ({ ...current, books: [...current.books, book] }));
      })}><Plus size={17} />New</button>
    </div>
    <input hidden ref={file} type="file" accept=".json,application/json" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = "";
      if (selected) void run(async () => {
        const json = await selected.text();
        await change((current) => importWorldBook(current, json, universeId));
        setNotice("WorldBook imported.");
      });
    }} />
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    {loadError && <button className="settings-button" disabled={loading} onClick={() => void retry()}>{loading ? "Retrying…" : "Retry"}</button>}
    {!document && !error && <p role="status">Loading WorldBooks…</p>}
    {document && visible.length === 0 && <p>No WorldBooks yet.</p>}
    <div className="worldbook-list">{visible.map((book, index) => <article className="worldbook-card" key={book.id}>
      <Link className="worldbook-card-main" href={`/settings/worldbooks/${book.id}`}>
        <BookOpen size={20} aria-hidden="true" /><span><strong>{book.name}</strong><small>{book.description || `${book.entries.length} Entries`}</small>
          <small>{book.entries.length} Entries · {book.enabled ? "Enabled" : "Disabled"}</small></span><ChevronRight size={18} aria-hidden="true" />
      </Link>
      <div className="worldbook-row-actions">
        <label><Switch aria-label={`Enable ${book.name}`} checked={book.enabled} disabled={busy} onChange={(enabled) => void run(async () => {
          await change((current) => ({ ...current, books: current.books.map((item) => item.id === book.id
            ? { ...item, enabled } : item) }));
        })} /></label>
        <button aria-label={`Move ${book.name} up`} disabled={busy || index === 0} onClick={() => void run(async () => {
          await moveBook(book.id, -1);
        })}><ArrowUp size={17} /></button>
        <button aria-label={`Move ${book.name} down`} disabled={busy || index === visible.length - 1} onClick={() => void run(async () => {
          await moveBook(book.id, 1);
        })}><ArrowDown size={17} /></button>
        <button aria-label={`Export ${book.name}`} onClick={() => downloadWorldBook(book)}><Download size={17} /></button>
        <button aria-label={`Delete ${book.name}`} disabled={busy} onClick={() => {
          if (!window.confirm(`Delete ${book.name} and its Entries?`)) return;
          void run(async () => { await removeBook(book.id); });
        }}><Trash2 size={17} /></button>
      </div>
    </article>)}</div>
  </PageShell>;
}
