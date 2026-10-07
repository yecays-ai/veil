"use client";
import { useSyncExternalStore } from "react";
import { browserBindingStorage } from "../lib/binding-storage";
import { liveBindings } from "../lib/contacts-bindings-live";

export function useBindings() {
  const snapshot = useSyncExternalStore(liveBindings.subscribe, liveBindings.getSnapshot, liveBindings.getServerSnapshot);
  return { bindings: snapshot.document, ready: snapshot.ready, error: snapshot.error,
    commit: browserBindingStorage.transact, retry: liveBindings.retry };
}
