"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CirclePlus, MessageCircle, Search, Users } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { sortChatSessions } from "../../lib/chat/session-order";
import { CONVERSATION_DELETE_WIDTH, conversationSwipeOffset, isHorizontalConversationSwipe,
  conversationSwipeReleaseTarget } from "../../lib/chat/swipe-gesture";
import { ChatAvatar } from "./avatar";
import { RootAppHeader } from "../root-app-header";

type Filter = "all" | "private" | "groups";
export function MessagesHome() {
  const router = useRouter(), { document, ready } = useFoundation();
  const [sessions, setSessions] = useState<ChatSession[]>([]), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [query, setQuery] = useState(""), [filter, setFilter] = useState<Filter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState("");
  const swipe = useRef<{ id: string; startX: number; startY: number; startOffset: number; horizontal: boolean } | null>(null);
  const suppressClickFor = useRef<string | null>(null);
  useEffect(() => { let active = true;
    const load = async () => { try { const rows = await chatStorage.listSessions(); if (active) {
      setSessions(sortChatSessions(rows)); setLoaded(true); setError(""); }
    } catch { if (active) setError("Could not load conversations. Existing messages have not been changed."); } };
    const unsubscribe = chatStorage.subscribe(() => void load()); void load();
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (!menuOpen) return; const close = (event: KeyboardEvent) => {
    if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const characters = new Map(document.characters.map((item) => [item.characterId, item]));
  function onListPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!openRowId) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-conversation-row]");
    if (row?.dataset.conversationRow !== openRowId) setOpenRowId(null);
  }
  function beginSwipe(event: ReactPointerEvent<HTMLAnchorElement>, id: string) {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    suppressClickFor.current = null;
    const startOffset = openRowId === id ? -CONVERSATION_DELETE_WIDTH : 0;
    swipe.current = { id, startX: event.clientX, startY: event.clientY, startOffset, horizontal: false };
    setDraggingRowId(id);
    setDragOffset(startOffset);
  }
  function moveSwipe(event: ReactPointerEvent<HTMLAnchorElement>, id: string) {
    const current = swipe.current;
    if (!current || current.id !== id) return;
    const deltaX = event.clientX - current.startX, deltaY = event.clientY - current.startY;
    if (!current.horizontal && !isHorizontalConversationSwipe(deltaX, deltaY)) {
      if (Math.abs(deltaY) >= 8) { swipe.current = null; setDraggingRowId(null); }
      return;
    }
    const wasHorizontal = current.horizontal;
    current.horizontal = true;
    if (event.cancelable) event.preventDefault();
    if (!wasHorizontal) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer may already be captured by the browser. */ }
    }
    setDragOffset(conversationSwipeOffset(current.startOffset, deltaX));
  }
  function finishSwipe(event: ReactPointerEvent<HTMLAnchorElement>, id: string) {
    const current = swipe.current;
    if (!current || current.id !== id) return;
    if (current.horizontal) {
      const offset = conversationSwipeOffset(current.startOffset, event.clientX - current.startX);
      setOpenRowId(conversationSwipeReleaseTarget(offset) < 0 ? id : null);
      suppressClickFor.current = id;
    } else if (current.startOffset < 0) {
      suppressClickFor.current = id;
    }
    swipe.current = null;
    setDraggingRowId(null);
  }
  async function confirmDeleteConversation() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await chatStorage.deleteSession(deleteTarget.id);
      setDeleteTarget(null);
      setOpenRowId(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Conversation could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }
  const visible = sessions.filter((session) => {
    const group = session.type === "group";
    if ((filter === "groups" && !group) || (filter === "private" && group)) return false;
    const name = group ? session.title ?? "Group" : session.remark || characters.get(session.characterId)?.name || "Unknown Contact";
    return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  const actionMenu = menuOpen && <div className="chat-action-layer" onMouseDown={(event) => {
    if (event.target === event.currentTarget) setMenuOpen(false);
  }}><div className="chat-action-popover" role="menu" aria-label="New chat">
      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); router.push("/contacts?mode=single"); }}><MessageCircle /><span>New Message</span></button>
      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); router.push("/contacts?mode=multi"); }}><Users /><span>New Group</span></button>
  </div></div>;
  return <div className="chat-app messages-home" onPointerDownCapture={onListPointerDown}>
    <RootAppHeader title="" className="messages-header" rightAction={<button className="messages-add-button" type="button" aria-label="New chat" title="New chat" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><CirclePlus /></button>} />
    <h1 className="messages-large-title">Chats</h1>
    <label className="messages-search"><Search /><input type="search" aria-label="Search chats" placeholder="Search chats..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="messages-filters" role="group" aria-label="Conversation type">{(["all", "private", "groups"] as const).map((item) =>
      <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    {error && <p role="alert" className="chat-notice">{error}</p>}
    {!ready || !loaded ? <p className="chat-notice">Loading conversations…</p> : visible.length === 0 ?
      <p className="chat-notice">{query ? "No matching chats." : filter === "groups" ? "No group chats yet." : "No conversations yet."}</p> :
      <div className="conversation-list">{visible.map((session) => { const group = session.type === "group", character = characters.get(session.characterId);
        const name = group ? session.title ?? "Group" : session.remark || character?.name || "Unknown Contact";
        const rowOpen = openRowId === session.id;
        const offset = draggingRowId === session.id ? dragOffset : rowOpen ? -CONVERSATION_DELETE_WIDTH : 0;
        return <div className="conversation-swipe-row" key={session.id} data-conversation-row={session.id}>
          <button className="conversation-delete-action" type="button" aria-label={`Delete ${name} conversation`}
            aria-hidden={!rowOpen} tabIndex={rowOpen ? 0 : -1}
            onClick={() => { setDeleteError(""); setOpenRowId(null); setDeleteTarget(session); }}>Delete</button>
          <Link className={`conversation-row${draggingRowId === session.id ? " is-dragging" : ""}`}
            style={{ transform: `translateX(${offset}px)` }} data-testid={`conversation-link-${session.id}`}
            href={group ? `/messages/group/${encodeURIComponent(session.id)}` : `/messages/${encodeURIComponent(session.characterId)}`}
            onPointerDown={(event) => beginSwipe(event, session.id)}
            onPointerMove={(event) => moveSwipe(event, session.id)}
            onPointerUp={(event) => finishSwipe(event, session.id)}
            onPointerCancel={() => { swipe.current = null; setDraggingRowId(null); setDragOffset(0); }}
            onClickCapture={(event) => {
              const suppressedId = suppressClickFor.current;
              if (suppressedId) {
                suppressClickFor.current = null;
                if (suppressedId === session.id && event.detail > 0) {
                  event.preventDefault(); event.stopPropagation(); setOpenRowId(null);
                }
              }
            }}>
            {group ? <span className="chat-avatar group-avatar"><Users /></span> : character ? <ChatAvatar profile={character} /> : <span className="chat-avatar">?</span>}
            <span className="conversation-summary">
              <span className="conversation-title-line"><strong>{name}</strong>
                {!!session.updatedAt && <time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
              </span>
              <span className="conversation-preview">{session.lastMessagePreview || (group ? `${session.participantIds?.length ?? 0} members` : "Start a conversation")}</span>
            </span>
          </Link>
        </div>;
      })}</div>}
    {actionMenu}
    {deleteTarget && <div className="chat-dialog-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget && !deleteBusy) setDeleteTarget(null);
    }}><div className="chat-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-conversation-title">
      <h2 id="delete-conversation-title">Delete Conversation?</h2>
      <p>This will permanently delete all messages and conversation-related data. This cannot be undone. Your contact and character will not be deleted.</p>
      {deleteError && <p role="alert" className="chat-notice">{deleteError}</p>}
      <div><button type="button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>Cancel</button>
        <button type="button" className="chat-danger" disabled={deleteBusy} onClick={() => void confirmDeleteConversation()}>{deleteBusy ? "Deleting…" : "Delete"}</button></div>
    </div></div>}
  </div>;
}
