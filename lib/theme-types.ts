import { APP_IDS, isAppId, type AppId } from "./app-registry";
import {
  defaultDesktop,
  DOCK_MAX,
  normalizeDesktop,
  type DesktopLayout,
} from "./desktop-layout";

export type ThemeProfile = {
  version: 1;
  colors: { background: string; surface: string; text: string; accent: string };
  wallpaper: {
    source: string | null;
    fit: "cover" | "contain";
    opacity: number;
    blur: number;
  };
  icons: Partial<Record<AppId, string>>;
  dock: { background: string; image: string | null; radius: number };
  text: {
    font: "system" | "serif" | "monospace";
    size: number;
    weight: number;
  };
  cssOverrides: Record<string, string>;
};

export type ThemeSnapshot = DesktopLayout & {
  profile: ThemeProfile;
  dockLayout: AppId[];
};

export type ThemePreset = { id: string; name: string; snapshot: ThemeSnapshot };
export type ThemeDocument = {
  version: 1;
  current: ThemeSnapshot;
  presets: ThemePreset[];
};

// Compose theme decoration with desktop data; layout algorithms remain independent.
export function defaultSnapshot(): ThemeSnapshot {
  return {
    profile: {
      version: 1,
      colors: {
        background: "#fafafa",
        surface: "#ffffff",
        text: "#171717",
        accent: "#2563eb",
      },
      wallpaper: {
        source: null,
        fit: "cover",
        opacity: 1,
        blur: 0,
      },
      icons: {},
      dock: { background: "#e9e9ec", image: null, radius: 24 },
      text: { font: "system", size: 16, weight: 400 },
      cssOverrides: {},
    },
    ...defaultDesktop(),
    dockLayout: ["messages"],
  };
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}

export function imageSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 600_000) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value))
    return value;
  try {
    const url = new URL(value);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Invalid image source. */
  }
  return null;
}

export function imageUrlInput(value: string): string | null {
  const input = value.trim();
  const markdown = input.match(/!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+).*\)/i);
  const html = input.match(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i);
  const source = imageSource(markdown?.[1] ?? html?.[1] ?? input);
  return source?.startsWith("http:") || source?.startsWith("https:")
    ? source
    : null;
}

export const CSS_VARIABLES = {
  "--theme-background": "color",
  "--theme-surface": "color",
  "--theme-text": "color",
  "--theme-accent": "color",
  "--theme-dock-background": "color",
  "--theme-font-size": "size",
  "--theme-icon-radius": "radius",
} as const;

export function normalizeOverrides(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(record(value))) {
    if (!(key in CSS_VARIABLES) || typeof val !== "string") continue;
    const kind = CSS_VARIABLES[key as keyof typeof CSS_VARIABLES];
    if (kind === "color" && /^#[0-9a-f]{6}$/i.test(val)) result[key] = val;
    if (kind !== "color" && /^\d+(\.\d+)?px$/.test(val)) {
      const n = parseFloat(val);
      if (kind === "size" ? n >= 12 && n <= 24 : n >= 0 && n <= 32)
        result[key] = val;
    }
  }
  return result;
}

export function normalizeSnapshot(value: unknown): ThemeSnapshot {
  const raw = record(value),
    p = record(raw.profile),
    d = defaultSnapshot();
  const c = record(p.colors),
    w = record(p.wallpaper),
    dock = record(p.dock),
    text = record(p.text);
  const icons: ThemeProfile["icons"] = {};
  for (const id of APP_IDS) {
    const source = imageSource(record(p.icons)[id]);
    if (source) icons[id] = source;
  }
  return {
    profile: {
      version: 1,
      colors: {
        background: color(c.background, d.profile.colors.background),
        surface: color(c.surface, d.profile.colors.surface),
        text: color(c.text, d.profile.colors.text),
        accent: color(c.accent, d.profile.colors.accent),
      },
      wallpaper: {
        source: imageSource(w.source),
        fit: w.fit === "contain" ? "contain" : "cover",
        opacity: number(w.opacity, 1, 0, 1),
        blur: number(w.blur, 0, 0, 20),
      },
      icons,
      dock: {
        background: color(dock.background, d.profile.dock.background),
        image: imageSource(dock.image),
        radius: number(dock.radius, 24, 0, 40),
      },
      text: {
        font:
          text.font === "serif" || text.font === "monospace"
            ? text.font
            : "system",
        size: number(text.size, 16, 12, 24),
        weight: number(text.weight, 400, 400, 700),
      },
      cssOverrides: normalizeOverrides(p.cssOverrides),
    },
    ...normalizeDesktop(raw),
    dockLayout: Array.isArray(raw.dockLayout)
      ? [...new Set(raw.dockLayout.filter(isAppId))].slice(0, DOCK_MAX)
      : d.dockLayout,
  };
}

export function normalizeDocument(value: unknown): ThemeDocument {
  const raw = record(value);
  const seen = new Set<string>();
  const presets: ThemePreset[] = [];
  if (Array.isArray(raw.presets))
    for (const item of raw.presets.slice(0, 10)) {
      const p = record(item);
      if (
        typeof p.id !== "string" ||
        !p.id ||
        seen.has(p.id) ||
        typeof p.name !== "string"
      )
        continue;
      seen.add(p.id);
      presets.push({
        id: p.id.slice(0, 100),
        name: p.name.slice(0, 60),
        snapshot: normalizeSnapshot(p.snapshot),
      });
    }
  return { version: 1, current: normalizeSnapshot(raw.current), presets };
}
