"use client";
import { useEffect, useState } from "react";
import { resolveChatBackground } from "../../lib/chat/background";
import {
  cachedBackgroundHint, cachedBackgroundSettings, cachedBackgroundUrl, pendingBackgroundReady,
  rememberBackgroundBlob, rememberBackgroundHint, rememberBackgroundSettings,
} from "../../lib/chat/background-cache";
import { affectsChatBackground, chatStorage, type ChatStorage } from "../../lib/chat/storage";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";

const DEFAULT_SETTINGS: ChatBackgroundSettings = { id: "chat-background" };

type Options = { characterId?: string; storage?: ChatStorage };

/** `characterId` lets the wallpaper be chosen before the session has been read, from what this chat last resolved to. */
export function useChatBackground(session: ChatSession | null, { characterId, storage = chatStorage }: Options = {}) {
  const [settings, setSettings] = useState<ChatBackgroundSettings>(
    () => cachedBackgroundSettings(storage, storage.backgroundRevision()) ?? DEFAULT_SETTINGS);
  // The wallpaper that had to be loaded after it was selected (so it may fade in); reset when the image changes.
  const [lateFor, setLateFor] = useState<string | null>(null);
  const hint = !session && characterId ? cachedBackgroundHint(storage, characterId, storage.backgroundRevision()) : null;
  const resolved = resolveChatBackground(session ? session : hint ? { backgroundImage: hint.image ?? undefined, backgroundBlur: hint.blur ?? undefined } : null, settings);
  const image = resolved.image;

  const sessionImage = session?.backgroundImage ?? null, sessionBlur = session?.backgroundBlur ?? null;
  const ownerId = session?.characterId;
  useEffect(() => {
    if (ownerId) rememberBackgroundHint(storage, ownerId, { image: sessionImage, blur: sessionBlur }, storage.backgroundRevision());
  }, [ownerId, sessionImage, sessionBlur, storage]);

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

  if (lateFor !== null && lateFor !== image) setLateFor(null);
  useEffect(() => {
    if (!image || cachedBackgroundUrl(image)) return;
    let active = true;
    const reveal = (ready: Promise<void>) => ready.then(() => { if (active) setLateFor(image); });
    const pending = pendingBackgroundReady(image);
    // Reveal a wallpaper only once the browser can paint it, so it never appears half-decoded.
    if (pending) void reveal(pending);
    else void storage.readChatImage(image).then(async (blob) => {
      if (active && blob) await reveal(rememberBackgroundBlob(image, blob).ready);
    }).catch(() => {});
    return () => { active = false; };
  }, [image, storage]);

  // A wallpaper already known to the cache is part of the first painted frame, with its decoded bitmap.
  const url = image ? cachedBackgroundUrl(image) : null;
  // "late": it was not ready when it was selected, so the caller may fade it in instead of popping it in.
  return { url, blur: resolved.blur, late: url !== null && lateFor === image };
}
