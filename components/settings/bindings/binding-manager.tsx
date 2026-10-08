"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { APP_REGISTRY, bindingCapableApps, isAppId, type AppBindingCapability, type AppId } from "../../../lib/app-registry";
import { resolveBindings, type BindingScope, type BindingSlot,
  type ManagedBindingField } from "../../../lib/bindings";
import { DEFAULT_API_CONFIG_ID } from "../../../lib/api-config";
import { BUILTIN_PRESET_ID } from "../../../lib/preset";
import { useBindingManager, type BindingResources } from "./use-binding-manager";

const FIELDS: { key: AppBindingCapability; label: string; multiple: boolean }[] = [
  { key: "apiConfigId", label: "Text API", multiple: false },
  { key: "presetId", label: "Preset", multiple: false },
  { key: "worldBookIds", label: "WorldBook", multiple: true },
  { key: "regexIds", label: "Regex", multiple: true },
];
const managedOverrideCount = (slot: BindingSlot | undefined) =>
  FIELDS.filter(({ key }) => slot && Object.hasOwn(slot, key)).length;
export const bindingApps = bindingCapableApps(APP_REGISTRY);
export function appBindingFields(app: { bindingCapabilities?: readonly AppBindingCapability[] }) {
  return FIELDS.filter((field) => app.bindingCapabilities?.includes(field.key));
}
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
  // Unset lists mean "use every available resource"; only an explicit [] is None.
  if ((field === "worldBookIds" || field === "regexIds") && value === undefined) return "Default (All)";
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
  const { document, bindings, resources, error, busy, update } = useBindingManager();
  const [openField, setOpenField] = useState<ManagedBindingField | null>(null);
  return <PageShell className="settings-app binding-manager" title="Bindings" backHref="/settings" backLabel="Back to Settings">
    {error && <Alert variant="danger">{error}</Alert>}
    {!resources && !error && <p role="status">Loading Bindings…</p>}
    {resources && <>
      <BindingFields title="Global Defaults" fields={FIELDS} own={bindings.global}
        effective={resolveBindings(bindings, null, "messages")} resources={resources}
        busy={busy} openField={openField} setOpenField={setOpenField}
        update={(field, value) => update({}, field, value)} />
      <section className="binding-section"><h2>Characters</h2>
        {document.characters.length === 0 && <p>No Characters yet.</p>}
        {document.characters.map((character) => {
          const binding = bindings.characters[character.characterId];
          const count = managedOverrideCount(binding?.defaults) +
            bindingApps.reduce((total, app) => total + managedOverrideCount(binding?.apps[app.id]), 0);
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
  const { document, bindings, resources, error, busy, update } = manager;
  const [openField, setOpenField] = useState<ManagedBindingField | null>(null);
  const character = characterId ? document.characters.find((item) => item.characterId === characterId) : undefined;
  const validApp: AppId | undefined = appId && isAppId(appId) ? appId : undefined;
  const app = bindingApps.find((item) => item.id === validApp);
  const scope: BindingScope = { characterId, appId: validApp };
  const title = app ? app.label : character ? character.name : "Global Defaults";
  const backHref = app ? `/settings/bindings/${encodeURIComponent(characterId!)}`
    : character ? "/settings/bindings" : "/settings/bindings";
  const invalid = (!!characterId && !character) || (!!appId && !app);
  const binding = characterId ? bindings.characters[characterId] : undefined;
  const own: BindingSlot = app ? binding?.apps[app.id] ?? {} : character ? binding?.defaults ?? {}
    : bindings.global;
  const inherited: BindingSlot = app ? resolveBindings({ ...bindings,
    characters: { ...bindings.characters,
      [characterId!]: { defaults: binding?.defaults ?? {}, apps: {} } } }, characterId!, app.id)
    : resolveBindings(bindings, null, "messages");
  const effective = resolveBindings(bindings, characterId ?? null, validApp ?? "messages");
  return <PageShell className="settings-app binding-manager" title={title} backHref={backHref} backLabel="Back to Bindings">
    {error && <Alert variant="danger">{error}</Alert>}
    {invalid ? <p>Binding target not found.</p> : !resources ? <p role="status">Loading Bindings…</p> : <>
      {app && <p className="binding-context">{character?.name} · {app.label}</p>}
      <BindingFields title={app ? "App Override" : "Character Defaults"}
        fields={app ? appBindingFields(app) : FIELDS} own={own} inherited={inherited}
        effective={effective} resources={resources} busy={busy} openField={openField}
        setOpenField={setOpenField} update={(field, value) => update(scope, field, value)}
        resetLabel={app ? "Inherit Character" : "Reset to Global"}
        inheritLabel={app ? "Character" : "Global"} />
      {character && !app && <section className="binding-section"><h2>App Overrides</h2>
        {bindingApps.map((item) => {
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

function BindingFields({ title, fields, own, inherited, effective, resources, busy, openField,
  setOpenField, update, resetLabel, inheritLabel }: {
  title: string; fields: typeof FIELDS; own: BindingSlot; inherited?: BindingSlot;
  effective: BindingSlot; resources: BindingResources; busy: boolean;
  openField: ManagedBindingField | null; setOpenField: (field: ManagedBindingField | null) => void;
  update: (field: ManagedBindingField, value: BindingSlot[ManagedBindingField]) => void;
  resetLabel?: string; inheritLabel?: string;
}) {
  return <section className="binding-section"><h2>{title}</h2>
        {fields.map(({ key, label, multiple }) => {
          const overridden = Object.hasOwn(own, key);
          const value = effective[key];
          const selected = Array.isArray(value) ? value : [];
          const options = optionsFor(resources, key);
          const expanded = openField === key;
          const set = (next: BindingSlot[ManagedBindingField]) => update(key, next);
          return <div className="binding-field" key={key}>
            <button className="binding-field-main" type="button" aria-expanded={expanded}
              onClick={() => setOpenField(expanded ? null : key)}>
              <span><strong>{label}</strong><small>{inherited
                ? `${overridden ? "Override" : "Inherited"}: ${displayValue(key, value, resources)}`
                : displayValue(key, value, resources)}</small></span><ChevronRight size={18} />
            </button>
            {inherited && overridden && <button type="button" className="binding-reset" disabled={busy}
              onClick={() => set(undefined)}>{resetLabel}</button>}
            {expanded && <div className="binding-picker">
              {inherited && <button type="button" disabled={busy} onClick={() => set(undefined)}>
                Inherit {inheritLabel} · {displayValue(key, inherited[key], resources)}
                {!overridden && <span aria-hidden="true"> ✓</span>}
              </button>}
              {!multiple && <>
                {!inherited && <button type="button" disabled={busy} onClick={() => set(undefined)}>
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
                {!inherited && <button type="button" disabled={busy} onClick={() => set(undefined)}>
                  Default (All){!overridden && <span aria-hidden="true"> ✓</span>}
                </button>}
                <button type="button" disabled={busy} onClick={() => set([])}>None
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
      </section>;
}
