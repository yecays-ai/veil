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
import { ThemeImageUrls } from "../lib/theme-image-urls";
import {
  defaultSnapshot,
  themeImageAssetId,
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
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const writable = useRef(false);
  const hydration = useRef<Promise<void> | null>(null);
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});
  useEffect(() => {
    const owner = ++lifecycle.current;
    mounted.current = true;
    let active = true;
    let revision = 0;
    const images = new ThemeImageUrls((id) => browserAppearanceImageStorage.readBlob(id));
    const load = async () => {
      const request = ++revision;
      images.invalidate();
      try {
        const saved = await browserThemeStorage.load();
        if (!active || request !== revision) return;
        writable.current = true;
        setDocument(saved);
        setReady(true);
        setError("");
        const urls = await images.sync(saved);
        if (active && request === revision && urls) setResolvedImages(urls);
      } catch (reason) {
        if (!active || request !== revision) return;
        writable.current = false;
        setReady(false);
        setError(reason instanceof Error ? reason.message : "Could not load appearance.");
        throw reason;
      }
    };
    const beginLoad = () => {
      const pending = load();
      hydration.current = pending;
      void pending.catch(() => {});
      return pending;
    };
    refresh.current = beginLoad;
    void beginLoad();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === "companion-phone.appearance.v1") void beginLoad();
    };
    window.addEventListener("storage", changed);
    return () => {
      active = false;
      lifecycle.current = owner + 1;
      mounted.current = false;
      writable.current = false;
      revision++;
      refresh.current = null;
      images.dispose();
      window.removeEventListener("storage", changed);
    };
  }, []);

  function commit(
    update: (document: ThemeDocument) => ThemeDocument,
  ): Promise<void> {
    const owner = lifecycle.current;
    const operation = queue.current.then(async () => {
      await hydration.current;
      if (owner !== lifecycle.current || !mounted.current || !writable.current)
        throw new Error("Appearance has not loaded. Existing data has not been changed.");
      await browserThemeStorage.transact(update);
      if (owner === lifecycle.current && mounted.current) await refresh.current?.();
    }).catch((reason) => {
      if (owner === lifecycle.current && mounted.current) setError(reason instanceof Error ? reason.message : "Could not save appearance.");
      throw reason;
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
