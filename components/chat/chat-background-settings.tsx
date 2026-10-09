"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Image as ImageIcon } from "lucide-react";
import {
  getChatImageFromIndexedDB,
  resolveChatBackgroundImage,
  saveChatImageToIndexedDB,
} from "../../lib/chat/background";
import { affectsChatBackground, chatStorage } from "../../lib/chat/storage";
import { readImage } from "../../lib/theme-storage";
import { ImageCropDialog } from "../image-crop-dialog";
import { normalizeBackgroundBlur } from "../../lib/chat/types";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";

function useAssetPreview(id: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const blob = id ? await getChatImageFromIndexedDB(id) : null;
        if (!active) return;
        if (!blob) {
          setUrl(null);
        } else {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch {
        if (!active) return;
        setUrl(null);
        setFailedId(id);
      }
    })();
    return () => {
      active = false;
      setFailedId(null); // a failure belongs to one read; returning to the same id starts clean
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return { url, failed: id !== null && failedId === id };
}

export function ChatBackgroundSettings({ screenRef, session, onBack }: {
  screenRef?: React.Ref<HTMLElement>;
  session: ChatSession;
  onBack: () => void;
}) {
  const [settings, setSettings] = useState<ChatBackgroundSettings>({ id: "chat-background" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState<string | null>(null);
  const conversationInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    let revision = 0;
    // Only the newest read may publish, so an older read finishing late cannot replace newer settings.
    const refresh = () => {
      const requestRevision = ++revision;
      void chatStorage.readChatBackgroundSettings().then((next) => {
        if (!active || requestRevision !== revision) return;
        setSettings(next);
        setLoadError("");
      }).catch(() => {
        if (active && requestRevision === revision) setLoadError("Chat background settings could not be loaded.");
      });
    };
    refresh();
    const unsubscribe = chatStorage.subscribe((change) => {
      if (affectsChatBackground(change, session.id)) refresh();
    });
    return () => { active = false; revision++; unsubscribe(); };
  }, [session.id]);
  const effectiveId = resolveChatBackgroundImage(session, settings);
  const { url: effectivePreview, failed: previewFailed } = useAssetPreview(effectiveId);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setCrop(await readImage(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Image could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCrop(value: string) {
    setBusy(true);
    setError("");
    let id: string | undefined;
    try {
      id = await saveChatImageToIndexedDB(await (await fetch(value)).blob());
      await chatStorage.updateSessionSettings(session.id, { backgroundImage: id });
      setCrop(null);
    } catch (reason) {
      if (id) await chatStorage.deleteChatImageIfUnused(id);
      setError(reason instanceof Error ? reason.message : "Chat background could not be saved.");
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function clearConversation() {
    setBusy(true);
    setError("");
    try {
      await chatStorage.updateSessionSettings(session.id,
        { backgroundImage: null, backgroundBlur: null });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chat background could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  return <section ref={screenRef} className="chat-info-screen" role="dialog" aria-modal="true" aria-label="Chat Background">
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
          onClick={() => void clearConversation()}>
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
          void choose(event.target.files?.[0]); event.target.value = "";
        }} />
      </section>
      {(error || loadError || previewFailed) && <p className="chat-notice" role="alert">
        {error || loadError || "The current background preview could not be loaded."}</p>}
    </div>
    {crop && <ImageCropDialog source={crop} shape="portrait" title="Adjust chat background"
      onSave={saveCrop} onCancel={() => setCrop(null)} />}
  </section>;
}

