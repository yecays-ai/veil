"use client";

import { ArrowLeftRight, Gift, Image as ImageIcon, Music, Paperclip, Smile } from "lucide-react";

/** First layer of the `+` button: message features plus disabled placeholders for later additions. */
export function ChatPlusPanel({ onStickers, onPhotos, onTransfer, onGift }: { onStickers: () => void; onPhotos: () => void; onTransfer: () => void; onGift: () => void }) {
  const soon = [
    { label: "Listen together", icon: Music }, { label: "File", icon: Paperclip },
  ];
  return <div className="chat-tray chat-plus-panel" role="menu" aria-label="More message options">
    <button type="button" role="menuitem" className="chat-plus-item" onClick={onStickers}>
      <span className="chat-plus-icon"><Smile aria-hidden="true" /></span><span>Stickers</span>
    </button>
    <button type="button" role="menuitem" className="chat-plus-item" onClick={onPhotos}>
      <span className="chat-plus-icon"><ImageIcon aria-hidden="true" /></span><span>Photos</span>
    </button>
    <button type="button" role="menuitem" className="chat-plus-item" onClick={onTransfer}>
      <span className="chat-plus-icon"><ArrowLeftRight aria-hidden="true" /></span><span>Transfer</span>
    </button>
    <button type="button" role="menuitem" className="chat-plus-item" onClick={onGift}>
      <span className="chat-plus-icon"><Gift aria-hidden="true" /></span><span>Gift</span>
    </button>
    {soon.map(({ label, icon: Icon }) => <button key={label} type="button" role="menuitem" className="chat-plus-item" disabled>
      <span className="chat-plus-icon"><Icon aria-hidden="true" /></span><span>{label}</span><small>Coming Soon</small>
    </button>)}
  </div>;
}
