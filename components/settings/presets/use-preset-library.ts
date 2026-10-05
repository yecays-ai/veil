"use client";
import { useEffect, useRef, useState } from "react";
import { browserPresetStorage, deletePresetAndBindings } from "../../../lib/preset-storage";
import type { FoundationStorage } from "../../../lib/foundation-storage";
import type { PresetDocument } from "../../../lib/preset";

export function usePresetLibrary() {
  const [document, setDocument] = useState<PresetDocument | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    browserPresetStorage.load().then((value) => {
      if (mounted.current) setDocument(value);
    }).catch((err: unknown) => {
      if (mounted.current) setError(err instanceof Error ? err.message : "Could not load Presets.");
    });
    return () => { mounted.current = false; };
  }, []);
  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
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
  async function remove(id: string, foundation: Pick<FoundationStorage, "transact">) {
    const next = await deletePresetAndBindings(id, browserPresetStorage, foundation);
    if (mounted.current) setDocument(next);
    return next;
  }
  return { document, error, notice, busy, run, change, remove, setNotice };
}
