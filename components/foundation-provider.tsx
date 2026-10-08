"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { CharacterConflictError } from "../lib/foundation";
import {
  defaultFoundation,
  type FoundationDocument,
} from "../lib/foundation-types";

type Context = {
  document: FoundationDocument;
  /** True once the persisted document has been read successfully at least once. */
  ready: boolean;
  commit: (
    update: (document: FoundationDocument) => FoundationDocument,
  ) => Promise<FoundationDocument>;
};
const FoundationContext = createContext<Context | null>(null);
export function useFoundation() {
  const context = useContext(FoundationContext);
  if (!context) throw new Error("FoundationProvider is required.");
  return context;
}
export function FoundationProvider({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState(defaultFoundation);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lifecycle = useRef(0);
  // Mirrors of the latest load outcome for commit(), which runs outside the render that created it.
  const loaded = useRef(false);
  const failure = useRef<string | null>(null);
  const refreshNow = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let active = true;
    const lifetime = lifecycle;
    lifetime.current++;
    let requestedRevision = 0;
    let pending: Promise<void> | undefined;
    const refresh = () => {
      requestedRevision++;
      if (pending) return pending;
      pending = Promise.resolve().then(async () => {
        let observed: number;
        do {
          observed = requestedRevision;
          try {
            const next = await browserFoundationStorage.load();
            if (active && observed === requestedRevision) {
              loaded.current = true; failure.current = null;
              setDocument(next);
              setError("");
              setReady(true);
            }
          } catch (reason) {
            // A failed read is not an empty catalog: keep the last good document, and never become ready on it.
            if (active && observed === requestedRevision) {
              failure.current = reason instanceof Error ? reason.message : "Could not load profile data.";
              setError(failure.current);
            }
          }
        } while (active && observed !== requestedRevision);
      }).finally(() => { pending = undefined; });
      return pending;
    };
    refreshNow.current = refresh;
    const unsubscribe = browserFoundationStorage.subscribe(() => { void refresh(); });
    const checkAfterPossibleMiss = () => { if (globalThis.document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("focus", checkAfterPossibleMiss);
    globalThis.document.addEventListener("visibilitychange", checkAfterPossibleMiss);
    void refresh();
    return () => {
      active = false;
      lifetime.current++;
      refreshNow.current = null;
      unsubscribe();
      window.removeEventListener("focus", checkAfterPossibleMiss);
      globalThis.document.removeEventListener("visibilitychange", checkAfterPossibleMiss);
    };
  }, []);
  async function commit(
    update: (document: FoundationDocument) => FoundationDocument,
  ) {
    if (!ready && !failure.current) throw new Error("Profile data is still loading.");
    const owner = lifecycle.current;
    // Serialize this provider's writes and their publication; a delayed earlier
    // transaction result cannot replace a later successful snapshot.
    const operation = queue.current.then(async () => {
      // After a failed read, re-read once before writing; if it still fails nothing is written.
      if (failure.current || !loaded.current) {
        await refreshNow.current?.();
        if (failure.current || !loaded.current)
          throw new Error(failure.current ?? "Profile data could not be loaded. Nothing was changed.");
      }
      try {
        const next = await browserFoundationStorage.transact(update);
        if (owner === lifecycle.current) { setDocument(next); setError(""); }
        return next;
      } catch (reason) {
        if (reason instanceof CharacterConflictError) {
          try {
            const latest = await browserFoundationStorage.load();
            if (owner === lifecycle.current) setDocument(latest);
          } catch { /* Retain the last good snapshot and the original conflict. */ }
        }
        throw reason;
      }
    });
    queue.current = operation.catch(() => {});
    return operation;
  }
  return (
    <FoundationContext.Provider value={{ document, ready, commit }}>
      {error && (
        <p className="theme-notice foundation-error" role="alert">
          {error}
          <button type="button" onClick={() => { void refreshNow.current?.(); }}>Retry</button>
        </p>
      )}
      {children}
    </FoundationContext.Provider>
  );
}
