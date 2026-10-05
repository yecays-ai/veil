"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Image as ImageIcon } from "lucide-react";
import {
  getChatImageFromIndexedDB,
  resolveChatBackgroundImage,
  saveChatImageToIndexedDB,
} from "../../lib/chat/background";
import { chatStorage } from "../../lib/chat/storage";
import { readImage } from "../../lib/theme-storage";
import { ImageCropDialog } from "../image-crop-dialog";
import { normalizeBackgroundBlur } from "../../lib/chat/types";
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
  const [crop, setCrop] = useState<{ source: string; scope: "conversation" | "global" } | null>(null);
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

  async function choose(file: File | undefined, scope: "conversation" | "global") {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setCrop({ source: await readImage(file), scope });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Image could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCrop(value: string, scope: "conversation" | "global") {
    setBusy(true);
    setError("");
    let id: string | undefined;
    try {
      id = await saveChatImageToIndexedDB(await (await fetch(value)).blob());
      if (scope === "conversation")
        await chatStorage.updateSessionSettings(session.id, { backgroundImage: id });
      else
        await chatStorage.updateGlobalChatBackground(id);
      setCrop(null);
    } catch (reason) {
      if (id) await chatStorage.deleteChatImageIfUnused(id);
      setError(reason instanceof Error ? reason.message : "Chat background could not be saved.");
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function clear(scope: "conversation" | "global") {
    setBusy(true);
    setError("");
    try {
      if (scope === "conversation")
        await chatStorage.updateSessionSettings(session.id,
          { backgroundImage: null, backgroundBlur: null });
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
      <div className="chat-background-preview" aria-label="Current chat background preview">
        {effectivePreview && <div className="chat-background-preview-image" aria-hidden="true"
          style={{ backgroundImage: `url(${JSON.stringify(effectivePreview)})`,
            filter: `blur(${normalizeBackgroundBlur(session.backgroundBlur ?? settings.blur)}px)`,
            inset: normalizeBackgroundBlur(session.backgroundBlur ?? settings.blur)
              ? `${-2 * normalizeBackgroundBlur(session.backgroundBlur ?? settings.blur)}px` : 0 }} />}
        {!effectivePreview && <ImageIcon aria-hidden="true" />}
      </div>
      <section className="chat-background-section">
        <div><strong>Current Conversation</strong>
          <small>{session.backgroundImage ? "Custom background" :
            session.backgroundBlur !== undefined ? "Custom blur · global image" : "Following global"}</small></div>
        <button type="button" disabled={busy} onClick={() => conversationInput.current?.click()}>
          Choose Background
        </button>
        {(session.backgroundImage || session.backgroundBlur !== undefined) && <button type="button" disabled={busy}
          onClick={() => void clear("conversation")}>
          Restore Global
        </button>}
        <label>Conversation blur ({normalizeBackgroundBlur(session.backgroundBlur ?? settings.blur)}px)
          <input type="range" min="0" max="20" step="1" disabled={busy}
            value={normalizeBackgroundBlur(session.backgroundBlur ?? settings.blur)}
            onChange={(event) => void chatStorage.updateSessionSettings(session.id,
              { backgroundBlur: Number(event.target.value) }).catch((reason) =>
              setError(reason instanceof Error ? reason.message : "Blur could not be saved."))} />
        </label>
        <input ref={conversationInput} hidden type="file" accept="image/*" onChange={(event) => {
          void choose(event.target.files?.[0], "conversation"); event.target.value = "";
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
        <label>Global blur ({normalizeBackgroundBlur(settings.blur)}px)
          <input type="range" min="0" max="20" step="1" disabled={busy}
            value={normalizeBackgroundBlur(settings.blur)}
            onChange={(event) => void chatStorage.updateGlobalChatBackgroundBlur(Number(event.target.value))
              .catch((reason) => setError(reason instanceof Error ? reason.message : "Blur could not be saved."))} />
        </label>
        <input ref={globalInput} hidden type="file" accept="image/*" onChange={(event) => {
          void choose(event.target.files?.[0], "global"); event.target.value = "";
        }} />
      </section>
      {error && <p className="chat-notice" role="alert">{error}</p>}
    </div>
    {crop && <ImageCropDialog source={crop.source} shape="portrait" title="Adjust chat background"
      onSave={(value) => saveCrop(value, crop.scope)} onCancel={() => setCrop(null)} />}
  </section>;
}
