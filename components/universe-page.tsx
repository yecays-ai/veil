"use client";
import { allUniverses, createUniverse, universeView, editUniverse } from "../lib/universe";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useFoundation } from "./foundation-provider";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import {
  deleteRelation,
  saveRelation,
  saveUniverse,
  setNodePosition,
} from "../lib/foundation";
import {
  RELATION_KINDS,
  normalizeRelationKind,
  type FoundationDocument,
  type RelationInput,
} from "../lib/foundation-types";

import { RelationshipCanvas } from "./relationship-canvas";
import { UI_COPY as U } from "../lib/ui-copy";
import { Avatar } from "./profile-view";
import { PageShell } from "./page-shell";
import { confirmDiscard } from "./leave-guard";

function RelationForm({
  document,
  id,
  save,
  cancel,
  remove,
  disabled,
  onDirtyChange,
  onBusyChange,
}: {
  document: FoundationDocument;
  id: string | null;
  save: (input: RelationInput) => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const existing = document.universe.relations.find((r) => r.id === id);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ block: "start" });
  }, []);
  const [draft, setDraft] = useState<RelationInput>(
    existing ?? {
      characterAId: document.characters[0]?.characterId ?? "",
      characterBId: document.characters[1]?.characterId ?? "",
      kind: null,
      label: "",
      aToBContext: null,
      bToAContext: null,
      sharedHistory: null,
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [baseline] = useState(() => JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }
  const a = document.characters.find(
    (c) => c.characterId === draft.characterAId,
  );
  const b = document.characters.find(
    (c) => c.characterId === draft.characterBId,
  );
  return (
    <form
      ref={form}
      autoComplete="off"
      className="foundation-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => save(draft));
      }}
    >
      <h2>{existing ? C.relations.edit : C.relations.create}</h2>
      <fieldset disabled={busy || disabled}>
        {(["characterAId", "characterBId"] as const).map((key, index) => (
          <label key={key}>
            {index ? C.relations.b : C.relations.a}
            <div className="person-selector">
              <Avatar
                avatar={(index ? b : a)?.avatar ?? null}
                name={(index ? b : a)?.name ?? ""}
              />
              <select
                autoComplete="off"
                aria-label={index ? C.relations.b : C.relations.a}
                value={draft[key]}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              >
                {document.characters.map((c) => (
                  <option key={c.characterId} value={c.characterId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </label>
        ))}
        <label>
          {C.relations.kind}
          <select
            autoComplete="off"
            value={draft.kind ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                kind: normalizeRelationKind(event.target.value),
              })
            }
          >
            <option value="">{C.relations.kindNone}</option>
            {RELATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {C.relations.kinds[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {C.relations.label}
          <input
            autoComplete="off"
            required
            maxLength={100}
            value={draft.label}
            onChange={(event) =>
              setDraft({ ...draft, label: event.target.value })
            }
          />
        </label>
        {(["aToBContext", "bToAContext", "sharedHistory"] as const).map(
          (key, index) => (
            <label key={key}>
              {index === 2
                ? C.relations.history
                : U.contextTitle(
                    (index ? b : a)?.name ?? C.relations.a,
                    (index ? a : b)?.name ?? C.relations.b,
                  )}
              <textarea
                autoComplete="off"
                aria-label={
                  index === 2
                    ? C.relations.history
                    : U.contextTitle(
                        (index ? b : a)?.name ?? C.relations.a,
                        (index ? a : b)?.name ?? C.relations.b,
                      )
                }
                maxLength={12000}
                value={draft[key] ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value || null })
                }
              />
              {index < 2 && (
                <small>
                  {U.contextHelp(
                    (index ? b : a)?.name ?? C.relations.a,
                    (index ? a : b)?.name ?? C.relations.b,
                  )}
                </small>
              )}
            </label>
          ),
        )}
        <div className="foundation-actions">
          <button type="submit">{C.common.save}</button>
          <button type="button" onClick={cancel}>
            {C.common.cancel}
          </button>
          {existing && (
            <button type="button" onClick={() => void run(remove)}>
              {C.universe.deleteRelation}
            </button>
          )}
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function UniversePage() {
  const { document: foundation, ready, commit: commitFoundation } = useFoundation();
  const [selected, setSelected] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("id") ?? "");
  const selectedId = allUniverses(foundation).some((u) => u.id === selected) ? selected : foundation.universe.id;
  const document = universeView(foundation, selectedId);
  const commit = (update: (view: FoundationDocument) => FoundationDocument) => commitFoundation((d) => editUniverse(d, selectedId, update));
  const [newName, setNewName] = useState("");
  const [editor, setEditor] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [infoDraft, setInfoDraft] = useState<{ name: string; worldSetting: string } | null>(null);
  const editingInfo = infoDraft !== null;
  const infoDirty = infoDraft !== null && (infoDraft.name !== document.universe.name || infoDraft.worldSetting !== (document.universe.worldSetting ?? ""));
  const [relationDirty, setRelationDirty] = useState(false);
  const [relationBusy, setRelationBusy] = useState(false);
  const dirty = infoDirty || relationDirty;
  function closeEditors() { setInfoDraft(null); setEditor(undefined); setRelationDirty(false); }
  const page = useRef<HTMLElement>(null);
  if (!ready)
    return (
      <PageShell
        title={C.universe.title}
        backHref="/"
        backLabel="Back to Home"
        bodyClassName="foundation-page"
      >
        {C.common.loading}
      </PageShell>
    );
  async function updateUniverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await commit((d) =>
        saveUniverse(
          d,
          String(data.get("universe-name")),
          String(data.get("world-setting")),
        ),
      );
      setNotice("");
      setInfoDraft(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageShell
      title={C.universe.title}
      backHref="/"
      backLabel="Back to Home"
      bodyClassName="foundation-page"
      guardLeave={dirty}
      rightAction={<Link href="/characters">{C.universe.characters}</Link>}
    >
      <label>Universe<select value={selectedId} disabled={busy || relationBusy} onChange={(event) => {
        if (busy || relationBusy || event.target.value === selectedId || !confirmDiscard(dirty)) return;
        setSelected(event.target.value); closeEditors(); setNotice("");
      }}>
        {allUniverses(foundation).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select></label>
      <form className="foundation-form" onSubmit={async (event) => {
        event.preventDefault();
        if (busy || relationBusy || !confirmDiscard(dirty)) return;
        setBusy(true); setNotice("");
        try { const saved = await commitFoundation((d) => createUniverse(d, newName)); setSelected(saved.universes!.at(-1)!.id); setNewName(""); closeEditors(); }
        catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
      }}><label>New Universe<input required maxLength={100} disabled={busy || relationBusy} value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <button disabled={busy || relationBusy}>Create Universe</button></form>
      <section ref={page} key={selectedId}>
        <header className="universe-header">
          <span className="section-eyebrow">{C.universe.title}</span>
          <h1>{document.universe.name}</h1>
          {document.universe.worldSetting && (
            <p>{document.universe.worldSetting}</p>
          )}
          {!editingInfo && (
            <button disabled={busy || relationBusy} onClick={() => setInfoDraft({ name: document.universe.name, worldSetting: document.universe.worldSetting ?? "" })}>
              {C.common.edit}
            </button>
          )}
        </header>
        {editingInfo && (
          <form
            autoComplete="off"
            className="foundation-form"
            onSubmit={updateUniverse}
          >
            <fieldset disabled={busy}>
              <label>
                {C.universe.name}
                <input
                  autoComplete="off"
                  name="universe-name"
                  required
                  maxLength={100}
                  value={infoDraft!.name}
                  onChange={(event) => setInfoDraft({ ...infoDraft!, name: event.target.value })}
                />
              </label>
              <label>
                {C.universe.setting}
                <textarea
                  autoComplete="off"
                  maxLength={12000}
                  name="world-setting"
                  value={infoDraft!.worldSetting}
                  onChange={(event) => setInfoDraft({ ...infoDraft!, worldSetting: event.target.value })}
                />
              </label>
              <div className="foundation-actions">
                <button>{C.common.save}</button>
                <button type="button" onClick={() => setInfoDraft(null)}>
                  {C.common.cancel}
                </button>
              </div>
            </fieldset>
          </form>
        )}
        <h2>{C.universe.canvas}</h2>
        {document.characters.length ? (
          <RelationshipCanvas
            document={document}
            edit={setEditor}
            move={async (id, point) => {
              try {
                await commit((d) => setNodePosition(d, id, point));
              } catch (error) {
                setNotice(String(error));
              }
            }}
          />
        ) : (
          <p>{C.universe.empty}</p>
        )}
        <button
          disabled={document.characters.length < 2}
          onClick={() => setEditor(null)}
        >
          {C.universe.addRelation}
        </button>
        {document.characters.length < 2 && <p>{C.relations.empty}</p>}
        {editor !== undefined && (
          <RelationForm
            key={editor ?? "new"}
            document={document}
            id={editor}
            disabled={busy}
            onDirtyChange={setRelationDirty}
            onBusyChange={setRelationBusy}
            cancel={() => setEditor(undefined)}
            save={async (input) => {
              await commit((d) => saveRelation(d, input, editor ?? undefined));
              setEditor(undefined);
              setNotice(C.relations.saved);
              requestAnimationFrame(() =>
                page.current
                  ?.querySelector(".relationship-viewport")
                  ?.scrollIntoView({ block: "center" }),
              );
            }}
            remove={async () => {
              if (editor) await commit((d) => deleteRelation(d, editor));
              setEditor(undefined);
              setNotice(C.universe.deletedRelation);
            }}
          />
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
    </PageShell>
  );
}
