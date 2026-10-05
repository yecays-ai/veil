"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { ChatAvatar } from "./avatar";

export function MessagesHome() {
  const { document, ready } = useFoundation();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "private" | "groups">("all");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await chatStorage.listSessions();
        if (active) {
          setSessions(rows);
          setLoaded(true);
          setError("");
        }
      } catch {
        if (active)
          setError(
            "Could not load conversations. Existing messages have not been changed.",
          );
      }
    };
    const unsubscribe = chatStorage.subscribe(() => {
      void load();
    });
    void load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const byCharacter = new Map(sessions.map((s) => [s.characterId, s]));
  const characters = [...document.characters].sort(
    (a, b) =>
      (byCharacter.get(b.characterId)?.updatedAt ?? 0) -
      (byCharacter.get(a.characterId)?.updatedAt ?? 0),
  );
  const visible = filter === "groups" ? [] : characters.filter((character) => {
    const name = byCharacter.get(character.characterId)?.remark || character.name;
    return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  return (
    <div className="chat-app messages-home">
      <header className="messages-header">
        <h1>Chats</h1>
        <button type="button" aria-label="New chat" title="New chat" disabled>+</button>
      </header>
      <input className="messages-search" type="search" aria-label="Search chats"
        placeholder="Search chats..." value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="messages-filters" role="group" aria-label="Conversation type">
        {(["all", "private", "groups"] as const).map((item) =>
          <button key={item} type="button" aria-pressed={filter === item}
            onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
      </div>
      {error && (
        <p role="alert" className="chat-notice">
          {error}
        </p>
      )}
      {!ready || !loaded ? (
        <p className="chat-notice">
          {error ? "Conversations unavailable." : "Loading conversations…"}
        </p>
      ) : !characters.length ? (
        <p className="chat-notice">
          Create a <Link href="/characters">Character</Link> to start a
          conversation.
        </p>
      ) : visible.length === 0 ? <p className="chat-notice">{filter === "groups" ? "No group chats yet." : "No matching chats."}</p> : (
        <div className="conversation-list">
          {visible.map((character) => {
            const session = byCharacter.get(character.characterId);
            return (
              <Link
                className="conversation-row"
                key={character.characterId}
                href={`/messages/${encodeURIComponent(character.characterId)}`}
              >
                <ChatAvatar profile={character} />
                <span className="conversation-summary">
                  <strong>{session?.remark || character.name}</strong>
                  <span>
                    {session?.lastMessagePreview || "Start a conversation"}
                  </span>
                </span>
                {!!session?.updatedAt && (
                  <time dateTime={new Date(session.updatedAt).toISOString()}>
                    {new Date(session.updatedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
