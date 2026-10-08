"use client";
import { useBindings } from "../../use-bindings";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFoundation } from "../../foundation-provider";
import { cleanStaleBindings, editBindingList, setBindingField, type BindingListEdit,
  type BindingScope, type BindingSlot, type ManagedBindingField } from "../../../lib/bindings";
import { browserApiConfigStorage } from "../../../lib/api-config-storage";
import { browserPresetStorage } from "../../../lib/preset-storage";
import { browserWorldBookStorage } from "../../../lib/worldbook-storage";
import { browserRegexStorage } from "../../../lib/regex-storage";
import { DEFAULT_REGEX_GROUP_ID } from "../../../lib/regex-defaults";
import { browserBindingStorage } from "../../../lib/binding-storage";
import { withCurrentBindingResources } from "../../../lib/binding-resource-validation";

export type BindingResources = {
  api: { id: string; name: string }[];
  presets: { id: string; name: string }[];
  activePresetId: string;
  worldBooks: { id: string; name: string }[];
  regex: { id: string; name: string }[];
};

export function useBindingManager() {
  const { document, ready: foundationReady } = useFoundation();
  const { bindings, ready: bindingsReady, error: bindingError, commit, retry: retryBindings } = useBindings();
  const ready = foundationReady && bindingsReady;
  const [resources, setResources] = useState<BindingResources | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(""), [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(false), revision = useRef(0);
  const pending = useRef<Promise<void> | undefined>(undefined), retryPending = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    const revisionRef = revision;
    return () => { mounted.current = false; revisionRef.current++; };
  }, []);
  const loadResources = useCallback(() => {
    if (!mounted.current || !ready) return Promise.resolve();
    if (pending.current) return pending.current;
    const request = ++revision.current;
    const active = () => mounted.current && request === revision.current;
    setLoading(true);
    const operation = (async () => {
      const [api, preset, worldBooks, regex] = await Promise.all([
        browserApiConfigStorage.listApiConfigs(), browserPresetStorage.load(),
        browserWorldBookStorage.load(), browserRegexStorage.load(),
      ]);
      const available = {
        apiConfigIds: new Set(api.map((item) => item.id)),
        presetIds: new Set(preset.presets.map((item) => item.id)),
        worldBookIds: new Set(worldBooks.books.map((item) => item.id)),
        regexIds: new Set(regex.groups.filter((item) => item.id !== DEFAULT_REGEX_GROUP_ID)
          .map((item) => item.id)),
      };
      if (!active()) return;
      setResources({
        api: api.map((item) => ({ id: item.id, name: item.name })),
        presets: preset.presets.map((item) => ({ id: item.id, name: item.name })),
        activePresetId: preset.activePresetId,
        worldBooks: worldBooks.books.map((item) => ({ id: item.id, name: item.name })),
        regex: regex.groups.filter((item) => item.id !== DEFAULT_REGEX_GROUP_ID)
          .map((item) => ({ id: item.id, name: item.name })),
      });
      // UI catalogs only decide whether to attempt reconciliation. They are never deletion
      // authority: re-read protected catalogs inside the existing Binding write boundary.
      const cleaned = cleanStaleBindings(bindings, available);
      if (JSON.stringify(cleaned) !== JSON.stringify(bindings))
        await browserBindingStorage.cleanStale((write) => withCurrentBindingResources((currentAvailable) => {
          if (!active()) throw new Error("Binding page closed. Nothing was cleaned.");
          return write(currentAvailable);
        }));
      if (active()) setLoadError("");
    })().catch((reason) => {
      if (active()) setLoadError(reason instanceof Error ? reason.message : "Bindings could not be loaded.");
    }).finally(() => {
      if (pending.current === operation) pending.current = undefined;
      if (active()) setLoading(false);
    });
    pending.current = operation;
    return operation;
  }, [ready, bindings]);
  useEffect(() => {
    if (!ready) return;
    void loadResources();
    const revisionRef = revision, pendingRef = pending;
    return () => { revisionRef.current++; pendingRef.current = undefined; };
  // Load once when Foundation becomes ready; each write re-reads its current document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const retry = () => {
    if (retryPending.current) return retryPending.current;
    if (pending.current || busy) return pending.current ?? Promise.resolve();
    setRetrying(true);
    const operation = (async () => {
      await retryBindings();
      if (mounted.current && ready) await loadResources();
    })().finally(() => {
      if (retryPending.current === operation) retryPending.current = undefined;
      if (mounted.current) setRetrying(false);
    });
    retryPending.current = operation;
    return operation;
  };

  async function update(scope: BindingScope, field: ManagedBindingField,
    value: BindingSlot[ManagedBindingField]) {
    if (!resources || busy) return;
    setBusy(true); setError("");
    try {
      await commit((current) => setBindingField(current, scope, field, value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Binding could not be saved.");
    } finally { setBusy(false); }
  }

  // List changes are applied to the latest stored document, not to the list on screen.
  async function edit(scope: BindingScope, field: "worldBookIds" | "regexIds", change: BindingListEdit) {
    if (!resources || busy) return;
    setBusy(true); setError("");
    try {
      await commit((current) => editBindingList(current, scope, field, change));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Binding could not be saved.");
    } finally { setBusy(false); }
  }

  return { document, bindings, resources, error: error || loadError || bindingError,
    loadError: loadError || bindingError, loading: loading || retrying,
    retry, busy: busy || loading || retrying || !!bindingError, update, edit };
}
