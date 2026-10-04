"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Image as ImageIcon } from "lucide-react";
import {
  getChatImageFromIndexedDB,
  resolveChatBackgroundImage,
  saveChatImageToIndexedDB,
} from "../../lib/chat/background";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";

function useAssetPreview(id: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      const blob = id ? await getChatImageFromIndexedDB(id) : null;
      if (!active) return;
      if (!blob) {
        setUrl(null);
      } else {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url;
}

export function ChatBackgroundSettings({ session, onBack }: {
  session: ChatSession;
  onBack: () => void;
}) {
  const [settings, setSettings] = useState<ChatBackgroundSettings>({ id: "chat-background" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationInput = useRef<HTMLInputElement>(null);
  const globalInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => void chatStorage.readChatBackgroundSettings().then((next) => {
      if (active) setSettings(next);
    });
    refresh();
    const unsubscribe = chatStorage.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  const effectiveId = resolveChatBackgroundImage(session, settings);
  const effectivePreview = useAssetPreview(effectiveId);

  async function upload(file: File | undefined, scope: "conversation" | "global") {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const id = await saveChatImageToIndexedDB(file);
      if (scope === "conversation")
        await chatStorage.updateSessionSettings(session.id, { backgroundImage: id });
      else
        await chatStorage.updateGlobalChatBackground(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chat background could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function clear(scope: "conversation" | "global") {
    setBusy(true);
    setError("");
    try {
      if (scope === "conversation")
        await chatStorage.updateSessionSettings(session.id, { backgroundImage: null });
      else
        await chatStorage.updateGlobalChatBackground(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chat background could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="chat-info-screen" aria-label="Chat Background">
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to Chat Info" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <h1>Chat Background</h1>
      <span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body">
      <div className="chat-background-preview" aria-label="Current chat background preview"
        style={effectivePreview ? { backgroundImage: `url(${JSON.stringify(effectivePreview)})` } : undefined}>
        {!effectivePreview && <ImageIcon aria-hidden="true" />}
      </div>
      <section className="chat-background-section">
        <div><strong>Current Conversation</strong>
          <small>{session.backgroundImage ? "Custom background" : "Following global"}</small></div>
        <button type="button" disabled={busy} onClick={() => conversationInput.current?.click()}>
          Choose Background
        </button>
        {session.backgroundImage && <button type="button" disabled={busy}
          onClick={() => void clear("conversation")}>
          Restore Global
        </button>}
        <input ref={conversationInput} hidden type="file" accept="image/*" onChange={(event) => {
          void upload(event.target.files?.[0], "conversation"); event.target.value = "";
        }} />
      </section>
      <section className="chat-background-section">
        <div><strong>Global Chat Background</strong>
          <small>{settings.globalChatBackgroundImage ? "Set" : "Not set"}</small></div>
        <button type="button" disabled={busy} onClick={() => globalInput.current?.click()}>
          Choose Global Background
        </button>
        {settings.globalChatBackgroundImage && <button type="button" disabled={busy}
          onClick={() => void clear("global")}>
          Clear Global
        </button>}
        <input ref={globalInput} hidden type="file" accept="image/*" onChange={(event) => {
          void upload(event.target.files?.[0], "global"); event.target.value = "";
        }} />
      </section>
      {error && <p className="chat-notice" role="alert">{error}</p>}
    </div>
  </section>;
}
