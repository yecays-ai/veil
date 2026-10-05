"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Plus, Search, UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { useContacts } from "../use-contacts";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { ChatAvatar } from "./avatar";
import { RootAppHeader } from "../root-app-header";

type Filter = "all" | "private" | "groups";
export function MessagesHome() {
  const router = useRouter(), { document, ready } = useFoundation();
  const contacts = useContacts(document.characters.map((item) => item.characterId));
  const [sessions, setSessions] = useState<ChatSession[]>([]), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [query, setQuery] = useState(""), [filter, setFilter] = useState<Filter>("all");
  const [sheet, setSheet] = useState<"actions" | "message" | "group" | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [groupName, setGroupName] = useState("");
  useEffect(() => { let active = true;
    const load = async () => { try { const rows = await chatStorage.listSessions(); if (active) {
      setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt)); setLoaded(true); setError(""); }
    } catch { if (active) setError("Could not load conversations. Existing messages have not been changed."); } };
    const unsubscribe = chatStorage.subscribe(() => void load()); void load();
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (!sheet) return; const close = (event: KeyboardEvent) => {
    if (event.key === "Escape") setSheet(null); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [sheet]);
  const characters = new Map(document.characters.map((item) => [item.characterId, item]));
  const contactCharacters = contacts.document.contacts.flatMap((item) => {
    const character = characters.get(item.characterId); return character ? [character] : [];
  });
  const visible = sessions.filter((session) => {
    const group = session.type === "group";
    if ((filter === "groups" && !group) || (filter === "private" && group)) return false;
    const name = group ? session.title ?? "Group" : session.remark || characters.get(session.characterId)?.name || "Unknown Contact";
    return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  async function openDirect(characterId: string) {
    const session = await chatStorage.openSession(characterId); setSheet(null);
    router.push(`/messages/${encodeURIComponent(session.characterId)}`);
  }
  async function createGroup() { try {
    const session = await chatStorage.createGroupSession(selected, groupName); setSheet(null);
    router.push(`/messages/group/${encodeURIComponent(session.id)}`);
  } catch (reason) { setError(reason instanceof Error ? reason.message : "Group could not be created."); } }
  const overlay = sheet && <div className="chat-sheet-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) setSheet(null);
  }}><section className="chat-sheet" role="dialog" aria-modal="true" aria-label={sheet === "actions" ? "New chat" : sheet === "message" ? "New Message" : "New Group"}>
    <header><h2>{sheet === "actions" ? "Start" : sheet === "message" ? "New Message" : "New Group"}</h2>
      <button type="button" aria-label="Close" onClick={() => setSheet(null)}><X /></button></header>
    {sheet === "actions" ? <div className="chat-sheet-actions">
      <button type="button" onClick={() => { setQuery(""); setSheet("message"); }}><MessageCircle /><span>New Message</span></button>
      <button type="button" onClick={() => { setQuery(""); setSelected([]); setGroupName(""); setSheet("group"); }}><Users /><span>New Group</span></button>
      <button type="button" onClick={() => router.push("/contacts/add")}><UserPlus /><span>Add Friend</span></button>
    </div> : <>
      <label className="messages-search"><Search /><input type="search" placeholder="Search contacts..." aria-label="Search contacts" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="contact-picker-list">{contactCharacters.filter((character) => character.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((character) =>
        <button type="button" key={character.characterId} onClick={() => sheet === "message" ? void openDirect(character.characterId) :
          setSelected((current) => current.includes(character.characterId) ? current.filter((id) => id !== character.characterId) : [...current, character.characterId])}>
          <ChatAvatar profile={character} /><span>{character.name}</span>{sheet === "group" && <span className="picker-check">{selected.includes(character.characterId) ? "✓" : ""}</span>}
        </button>)}</div>
      {sheet === "group" && <div className="group-create-footer"><input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" aria-label="Group name" />
        <button type="button" disabled={selected.length < 2 || !groupName.trim()} onClick={() => void createGroup()}>Create</button></div>}
    </>}
  </section></div>;
  return <div className="chat-app messages-home">
    <RootAppHeader title="" className="messages-header" rightAction={<button type="button" aria-label="New chat" title="New chat" onClick={() => setSheet("actions")}><Plus /></button>} />
    <h1 className="messages-large-title">Chats</h1>
    <label className="messages-search"><Search /><input type="search" aria-label="Search chats" placeholder="Search chats..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="messages-filters" role="group" aria-label="Conversation type">{(["all", "private", "groups"] as const).map((item) =>
      <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    {error && <p role="alert" className="chat-notice">{error}</p>}
    {!ready || !loaded || !contacts.ready ? <p className="chat-notice">Loading conversations…</p> : visible.length === 0 ?
      <p className="chat-notice">{query ? "No matching chats." : filter === "groups" ? "No group chats yet." : "No conversations yet."}</p> :
      <div className="conversation-list">{visible.map((session) => { const group = session.type === "group", character = characters.get(session.characterId);
        const name = group ? session.title ?? "Group" : session.remark || character?.name || "Unknown Contact";
        return <Link className="conversation-row" key={session.id} href={group ? `/messages/group/${encodeURIComponent(session.id)}` : `/messages/${encodeURIComponent(session.characterId)}`}>
          {group ? <span className="chat-avatar group-avatar"><Users /></span> : character ? <ChatAvatar profile={character} /> : <span className="chat-avatar">?</span>}
          <span className="conversation-summary"><strong>{name}</strong><span>{session.lastMessagePreview || (group ? `${session.participantIds?.length ?? 0} members` : "Start a conversation")}</span></span>
          {!!session.updatedAt && <time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
        </Link>;
      })}</div>}
    {overlay}
  </div>;
}
