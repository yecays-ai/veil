"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useFoundation } from "./foundation-provider";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import {
  deleteRelation,
  saveRelation,
  saveUniverse,
  setNodePosition,
} from "../lib/foundation";
import type {
  FoundationDocument,
  NodePosition,
  RelationInput,
} from "../lib/foundation-types";

function RelationshipCanvas({
  document,
  move,
  edit,
}: {
  document: FoundationDocument;
  move: (id: string, point: NodePosition) => Promise<void>;
  edit: (id: string) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Record<string, NodePosition>>({});
  const drag = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    point: NodePosition;
    moved: boolean;
  } | null>(null);
  const suppress = useRef(false);
  const positions = { ...document.universe.nodePositions, ...preview };
  const width = Math.max(
    640,
    ...Object.values(positions).map((p) => p.x + 190),
  );
  const height = Math.max(
    360,
    ...Object.values(positions).map((p) => p.y + 110),
  );
  return (
    <div className="relationship-scroll">
      <div
        className="relationship-canvas"
        aria-label={C.universe.canvas}
        style={{ width, height }}
      >
        <svg width={width} height={height} aria-hidden="true">
          {document.universe.relations.map((r) => {
            const a = positions[r.characterAId],
              b = positions[r.characterBId];
            return (
              <line
                key={r.id}
                x1={a.x + 80}
                y1={a.y + 32}
                x2={b.x + 80}
                y2={b.y + 32}
              />
            );
          })}
        </svg>
        {document.universe.relations.map((r) => {
          const a = positions[r.characterAId],
            b = positions[r.characterBId];
          return (
            <button
              className="relationship-label"
              key={r.id}
              style={{ left: (a.x + b.x) / 2 + 80, top: (a.y + b.y) / 2 + 32 }}
              onClick={() => edit(r.id)}
            >
              {r.label}
            </button>
          );
        })}
        {document.characters.map((c) => {
          const p = positions[c.characterId];
          return (
            <button
              key={c.characterId}
              className="character-node"
              style={{ left: p.x, top: p.y }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                suppress.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  id: c.characterId,
                  pointer: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  point: p,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                const d = drag.current;
                if (
                  !d ||
                  d.id !== c.characterId ||
                  d.pointer !== event.pointerId
                )
                  return;
                const dx = event.clientX - d.x,
                  dy = event.clientY - d.y;
                if (Math.hypot(dx, dy) > 5) d.moved = true;
                if (d.moved)
                  setPreview({
                    [d.id]: {
                      x: Math.max(0, Math.min(5000, d.point.x + dx)),
                      y: Math.max(0, Math.min(5000, d.point.y + dy)),
                    },
                  });
              }}
              onPointerUp={(event) => {
                const d = drag.current;
                if (!d || d.pointer !== event.pointerId) return;
                drag.current = null;
                suppress.current = d.moved;
                if (d.moved)
                  void move(d.id, preview[d.id] ?? d.point).finally(() =>
                    setPreview({}),
                  );
              }}
              onPointerCancel={() => {
                drag.current = null;
                suppress.current = true;
                setPreview({});
              }}
              onKeyDown={(event) => {
                const vectors: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                const vector = vectors[event.key];
                if (vector) {
                  event.preventDefault();
                  const step = event.shiftKey ? 40 : 10;
                  void move(c.characterId, {
                    x: p.x + vector[0] * step,
                    y: p.y + vector[1] * step,
                  });
                }
              }}
              onClick={() => {
                if (suppress.current) {
                  suppress.current = false;
                  return;
                }
                router.push(`/characters/${c.characterId}`);
              }}
            >
              {c.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatar} alt="" draggable={false} />
              ) : (
                <span className="avatar-placeholder" aria-hidden="true">
                  {c.name.slice(0, 1)}
                </span>
              )}
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RelationForm({
  document,
  id,
  save,
  cancel,
  remove,
}: {
  document: FoundationDocument;
  id: string | null;
  save: (input: RelationInput) => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
}) {
  const existing = document.universe.relations.find((r) => r.id === id);
  const [draft, setDraft] = useState<RelationInput>(
    existing ?? {
      characterAId: document.characters[0]?.characterId ?? "",
      characterBId: document.characters[1]?.characterId ?? "",
      label: "",
      aToBContext: null,
      bToAContext: null,
      sharedHistory: null,
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  return (
    <form
      className="foundation-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => save(draft));
      }}
    >
      <h2>{existing ? C.relations.edit : C.relations.create}</h2>
      <fieldset disabled={busy}>
        {(["characterAId", "characterBId"] as const).map((key, index) => (
          <label key={key}>
            {index ? C.relations.b : C.relations.a}
            <select
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
          </label>
        ))}
        <label>
          {C.relations.label}
          <input
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
              {[C.relations.aToB, C.relations.bToA, C.relations.history][index]}
              <textarea
                value={draft[key] ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
              {index < 2 && (
                <small>{index ? C.relations.bHelp : C.relations.aHelp}</small>
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
  const { document, ready, commit } = useFoundation();
  const [editor, setEditor] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  if (!ready)
    return <section className="foundation-page">{C.common.loading}</section>;
  async function updateUniverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await commit((d) =>
        saveUniverse(d, String(data.get("name")), String(data.get("setting"))),
      );
      setNotice(C.common.saved);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="foundation-page">
      <nav>
        <Link href="/">{C.common.home}</Link>
        <Link href="/characters">{C.universe.characters}</Link>
      </nav>
      <h1>{C.universe.title}</h1>
      <p>{C.universe.description}</p>
      <form className="foundation-form" onSubmit={updateUniverse}>
        <fieldset disabled={busy}>
          <label>
            {C.universe.name}
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={document.universe.name}
            />
          </label>
          <label>
            {C.universe.setting}
            <textarea
              name="setting"
              defaultValue={document.universe.worldSetting ?? ""}
            />
          </label>
          <button>{C.common.save}</button>
        </fieldset>
      </form>
      <h2>{C.universe.canvas}</h2>
      <p>{C.universe.canvasHelp}</p>
      {document.characters.length ? (
        <RelationshipCanvas
          document={document}
          edit={setEditor}
          move={async (id, point) => {
            try {
              await commit((d) => setNodePosition(d, id, point));
              setNotice(C.universe.positionSaved);
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
          cancel={() => setEditor(undefined)}
          save={async (input) => {
            await commit((d) => saveRelation(d, input, editor ?? undefined));
            setEditor(undefined);
            setNotice(C.relations.saved);
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
  );
}
