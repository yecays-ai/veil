"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { browserFoundationStorage } from "../lib/foundation-storage";
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
  useEffect(() => {
    let active = true;
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
    };
  }, []);
  async function commit(
    update: (document: FoundationDocument) => FoundationDocument,
  ) {
    if (!ready) throw new Error("Profile data is still loading.");
    const next = await browserFoundationStorage.transact(update);
    setDocument(next);
    setError("");
    return next;
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
