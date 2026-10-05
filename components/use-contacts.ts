"use client";
import { useCallback, useEffect, useState } from "react";
import { browserContactStorage, type ContactDocument } from "../lib/contact-storage";
import { chatStorage } from "../lib/chat/storage";

export function useContacts(characterIds: readonly string[]) {
  const [document, setDocument] = useState<ContactDocument>({ version: 1, contacts: [] });
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const key = characterIds.join("\u0000");
  const load = useCallback(async () => {
    try {
      const valid = new Set(characterIds);
      const sessions = await chatStorage.listSessions();
      const legacy = sessions.flatMap((session) => session.type !== "group" && session.characterId && valid.has(session.characterId)
        ? [session.characterId] : []);
      const next = legacy.length ? await browserContactStorage.ensureCharacters(legacy) : await browserContactStorage.load();
      setDocument(next); setReady(true); setError("");
    } catch { setError("Contacts could not be loaded."); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener("veil-contacts-change", refresh);
    return () => { window.clearTimeout(initial); window.removeEventListener("veil-contacts-change", refresh); };
  }, [load]);
  return { document, ready, error, commit: browserContactStorage.transact };
}
