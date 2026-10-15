"use client";

import { ArrowDownLeft, ArrowUpRight, Check, CreditCard, RotateCcw, X } from "lucide-react";
import type { MouseEvent } from "react";
import type { ChatMessage } from "../../../lib/chat/types";
import { canApplyTransferAction, formatTransferAmount, type TransferAction, type TransferActor } from "../../../lib/chat/transfer";

const status = {
  pending: { icon: ArrowDownLeft, name: "Pending", detail: "Tap to receive" },
  received: { icon: Check, name: "Received", detail: "Transfer completed" },
  declined: { icon: X, name: "Declined", detail: "Transfer declined" },
  returned: { icon: RotateCcw, name: "Returned", detail: "Transfer returned" },
} as const;

export function TransferCard({ message, actor, characterName, onAction, onOpenActions, onPointerDown, onContextMenu }: {
  message: ChatMessage; actor: TransferActor; characterName: string; onAction: (id: string, action: TransferAction) => void;
  onOpenActions: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void; onPointerDown: () => void; onContextMenu: () => void;
}) {
  const transfer = message.transfer;
  if (!transfer) return null;
  const relation = transfer.sender === "user" ? `To ${characterName}` : `From ${characterName}`;
  const current = status[transfer.status], StatusIcon = current.icon;
  const available = (["receive", "decline", "return"] as const).filter((action) => canApplyTransferAction(transfer, actor, action));
  return <section className="chat-transfer-card" aria-label={`${relation}, ${current.name}`}
    onPointerDown={onPointerDown} onContextMenu={(event) => { onContextMenu(); event.preventDefault(); }}
    onClick={(event) => onOpenActions(event, message)}>
    <header className="chat-card-heading">
      <span className="chat-card-main-icon" aria-hidden="true">{transfer.sender === "user" ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
      <span className="chat-card-heading-copy"><small>{relation}</small><strong>Transfer</strong></span>
      <CreditCard className="chat-card-corner-icon" aria-hidden="true" />
    </header>
    <strong className="chat-transfer-amount">{formatTransferAmount(transfer.amount)}</strong>
    <p className="chat-transfer-note">{transfer.note || "No message"}</p>
    <footer className="chat-card-status"><span><StatusIcon aria-hidden="true" />{current.name}</span><small>{current.detail}</small></footer>
    {available.length > 0 && <div className="chat-card-actions">
      {available.map((action) => <button key={action} type="button" onClick={(event) => { event.stopPropagation(); onAction(message.id, action); }}>
        {action === "receive" ? "Receive" : action === "decline" ? "Decline" : "Return"}
      </button>)}
    </div>}
  </section>;
}

export function TransferResultCard({ message, characterName }: { message: ChatMessage; characterName: string }) {
  const event = message.transferEvent;
  if (!event) return null;
  const received = event.action === "receive", returned = event.action === "return";
  const Icon = received ? Check : returned ? RotateCcw : X;
  const title = received ? "Received" : returned ? "Returned" : "Declined";
  const detail = received ? "Transfer completed" : returned ? "Transfer returned" : "Transfer declined";
  const actor = event.actor === "user" ? "You" : characterName;
  return <section className="chat-transfer-card chat-result-card" aria-label={`${actor}: ${title}`}>
    <header className="chat-card-heading"><span className="chat-card-main-icon" aria-hidden="true"><Icon /></span>
      <span className="chat-card-heading-copy"><small>{actor}</small><strong>{title}</strong></span>
      <CreditCard className="chat-card-corner-icon" aria-hidden="true" /></header>
    <strong className="chat-result-value">{formatTransferAmount(event.amount)}</strong>
    <footer className="chat-card-status"><span><Icon aria-hidden="true" />{title}</span><small>{detail}</small></footer>
  </section>;
}
