"use client";

import { useCallback, useEffect, useState } from "react";
import { browserStickerStorage, emptyStickerDocument, STICKER_CHANGE_EVENT, type StickerDocument } from "../../lib/chat/sticker-storage";

/** The sticker library, read when the owner mounts and again after any change (this tab or another). `null` while loading. */
export function useStickerLibrary() {
  const [document, setDocument] = useState<StickerDocument | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    browserStickerStorage.load().then((next) => { setDocument(next); setError(""); },
      (reason) => { setDocument((current) => current ?? emptyStickerDocument()); setError(reason instanceof Error ? reason.message : "表情包读取失败。"); });
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener(STICKER_CHANGE_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => { window.removeEventListener(STICKER_CHANGE_EVENT, reload); window.removeEventListener("storage", reload); };
  }, [reload]);
  return { document, error };
}
