import { FOUNDATION_COPY as C } from "./foundation-copy";
export const APP_REGISTRY = [
  { id: "messages", label: "Messages", href: "/messages", glyph: "M" },
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
