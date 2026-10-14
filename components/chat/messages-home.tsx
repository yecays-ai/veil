"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CirclePlus, MessageCircle, Search, Users } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import { withMemoryClear } from "../../lib/memory/browser";
import { prefetchChatSession } from "../../lib/chat/session-prefetch";
import { lastSessionList, rememberSessionList } from "../../lib/chat/session-list-snapshot";
import type { ChatSession } from "../../lib/chat/types";
import { recordChatDiagnostic } from "../../lib/diagnostics/chat-first-paint";
import { sortChatSessions } from "../../lib/chat/session-order";
import { CONVERSATION_DELETE_WIDTH, conversationDeleteMotion, conversationSwipeOffset, isHorizontalConversationSwipe,
  conversationSwipeReleaseTarget } from "../../lib/chat/swipe-gesture";
import { ChatAvatar } from "./avatar";
import { CharacterPresenceBadge } from "../presence";
import { RootAppHeader } from "../root-app-header";
import { useContacts } from "../use-contacts";
import { contactDisplayName } from "../../lib/contact-storage";

type Filter = "all" | "private" | "groups";
export function MessagesHome() {
  const router = useRouter(), { document, ready } = useFoundation();
  const contacts = useContacts();
  const [snapshot] = useState(() => lastSessionList(chatStorage));
  const [sessions, setSessions] = useState<ChatSession[]>(snapshot ?? []), [loaded, setLoaded] = useState(snapshot !== null);
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
    let requestRevision = 0;
    const load = async () => {
      const revision = ++requestRevision;
      try { const rows = await chatStorage.listSessions(); if (active && revision === requestRevision) {
        const sorted = sortChatSessions(rows);
        rememberSessionList(chatStorage, sorted); setSessions(sorted); setLoaded(true); setError(""); }
      } catch { if (active && revision === requestRevision)
        setError("Could not load conversations. Existing messages have not been changed."); }
    };
    const unsubscribe = chatStorage.subscribe((change) => {
      if (change.domain === "session" || change.domain === "messages") void load();
    }); void load();
    return () => { active = false; requestRevision++; unsubscribe(); };
  }, []);
  useEffect(() => { if (!menuOpen) return; const close = (event: KeyboardEvent) => {
    if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  useEffect(() => {
    router.prefetch("/contacts?mode=single");
    router.prefetch("/contacts?mode=multi");
  }, [router]);
  const characters = new Map(document.characters.map((item) => [item.characterId, item]));
  const contactByCharacter = new Map(contacts.document.contacts.map((item) => [item.characterId, item]));
  const namesReady = ready && contacts.ready;
  function conversationName(session: ChatSession): string | null {
    if (session.type === "group") return session.title ?? "Group";
    if (!namesReady) return null;
    const character = characters.get(session.characterId);
    return character
      ? contactDisplayName(contactByCharacter.get(character.characterId), character.name) : "Unknown Contact";
  }
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
      const { cleanupIncomplete } = await withMemoryClear(deleteTarget, (scope) => chatStorage.deleteSession(deleteTarget.id, scope));
      if (cleanupIncomplete) setDeleteError("Conversation deleted. Memory cleanup is pending.");
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
    const search = query.trim().toLocaleLowerCase();
    if (!search) return true;
    return conversationName(session)?.toLocaleLowerCase().includes(search) ?? false;
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
    {!loaded ? !error && <p className="chat-notice">Loading conversations…</p> : visible.length > 0 &&
      <div className="conversation-list">{visible.map((session) => { const group = session.type === "group", character = characters.get(session.characterId);
        const name = conversationName(session);
        const rowOpen = openRowId === session.id;
        const offset = draggingRowId === session.id ? dragOffset : rowOpen ? -CONVERSATION_DELETE_WIDTH : 0;
        const deleteMotion = conversationDeleteMotion(offset);
        return <div className="conversation-swipe-row" key={session.id} data-conversation-row={session.id}>
          <button className={`conversation-delete-action${draggingRowId === session.id ? " is-dragging" : ""}`}
            style={{ width: `${deleteMotion.width}px`, transform: `translateX(${deleteMotion.translateX}px)` }}
            type="button" aria-label={name ? `Delete ${name} conversation` : "Delete conversation"}
            aria-hidden={!rowOpen} tabIndex={rowOpen ? 0 : -1}
            onClick={() => { setDeleteError(""); setOpenRowId(null); setDeleteTarget(session); }}>
            <span className="conversation-delete-label" style={{ transform: `translateX(${deleteMotion.labelOffsetX}px)` }}>Delete</span>
          </button>
          <Link className={`conversation-row${draggingRowId === session.id ? " is-dragging" : ""}`}
            style={{ transform: `translateX(${offset}px)` }} data-testid={`conversation-link-${session.id}`}
            href={group ? `/messages/group/${encodeURIComponent(session.id)}` : `/messages/${encodeURIComponent(session.characterId)}`}
            onPointerDownCapture={(event) => {
              if (!group && event.isPrimary && event.button === 0)
                void prefetchChatSession(session.characterId, chatStorage);
            }}
            onClick={(event) => {
              if (!event.defaultPrevented && !group) recordChatDiagnostic("navigation-call", {
                target: `/messages/${encodeURIComponent(session.characterId)}`, characterId: session.characterId,
              });
            }}
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
            {group ? <span className="chat-avatar group-avatar"><Users /></span> : namesReady && character ?
              <span className="chat-avatar-presence"><ChatAvatar profile={character} /><CharacterPresenceBadge character={character} />
                {!!session.unreadCount && <span className="chat-unread-badge" data-testid={`unread-${session.id}`}
                  aria-label={`${session.unreadCount} unread`}>{session.unreadCount > 99 ? "99+" : session.unreadCount}</span>}</span>
              : <span className="chat-avatar">{namesReady ? "?" : ""}</span>}
            <span className="conversation-summary">
              <span className="conversation-title-line"><strong>{name ?? "Loading contact…"}</strong>
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
