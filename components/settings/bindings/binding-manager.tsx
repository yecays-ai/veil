"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { APP_REGISTRY, isAppId, type AppId } from "../../../lib/app-registry";
import { resolveBindings, type BindingScope, type BindingSlot,
  type ManagedBindingField } from "../../../lib/bindings";
import { DEFAULT_API_CONFIG_ID } from "../../../lib/chat/types";
import { BUILTIN_PRESET_ID } from "../../../lib/preset";
import { useBindingManager, type BindingResources } from "./use-binding-manager";

const FIELDS: { key: ManagedBindingField; label: string; multiple: boolean }[] = [
  { key: "apiConfigId", label: "Text API", multiple: false },
  { key: "presetId", label: "Preset", multiple: false },
  { key: "worldBookIds", label: "WorldBook", multiple: true },
  { key: "regexIds", label: "Regex", multiple: true },
];
const managedOverrideCount = (slot: BindingSlot | undefined) =>
  FIELDS.filter(({ key }) => slot && Object.hasOwn(slot, key)).length;
type Option = { id: string; name: string };
function optionsFor(resources: BindingResources, field: ManagedBindingField): Option[] {
  if (field === "apiConfigId") return resources.api;
  if (field === "presetId") return resources.presets;
  if (field === "worldBookIds") return resources.worldBooks;
  return resources.regex;
}
function displayValue(field: ManagedBindingField, value: BindingSlot[ManagedBindingField],
  resources: BindingResources): string {
  const options = optionsFor(resources, field);
  if (Array.isArray(value)) return value.length
    ? value.map((id) => options.find((item) => item.id === id)?.name ?? "Unavailable").join(" · ") : "None";
  if (field === "apiConfigId") {
    if (value === null) return "None";
    const id = value ?? DEFAULT_API_CONFIG_ID;
    return options.find((item) => item.id === id)?.name ?? "Not configured";
  }
  if (field === "presetId") {
    if (value === null) return options.find((item) => item.id === BUILTIN_PRESET_ID)?.name ?? "VEIL Default";
    const id = value ?? resources.activePresetId;
    return options.find((item) => item.id === id)?.name ?? "VEIL Default";
  }
  return "None";
}

export function BindingHome() {
  const { document, resources, error } = useBindingManager();
  return <PageShell className="settings-app binding-manager" title="Bindings" backHref="/settings" backLabel="Back to Settings">
    {error && <Alert variant="danger">{error}</Alert>}
    {!resources && !error && <p role="status">Loading Bindings…</p>}
    {resources && <>
      <section className="binding-section"><h2>Global Defaults</h2>
        <Link className="binding-link" href="/settings/bindings/global">
          <span>Manage defaults<small>Text API · Preset · WorldBook · Regex</small></span><ChevronRight size={18} />
        </Link>
      </section>
      <section className="binding-section"><h2>Characters</h2>
        {document.characters.length === 0 && <p>No Characters yet.</p>}
        {document.characters.map((character) => {
          const binding = document.bindings.characters[character.characterId];
          const count = managedOverrideCount(binding?.defaults) +
            Object.values(binding?.apps ?? {}).reduce((total, slot) => total + managedOverrideCount(slot), 0);
          return <Link className="binding-link" key={character.characterId}
            href={`/settings/bindings/${encodeURIComponent(character.characterId)}`}>
            <span>{character.name}<small>{count ? "Custom choices" : "Following Global Defaults"}</small></span>
            <ChevronRight size={18} />
          </Link>;
        })}
      </section>
    </>}
  </PageShell>;
}

