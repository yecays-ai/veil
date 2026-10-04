"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { chatEngine } from "../../lib/chat/engine";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatMessage } from "../../lib/chat/types";
import {
  MESSAGE_LONG_PRESS_MS,
  messageMenuPosition,
  movedPastLongPressTolerance,
  selectMessageRange,
} from "../../lib/chat/message-actions";
import { ChatAvatar } from "./avatar";
import { useChatSession } from "./use-chat-session";

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
  const composer = useRef<HTMLTextAreaElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const positionMenu = useRef<() => void>(() => {});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const closeActions = useCallback(() => {
    setActiveMessage(null);
    setMenuAnchor(null);
  }, []);
  const cancelLongPress = useCallback(() => {
    longPressStart.current = null;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);
  useEffect(() => () => cancelLongPress(), [cancelLongPress]);
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

  function startLongPress(e: React.PointerEvent<HTMLElement>, message: ChatMessage) {
    if (multiSelect || message.status === "streaming" ||
      (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const anchor = e.currentTarget;
    longPressStart.current = { x: e.clientX, y: e.clientY };
    longPressTriggered.current = false;
    cancelLongPress();
    longPressStart.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setActiveMessage(message); setMenuAnchor(anchor); setSettingsOpen(false);
      longPressTimer.current = null;
    }, MESSAGE_LONG_PRESS_MS);
  }
  function finishLongPress(e: React.PointerEvent) {
    cancelLongPress();
    if (longPressTriggered.current) {
      e.preventDefault(); e.stopPropagation(); longPressTriggered.current = false;
    }
  }
  function moveLongPress(e: React.PointerEvent) {
    if (longPressStart.current && movedPastLongPressTolerance(longPressStart.current,
      { x: e.clientX, y: e.clientY })) cancelLongPress();
  }
  async function copyMessage() {
    if (!activeMessage) return;
    try { await navigator.clipboard.writeText(activeMessage.content); setFeedback("Copied"); }
    catch { setError("Message could not be copied."); }
    closeActions();
  }
  async function deleteConfirmed() {
    if (!session || !confirmDelete) return;
    try { await chatStorage.deleteMessages(session.id, confirmDelete); setFeedback("Deleted");
      setConfirmDelete(null); setMultiSelect(false); setSelectedIds(new Set()); }
    catch (e) { setError(e instanceof Error ? e.message : "Messages could not be deleted."); }
  }
  useEffect(() => {
    if (nearBottom.current)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [messages]);
  // Keep the chat composer above the visual viewport's keyboard, without
  // changing Phone Shell or Home sizing. Blur is deliberately not generation.
  const shell = useRef<HTMLDivElement>(null);
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

  async function send() {
    if (!session || sending || !draft.trim() || loadError) return;
    const content = draft;
    setSending(true);
    setError("");
    try {
      nearBottom.current = true;
      await chatEngine.send(session.id, content);
      if (mounted.current) {
        setDraft((current) => (current === content ? "" : current));
        composer.current?.focus();
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Message could not be saved.",
        );
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  async function reply() {
    if (!session || generating || sending || loadError) return;
    setGenerating(true);
    setError("");
    nearBottom.current = true;
    try {
      await chatEngine.requestReply(session.id);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Reply could not be requested.",
        );
    } finally {
      if (mounted.current) setGenerating(false);
    }
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
  const pending = messages.some((m) =>
    m.role === "user" && m.status === "sent" && !m.requestedBy);
  const selectable = messages.filter((message) => message.status !== "streaming");
  return (
    <div className="chat-app chat-room" ref={shell}
      data-context-menu-open={activeMessage ? "" : undefined}>
      <header className="chat-header">
        <Link
          href="/messages"
          className="chat-back"
          aria-label="Back to Messages"
        >
          ‹
        </Link>
        <ChatAvatar profile={character} />
        <strong>{session?.remark || character.name}</strong>
        <button type="button" className="chat-settings-button" aria-label="Conversation settings"
          aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>•••</button>
        {settingsOpen && <div className="chat-settings-menu">
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
        {messages.map((message) => (
          <div
            key={message.id}
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
                onPointerDown={(e) => startLongPress(e, message)}
                onPointerMove={moveLongPress}
                onPointerUp={finishLongPress}
                onPointerCancel={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onContextMenu={(e) => {
                  if (message.status === "streaming") return;
                  e.preventDefault(); setActiveMessage(message); setMenuAnchor(e.currentTarget);
                }}>
                {message.content ||
                  (message.status === "streaming" && generating ? "…" : "")}
              </p>
              <span className="chat-message-meta">
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
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
        ))}
      </div>
      {(feedback || error || loadError) && (
        <p role="alert" className="chat-notice chat-error">
          {error || loadError || feedback}
        </p>
      )}
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
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="chat-input-label" htmlFor="chat-input">
          Message
        </label>
        <textarea
          id="chat-input"
          ref={composer}
          rows={2}
          maxLength={12000}
          value={draft}
          disabled={!session || !!loadError}
          placeholder="Write a message…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="chat-composer-actions">
          <button
            type="submit"
            onPointerDown={(e) => e.preventDefault()}
            disabled={!session || sending || !draft.trim() || !!loadError}
          >
            Send
          </button>
          {generating ? (
            <button
              type="button"
              onClick={() => session && chatEngine.stop(session.id)}
            >
              Stop reply
            </button>
          ) : (
            <button
              type="button"
              disabled={!session || !pending || sending || !!loadError}
              onClick={() => void reply()}
            >
              Request Reply
            </button>
          )}
        </div>
      </form>
      {activeMessage && <>
        <button className="chat-context-backdrop" aria-label="Close message actions" onClick={closeActions} />
        <div ref={actionMenu} className="chat-message-actions" role="menu" aria-label="Message actions"
          style={{ left: 0, top: 0, visibility: "hidden" }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="chat-message-actions-grid">
            <Action label="Copy" icon="⧉" onClick={() => void copyMessage()} />
            <Action label="Edit" icon="✎" onClick={() => { setEditingMessage(activeMessage);
              setEditText(activeMessage.content); closeActions(); }} />
            <Action label="Quote" icon="❞" disabled />
            <Action label="React" icon="♡" disabled />
            <Action label="Select" icon="☑" onClick={() => { const id = activeMessage.id;
              setMultiSelect(true); setSelectionStartId(id); setSelectedIds(new Set([id])); closeActions(); }} />
            <Action label="Favorite" icon="☆" disabled />
            <Action label="Delete" icon="⌫" danger onClick={() => { setConfirmDelete([activeMessage.id]); closeActions(); }} />
            <Action label="Regenerate" icon="↻" disabled />
          </div>
        </div>
      </>}
      {editingMessage && <div className="chat-dialog-backdrop">
        <form className="chat-dialog" onSubmit={async (e) => { e.preventDefault();
          try { await chatStorage.editMessage(editingMessage.id, editText); setEditingMessage(null); setFeedback("Saved"); }
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
          try { await chatStorage.clearSession(session.id); setConfirmClear(false); setFeedback("Conversation cleared"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Conversation could not be cleared."); }
        }} />}
    </div>
  );
}

function Action({ label, icon, disabled, danger, onClick }: {
  label: string; icon: string; disabled?: boolean; danger?: boolean; onClick?: () => void;
}) {
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
    className={danger ? "chat-danger" : undefined}><span aria-hidden="true">{icon}</span><small>{label}</small></button>;
}

function ConfirmDialog({ title, text, onCancel, onConfirm }: {
  title: string; text: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="chat-dialog-backdrop"><div className="chat-dialog" role="alertdialog"
    aria-modal="true" aria-labelledby="chat-confirm-title"><h2 id="chat-confirm-title">{title}</h2>
    <p>{text}</p><div><button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="chat-danger" onClick={onConfirm}>Delete</button></div></div></div>;
}
