"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { toMessageSticker } from "../../lib/chat/sticker-storage";
import type { MessageSticker } from "../../lib/chat/sticker-message";
import { StickerImage } from "./sticker-image";
import { useStickerLibrary } from "./use-sticker-library";

/** Pack tabs on top, the active pack's stickers below; tapping one sends it. */
export function StickerPanel({ onSend, onManage }: { onSend: (sticker: MessageSticker) => void; onManage: () => void }) {
  const { document, error } = useStickerLibrary();
  const [chosen, setChosen] = useState<string | null>(null);
  const packs = document?.packs ?? [];
  const active = packs.find((pack) => pack.id === chosen) ?? packs[0];
  if (!document) return <div className="chat-tray sticker-panel" role="status"><p className="sticker-empty">载入中…</p></div>;
  return <div className="chat-tray sticker-panel" aria-label="表情包">
    {error && <p className="sticker-note" role="alert">{error}</p>}
    {!packs.length ? <div className="sticker-empty">
      <p>还没有表情包</p>
      <button type="button" onClick={onManage}>导入表情包</button>
    </div> : <>
      <div className="sticker-tabs">
        <div className="sticker-tab-list" role="tablist" aria-label="图集">
          {packs.map((pack) => <button key={pack.id} type="button" role="tab" aria-selected={pack.id === active?.id}
            className="sticker-tab" onClick={() => setChosen(pack.id)}>{pack.name}</button>)}
        </div>
        <button type="button" className="sticker-manage" aria-label="管理表情包" title="管理表情包" onClick={onManage}><Settings2 aria-hidden="true" /></button>
      </div>
      {active && (active.stickers.length ? <div className="sticker-grid">
        {active.stickers.map((sticker) => <button key={sticker.id} type="button" className="sticker-cell" title={sticker.name}
          aria-label={`发送表情包 ${sticker.name}`} onClick={() => onSend(toMessageSticker(active, sticker))}>
          <StickerImage url={sticker.url} name={sticker.name} />
        </button>)}
      </div> : <p className="sticker-empty">这个图集还没有表情，点右上角管理去添加。</p>)}
    </>}
  </div>;
}
