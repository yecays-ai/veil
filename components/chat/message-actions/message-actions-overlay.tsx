"use client";

import { Bookmark, Brain, CircleCheck, Copy, Pencil, Plus, Quote, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import type { RefObject } from "react";
import { canReactTo } from "../../../lib/chat/reactions";
import { getMessageActions } from "../../../lib/chat/message-action-registry";
import { canRegenerateTurn } from "../../../lib/chat/turns";
import type { ChatMessage } from "../../../lib/chat/types";
import { ReactionBar, ReactionPickerSheet } from "../reaction-bar";

export function MessageActionsOverlay({ activeMessage, messages, generationActive, revealPending, actionMenuRef, reactionBarRef,
  reactionPickerOpen, onClose, onPickReaction, onOpenReactionPicker, onCopy, onEdit, onQuote, onMemory, onSelect, onDelete,
  onRegenerate, onRunRegisteredAction }: {
  activeMessage: ChatMessage | null;
  messages: readonly ChatMessage[];
  generationActive: boolean;
  revealPending: boolean;
  actionMenuRef: RefObject<HTMLDivElement | null>;
  reactionBarRef: RefObject<HTMLDivElement | null>;
  reactionPickerOpen: boolean;
  onClose: () => void;
  onPickReaction: (emoji: string | null) => void;
  onOpenReactionPicker: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onQuote: () => void;
  onMemory: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onRunRegisteredAction: (id: string) => void;
}) {
  if (!activeMessage) return null;
  return <>
    <button className="chat-context-backdrop" data-message-overlay="" aria-label="Close message actions" onClick={onClose} />
    {canReactTo(activeMessage) && <ReactionBar barRef={reactionBarRef} current={activeMessage.reactions?.user}
      onPick={onPickReaction} onMore={onOpenReactionPicker} />}
    {reactionPickerOpen && <ReactionPickerSheet onPick={(emoji) => onPickReaction(emoji === activeMessage.reactions?.user ? null : emoji)} />}
    <div ref={actionMenuRef} tabIndex={-1} data-message-overlay="" className="chat-message-actions ctx-menu" role="menu" aria-label="Message actions"
      style={{ left: 0, top: 0, visibility: "hidden" }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="chat-message-actions-grid">
        <Action label="Copy" icon={Copy} disabled={!!activeMessage.sticker} onClick={onCopy} />
        <Action label="Edit" icon={Pencil} disabled={activeMessage.role === "system" || !!activeMessage.sticker || generationActive || activeMessage.status === "error" || activeMessage.status === "cancelled"} onClick={onEdit} />
        <Action label="Quote" icon={Quote} disabled={activeMessage.role === "system" || activeMessage.status === "error" || activeMessage.status === "cancelled"} onClick={onQuote} />
        <Action label="Memory" icon={Brain} disabled={activeMessage.role !== "assistant"} onClick={onMemory} />
        <Action label="Select" icon={CircleCheck} onClick={onSelect} />
        <Action label="Favorite" icon={Bookmark} disabled />
        <Action label="Delete" icon={Trash2} danger onClick={onDelete} />
        <Action label="Regenerate" icon={RotateCcw} disabled={!canRegenerateTurn(messages, activeMessage.id) || generationActive || revealPending} onClick={onRegenerate} />
        {getMessageActions(activeMessage).map((action) => <Action key={action.id} label={action.label} icon={Plus} onClick={() => onRunRegisteredAction(action.id)} />)}
      </div>
    </div>
  </>;
}

export function Action({ label, icon: Icon, disabled, danger, onClick }: { label: string; icon: LucideIcon; disabled?: boolean; danger?: boolean; onClick?: () => void }) {
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
    className={`ctx-menu-btn${danger ? " ctx-menu-btn-danger chat-danger" : ""}`}>
    <Icon size={25} strokeWidth={1.75} aria-hidden="true" /><small>{label}</small>
  </button>;
}
