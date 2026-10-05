"use client";
import { useEffect, useState } from "react";
import { browserBindingStorage } from "../lib/binding-storage";
import type { BindingDocument } from "../lib/bindings";

export function useBindings() {
  const [bindings, setBindings] = useState<BindingDocument>({ global: {}, characters: {} });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => void browserBindingStorage.load().then((next) => {
      if (active) { setBindings(next); setReady(true); setError(""); }
    }).catch(() => { if (active) setError("Bindings could not be loaded."); });
    load(); window.addEventListener("storage", load); window.addEventListener("veil-bindings-change", load);
    return () => { active = false; window.removeEventListener("storage", load); window.removeEventListener("veil-bindings-change", load); };
  }, []);
  return { bindings, ready, error, commit: browserBindingStorage.transact };
}
