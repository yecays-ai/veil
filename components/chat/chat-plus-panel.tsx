"use client";

import { Gift, Image as ImageIcon, Music, Paperclip, Smile } from "lucide-react";

/** First layer of the `+` button: only stickers do anything; the rest only hold their place. */
export function ChatPlusPanel({ onStickers }: { onStickers: () => void }) {
  const soon = [
    { label: "照片", icon: ImageIcon }, { label: "礼物", icon: Gift },
    { label: "一起听歌", icon: Music }, { label: "文件", icon: Paperclip },
  ];
  return <div className="chat-tray chat-plus-panel" role="menu" aria-label="更多">
    <button type="button" role="menuitem" className="chat-plus-item" onClick={onStickers}>
      <span className="chat-plus-icon"><Smile aria-hidden="true" /></span><span>表情包</span>
    </button>
    {soon.map(({ label, icon: Icon }) => <button key={label} type="button" role="menuitem" className="chat-plus-item" disabled>
      <span className="chat-plus-icon"><Icon aria-hidden="true" /></span><span>{label}</span><small>开发中</small>
    </button>)}
  </div>;
}
