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
const SETTINGS_PREPARE_LIMIT_MS = 1200;
// One in-flight settings read per storage, shared only by hooks that started at the same background revision.
const pendingSettingsReads = new WeakMap<ChatStorage, { revision: number; promise: Promise<ChatBackgroundSettings> }>();

// A read that began before a later background change is already stale: caching it would replace a newer snapshot.
function rememberCurrentSettings(storage: ChatStorage, next: ChatBackgroundSettings, readRevision: number) {
  if (storage.backgroundRevision() === readRevision) rememberBackgroundSettings(storage, next, readRevision);
}

function readBackgroundSettings(storage: ChatStorage, revision: number) {
  const pending = pendingSettingsReads.get(storage);
  if (pending?.revision === revision) return pending.promise;
  const promise = storage.readChatBackgroundSettings().finally(() => {
    // An older read finishing late must not clear the entry of a newer one.
    if (pendingSettingsReads.get(storage)?.promise === promise) pendingSettingsReads.delete(storage);
  });
  pendingSettingsReads.set(storage, { revision, promise });
  return promise;
}

type Options = { characterId?: string; storage?: ChatStorage };

/** Choose the current chat's wallpaper before its session read, using its last resolved hint. */
export function useChatBackground(session: ChatSession | null, { characterId, storage = chatStorage }: Options = {}) {
  const settingsSnapshot = cachedBackgroundSettings(storage, storage.backgroundRevision());
  const [settings, setSettings] = useState<ChatBackgroundSettings>(settingsSnapshot ?? DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(settingsSnapshot !== null);
  const settingsForFrame = settingsSnapshot ?? settings;
  const settingsReadyForFrame = settingsReady || settingsSnapshot !== null;
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const settingsRevision = useRef(0);
  const hint = !session && characterId ? cachedBackgroundHint(storage, characterId, storage.backgroundRevision()) : null;
  const resolved = resolveChatBackground(session ? session : hint ? { backgroundImage: hint.image ?? undefined, backgroundBlur: hint.blur ?? undefined } : null, settingsForFrame);
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
      void readBackgroundSettings(storage, readRevision).then((next) => {
        rememberCurrentSettings(storage, next, readRevision);
        if (active && request === settingsRevision.current) {
          if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
          setSettings(next);
          setSettingsReady(true);
        }
      }).catch(() => {
        if (active && request === settingsRevision.current) {
          if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
          setSettingsReady(true);
        }
      });
    };
    const snapshot = cachedBackgroundSettings(storage, storage.backgroundRevision());
    let fallbackTimer: number | undefined;
    if (snapshot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings(snapshot);
      setSettingsReady(true);
    } else {
      fallbackTimer = window.setTimeout(() => {
        if (active) setSettingsReady(true);
      }, SETTINGS_PREPARE_LIMIT_MS);
      refresh();
    }
    return () => {
      active = false;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      settingsRevision.current++;
    };
  }, [storage]);

  useEffect(() => {
    if (!session?.id) return;
    const snapshot = cachedBackgroundSettings(storage, storage.backgroundRevision());
    if (snapshot) {
      settingsRevision.current++;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings(snapshot);
      setSettingsReady(true);
    }
  }, [session?.id, storage]);

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) return;
    let active = true;
    const refresh = () => {
      const request = ++settingsRevision.current;
      const readRevision = storage.backgroundRevision();
      void storage.readChatBackgroundSettings().then((next) => {
        rememberCurrentSettings(storage, next, readRevision);
        if (active && request === settingsRevision.current) {
          setSettings(next);
          setSettingsReady(true);
        }
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
        if (!active) return; // a late read from a route that has left must not create an object URL
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
  const readyForFrame = settingsReadyForFrame && (!image || !!url || fallbackFor === image);
  useEffect(() => {
    if (isChatDiagnosticsEnabled()) recordChatDiagnostic("background-url-state", {
      characterId, hasImage: !!image, hasSession: !!session, cached: !!url, urlKind: url ? "object-url" : "unavailable",
    });
  }, [characterId, image, session, session?.id, url]);
  return { url, blur: resolved.blur, late: url !== null && lateFor === image, readyForFrame };
}
