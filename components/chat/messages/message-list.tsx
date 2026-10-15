import { Fragment, type MouseEvent, type ReactNode } from "react";
import type { ProfileBasics } from "../../../lib/foundation-types";
import { applyRegex } from "../../../lib/regex-engine";
import type { RegexGroup } from "../../../lib/regex";
import { canContinueTurn, canRegenerateTurn } from "../../../lib/chat/turns";
import type { ChatMessage } from "../../../lib/chat/types";
import { readOnReplyState, resolveUserMessageDelivery, userMessageDeliveryLabel } from "../../../lib/chat/delivery";
import { reactionBadges } from "../../../lib/chat/reactions";
import { parseQuotedReply } from "../../../lib/chat/quote";
import { visibleReplyText } from "../../../lib/chat/usability";
import { ChatAvatar } from "../avatar";
import { MessageFooter } from "../message-footer";
import { QuoteBubble } from "../quote-bubble";
import { StickerImage } from "../sticker-image";
import { TransferCard, TransferResultCard } from "../transfers/transfer-card";
import type { TransferAction } from "../../../lib/chat/transfer";
import { GiftCard, GiftResultCard } from "../gifts/gift-card";
import type { GiftAction } from "../../../lib/chat/gift";

type GroupedMessage = { message: ChatMessage; showTimestamp: boolean; isGroupStart: boolean; isGroupEnd: boolean };

