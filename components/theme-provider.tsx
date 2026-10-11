"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { PersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import { browserThemeStorage } from "../lib/theme-storage";
import { isChatDiagnosticsEnabled, recordChatDiagnostic } from "../lib/diagnostics/chat-first-paint";
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
  /** The first load has finished, successfully or not. Until then the document is only the built-in default. */
  settled: boolean;
  commit: (update: (document: ThemeDocument) => ThemeDocument, scope?: PersistenceWriteScope) => Promise<void>;
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
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const writable = useRef(false);
  const hydration = useRef<Promise<void> | null>(null);
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const recover = useRef<(() => Promise<void>) | null>(null);
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});
  useEffect(() => {
    const owner = ++lifecycle.current;
    mounted.current = true;
    let active = true;
    let revision = 0;
    let imageTimeout: ReturnType<typeof setTimeout> | undefined;
    const images = new ThemeImageUrls((id) => browserAppearanceImageStorage.readBlob(id));
    const load = async () => {
      const request = ++revision;
      clearTimeout(imageTimeout);
      images.invalidate();
      try {
        const saved = await browserThemeStorage.load();
        if (!active || request !== revision) return;
        writable.current = true;
        // Saved configuration is usable independently of its image resources.
        setDocument(saved);
        const retained = images.retained(saved);
        setResolvedImages(retained);
        setReady(true);
        setSettled(true);
        setError("");
        const assetsStartedAt = isChatDiagnosticsEnabled() ? performance.now() : null;
        if (assetsStartedAt !== null) recordChatDiagnostic("theme-image-urls-start");
        let timedOut = false;
        const publishImages = (urls: Record<string, string> | null) => {
          if (!active || request !== revision) return;
          clearTimeout(imageTimeout);
          const prepared = urls ?? retained;
          setResolvedImages(prepared);
          if (assetsStartedAt !== null) recordChatDiagnostic("theme-image-urls-ready", {
            resolvedCount: Object.keys(prepared).length,
            durationMs: performance.now() - assetsStartedAt, ready: true, timedOut,
          });
        };
        imageTimeout = setTimeout(() => {
          if (!active || request !== revision) return;
          timedOut = true;
          images.invalidate();
          publishImages(null);
        }, 1000);
        void images.sync(saved).then((urls) => {
          if (!timedOut) publishImages(urls);
        }).catch((reason) => {
          if (!active || request !== revision || timedOut) return;
          publishImages(null);
          setError(reason instanceof Error ? reason.message : "Could not load appearance images.");
        });
      } catch (reason) {
        if (!active || request !== revision) return;
        writable.current = false;
        setReady(false);
        setSettled(true);
        setError(reason instanceof Error ? reason.message : "Could not load appearance.");
        throw reason;
      }
    };
    let loading: Promise<void> | null = null;
    const beginLoad = () => {
      const pending = load();
      hydration.current = pending;
      loading = pending;
      void pending.catch(() => {}).finally(() => { if (loading === pending) loading = null; });
      return pending;
    };
    // Recovery joins a load that is already running instead of superseding it.
    const recoverLoad = () => loading ?? beginLoad();
    refresh.current = beginLoad;
    recover.current = recoverLoad;
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
      clearTimeout(imageTimeout);
      refresh.current = null;
      recover.current = null;
      images.dispose();
      window.removeEventListener("storage", changed);
    };
  }, []);

  // Waits until the newest load has settled and returns its failure, if any.
  async function settledLoad(): Promise<unknown> {
    let seen: Promise<void> | null, failure: unknown;
    do {
      seen = hydration.current;
      failure = undefined;
      try { await seen; } catch (reason) { failure = reason; }
    } while (seen !== hydration.current);
    return failure;
  }

  function commit(
    update: (document: ThemeDocument) => ThemeDocument,
    scope?: PersistenceWriteScope,
  ): Promise<void> {
    const owner = lifecycle.current;
    const live = () => owner === lifecycle.current && mounted.current;
    const operation = queue.current.then(async () => {
      let failure = await settledLoad();
      // A failed load is retried from the persisted data before any write is refused.
      if (!writable.current && live()) {
        await recover.current?.().catch(() => {});
        failure = await settledLoad();
      }
      if (!live() || !writable.current)
        throw failure instanceof Error ? failure
          : new Error("Appearance has not loaded. Existing data has not been changed.");
      await browserThemeStorage.transact(update, scope);
      // The write is durable here; a failed refresh must not report it as a failed save.
      if (live()) {
        try { await refresh.current?.(); }
        catch (reason) {
          if (live()) setError(`Appearance was saved, but could not be reloaded. ${reason instanceof Error ? reason.message : ""}`.trim());
        }
      }
    }).catch((reason) => {
      if (live()) setError(reason instanceof Error ? reason.message : "Could not save appearance.");
      throw reason;
    });
    queue.current = operation.catch(() => {});
    return operation;
  }

  useLayoutEffect(() => {
    if (ready) globalThis.document.getElementById("veil-theme-bootstrap")?.remove();
  }, [ready, document]);

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
        settled,
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
            {!ready && <button type="button" onClick={() => { void recover.current?.().catch(() => {}); }}>Retry</button>}
          </p>
        )}
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
