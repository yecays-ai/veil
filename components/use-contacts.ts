"use client";
import { useSyncExternalStore } from "react";
import { browserContactStorage } from "../lib/contact-storage";
import { liveContacts } from "../lib/contacts-bindings-live";

export function useContacts() {
  const snapshot = useSyncExternalStore(liveContacts.subscribe, liveContacts.getSnapshot, liveContacts.getServerSnapshot);
  return { ...snapshot, commit: browserContactStorage.transact, retry: liveContacts.retry };
}
