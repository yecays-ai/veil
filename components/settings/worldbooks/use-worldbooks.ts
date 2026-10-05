"use client";
import { useCallback, useEffect, useState } from "react";
import { browserWorldBookStorage, deleteWorldBookAndBindings } from "../../../lib/worldbook-storage";
import type { WorldBookDocument } from "../../../lib/worldbook";
import { browserBindingStorage } from "../../../lib/binding-storage";

export function useWorldBooks() {
  const [document, setDocument] = useState<WorldBookDocument>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void browserWorldBookStorage.load().then(setDocument).catch((reason) =>
    setError(reason instanceof Error ? reason.message : "WorldBooks could not be loaded.")); }, []);
  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "WorldBook could not be saved."); }
    finally { setBusy(false); }
  }, []);
  const change = useCallback(async (update: (current: WorldBookDocument) => WorldBookDocument) => {
    const next = await browserWorldBookStorage.transact(update);
    setDocument(next);
    return next;
  }, []);
  const removeBook = useCallback(async (bookId: string) => {
    setDocument(await deleteWorldBookAndBindings(bookId, browserWorldBookStorage, browserBindingStorage));
  }, []);
  return { document, error, notice, busy, run, change, removeBook, setNotice };
}
