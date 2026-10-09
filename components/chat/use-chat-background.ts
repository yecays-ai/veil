"use client";
import { useEffect, useRef, useState } from "react";
import { resolveChatBackground } from "../../lib/chat/background";
import {
  cachedBackgroundHint, cachedBackgroundSettings, cachedBackgroundUrl, pendingBackgroundReady,
  rememberBackgroundBlob, rememberBackgroundHint, rememberBackgroundSettings,
} from "../../lib/chat/background-cache";
import { affectsChatBackground, chatStorage, type ChatStorage } from "../../lib/chat/storage";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";
import { isChatDiagnosticsEnabled, recordChatDiagnostic } from "../../lib/diagnostics/chat-first-paint";

const DEFAULT_SETTINGS: ChatBackgroundSettings = { id: "chat-background" };
const BACKGROUND_PREPARE_LIMIT_MS = 1200;

type Options = { characterId?: string; storage?: ChatStorage };

/** Choose the current chat's wallpaper before its session read, using its last resolved hint. */
export function useChatBackground(session: ChatSession | null, { characterId, storage = chatStorage }: Options = {}) {
  const initialSettings = cachedBackgroundSettings(storage, storage.backgroundRevision());
  const [settings, setSettings] = useState<ChatBackgroundSettings>(initialSettings ?? DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(!!initialSettings);
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const settingsRevision = useRef(0);
  const hint = !session && characterId ? cachedBackgroundHint(storage, characterId, storage.backgroundRevision()) : null;
  const resolved = resolveChatBackground(session ? session : hint ? { backgroundImage: hint.image ?? undefined, backgroundBlur: hint.blur ?? undefined } : null, settings);
  const image = resolved.image;
  useEffect(() => {
    if (isChatDiagnosticsEnabled()) recordChatDiagnostic("background-selection", {
      characterId, hasImage: !!image, selection: image ? "custom" : "default",
    });
  }, [characterId, image, session?.id]);

  const sessionImage = session?.backgroundImage ?? null, sessionBlur = session?.backgroundBlur ?? null;
  const ownerId = session?.characterId;
  useEffect(() => {
    if (ownerId) rememberBackgroundHint(storage, ownerId, { image: sessionImage, blur: sessionBlur }, storage.backgroundRevision());
  }, [ownerId, sessionImage, sessionBlur, storage]);

  // Start settings recovery in parallel with the route's session/message read.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const request = ++settingsRevision.current;
      const readRevision = storage.backgroundRevision();
      void storage.readChatBackgroundSettings().then((next) => {
        rememberBackgroundSettings(storage, next, readRevision);
        if (active && request === settingsRevision.current) { setSettings(next); setSettingsReady(true); }
      }).catch(() => {
        if (active && request === settingsRevision.current) setSettingsReady(true);
      });
    };
    const snapshot = cachedBackgroundSettings(storage, storage.backgroundRevision());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (snapshot) { setSettings(snapshot); setSettingsReady(true); } else refresh();
    return () => { active = false; settingsRevision.current++; };
  }, [storage]);

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) return;
    let active = true;
    const refresh = () => {
      const request = ++settingsRevision.current;
      const readRevision = storage.backgroundRevision();
      void storage.readChatBackgroundSettings().then((next) => {
        rememberBackgroundSettings(storage, next, readRevision);
        if (active && request === settingsRevision.current) setSettings(next);
      }).catch(() => {});
    };
    const unsubscribe = storage.subscribe((change) => {
      if (affectsChatBackground(change, sessionId)) refresh();
    });
    return () => { active = false; unsubscribe(); };
  }, [session?.id, storage]);

  const url = image ? cachedBackgroundUrl(image) : null;
  useEffect(() => {
    if (!image || cachedBackgroundUrl(image)) return;
    let active = true;
    const markReady = () => {
      if (!active) return;
      setLateFor(image);
      setFallbackFor((current) => current === image ? null : current);
    };
    const fail = () => { if (active) setFallbackFor(image); };
    const pending = pendingBackgroundReady(image);
    if (pending) void pending.then(markReady, fail);
    else {
      void storage.readChatImage(image).then(async (blob) => {
        if (!blob) { fail(); return; }
        try { await rememberBackgroundBlob(image, blob).ready; markReady(); }
        catch { fail(); }
      }).catch(fail);
    }
    // A hung local read/decode may fall back to the theme background; it cannot hold the chat blank.
    const timeout = window.setTimeout(fail, BACKGROUND_PREPARE_LIMIT_MS);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [characterId, image, storage]);

  if (lateFor !== null && lateFor !== image) setLateFor(null);
  if (fallbackFor !== null && fallbackFor !== image) setFallbackFor(null);
  const readyForFrame = settingsReady && (!image || !!url || fallbackFor === image);
  useEffect(() => {
    if (isChatDiagnosticsEnabled()) recordChatDiagnostic("background-url-state", {
      characterId, hasImage: !!image, hasSession: !!session, cached: !!url, urlKind: url ? "object-url" : "unavailable",
    });
  }, [characterId, image, session, session?.id, url]);
  return { url, blur: resolved.blur, late: url !== null && lateFor === image, readyForFrame };
}
