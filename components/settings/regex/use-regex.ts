"use client";
import { useCallback, useEffect, useState } from "react";
import { browserRegexStorage, deleteRegexGroupAndBindings } from "../../../lib/regex-storage";
import { browserBindingStorage } from "../../../lib/binding-storage";
import type { RegexDocument } from "../../../lib/regex";

export function useRegex() {
  const [document, setDocument] = useState<RegexDocument>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void browserRegexStorage.load().then(setDocument).catch((reason) =>
    setError(reason instanceof Error ? reason.message : "Regex Groups could not be loaded.")); }, []);
  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Regex Group could not be saved."); }
    finally { setBusy(false); }
  }, []);
  const change = useCallback(async (update: (current: RegexDocument) => RegexDocument) => {
    const next = await browserRegexStorage.transact(update);
    setDocument(next);
    return next;
  }, []);
  const removeGroup = useCallback(async (groupId: string) => {
    setDocument(await deleteRegexGroupAndBindings(groupId, browserRegexStorage, browserBindingStorage));
  }, []);
  return { document, error, notice, busy, run, change, removeGroup, setNotice };
}
