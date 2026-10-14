"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { parseStickerText, type StickerParse } from "../../lib/chat/sticker-import";
import {
  addStickers, browserStickerStorage, createPack, deletePack, MAX_STICKERS_PER_PACK, PACK_NAME_MAX, PACK_NOTE_MAX,
  removeSticker, renameSticker, setPackCharacter, updatePackInfo, type StickerPack,
} from "../../lib/chat/sticker-storage";
import { StickerImage } from "./sticker-image";
import { useStickerLibrary } from "./use-sticker-library";

export type ManagerCharacter = { characterId: string; name: string };
const SKIP_REASON = { "no-url": "没有链接", "bad-url": "链接无效", duplicate: "重复" } as const;

/** Paste a community list, see what was recognized, then import. Nothing is saved until the button is pressed. */
function PasteImport({ label, onImport }: { label: string; onImport: (rows: StickerParse["rows"]) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = text.trim() ? parseStickerText(text) : null;
  return <div className="sticker-paste">
    <textarea value={text} rows={5} placeholder={"粘贴整段文本，例如：\n贴贴：https://example.com/a.png\n请帮我一下 https://example.com/b.gif"}
      aria-label="批量导入文本" onChange={(e) => setText(e.target.value)} />
    {parsed && <p className="sticker-note" role="status">已识别 {parsed.rows.length} 个{parsed.skipped.length ? ` / 有 ${parsed.skipped.length} 个未识别` : ""}</p>}
    {parsed && parsed.skipped.length > 0 && <details className="sticker-skipped"><summary>查看未识别的内容</summary>
      <ul>{parsed.skipped.slice(0, 50).map((skip, index) => <li key={index}><span>{SKIP_REASON[skip.reason]}</span> {skip.text}</li>)}</ul>
    </details>}
    {error && <p className="sticker-note sticker-error" role="alert">{error}</p>}
    <button type="button" disabled={!parsed?.rows.length || busy} onClick={async () => {
      if (!parsed) return;
      setBusy(true); setError("");
      try { await onImport(parsed.rows); setText(""); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败。"); }
      finally { setBusy(false); }
    }}>{label}{parsed?.rows.length ? `（${parsed.rows.length}）` : ""}</button>
  </div>;
}

/** A field that follows the saved value until the user types; saving or leaving it hands control back, so another tab's edit is never overwritten by a stale draft. */
function useDraft(saved: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return { value: draft ?? saved, edit: (next: string) => setDraft(next), done: () => setDraft(null), changed: draft !== null && draft !== saved };
}

function PackDetail({ pack, characters, onBack }: { pack: StickerPack; characters: ManagerCharacter[]; onBack: () => void }) {
  const [message, setMessage] = useState("");
  const name = useDraft(pack.name), note = useDraft(pack.note ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [single, setSingle] = useState({ name: "", url: "" });
  const run = async (task: () => Promise<unknown>) => {
    try { await task(); setMessage(""); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "保存失败。"); }
  };
  const sticker = pack.stickers.find((item) => item.id === picked);
  return <div className="sticker-detail">
    <button type="button" className="sticker-back" onClick={onBack}><ChevronLeft aria-hidden="true" />图集</button>
    {message && <p className="sticker-note sticker-error" role="alert">{message}</p>}
    <label className="sticker-field"><span>图集名（角色会看到「图集名｜表情名」）</span>
      <input value={name.value} maxLength={PACK_NAME_MAX} onChange={(e) => name.edit(e.target.value)}
        onBlur={() => { const next = name.value; name.done();
          if (name.changed && next.trim()) void run(() => browserStickerStorage.transact((d) => updatePackInfo(d, pack.id, { name: next }))); }} />
    </label>
    <label className="sticker-field"><span>备注（只给你自己看）</span>
      <textarea value={note.value} rows={2} maxLength={PACK_NOTE_MAX} onChange={(e) => note.edit(e.target.value)}
        onBlur={() => { const next = note.value; note.done();
          if (note.changed) void run(() => browserStickerStorage.transact((d) => updatePackInfo(d, pack.id, { note: next }))); }} />
    </label>

    <h3>可以使用这个图集的角色</h3>
    {characters.length ? <ul className="sticker-bind">{characters.map((character) => {
      const bound = !!pack.characterIds?.includes(character.characterId);
      return <li key={character.characterId}><label>
        <input type="checkbox" checked={bound}
          onChange={(e) => { const next = e.target.checked; void run(() => browserStickerStorage.transact((d) => setPackCharacter(d, pack.id, character.characterId, next))); }} />
        {character.name}</label></li>;
    })}</ul> : <p className="sticker-note">还没有角色。</p>}
    <p className="sticker-note">只有被选中的角色才会收到这个图集里的表情，并且只会从里面挑选。</p>

    <h3>表情（{pack.stickers.length}/{MAX_STICKERS_PER_PACK}）</h3>
    {pack.stickers.length ? <div className="sticker-grid">
      {pack.stickers.map((item) => <button key={item.id} type="button" className="sticker-cell" aria-pressed={item.id === picked}
        title={item.name} aria-label={`表情 ${item.name}`} onClick={() => { setPicked(item.id === picked ? null : item.id); setRename(item.name); }}>
        <StickerImage url={item.url} name={item.name} />
      </button>)}
    </div> : <p className="sticker-note">还没有表情。</p>}
    {sticker && <div className="sticker-edit">
      <input value={rename} maxLength={40} aria-label="表情名" onChange={(e) => setRename(e.target.value)} />
      <button type="button" disabled={!rename.trim() || rename === sticker.name}
        onClick={() => void run(() => browserStickerStorage.transact((d) => renameSticker(d, pack.id, sticker.id, rename)))}>改名</button>
      <button type="button" aria-label="删除这个表情" onClick={() => { setPicked(null);
        void run(() => browserStickerStorage.transact((d) => removeSticker(d, pack.id, sticker.id))); }}><Trash2 aria-hidden="true" /></button>
    </div>}

    <h3>批量导入</h3>
    <PasteImport label="导入到这个图集" onImport={async (rows) => {
      let result = { added: 0, full: false };
      await browserStickerStorage.transact((d) => { const next = addStickers(d, pack.id, rows); result = next; return next.document; });
      setMessage(result.full ? `已加入 ${result.added} 个，图集已满。` : `已加入 ${result.added} 个。`);
    }} />
    <h3>按链接添加一个</h3>
    <div className="sticker-edit sticker-single">
      <input value={single.name} placeholder="表情名" maxLength={40} onChange={(e) => setSingle({ ...single, name: e.target.value })} />
      <input value={single.url} placeholder="https://…" inputMode="url" onChange={(e) => setSingle({ ...single, url: e.target.value })} />
      <button type="button" disabled={!single.name.trim() || !single.url.trim()} onClick={() => void run(async () => {
        let added = 0;
        await browserStickerStorage.transact((d) => { const next = addStickers(d, pack.id, [{ name: single.name, url: single.url }]); added = next.added; return next.document; });
        if (!added) throw new Error("链接无效、已存在或图集已满。");
        setSingle({ name: "", url: "" });
      })}>添加</button>
    </div>

    <div className="sticker-danger">
      {confirmDelete ? <>
        <p className="sticker-note">删除图集「{pack.name}」？已发出的表情包消息不受影响。</p>
        <button type="button" onClick={() => void run(async () => { await browserStickerStorage.transact((d) => deletePack(d, pack.id)); onBack(); })}>确认删除</button>
        <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
      </> : <button type="button" onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden="true" />删除图集</button>}
    </div>
  </div>;
}

function NewPack({ current, onDone, onCancel }: { current?: ManagerCharacter; onDone: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [bind, setBind] = useState(true);
  const [error, setError] = useState("");
  return <div className="sticker-detail">
    <button type="button" className="sticker-back" onClick={onCancel}><ChevronLeft aria-hidden="true" />图集</button>
    <label className="sticker-field"><span>图集名</span>
      <input value={name} maxLength={PACK_NAME_MAX} placeholder="例如：丑猫" onChange={(e) => setName(e.target.value)} /></label>
    <label className="sticker-field"><span>备注（可不填）</span>
      <textarea value={note} rows={2} maxLength={PACK_NOTE_MAX} onChange={(e) => setNote(e.target.value)} /></label>
    {current && <label className="sticker-check"><input type="checkbox" checked={bind} onChange={(e) => setBind(e.target.checked)} />让 {current.name} 也能发这个图集里的表情</label>}
    {error && <p className="sticker-note sticker-error" role="alert">{error}</p>}
    <h3>批量导入（可不填，之后再导入）</h3>
    <PasteImport label="创建并导入" onImport={create} />
    <button type="button" disabled={!name.trim()} onClick={() => void create([]).catch((reason) => setError(reason instanceof Error ? reason.message : "创建失败。"))}>只创建空图集</button>
  </div>;
  async function create(rows: StickerParse["rows"]) {
    setError("");
    const id = `pack_${crypto.randomUUID()}`;
    await browserStickerStorage.transact((d) => {
      let next = createPack(d, name, note, id);
      if (current && bind) next = setPackCharacter(next, id, current.characterId, true);
      return rows.length ? addStickers(next, id, rows).document : next;
    });
    onDone(id);
  }
}

/** The whole library: list of packs, one pack's detail, or the new-pack form. Opened over the chat, closed with the back button. */
export function StickerManager({ characters, current, onClose }: { characters: ManagerCharacter[]; current?: ManagerCharacter; onClose: () => void }) {
  const { document, error } = useStickerLibrary();
  const [view, setView] = useState<{ kind: "list" } | { kind: "new" } | { kind: "pack"; id: string }>({ kind: "list" });
  const packs = document?.packs ?? [];
  const open = view.kind === "pack" ? packs.find((pack) => pack.id === view.id) : undefined;
  return <div className="sticker-manager" role="dialog" aria-label="表情包管理">
    <header className="sticker-manager-head">
      <button type="button" className="sticker-back" onClick={onClose}><ChevronLeft aria-hidden="true" />返回</button>
      <h2>表情包</h2>
    </header>
    <div className="sticker-manager-body">
      {error && <p className="sticker-note sticker-error" role="alert">{error}</p>}
      {!document ? <p className="sticker-note" role="status">载入中…</p>
        : view.kind === "new" ? <NewPack current={current} onCancel={() => setView({ kind: "list" })} onDone={(id) => setView({ kind: "pack", id })} />
          : open ? <PackDetail pack={open} characters={characters} onBack={() => setView({ kind: "list" })} />
            : <div className="sticker-list">
              <button type="button" className="sticker-new" onClick={() => setView({ kind: "new" })}><Plus aria-hidden="true" />新建 / 导入图集</button>
              {!packs.length && <p className="sticker-note">还没有表情包。新建一个图集，粘贴社区整理的文本就能一次导入几十个。</p>}
              <ul>{packs.map((pack) => {
                const names = characters.filter((c) => pack.characterIds?.includes(c.characterId)).map((c) => c.name);
                return <li key={pack.id}><button type="button" className="sticker-row" onClick={() => setView({ kind: "pack", id: pack.id })}>
                  <span><strong>{pack.name}</strong><small>{pack.stickers.length} 个表情 · {names.length ? `角色：${names.join("、")}` : "未绑定角色"}</small></span>
                  <ChevronRight aria-hidden="true" /></button></li>;
              })}</ul>
            </div>}
    </div>
  </div>;
}
