"use client";

import type { MouseEvent } from "react";
import type { ChatMessage } from "../../../lib/chat/types";
import { canApplyGiftAction, type GiftAction, type GiftActor } from "../../../lib/chat/gift";

const labels = { pending: "等待领取", accepted: "已接受", declined: "已拒绝" } as const;

export function GiftCard({ message, actor, characterName, onAction, onOpenActions, onPointerDown, onContextMenu }: {
  message: ChatMessage; actor: GiftActor; characterName: string; onAction: (id: string, action: GiftAction) => void;
  onOpenActions: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void; onPointerDown: () => void; onContextMenu: () => void;
}) {
  const gift = message.gift;
  if (!gift) return null;
  const sender = gift.sender === "user" ? "你" : characterName;
  const receiver = gift.recipient === "user" ? "你" : characterName;
  const available: GiftAction[] = (["accept", "decline"] as const).filter((action) => canApplyGiftAction(gift, actor, action));
  return <section className="chat-gift-card" aria-label={`${sender}送给${receiver}的礼物，${labels[gift.status]}`}
    onPointerDown={onPointerDown} onContextMenu={(event) => { onContextMenu(); event.preventDefault(); }}
    onClick={(event) => onOpenActions(event, message)}>
    <header className="chat-gift-heading"><span className="chat-gift-icon" aria-hidden="true">{gift.icon}</span>
      <span>{sender} 送给 {receiver}</span></header>
    <p className="chat-gift-content">{gift.content}</p>
    <footer className={`chat-gift-status chat-gift-status-${gift.status}`}>{labels[gift.status]}</footer>
    {available.length > 0 && <div className="chat-gift-actions">
      {available.map((action) => <button key={action} type="button" onClick={(event) => { event.stopPropagation(); onAction(message.id, action); }}>
        {action === "accept" ? "收下" : "拒绝"}
      </button>)}
    </div>}
  </section>;
}

export function GiftResultCard({ message, characterName }: { message: ChatMessage; characterName: string }) {
  const event = message.giftEvent;
  if (!event) return null;
  const actor = event.actor === "user" ? "你" : characterName;
  const action = event.action === "accept" ? "收下了礼物" : "拒绝了礼物";
  return <div className="chat-gift-result" aria-label={`${actor}${action}`}>{event.icon} {actor}{action} · {event.content}</div>;
}
