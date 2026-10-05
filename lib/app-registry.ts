import { FOUNDATION_COPY as C } from "./foundation-copy";
export const APP_REGISTRY = [
  { id: "messages", label: "Messages", href: "/messages", glyph: "M",
    bindingCapabilities: ["apiConfigId", "presetId", "worldBookIds", "regexIds"] },
  { id: "appearance", label: "Appearance", href: "/appearance", glyph: "A" },
  { id: "profile", label: C.profile.title, href: "/profile", glyph: "U" },
  {
    id: "characters",
    label: C.characters.title,
    href: "/characters",
    glyph: "C",
  },
  { id: "universe", label: C.universe.title, href: "/universe", glyph: "◎" },
  { id: "settings", label: "Settings", href: "/settings", glyph: "S" },
] as const;

export type AppId = (typeof APP_REGISTRY)[number]["id"];
export const APP_IDS: AppId[] = APP_REGISTRY.map((app) => app.id);
export function isAppId(value: unknown): value is AppId {
  return APP_IDS.includes(value as AppId);
}

export type AppBindingCapability = "apiConfigId" | "presetId" | "worldBookIds" | "regexIds";
export function bindingCapableApps<T extends { id: string }>(registry: readonly T[]): (T & { bindingCapabilities: readonly AppBindingCapability[] })[] {
  return registry.filter((app): app is T & { bindingCapabilities: readonly AppBindingCapability[] } =>
    "bindingCapabilities" in app && Array.isArray(app.bindingCapabilities) && app.bindingCapabilities.length > 0);
}