/** The message timeline is presentation-only; ChatRoom retains session, overlay and generation coordination. */
export function MessageList({
  groupedMessages, messages, selectedIds, activeMessageId, highlightedMessageId, multiSelect, typing, typingBeforeId,
  typingIndicator, character, userName, streamOnline, generationActive, regexGroups, lastVisibleMessageId, lifeMode,
  onOpenActions, onToggleSelected, onClearHighlight, onRegenerate,
  onPointerDownMessage, onContextMenuMessage, onTransferAction, onGiftAction,
}: {
  groupedMessages: readonly GroupedMessage[];
  messages: readonly ChatMessage[];
  selectedIds: ReadonlySet<string>;
  activeMessageId?: string;
  highlightedMessageId: string | null;
  multiSelect: boolean;
  typing: boolean;
  typingBeforeId?: string;
  typingIndicator: ReactNode;
  character: Pick<ProfileBasics, "name" | "avatar">;
  userName: string;
  streamOnline: boolean;
  generationActive: boolean;
  regexGroups: readonly RegexGroup[];
  lastVisibleMessageId?: string;
  lifeMode?: boolean;
  onOpenActions: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onToggleSelected: (message: ChatMessage) => void;
  onClearHighlight: (messageId: string) => void;
  onRegenerate: (message: ChatMessage, continuation?: boolean) => void;
  onPointerDownMessage: () => void;
  onContextMenuMessage: () => void;
  onTransferAction: (messageId: string, action: TransferAction) => void;
  onGiftAction: (messageId: string, action: GiftAction) => void;
}) {
  return <>
    {groupedMessages.map(({ message, showTimestamp, isGroupStart, isGroupEnd }) => {
      const delivery = isGroupEnd ? resolveUserMessageDelivery(message, lifeMode ? readOnReplyState(messages) : undefined) : null;
      const groupClass = `${isGroupStart ? " chat-group-start" : ""}${isGroupEnd ? " chat-group-end" : ""}${isGroupStart || isGroupEnd ? "" : " chat-group-middle"}`;
      const visibleText = visibleReplyText(message, streamOnline);
      const parsed = message.role === "assistant" ? parseQuotedReply(visibleText) : { content: visibleText, preview: null };
      const quotePreview = message.quote?.preview ?? parsed.preview;
      const selected = selectedIds.has(message.id);
      const highlighted = highlightedMessageId === message.id;
      const badges = reactionBadges(message);
      const specialKind = message.transfer || message.transferEvent ? " chat-message-transfer"
        : message.gift || message.giftEvent ? " chat-message-gift" : "";
      return <Fragment key={message.id}>
        {typingBeforeId === message.id && typingIndicator}
        {showTimestamp && <div className="chat-time-separator chat-sys-msg"><time dateTime={new Date(message.createdAt).toISOString()}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time></div>}
        {message.role === "system" || message.recalled ? <div className={`chat-turn chat-system-event${selected ? " chat-turn-selected" : ""}${highlighted ? " chat-turn-search-highlight" : ""}`}
          data-message-id={message.id} data-active={activeMessageId === message.id ? "" : undefined}
          onClick={() => { if (multiSelect) onToggleSelected(message); }}>
          {multiSelect && <span className="chat-selection-control" aria-hidden="true">{selected ? "✓" : ""}</span>}
          <p className="chat-system-pill" onClick={(event) => onOpenActions(event, message)}>{message.recalled
            ? message.role === "user" ? "You recalled a message." : `${character.name} recalled a message.` : message.content}</p>
        </div> : <div className={`chat-turn chat-msg-wrapper chat-turn-${message.role}${groupClass}${selected ? " chat-turn-selected" : ""}${highlighted ? " chat-turn-search-highlight" : ""}`}
          data-message-id={message.id} data-consecutive={!isGroupStart ? "" : undefined}
          data-active={activeMessageId === message.id ? "" : undefined}
          onClick={() => { if (multiSelect && message.status !== "streaming") onToggleSelected(message); }}>
          {multiSelect && <span className="chat-selection-control" aria-hidden="true">{selected ? "✓" : ""}</span>}
          {message.role === "assistant" && <div className="chat-avatar-column chat-msg-avatar">{isGroupStart && <ChatAvatar profile={character} />}</div>}
          <div className={`chat-message${specialKind}`}>
            {message.transfer ? <TransferCard message={message} actor="user" characterName={character.name} onAction={onTransferAction}
              onOpenActions={onOpenActions} onPointerDown={onPointerDownMessage} onContextMenu={onContextMenuMessage} />
              : message.gift ? <GiftCard message={message} actor="user" characterName={character.name} onAction={onGiftAction}
                onOpenActions={onOpenActions} onPointerDown={onPointerDownMessage} onContextMenu={onContextMenuMessage} />
                : message.giftEvent ? <GiftResultCard message={message} characterName={character.name} />
              : message.transferEvent ? <TransferResultCard message={message} characterName={character.name} /> : <div
                className={`chat-bubble-shell${badges.length ? " chat-bubble-shell-has-reactions" : ""}`}>
                {badges.length > 0 && <span className="chat-reaction-stack" aria-label="Message reactions">
                  {badges.map((emoji, index) => <span key={index} className="chat-reaction-badge" data-emoji={emoji}
                    data-side={index === 0 && message.reactions?.character ? "character" : "user"} role="img" aria-label={`Reaction ${emoji}`} />)}
                </span>}
                <p className={`chat-bubble chat-bubble-role-${message.role} chat-markdown${message.sticker ? " chat-bubble-sticker" : ""}`}
                  onAnimationEnd={() => { if (highlighted) onClearHighlight(message.id); }}
                  onPointerDown={onPointerDownMessage}
                  onContextMenu={onContextMenuMessage}
                  onClick={(event) => onOpenActions(event, message)}>
                  {quotePreview !== null && quotePreview !== undefined && <QuoteBubble preview={quotePreview}
                    author={message.quote ? (message.quote.role === "user" ? "You" : character.name) : undefined} />}
                  {message.sticker && <StickerImage className="chat-sticker-image" url={message.sticker.url} name={message.sticker.name} />}
                  {message.sticker ? null : message.status === "error" || message.status === "cancelled" ? "Generation attempt" : (parsed.content && (message.role === "user" || message.role === "assistant")
                    ? applyRegex(parsed.content, regexGroups, message.role, "display", { character: character.name, user: userName }) : parsed.content) ||
                    (message.status === "streaming" && generationActive ? "…" : "")}
                </p>
              </div>}
            <MessageFooter messageId={message.id} />
            <span className="chat-message-meta">
              {message.status === "streaming" && !generationActive && <span>Interrupted reply</span>}
              {message.status === "cancelled" && <span>Reply stopped</span>}
              {message.status === "error" && <span role="alert">{message.error || "Reply failed."}</span>}
              {!generationActive && message.role === "assistant" && canRegenerateTurn(messages, message.id) &&
                (message.status === "error" || message.status === "cancelled") && <button type="button" onClick={() => onRegenerate(message, message.attemptMode === "continue")}>Retry</button>}
              {!generationActive && canContinueTurn(messages, message.id) && <button type="button" onClick={() => onRegenerate(message, true)}>Continue conversation</button>}
              {delivery && !typing && message.id === lastVisibleMessageId && <span className="chat-delivery-status">{userMessageDeliveryLabel(delivery)}</span>}
            </span>
          </div>
        </div>}
      </Fragment>;
    })}
    {!typingBeforeId && typingIndicator}
  </>;
}
