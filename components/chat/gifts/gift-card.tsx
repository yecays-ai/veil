"use client";

import { Check, Gift, RotateCcw } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { ChatMessage } from "../../../lib/chat/types";
import { canApplyGiftAction, type GiftAction, type GiftActor } from "../../../lib/chat/gift";

const status = {
  pending: { name: "Pending", detail: "Tap to open" },
  accepted: { name: "Received", detail: "Gift received" },
  declined: { name: "Returned", detail: "Gift returned" },
} as const;

export function GiftCard({ message, actor, characterName, onAction, onPointerDown, onContextMenu }: {
  message: ChatMessage; actor: GiftActor; characterName: string; onAction: (id: string, action: GiftAction) => void;
  onOpenActions: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void; onPointerDown: () => void; onContextMenu: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gift = message.gift;
  if (!gift) return null;
  const relation = gift.sender === "user" ? `To ${characterName}` : `From ${characterName}`;
  const sender = gift.sender === "user" ? "You" : characterName;
  const receiver = gift.recipient === "user" ? "You" : characterName;
  const current = status[gift.status];
  const available = (["accept", "decline"] as const).filter((action) => canApplyGiftAction(gift, actor, action));
  return <>
    <section className="chat-gift-card" aria-label={`${relation}, ${current.name}`}
      onPointerDown={onPointerDown} onContextMenu={(event) => { onContextMenu(); event.preventDefault(); }} onClick={() => setOpen(true)}>
      <header className="chat-card-heading"><span className="chat-gift-icon" aria-hidden="true">{gift.icon}</span>
        <span className="chat-card-heading-copy"><small>{relation}</small><strong>A little gift for you</strong></span>
        <Gift className="chat-card-corner-icon" aria-hidden="true" /></header>
      <p className="chat-gift-content">{gift.content}</p>
      <footer className="chat-card-status"><span><Gift aria-hidden="true" />{current.name}</span><small>{current.detail}</small></footer>
    </section>
    {open && <div className="chat-gift-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="chat-gift-detail" role="dialog" aria-modal="true" aria-label="Gift details">
        <span className="chat-gift-detail-icon" aria-hidden="true">{gift.icon}</span>
        <h2>A little gift for you</h2><p>{gift.content}</p>
        <dl><div><dt>From</dt><dd>{sender}</dd></div><div><dt>To</dt><dd>{receiver}</dd></div><div><dt>Status</dt><dd>{current.name}</dd></div></dl>
        {available.length > 0 && <div className="chat-card-actions">{available.map((action) => <button key={action} type="button" onClick={() => { onAction(message.id, action); setOpen(false); }}>
          {action === "accept" ? "Accept gift" : "Decline"}</button>)}</div>}
        <button type="button" className="chat-gift-detail-close" onClick={() => setOpen(false)}>Close</button>
      </section>
    </div>}
  </>;
}

export function GiftResultCard({ message, characterName }: { message: ChatMessage; characterName: string }) {
  const event = message.giftEvent;
  if (!event) return null;
  const accepted = event.action === "accept", Icon = accepted ? Check : RotateCcw;
  const title = accepted ? "Gift received" : "Gift declined";
  const actor = event.actor === "user" ? "You" : characterName;
  return <section className="chat-gift-card chat-result-card" aria-label={`${actor}: ${title}`}>
    <header className="chat-card-heading"><span className="chat-gift-icon" aria-hidden="true">{event.icon}</span>
      <span className="chat-card-heading-copy"><small>{actor}</small><strong>{title}</strong></span>
      <Gift className="chat-card-corner-icon" aria-hidden="true" /></header>
    <p className="chat-gift-content">{event.content}</p>
    <footer className="chat-card-status"><span><Icon aria-hidden="true" />{accepted ? "Received" : "Returned"}</span><small>{title}</small></footer>
  </section>;
}
