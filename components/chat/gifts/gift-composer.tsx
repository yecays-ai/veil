"use client";

import { useState, type FormEvent } from "react";
import { GIFT_CONTENT_LIMIT, GIFT_ICON_LIMIT, normalizeGiftContent, normalizeGiftIcon } from "../../../lib/chat/gift";

export function GiftComposer({ disabled, onClose, onSend }: { disabled: boolean; onClose: () => void; onSend: (icon: string, content: string) => void }) {
  const [icon, setIcon] = useState("🎁"), [content, setContent] = useState(""), [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onSend(normalizeGiftIcon(icon), normalizeGiftContent(content)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Describe the gift."); }
  }
  return <div className="chat-gift-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="chat-gift-composer" role="dialog" aria-modal="true" aria-labelledby="chat-gift-title" onSubmit={submit}>
      <h2 id="chat-gift-title">Send a gift</h2>
      <label>Icon<input autoFocus value={icon} maxLength={GIFT_ICON_LIMIT} onChange={(event) => setIcon(event.target.value)} aria-label="Gift icon" /></label>
      <label>Gift description<textarea required maxLength={GIFT_CONTENT_LIMIT} rows={4} value={content}
        onChange={(event) => setContent(event.target.value)} placeholder="Describe your gift" /></label>
      <p className="chat-gift-preview"><span aria-hidden="true">{icon || "🎁"}</span> {content || "Gift preview"} · Virtual chat gesture</p>
      {error && <p role="alert" className="chat-error">{error}</p>}
      <div className="chat-gift-composer-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={disabled}>Send gift</button></div>
    </form>
  </div>;
}
