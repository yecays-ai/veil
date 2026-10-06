"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { browserThemeStorage } from "../lib/theme-storage";
import { browserAppearanceImageStorage } from "../lib/appearance-image-storage";
import {
  defaultSnapshot,
  normalizeDocument,
  themeImageAssetId,
  themeImageAssetIds,
  type ThemeDocument,
  type ThemeProfile,
} from "../lib/theme-types";

type ThemeContextValue = {
  document: ThemeDocument;
  ready: boolean;
  commit: (update: (document: ThemeDocument) => ThemeDocument) => Promise<void>;
  resolveImage: (source: string | null) => string | null;
  updateProfile: (
    update: (profile: ThemeProfile) => ThemeProfile,
  ) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
function resolveThemeImage(source: string | null, images: Record<string, string>): string | null {
  if (!source) return null;
  return themeImageAssetId(source) ? images[source] ?? null : source;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is required.");
  return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<ThemeDocument>({
    version: 1,
    current: defaultSnapshot(),
    presets: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(document);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);
  const imageUrls = useRef<Record<string, string>>({});
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});

  async function syncImageUrls(value: ThemeDocument) {
    const references = [...themeImageAssetIds(value)].map((id) => `appearance-asset:${id}`);
    const next = Object.fromEntries(references.flatMap((reference) =>
      imageUrls.current[reference] ? [[reference, imageUrls.current[reference]]] : []));
    for (const reference of references) {
      if (next[reference]) continue;
      const id = themeImageAssetId(reference);
      if (!id) continue;
      const blob = await browserAppearanceImageStorage.readBlob(id).catch(() => null);
      if (blob) next[reference] = URL.createObjectURL(blob);
    }
    for (const [reference, url] of Object.entries(imageUrls.current))
      if (!next[reference]) URL.revokeObjectURL(url);
    imageUrls.current = next;
    if (mounted.current) setResolvedImages(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(imageUrls.current).forEach((url) => URL.revokeObjectURL(url));
      imageUrls.current = {};
    };
  }, []);

  useEffect(() => {
    let active = true;
    browserThemeStorage
      .load()
      .then(async (saved) => {
        await syncImageUrls(saved);
        if (active) {
          current.current = saved;
          setDocument(saved);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load appearance.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function commit(
    update: (document: ThemeDocument) => ThemeDocument,
  ): Promise<void> {
    const operation = queue.current.then(async () => {
      const next = normalizeDocument(update(current.current), false);
      await browserThemeStorage.save(next);
      await syncImageUrls(next);
      current.current = next;
      setDocument(next);
      setError("");
    });
    queue.current = operation.catch(() => {});
    return operation;
  }

  const profile = document.current.profile;
  const fonts = {
    system: "Arial, Helvetica, sans-serif",
    serif: "Georgia, serif",
    monospace: "monospace",
  };
  const style = {
    "--theme-background": profile.colors.background,
    "--theme-surface": profile.colors.surface,
    "--theme-text": profile.colors.text,
    "--theme-accent": profile.colors.accent,
    "--theme-dock-background": profile.dock.background,
    "--theme-font-size": `${profile.text.size}px`,
    "--theme-font-family": fonts[profile.text.font],
    "--theme-font-weight": profile.text.weight,
    "--theme-icon-radius": "16px",
    ...profile.cssOverrides,
  } as CSSProperties;

  return (
    <ThemeContext.Provider
      value={{
        document,
        ready,
        commit,
        resolveImage: (source) => {
          if (!source) return null;
          return themeImageAssetId(source) ? resolvedImages[source] ?? null : source;
        },
        updateProfile: (update) =>
          commit((d) => ({
            ...d,
            current: { ...d.current, profile: update(d.current.profile) },
          })),
      }}
    >
      <div className="theme-surface" style={style}>
        {resolveThemeImage(profile.wallpaper.source, resolvedImages) && (
          <div
            className="theme-home-wallpaper"
            data-testid="home-wallpaper"
            aria-hidden="true"
            style={{
              backgroundImage: `url(${JSON.stringify(resolveThemeImage(profile.wallpaper.source, resolvedImages))})`,
              backgroundSize: profile.wallpaper.fit,
              backgroundPosition: "center",
              opacity: profile.wallpaper.opacity,
              filter: `blur(${profile.wallpaper.blur}px)`,
              inset: profile.wallpaper.blur
                ? `${-2 * profile.wallpaper.blur}px`
                : 0,
            }}
          />
        )}
        {error && (
          <p role="alert" className="theme-notice">
            {error}
          </p>
        )}
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
