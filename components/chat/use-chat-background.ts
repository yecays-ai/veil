"use client";
import { useEffect, useState } from "react";
import { resolveChatBackground } from "../../lib/chat/background";
import { affectsChatBackground, chatStorage } from "../../lib/chat/storage";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";

export function useChatBackground(session: ChatSession | null) {
  const [settings, setSettings] = useState<ChatBackgroundSettings>({ id: "chat-background" });
  const [asset, setAsset] = useState<{ id: string; url: string } | null>(null);
  const resolved = resolveChatBackground(session, settings);

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) return;
    let active = true;
    let revision = 0;
    const refresh = () => {
      const requestRevision = ++revision;
      void chatStorage.readChatBackgroundSettings().then((next) => {
        if (active && revision === requestRevision) setSettings(next);
      }).catch(() => {});
    };
    refresh();
    const unsubscribe = chatStorage.subscribe((change) => {
      if (affectsChatBackground(change, sessionId)) refresh();
    });
    return () => { active = false; revision++; unsubscribe(); };
  }, [session?.id]);

  useEffect(() => {
    const id = resolved.image;
    if (!id) return;
    let active = true;
    let objectUrl: string | undefined;
    void chatStorage.readChatImage(id).then((blob) => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setAsset({ id, url: objectUrl });
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolved.image]);

  return { url: asset?.id === resolved.image ? asset.url : null, blur: resolved.blur };
}