export function BindingEditor({ characterId, appId }: { characterId?: string; appId?: string }) {
  const manager = useBindingManager();
  const { document, resources, error, busy, update } = manager;
  const [openField, setOpenField] = useState<ManagedBindingField | null>(null);
  const character = characterId ? document.characters.find((item) => item.characterId === characterId) : undefined;
  const validApp: AppId | undefined = appId && isAppId(appId) ? appId : undefined;
  const app = APP_REGISTRY.find((item) => item.id === validApp);
  const scope: BindingScope = { characterId, appId: validApp };
  const title = app ? app.label : character ? character.name : "Global Defaults";
  const backHref = app ? `/settings/bindings/${encodeURIComponent(characterId!)}`
    : character ? "/settings/bindings" : "/settings/bindings";
  const invalid = (!!characterId && !character) || (!!appId && !app);
  const binding = characterId ? document.bindings.characters[characterId] : undefined;
  const own: BindingSlot = app ? binding?.apps[app.id] ?? {} : character ? binding?.defaults ?? {}
    : document.bindings.global;
  const inherited: BindingSlot = app ? resolveBindings({ ...document.bindings,
    characters: { ...document.bindings.characters,
      [characterId!]: { defaults: binding?.defaults ?? {}, apps: {} } } }, characterId!, app.id)
    : resolveBindings(document.bindings, null, "messages");
  const effective = resolveBindings(document.bindings, characterId ?? null, validApp ?? "messages");
  return <PageShell className="settings-app binding-manager" title={title} backHref={backHref} backLabel="Back to Bindings">
    {error && <Alert variant="danger">{error}</Alert>}
    {invalid ? <p>Binding target not found.</p> : !resources ? <p role="status">Loading Bindings…</p> : <>
      {character && <p className="binding-context">{app ? `${character.name} · ${app.label}` : character.name}</p>}
      <section className="binding-section"><h2>{app ? "App Override" : character ? "Character Defaults" : "Global Defaults"}</h2>
        {FIELDS.map(({ key, label, multiple }) => {
          const overridden = Object.hasOwn(own, key);
          const value = effective[key];
          const selected = Array.isArray(value) ? value : [];
          const options = optionsFor(resources, key);
          const expanded = openField === key;
          const set = (next: BindingSlot[ManagedBindingField]) => void update(scope, key, next);
          return <div className="binding-field" key={key}>
            <button className="binding-field-main" type="button" aria-expanded={expanded}
              onClick={() => setOpenField(expanded ? null : key)}>
              <span><strong>{label}</strong><small>{character
                ? `${overridden ? "Override" : "Inherited"}: ${displayValue(key, value, resources)}`
                : displayValue(key, value, resources)}</small></span><ChevronRight size={18} />
            </button>
            {character && overridden && <button type="button" className="binding-reset" disabled={busy}
              onClick={() => set(undefined)}>{app ? "Inherit Character" : "Reset to Global"}</button>}
            {expanded && <div className="binding-picker">
              {character && <button type="button" disabled={busy} onClick={() => set(undefined)}>
                Inherit {app ? "Character" : "Global"} · {displayValue(key, inherited[key], resources)}
                {!overridden && <span aria-hidden="true"> ✓</span>}
              </button>}
              {!multiple && <>
                {!character && <button type="button" disabled={busy} onClick={() => set(undefined)}>
                  {key === "apiConfigId" ? "Use default Text API" : "Use active Preset"}
                  {!Object.hasOwn(own, key) && <span aria-hidden="true"> ✓</span>}
                </button>}
                <button type="button" disabled={busy} onClick={() => set(null)}>
                  {key === "apiConfigId" ? "None · disable Text API" : "VEIL Default · clear Preset choice"}
                  {own[key] === null && <span aria-hidden="true"> ✓</span>}
                </button>
                {options.map((option) => <button type="button" key={option.id} disabled={busy}
                  onClick={() => { set(option.id); setOpenField(null); }}>
                  {option.name}{own[key] === option.id && <span aria-hidden="true"> ✓</span>}
                </button>)}
              </>}
              {multiple && <>
                <button type="button" disabled={busy} onClick={() => set([])}>Clear all
                  {overridden && Array.isArray(own[key]) && own[key].length === 0 && <span aria-hidden="true"> ✓</span>}
                </button>
                {options.map((option) => <button type="button" key={option.id} disabled={busy}
                  onClick={() => set(selected.includes(option.id)
                    ? selected.filter((id) => id !== option.id) : [...selected, option.id])}>
                  {option.name}{selected.includes(option.id) && <span aria-hidden="true"> ✓</span>}
                </button>)}
                {selected.length > 1 && <div className="binding-selected-order"><strong>Selection order</strong>
                  {selected.map((id, index) => <div key={id}>
                    <span>{options.find((item) => item.id === id)?.name}</span>
                    <button type="button" aria-label={`Move ${label} ${index + 1} up`} disabled={busy || index === 0}
                      onClick={() => { const next = [...selected]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; set(next); }}>↑</button>
                    <button type="button" aria-label={`Move ${label} ${index + 1} down`} disabled={busy || index === selected.length - 1}
                      onClick={() => { const next = [...selected]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; set(next); }}>↓</button>
                  </div>)}
                </div>}
              </>}
              {options.length === 0 && <p>No {label} resources saved yet.</p>}
            </div>}
          </div>;
        })}
      </section>
      {character && !app && <section className="binding-section"><h2>App Overrides</h2>
        {APP_REGISTRY.map((item) => {
          const count = managedOverrideCount(binding?.apps[item.id]);
          return <Link className="binding-link" key={item.id}
            href={`/settings/bindings/${encodeURIComponent(characterId!)}/${item.id}`}>
            <span>{item.label}<small>{count ? "Custom choices" : "Following Character Defaults"}</small></span>
            <ChevronRight size={18} />
          </Link>;
        })}
      </section>}
    </>}
  </PageShell>;
}
