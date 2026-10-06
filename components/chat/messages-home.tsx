"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CirclePlus, MessageCircle, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { ChatAvatar } from "./avatar";
import { RootAppHeader } from "../root-app-header";

type Filter = "all" | "private" | "groups";
export function MessagesHome() {
  const router = useRouter(), { document, ready } = useFoundation();
  const [sessions, setSessions] = useState<ChatSession[]>([]), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [query, setQuery] = useState(""), [filter, setFilter] = useState<Filter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { let active = true;
    const load = async () => { try { const rows = await chatStorage.listSessions(); if (active) {
      setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt)); setLoaded(true); setError(""); }
    } catch { if (active) setError("Could not load conversations. Existing messages have not been changed."); } };
    const unsubscribe = chatStorage.subscribe(() => void load()); void load();
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (!menuOpen) return; const close = (event: KeyboardEvent) => {
    if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const characters = new Map(document.characters.map((item) => [item.characterId, item]));
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
  return <div className="chat-app messages-home">
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
        return <Link className="conversation-row" key={session.id} href={group ? `/messages/group/${encodeURIComponent(session.id)}` : `/messages/${encodeURIComponent(session.characterId)}`}>
          {group ? <span className="chat-avatar group-avatar"><Users /></span> : character ? <ChatAvatar profile={character} /> : <span className="chat-avatar">?</span>}
          <span className="conversation-summary"><strong>{name}</strong><span>{session.lastMessagePreview || (group ? `${session.participantIds?.length ?? 0} members` : "Start a conversation")}</span></span>
          {!!session.updatedAt && <time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
        </Link>;
      })}</div>}
    {actionMenu}
  </div>;
}
