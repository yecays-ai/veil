"use client";
import { useEffect, useState } from "react";
import { resolveChatBackgroundImage } from "../../lib/chat/background";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";

export function useChatBackground(session: ChatSession | null) {
  const sessionBackground = session?.backgroundImage;
  const [assetId, setAssetId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const settings = await chatStorage.readChatBackgroundSettings();
      if (active)
        setAssetId(resolveChatBackgroundImage({ backgroundImage: sessionBackground }, settings));
    }
    void refresh();
    const unsubscribe = chatStorage.subscribe(() => void refresh());
    return () => { active = false; unsubscribe(); };
  }, [sessionBackground]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      const blob = assetId ? await chatStorage.readChatImage(assetId) : null;
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
  }, [assetId]);

  return url;
}
