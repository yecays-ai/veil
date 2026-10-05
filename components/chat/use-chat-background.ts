"use client";
import { useEffect, useState } from "react";
import { resolveChatBackground } from "../../lib/chat/background";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatBackgroundSettings, ChatSession } from "../../lib/chat/types";

export function useChatBackground(session: ChatSession | null) {
  const [settings, setSettings] = useState<ChatBackgroundSettings>({ id: "chat-background" });
  const [asset, setAsset] = useState<{ id: string; url: string } | null>(null);
  const resolved = resolveChatBackground(session, settings);

  useEffect(() => {
    let active = true;
    const refresh = () => void chatStorage.readChatBackgroundSettings().then((next) => {
      if (active) setSettings(next);
    });
    refresh();
    const unsubscribe = chatStorage.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const id = resolved.image;
    if (!id) return;
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      const blob = await chatStorage.readChatImage(id);
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setAsset({ id, url: objectUrl });
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolved.image]);

  return { url: asset?.id === resolved.image ? asset.url : null, blur: resolved.blur };
}
