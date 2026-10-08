"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { resolveChatBackground } from "../../lib/chat/background";
import {
  cachedBackgroundBlob, cachedBackgroundSettings, rememberBackgroundBlob, rememberBackgroundSettings,
} from "../../lib/chat/background-cache";
import { affectsChatBackground, chatStorage, type ChatStorage } from "../../lib/chat/storage";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";

const DEFAULT_SETTINGS: ChatBackgroundSettings = { id: "chat-background" };

export function useChatBackground(session: ChatSession | null, storage: ChatStorage = chatStorage) {
  const [settings, setSettings] = useState<ChatBackgroundSettings>(
    () => cachedBackgroundSettings(storage, storage.backgroundRevision()) ?? DEFAULT_SETTINGS);
  const [fetched, setFetched] = useState<{ id: string; blob: Blob } | null>(null);
  const [owned, setOwned] = useState<{ blob: Blob; url: string } | null>(null);
  const resolved = resolveChatBackground(session, settings);
  const image = resolved.image;

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) return;
    let active = true;
    let requestRevision = 0;
    const refresh = () => {
      const request = ++requestRevision;
      const readRevision = storage.backgroundRevision();
      void storage.readChatBackgroundSettings().then((next) => {
        rememberBackgroundSettings(storage, next, readRevision);
        if (active && requestRevision === request) setSettings(next);
      }).catch(() => {});
    };
    // A valid snapshot replaces the read; it may have been stored after this hook's first render
    // (e.g. by another chat while the session was still loading), so apply it to state too.
    const snapshot = cachedBackgroundSettings(storage, storage.backgroundRevision());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (snapshot) setSettings(snapshot); else refresh();
    const unsubscribe = storage.subscribe((change) => {
      if (affectsChatBackground(change, sessionId)) refresh();
    });
    return () => { active = false; requestRevision++; unsubscribe(); };
  }, [session?.id, storage]);

  useEffect(() => {
    if (!image || cachedBackgroundBlob(image)) return;
    let active = true;
    void storage.readChatImage(image).then((blob) => {
      if (!active || !blob) return;
      rememberBackgroundBlob(image, blob);
      setFetched({ id: image, blob });
    }).catch(() => {});
    return () => { active = false; };
  }, [image, storage]);

  const source = image ? (cachedBackgroundBlob(image) ?? (fetched?.id === image ? fetched.blob : null)) : null;
  // Layout effect: an already-known Blob becomes a URL before the browser paints, with no storage hop.
  useLayoutEffect(() => {
    if (!source) return;
    const url = URL.createObjectURL(source);
    // The URL is an external resource owned by this effect; publishing it in a layout effect makes it
    // part of the frame that is painted, which is the point of this hook.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOwned({ blob: source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);

  return { url: owned && owned.blob === source ? owned.url : null, blur: resolved.blur };
}
