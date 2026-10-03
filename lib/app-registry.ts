export const APP_REGISTRY = [
  { id: "messages", label: "Messages", href: "/messages", glyph: "M" },
  { id: "appearance", label: "Appearance", href: "/appearance", glyph: "A" },
] as const;

export type AppId = (typeof APP_REGISTRY)[number]["id"];
export const APP_IDS: AppId[] = APP_REGISTRY.map((app) => app.id);
export function isAppId(value: unknown): value is AppId {
  return APP_IDS.includes(value as AppId);
}
