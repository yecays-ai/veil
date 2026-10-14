"use client";

import { useState } from "react";
import { chatStorage } from "../../../lib/chat/storage";
import type { TransferAction } from "../../../lib/chat/transfer";

export function useTransferActions(sessionId: string | undefined, onError: (message: string) => void, onComplete: () => void) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [working, setWorking] = useState(false);
  async function send(amount: number, note: string) {
    if (!sessionId || working) return;
    setWorking(true);
    try { await chatStorage.createTransfer(sessionId, amount, note, "user"); setComposerOpen(false); onComplete(); }
    catch (error) { onError(error instanceof Error ? error.message : "Transfer could not be sent."); }
    finally { setWorking(false); }
  }
  async function act(id: string, action: TransferAction) {
    if (working) return;
    setWorking(true);
    try { await chatStorage.actOnTransfer(id, "user", action); }
    catch (error) { onError(error instanceof Error ? error.message : "Transfer could not be updated."); }
    finally { setWorking(false); }
  }
  return { composerOpen, setComposerOpen, working, send, act };
}
