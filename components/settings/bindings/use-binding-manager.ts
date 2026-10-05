"use client";
import { useEffect, useState } from "react";
import { useFoundation } from "../../foundation-provider";
import { APP_REGISTRY } from "../../../lib/app-registry";
import { cleanStaleBindings, setBindingField,
  type BindingScope, type BindingSlot, type ManagedBindingField } from "../../../lib/bindings";
import { chatStorage } from "../../../lib/chat/storage";
import { browserPresetStorage } from "../../../lib/preset-storage";
import { browserWorldBookStorage } from "../../../lib/worldbook-storage";
import { browserRegexStorage } from "../../../lib/regex-storage";
import { DEFAULT_REGEX_GROUP_ID } from "../../../lib/regex-defaults";

export type BindingResources = {
  api: { id: string; name: string }[];
  presets: { id: string; name: string }[];
  activePresetId: string;
  worldBooks: { id: string; name: string }[];
  regex: { id: string; name: string }[];
};

export function useBindingManager() {
  const { document, ready, commit } = useFoundation();
  const [resources, setResources] = useState<BindingResources | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void (async () => {
      const [api, preset, worldBooks, regex] = await Promise.all([
        chatStorage.listApiConfigs(), browserPresetStorage.load(),
        browserWorldBookStorage.load(), browserRegexStorage.load(),
      ]);
      const available = {
        apiConfigIds: new Set(api.map((item) => item.id)),
        presetIds: new Set(preset.presets.map((item) => item.id)),
        worldBookIds: new Set(worldBooks.books.map((item) => item.id)),
        regexIds: new Set(regex.groups.filter((item) => item.id !== DEFAULT_REGEX_GROUP_ID)
          .map((item) => item.id)),
      };
      const cleaned = cleanStaleBindings(document.bindings, available);
      if (JSON.stringify(cleaned) !== JSON.stringify(document.bindings))
        await commit((current) => ({ ...current,
          bindings: cleanStaleBindings(current.bindings, available) }));
      if (active) setResources({
        api: api.map((item) => ({ id: item.id, name: item.name })),
        presets: preset.presets.map((item) => ({ id: item.id, name: item.name })),
        activePresetId: preset.activePresetId,
        worldBooks: worldBooks.books.map((item) => ({ id: item.id, name: item.name })),
        regex: regex.groups.filter((item) => item.id !== DEFAULT_REGEX_GROUP_ID)
          .map((item) => ({ id: item.id, name: item.name })),
      });
    })().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Bindings could not be loaded."); });
    return () => { active = false; };
  // Load once when Foundation becomes ready; each write re-reads its current document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function update(scope: BindingScope, field: ManagedBindingField,
    value: BindingSlot[ManagedBindingField]) {
    if (!resources || busy) return;
    setBusy(true); setError("");
    try {
      await commit((current) => ({ ...current,
        bindings: setBindingField(current.bindings, scope, field, value) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Binding could not be saved.");
    } finally { setBusy(false); }
  }

  return { document, resources, error, busy, update, apps: APP_REGISTRY };
}
