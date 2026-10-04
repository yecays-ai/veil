"use client";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Ellipsis,
  Heart,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useFoundation } from "../foundation-provider";
import { chatEngine } from "../../lib/chat/engine";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatMessage } from "../../lib/chat/types";
import {
  messageMenuPosition,
  selectMessageRange,
} from "../../lib/chat/message-actions";
import { ChatAvatar } from "./avatar";
import { useChatSession } from "./use-chat-session";
import { useKeyboardDismissAutoReply } from "./use-keyboard-dismiss-auto-reply";
import { createTransientFeedback, hasPendingUserContent, sendThenRequestReply, visibleReplyText } from "../../lib/chat/usability";
import { groupVisibleMessages, hiddenForReveal } from "../../lib/chat/bubble-pacing";
import { useBubbleReveal } from "./use-bubble-reveal";

export function ChatRoom({ characterId }: { characterId: string }) {
  const { document, ready } = useFoundation();
  const character = document.characters.find(
    (c) => c.characterId === characterId,
  );
  const { session, messages, loadError } = useChatSession(
    characterId,
    ready && !!character,
  );
  const empty = !!session && messages.length === 0 && !loadError;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackController] = useState(() => createTransientFeedback(setFeedback));
  const sendingLock = useRef(false);
  const replyLock = useRef(false);
  const currentSessionId = useRef(session?.id);
  currentSessionId.current = session?.characterId === characterId ? session.id : undefined;
  const { queue: revealQueue, state: revealState } = useBubbleReveal(
    currentSessionId.current, messages, session?.streamOnline === true, !!loadError,
  );
  function showFeedback(text: string) {
    feedbackController.show(text);
  }
  useEffect(() => () => feedbackController.cancel(), [feedbackController]);
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionStartId, setSelectionStartId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const mounted = useRef(true);
  const shell = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerBar = useRef<HTMLFormElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const positionMenu = useRef<() => void>(() => {});
  const nativeSelectionActive = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const textarea = composer.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [draft]);
  useLayoutEffect(() => {
    const bar = composerBar.current;
    if (!bar || !shell.current) return;
    const update = () => shell.current?.style.setProperty("--chat-composer-height", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const trackSelection = () => {
      const selection = window.getSelection();
      nativeSelectionActive.current = !!selection && !selection.isCollapsed &&
        !!selection.toString();
    };
    globalThis.document.addEventListener("selectionchange", trackSelection);
    return () => globalThis.document.removeEventListener("selectionchange", trackSelection);
  }, []);

  const closeActions = useCallback(() => {
    setActiveMessage(null);
    setMenuAnchor(null);
  }, []);
  useLayoutEffect(() => {
    if (!activeMessage || !menuAnchor || !actionMenu.current || !shell.current) return;
    const menu = actionMenu.current;
    const position = () => {
      if (!menu.isConnected || !menuAnchor.isConnected || !shell.current) return;
      const rect = menuAnchor.getBoundingClientRect();
      const viewportRect = shell.current.getBoundingClientRect();
      const scaleX = viewportRect.width / shell.current.clientWidth || 1;
      const scaleY = viewportRect.height / shell.current.clientHeight || 1;
      menu.style.maxWidth = `${Math.max(0, shell.current.clientWidth - 16)}px`;
      const naturalHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
      const result = messageMenuPosition({
        left: (rect.left - viewportRect.left) / scaleX,
        right: (rect.right - viewportRect.left) / scaleX,
        top: (rect.top - viewportRect.top) / scaleY,
        bottom: (rect.bottom - viewportRect.top) / scaleY,
      }, { width: menu.offsetWidth, height: naturalHeight }, {
        width: shell.current.clientWidth,
        height: shell.current.clientHeight,
      });
      Object.assign(menu.style, { left: `${result.left}px`, top: `${result.top}px`,
        maxHeight: `${result.maxHeight}px`, visibility: "visible" });
    };
    positionMenu.current = position;
    const openedAt = performance.now();
    let frame = requestAnimationFrame(function track() {
      position();
      if (performance.now() < openedAt + 180) frame = requestAnimationFrame(track);
    });
    const observer = new ResizeObserver(position);
    observer.observe(menuAnchor);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [activeMessage, menuAnchor]);

  function openActions(e: React.MouseEvent<HTMLElement>, message: ChatMessage) {
    if (multiSelect || message.status === "streaming") return;
    const selection = window.getSelection();
    if (nativeSelectionActive.current ||
      (selection && !selection.isCollapsed && selection.toString())) return;
    setActiveMessage(message);
    setMenuAnchor(e.currentTarget);
    setSettingsOpen(false);
  }
  async function copyMessage() {
    if (!activeMessage) return;
    try { await navigator.clipboard.writeText(activeMessage.content); showFeedback("Copied"); }
    catch { setError("Message could not be copied."); }
    closeActions();
  }
  async function deleteConfirmed() {
    if (!session || !confirmDelete) return;
    try { await chatStorage.deleteMessages(session.id, confirmDelete); revealQueue.discard(confirmDelete); showFeedback("Deleted");
      setConfirmDelete(null); setMultiSelect(false); setSelectedIds(new Set()); }
    catch (e) { setError(e instanceof Error ? e.message : "Messages could not be deleted."); }
  }
  useEffect(() => {
    if (nearBottom.current)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [messages, revealState]);
  // Keep the chat composer above the visual viewport's keyboard, without
  // changing Phone Shell or Home sizing. Blur is deliberately not generation.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const mobile = window.matchMedia(
        "(hover: none) and (pointer: coarse)",
      ).matches;
      const bottom =
        shell.current?.getBoundingClientRect().bottom ?? window.innerHeight;
      const obscured = mobile
        ? Math.max(0, bottom - viewport.height - viewport.offsetTop)
        : 0;
      shell.current?.style.setProperty(
        "--chat-keyboard-inset",
        `${obscured}px`,
      );
      if (nearBottom.current)
        history.current?.scrollTo({ top: history.current.scrollHeight });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  async function persistDraft(content: string, sessionId: string, focus: boolean) {
    sendingLock.current = true;
    setSending(true);
    try {
      nearBottom.current = true;
      await chatEngine.send(sessionId, content);
      if (mounted.current && currentSessionId.current === sessionId) {
        setDraft((current) => (current === content ? "" : current));
        if (focus) composer.current?.focus();
      }
    } finally {
      sendingLock.current = false;
      if (mounted.current) setSending(false);
    }
  }
  async function send() {
    if (!session || session.characterId !== characterId || sendingLock.current || !draft.trim() || loadError) return;
    setError("");
    try {
      await persistDraft(draft, session.id, true);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Message could not be saved.",
        );
    }
  }
  async function reply() {
    if (!session || session.characterId !== characterId || replyLock.current || sendingLock.current ||
      chatEngine.isGenerating(session.id) || loadError) return;
    const sessionId = session.id;
    replyLock.current = true;
    let revealToken: number | undefined;
    setGenerating(true);
    setError("");
    nearBottom.current = true;
    try {
      await sendThenRequestReply(draft,
        (content) => persistDraft(content, sessionId, false),
        async () => {
          if (mounted.current && currentSessionId.current === sessionId) {
            revealToken = revealQueue.begin(sessionId, messages, session.streamOnline === true, performance.now());
            const token = revealToken;
            return chatEngine.requestReply(sessionId, (completed) => {
              if (mounted.current && currentSessionId.current === sessionId)
                revealQueue.complete(sessionId, completed, performance.now(), token);
            });
          }
        });
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Reply could not be requested.",
        );
    } finally {
      revealQueue.settle(sessionId, revealToken);
      replyLock.current = false;
      if (mounted.current) setGenerating(false);
    }
  }
  useKeyboardDismissAutoReply(shell, {
    sessionId: session?.characterId === characterId ? session.id : undefined,
    enabled: session?.autoReplyOnKeyboardDismiss === true,
    blocked: generating || !!revealState?.pending || sending || multiSelect || !!activeMessage || !!editingMessage ||
      settingsOpen || confirmClear || !!confirmDelete,
    onReply: reply,
  });
  async function updateSetting(patch: { streamOnline?: boolean; autoReplyOnKeyboardDismiss?: boolean }) {
    if (!session) return;
    try { await chatStorage.updateSessionSettings(session.id, patch); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Setting could not be saved."); }
  }
  if (!ready)
    return (
      <div className="chat-app">
        <p className="chat-notice">Loading Character…</p>
      </div>
    );
  if (!character)
    return (
      <div className="chat-app">
        <Link href="/messages">‹ Messages</Link>
        <p className="chat-notice">This Character is no longer available.</p>
      </div>
    );
  const pending = hasPendingUserContent(messages);
  const selectable = messages.filter((message) => message.status !== "streaming");
  const hidden = (message: ChatMessage) =>
    (!!revealState && hiddenForReveal(message, revealState)) ||
    (generating && session?.streamOnline !== true && message.role === "assistant" && message.status === "streaming");
  const visibleMessages = messages.filter((message) => !hidden(message));
  const groupedMessages = groupVisibleMessages(visibleMessages);
  const typing = !!revealState?.pending || (generating && session?.streamOnline !== true);
  const firstHiddenIndex = messages.findIndex(hidden);
  const typingBeforeId = firstHiddenIndex < 0 ? undefined :
    messages.slice(firstHiddenIndex + 1).find((message) => !hidden(message))?.id;
  const typingIndicator = typing && <div className="chat-turn chat-turn-assistant" role="status" aria-label="Replying">
    <ChatAvatar profile={character} /><div className="chat-message">
      <p className="chat-bubble">…</p><span className="chat-message-meta">Replying…</span>
    </div>
  </div>;
  return (
    <div className="chat-app chat-room" ref={shell}
      data-context-menu-open={activeMessage ? "" : undefined}>
      <header className="chat-header">
        <Link
          href="/messages"
          className="chat-back"
          aria-label="Back to Messages"
        >
          <ChevronLeft aria-hidden="true" />
        </Link>
        <div className="chat-contact-summary" aria-label={`${session?.remark || character.name} contact details`}>
          <ChatAvatar profile={character} />
          <strong>{session?.remark || character.name}</strong>
          <ChevronRight aria-hidden="true" />
        </div>
        <button type="button" className="chat-settings-button" aria-label="Conversation settings"
          title="Conversation settings" aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}><Ellipsis aria-hidden="true" /></button>
        {settingsOpen && <div className="chat-settings-menu">
          <label className="chat-session-setting"><span>Streaming Replies
            <small>Show replies as they are generated.</small></span>
            <input type="checkbox" checked={session?.streamOnline === true}
              onChange={(e) => void updateSetting({ streamOnline: e.target.checked })} /></label>
          <label className="chat-session-setting"><span>Reply When Keyboard Closes</span>
            <input type="checkbox" checked={session?.autoReplyOnKeyboardDismiss === true}
              onChange={(e) => void updateSetting({ autoReplyOnKeyboardDismiss: e.target.checked })} /></label>
          <button type="button" className="chat-danger" disabled={!messages.length || generating}
            onClick={() => { setSettingsOpen(false); setConfirmClear(true); }}>Clear Chat</button>
        </div>}
      </header>
      <div
        className={`chat-history${empty ? " chat-history-empty" : ""}`}
        ref={history}
        aria-label="Conversation history"
        onScroll={() => {
          const el = history.current;
          if (el)
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (activeMessage) positionMenu.current();
        }}
      >
        {!session && (
          <p className="chat-notice">
            {loadError ? "Conversation unavailable." : "Loading conversation…"}
          </p>
        )}
        {empty && <p className="chat-empty-state">No messages yet</p>}
        {groupedMessages.map(({ message, showTimestamp }) => (
          <Fragment key={message.id}>
            {typingBeforeId === message.id && typingIndicator}
            {showTimestamp && <div className="chat-time-separator">
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>}
          <div
            className={`chat-turn chat-turn-${message.role}${selectedIds.has(message.id) ? " chat-turn-selected" : ""}`}
            data-message-id={message.id}
            data-active={activeMessage?.id === message.id ? "" : undefined}
            onClick={() => {
              if (!multiSelect || message.status === "streaming") return;
              setSelectedIds((current) => { const next = new Set(current);
                if (next.has(message.id)) next.delete(message.id); else next.add(message.id); return next; });
            }}
          >
            {multiSelect && <span className="chat-selection-control" aria-hidden="true">
              {selectedIds.has(message.id) ? "✓" : ""}
            </span>}
            {message.role === "assistant" && <ChatAvatar profile={character} />}
            <div className="chat-message">
              <p className="chat-bubble"
                onPointerDown={() => { nativeSelectionActive.current = false; }}
                onContextMenu={() => { nativeSelectionActive.current = true; }}
                onClick={(e) => openActions(e, message)}>
                {visibleReplyText(message, session?.streamOnline === true) ||
                  (message.status === "streaming" && generating ? "…" : "")}
              </p>
              <span className="chat-message-meta">
                {message.status === "streaming" && (
                  <span>{generating ? "Replying…" : "Interrupted reply"}</span>
                )}
                {message.status === "cancelled" && <span>Reply stopped</span>}
                {message.status === "error" && (
                  <span role="alert">{message.error || "Reply failed."}</span>
                )}
              </span>
            </div>
          </div>
          </Fragment>
        ))}
        {!typingBeforeId && typingIndicator}
      </div>
      {(error || loadError) && (
        <p role="alert" className="chat-notice chat-error">
          {error || loadError}
        </p>
      )}
      {feedback && <div className="chat-feedback-toast" role="status">{feedback}</div>}
      {multiSelect && <div className="chat-multi-select-bar">
        <span>{selectedIds.size} selected</span>
        <button type="button" onClick={() => setSelectedIds(new Set(selectable.map((m) => m.id)))}>Select all</button>
        <button type="button" disabled={!selectionStartId} onClick={() => selectionStartId &&
          setSelectedIds(new Set(selectMessageRange(selectable.map((m) => m.id), selectionStartId)))}>
          Select from here to latest
        </button>
        <button type="button" className="chat-danger" disabled={!selectedIds.size}
          onClick={() => setConfirmDelete([...selectedIds])}>Delete selected</button>
        <button type="button" onClick={() => { setMultiSelect(false); setSelectedIds(new Set()); }}>Cancel</button>
      </div>}
      <form
        className="chat-composer"
        ref={composerBar}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button type="button" className="chat-composer-icon chat-composer-plus"
          aria-label="More message options" title="More message options">
          <Plus aria-hidden="true" />
        </button>
        <div className="chat-input-shell">
          <label className="chat-input-label" htmlFor="chat-input">Message</label>
          <textarea
            id="chat-input"
            ref={composer}
            rows={1}
            maxLength={12000}
            value={draft}
            disabled={!session || !!loadError}
            placeholder="Message…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <span className="chat-voice-slot" aria-hidden="true" />
        </div>
        <div className="chat-composer-actions">
          {generating || revealState?.pending ? (
            <button type="button" className="chat-composer-icon" aria-label="Stop reply" title="Stop reply"
              onClick={() => {
                revealQueue.cancel();
                if (session) chatEngine.stop(session.id);
              }}>
              <Square aria-hidden="true" />
            </button>
          ) : session?.autoReplyOnKeyboardDismiss !== true ? (
            <button
              type="button"
              className="chat-composer-icon chat-request-reply"
              aria-label="Request Reply"
              title="Request Reply"
              onPointerDown={(e) => e.preventDefault()}
              disabled={!session || (!pending && !draft.trim()) || sending || !!loadError}
              onClick={() => void reply()}
            >
              <Sparkles aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="submit"
            className="chat-composer-icon chat-send"
            aria-label="Send"
            title="Send"
            onPointerDown={(e) => e.preventDefault()}
            disabled={!session || sending || !draft.trim() || !!loadError}
          >
            <SendHorizontal aria-hidden="true" />
          </button>
        </div>
      </form>
      {activeMessage && <>
        <button className="chat-context-backdrop" aria-label="Close message actions" onClick={closeActions} />
        <div ref={actionMenu} className="chat-message-actions" role="menu" aria-label="Message actions"
          style={{ left: 0, top: 0, visibility: "hidden" }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="chat-message-actions-grid">
            <Action label="Copy" icon={Copy} onClick={() => void copyMessage()} />
            <Action label="Edit" icon={Pencil} onClick={() => { setEditingMessage(activeMessage);
              setEditText(activeMessage.content); closeActions(); }} />
            <Action label="Quote" icon={Quote} disabled />
            <Action label="React" icon={Heart} disabled />
            <Action label="Select" icon={CircleCheck} onClick={() => { const id = activeMessage.id;
              setMultiSelect(true); setSelectionStartId(id); setSelectedIds(new Set([id])); closeActions(); }} />
            <Action label="Favorite" icon={Bookmark} disabled />
            <Action label="Delete" icon={Trash2} danger onClick={() => { setConfirmDelete([activeMessage.id]); closeActions(); }} />
            <Action label="Regenerate" icon={RotateCcw} disabled />
          </div>
        </div>
      </>}
      {editingMessage && <div className="chat-dialog-backdrop">
        <form className="chat-dialog" onSubmit={async (e) => { e.preventDefault();
          try { await chatStorage.editMessage(editingMessage.id, editText); setEditingMessage(null); showFeedback("Saved"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be saved."); } }}>
          <h2>Edit Message</h2><textarea autoFocus maxLength={12000} value={editText}
            onChange={(e) => setEditText(e.target.value)} />
          <div><button type="button" onClick={() => setEditingMessage(null)}>Cancel</button>
            <button type="submit" disabled={!editText.trim()}>Save</button></div>
        </form>
      </div>}
      {confirmDelete && <ConfirmDialog title="Delete messages?"
        text={`Delete ${confirmDelete.length} message${confirmDelete.length === 1 ? "" : "s"} from this conversation?`}
        onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteConfirmed()} />}
      {confirmClear && <ConfirmDialog title="Clear this conversation?"
        text={`Delete all ${messages.length} messages from this conversation?`}
        onCancel={() => setConfirmClear(false)} onConfirm={async () => {
          if (!session) return;
          try { await chatStorage.clearSession(session.id); revealQueue.cancel(); setConfirmClear(false); showFeedback("Conversation cleared"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Conversation could not be cleared."); }
        }} />}
    </div>
  );
}

function Action({ label, icon, disabled, danger, onClick }: {
  label: string; icon: LucideIcon; disabled?: boolean; danger?: boolean; onClick?: () => void;
}) {
  const Icon = icon;
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
    className={danger ? "chat-danger" : undefined}><Icon size={25} strokeWidth={1.75}
      aria-hidden="true" /><small>{label}</small></button>;
}

function ConfirmDialog({ title, text, onCancel, onConfirm }: {
  title: string; text: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="chat-dialog-backdrop"><div className="chat-dialog" role="alertdialog"
    aria-modal="true" aria-labelledby="chat-confirm-title"><h2 id="chat-confirm-title">{title}</h2>
    <p>{text}</p><div><button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="chat-danger" onClick={onConfirm}>Delete</button></div></div></div>;
}
