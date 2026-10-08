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
  useEffect(() => {
    let active = true;
    const lifetime = lifecycle;
    lifetime.current++;
    browserFoundationStorage
      .load()
      .then((d) => {
        if (active) setDocument(d);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load profile data.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      lifetime.current++;
    };
  }, []);
  async function commit(
    update: (document: FoundationDocument) => FoundationDocument,
  ) {
    if (!ready) throw new Error("Profile data is still loading.");
    const owner = lifecycle.current;
    // Serialize this provider's writes and their publication; a delayed earlier
    // transaction result cannot replace a later successful snapshot.
    const operation = queue.current.then(async () => {
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
        </p>
      )}
      {children}
    </FoundationContext.Provider>
  );
}
