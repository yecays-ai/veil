"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { chatEngine } from "../../lib/chat/engine";
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
  const history = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const mounted = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
  const pending = messages.some((m) => m.role === "user" && !m.requestedBy);
  return (
    <div className="chat-app chat-room" ref={shell}>
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
            className={`chat-turn chat-turn-${message.role}`}
            data-message-id={message.id}
          >
            {message.role === "assistant" && <ChatAvatar profile={character} />}
            <div className="chat-message">
              <p className="chat-bubble">
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
      {(error || loadError) && (
        <p role="alert" className="chat-notice chat-error">
          {error || loadError}
        </p>
      )}
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
    </div>
  );
}
