"use client";

import { useState } from "react";
import { chatStorage } from "../../../lib/chat/storage";
import type { GiftAction } from "../../../lib/chat/gift";

export function useGiftActions(sessionId: string | undefined, onError: (message: string) => void, onComplete: () => void) {
  const [composerOpen, setComposerOpen] = useState(false), [working, setWorking] = useState(false);
  async function send(icon: string, content: string) {
    if (!sessionId || working) return;
    setWorking(true);
    try { await chatStorage.createGift(sessionId, icon, content, "user"); setComposerOpen(false); onComplete(); }
    catch (error) { onError(error instanceof Error ? error.message : "Gift could not be sent."); }
    finally { setWorking(false); }
  }
  async function act(id: string, action: GiftAction) {
    if (working) return;
    setWorking(true);
    try { await chatStorage.actOnGift(id, "user", action); }
    catch (error) { onError(error instanceof Error ? error.message : "Gift could not be updated."); }
    finally { setWorking(false); }
  }
  return { composerOpen, setComposerOpen, working, send, act };
}
