"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserPresetStorage, deletePresetAndBindings } from "../../../lib/preset-storage";
import { browserBindingStorage } from "../../../lib/binding-storage";
import type { PresetDocument } from "../../../lib/preset";

export function usePresetLibrary() {
  const [document, setDocument] = useState<PresetDocument | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0), pending = useRef<Promise<void> | undefined>(undefined);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const load = useCallback(() => {
    if (!mounted.current || locked.current) return Promise.resolve();
    if (pending.current) return pending.current;
    const request = ++revision.current;
    setLoading(true);
    const operation = Promise.resolve().then(() => browserPresetStorage.load()).then((value) => {
      if (mounted.current && request === revision.current) {
        setDocument(value); setError(""); setLoadError("");
      }
    }).catch((err: unknown) => {
      if (mounted.current && request === revision.current) {
        const message = err instanceof Error ? err.message : "Could not load Presets.";
        setError(message); setLoadError(message);
      }
    }).finally(() => {
      if (pending.current === operation) pending.current = undefined;
      if (mounted.current && request === revision.current) setLoading(false);
    });
    pending.current = operation;
    return operation;
  }, []);
  useEffect(() => {
    mounted.current = true; pending.current = undefined;
    void load();
    const revisionRef = revision;
    return () => { mounted.current = false; revisionRef.current++; };
  }, [load]);
  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; revision.current++;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Could not save Preset."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function change(update: (current: PresetDocument) => PresetDocument) {
    const next = await browserPresetStorage.transact(update);
    if (mounted.current) setDocument(next);
    return next;
  }
  async function remove(id: string) {
    const next = await deletePresetAndBindings(id, browserPresetStorage, browserBindingStorage);
    if (mounted.current) setDocument(next);
    return next;
  }
  return { document, error, notice, busy, loading, loadError, retry: load, run, change, remove, setNotice };
}
