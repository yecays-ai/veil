"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserRegexStorage, deleteRegexGroupAndBindings } from "../../../lib/regex-storage";
import { browserBindingStorage } from "../../../lib/binding-storage";
import type { RegexDocument } from "../../../lib/regex";

export function useRegex(scope = "list") {
  const [snapshot, setSnapshot] = useState<{ scope: string; document: RegexDocument }>();
  const document = snapshot?.scope === scope ? snapshot.document : undefined;
  const [error, setError] = useState("");
  const [notice, updateNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef(0), live = useRef(false), revision = useRef(0);
  const running = useRef(false), writing = useRef<symbol | undefined>(undefined);
  const owner = lifetime.current;
  const isCurrent = useCallback(() => live.current && lifetime.current === owner, [owner]);
  const assertCurrent = useCallback(() => {
    if (!isCurrent()) throw new Error("This Regex editor is no longer active. Reopen it before saving.");
    if (!document) throw new Error("Regex data is still loading.");
  }, [document, isCurrent]);

  useEffect(() => {
    const epoch = ++lifetime.current, request = ++revision.current;
    live.current = true; running.current = false; writing.current = undefined;
    void browserRegexStorage.load().then((value) => {
      if (live.current && lifetime.current === epoch && revision.current === request) {
        setBusy(false); setError(""); updateNotice("");
        setSnapshot({ scope, document: value });
      }
    }).catch((reason) => {
      if (live.current && lifetime.current === epoch && revision.current === request)
        setError(reason instanceof Error ? reason.message : "Regex data could not be loaded.");
    });
    const lifetimeRef = lifetime, revisionRef = revision;
    return () => { live.current = false; lifetimeRef.current++; revisionRef.current++; };
  }, [scope]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    if (!isCurrent() || running.current || writing.current) return;
    running.current = true; revision.current++;
    setBusy(true); setError(""); updateNotice("");
    try { await operation(); }
    catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : "Regex could not be saved.");
    } finally {
      if (isCurrent()) { running.current = false; setBusy(false); }
    }
  }, [isCurrent]);

  const change = useCallback(async (update: (current: RegexDocument) => RegexDocument) => {
    assertCurrent();
    if (writing.current) throw new Error("A save is already in progress.");
    const token = Symbol(); writing.current = token; revision.current++; setBusy(true);
    try {
      const next = await browserRegexStorage.transact((current) => {
        assertCurrent();
        return update(current);
      }, document);
      assertCurrent();
      setSnapshot({ scope, document: next });
      return next;
    } finally {
      if (writing.current === token) {
        writing.current = undefined;
        if (isCurrent() && !running.current) setBusy(false);
      }
    }
  }, [assertCurrent, document, isCurrent, scope]);

  const removeGroup = useCallback(async (groupId: string) => {
    assertCurrent();
    const next = await deleteRegexGroupAndBindings(groupId, browserRegexStorage, browserBindingStorage, document, assertCurrent);
    assertCurrent();
    setSnapshot({ scope, document: next });
  }, [assertCurrent, document, scope]);
  const setNotice = useCallback((value: string) => { if (isCurrent()) updateNotice(value); }, [isCurrent]);
  return { document, error, notice, busy, run, change, removeGroup, setNotice };
}
