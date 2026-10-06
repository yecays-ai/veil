"use client";
import { useEffect, useState } from "react";
import { browserContactStorage, type ContactDocument } from "../lib/contact-storage";

export function useContacts() {
  const [document, setDocument] = useState<ContactDocument>({ version: 1, contacts: [] });
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await browserContactStorage.load();
        if (active) { setDocument(next); setReady(true); setError(""); }
      } catch {
        if (active) { setReady(true); setError("Contacts could not be loaded."); }
      }
    };
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener("veil-contacts-change", refresh);
    return () => { active = false; window.clearTimeout(initial); window.removeEventListener("veil-contacts-change", refresh); };
  }, []);
  return { document, ready, error, commit: browserContactStorage.transact };
}
