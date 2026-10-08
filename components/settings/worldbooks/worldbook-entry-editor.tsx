"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { Input, Select } from "../ui/form";
import { importWorldBookEntry, normalizeWorldBookEntry, type WorldBookEntry } from "../../../lib/worldbook";
import { downloadWorldBook } from "./files";
import { useWorldBooks } from "./use-worldbooks";
import { Switch } from "../ui/switch";

export function WorldBookEntryEditor({ bookId, entryId }: { bookId: string; entryId: string }) {
  const library = useWorldBooks(`${bookId}/${entryId}`);
  const book = library.document?.books.find((item) => item.id === bookId);
  const saved = book?.entries.find((item) => item.id === entryId);
  const base = `/settings/worldbooks/${bookId}`;
  if (!book || (entryId !== "new" && !saved)) return <PageShell className="settings-app worldbook-manager" title="Entry" backHref={base} backLabel="Back to WorldBook">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Entry not found." : "Loading Entry…"}</p>}
  </PageShell>;
  return <Editor key={`${bookId}/${entryId}`} bookId={bookId} entryId={entryId} saved={saved} library={library} />;
}

function Editor({ bookId, entryId, saved, library }: {
  bookId: string; entryId: string; saved?: WorldBookEntry; library: ReturnType<typeof useWorldBooks>;
}) {
  const { busy, error, notice, run, change, setNotice } = library;
  const [draft, setDraft] = useState<WorldBookEntry>(() => saved ?? normalizeWorldBookEntry({ content: "" }));
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const base = `/settings/worldbooks/${bookId}`;
  const patch = (change: Partial<WorldBookEntry>) => setDraft((current) => ({ ...current, ...change }));
  const number = (field: "scanDepth" | "priority" | "sticky" | "cooldown" | "delay", value: string) =>
    patch({ [field]: value === "" ? 0 : Number(value) });
  return <PageShell className="settings-app worldbook-manager" title={saved ? "Edit Entry" : "New Entry"}
    backHref={base} backLabel="Back to WorldBook"
    rightAction={<button className="settings-header-action" disabled={busy || !draft.name.trim()} onClick={() => void run(async () => {
      await change((current) => ({ ...current, books: current.books.map((book) => book.id !== bookId ? book : {
        ...book, entries: saved ? book.entries.map((item) => item.id === entryId ? draft : item) : [...book.entries, draft],
      }) }));
      router.push(base);
    })}>Save</button>}>
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    <section className="worldbook-section"><h2>Basic</h2><div className="settings-editor">
      <label>Name / Comment<Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label>
      <label>Content<textarea className="settings-input worldbook-content" rows={10} value={draft.content}
        onChange={(event) => patch({ content: event.target.value })} /></label>
      <label className="worldbook-check"><span>Enabled</span><Switch checked={draft.enabled}
        onChange={(enabled) => patch({ enabled })} /></label>
      <label className="worldbook-check"><span>Always activate</span><Switch checked={draft.constant}
        onChange={(constant) => patch({ constant })} /></label>
      <label>Keywords (one per line)<textarea className="settings-input" rows={4} value={draft.keywords.join("\n")}
        onChange={(event) => patch({ keywords: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></label>
      <label>Match Mode<Select value={draft.matchMode} onChange={(event) => patch({ matchMode: event.target.value as WorldBookEntry["matchMode"] })}>
        <option value="literal">Literal keywords</option><option value="regex">Regex keyword matching</option>
      </Select></label>
      <label className="worldbook-check"><span>Case sensitive</span><Switch checked={draft.caseSensitive}
        onChange={(caseSensitive) => patch({ caseSensitive })} /></label>
      <label>Position<Select value={draft.position} onChange={(event) => patch({ position: event.target.value as WorldBookEntry["position"] })}>
        <option value="before">Before</option><option value="after">After</option>
      </Select></label>
      <label>Scan Depth<Input type="number" min={1} step={1} value={draft.scanDepth}
        onChange={(event) => number("scanDepth", event.target.value)} /></label>
      <label>Priority<Input type="number" step={1} value={draft.priority}
        onChange={(event) => number("priority", event.target.value)} /></label>
    </div></section>
    <details className="worldbook-section"><summary>Advanced</summary><div className="settings-editor">
      <label>Sticky (reply cycles)<Input type="number" min={0} step={1} value={draft.sticky}
        onChange={(event) => number("sticky", event.target.value)} /></label>
      <label>Cooldown (reply cycles)<Input type="number" min={0} step={1} value={draft.cooldown}
        onChange={(event) => number("cooldown", event.target.value)} /></label>
      <label>Delay (reply cycles)<Input type="number" min={0} step={1} value={draft.delay}
        onChange={(event) => number("delay", event.target.value)} /></label>
    </div></details>
    {saved && <div className="settings-action-row worldbook-actions">
      <button className="settings-button" disabled={busy} onClick={() => file.current?.click()}><Upload size={17} />Replace from JSON</button>
      <button className="settings-button" onClick={() => downloadWorldBook(saved)}><Download size={17} />Export Entry</button>
      <input hidden ref={file} type="file" accept=".json,application/json" onChange={(event) => {
        const selected = event.target.files?.[0]; event.target.value = "";
        if (selected) void run(async () => {
          const json = await selected.text();
          const next = await change((current) => importWorldBookEntry(current, bookId, json, saved.id));
          setDraft(next.books.find((book) => book.id === bookId)!.entries.find((item) => item.id === saved.id)!);
          setNotice("Entry replaced.");
        });
      }} />
    </div>}
  </PageShell>;
}
