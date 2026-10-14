"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { MouseEvent } from "react";
import type { ChatMessage } from "../../../lib/chat/types";
import { canApplyTransferAction, formatTransferAmount, type TransferAction, type TransferActor } from "../../../lib/chat/transfer";

const labels = { pending: "待处理", received: "已收款", declined: "已拒绝", returned: "已退回" } as const;

export function TransferCard({ message, actor, characterName, onAction, onOpenActions, onPointerDown, onContextMenu }: {
  message: ChatMessage; actor: TransferActor; characterName: string; onAction: (id: string, action: TransferAction) => void;
  onOpenActions: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void; onPointerDown: () => void; onContextMenu: () => void;
}) {
  const transfer = message.transfer;
  if (!transfer) return null;
  const sender = transfer.sender === "user" ? "你" : characterName;
  const receiver = transfer.recipient === "user" ? "你" : characterName;
  const available: TransferAction[] = ["receive", "decline", "return"].filter((action) =>
    canApplyTransferAction(transfer, actor, action as TransferAction)) as TransferAction[];
  return <section className="chat-transfer-card" aria-label={`${sender}转给${receiver}，${labels[transfer.status]}`}
    onPointerDown={onPointerDown} onContextMenu={(event) => { onContextMenu(); event.preventDefault(); }}
    onClick={(event) => onOpenActions(event, message)}>
    <header className="chat-transfer-heading"><span className="chat-transfer-icon" aria-hidden="true">{transfer.sender === "user" ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
      <span>{sender} 转给 {receiver}</span></header>
    <strong className="chat-transfer-amount">{formatTransferAmount(transfer.amount)}</strong>
    <span className="chat-transfer-caption">虚拟转账</span>
    <p className="chat-transfer-note">{transfer.note || "无留言"}</p>
    <footer className={`chat-transfer-status chat-transfer-status-${transfer.status}`}>{labels[transfer.status]}</footer>
    {available.length > 0 && <div className="chat-transfer-actions">
      {available.map((action) => <button key={action} type="button" onClick={(event) => { event.stopPropagation(); onAction(message.id, action); }}>
        {action === "receive" ? "收下" : action === "decline" ? "拒绝" : "退回"}
      </button>)}
    </div>}
  </section>;
}

export function TransferResultCard({ message, characterName }: { message: ChatMessage; characterName: string }) {
  const event = message.transferEvent;
  if (!event) return null;
  const action = event.action === "receive" ? "收下了这笔转账" : event.action === "decline" ? "拒绝了这笔转账" : "退回了这笔转账";
  const actor = event.actor === "user" ? "你" : characterName;
  return <div className="chat-transfer-result" aria-label={`${actor}${action}`}>{actor}{action} · {formatTransferAmount(event.amount)}</div>;
}
