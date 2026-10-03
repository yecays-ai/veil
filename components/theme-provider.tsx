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
import {
  defaultSnapshot,
  normalizeDocument,
  type ThemeDocument,
  type ThemeProfile,
} from "../lib/theme-types";

type ThemeContextValue = {
  document: ThemeDocument;
  ready: boolean;
  commit: (update: (document: ThemeDocument) => ThemeDocument) => Promise<void>;
  updateProfile: (
    update: (profile: ThemeProfile) => ThemeProfile,
  ) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
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

  useEffect(() => {
    let active = true;
    browserThemeStorage
      .load()
      .then((saved) => {
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
      const next = normalizeDocument(update(current.current));
      await browserThemeStorage.save(next);
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
    "--theme-status-color": profile.statusBar.color,
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
        updateProfile: (update) =>
          commit((d) => ({
            ...d,
            current: { ...d.current, profile: update(d.current.profile) },
          })),
      }}
    >
      <div className="theme-surface" style={style}>
        {error && (
          <p role="alert" className="theme-notice">
            {error}
          </p>
        )}
        {profile.statusBar.visible && (
          <div className="theme-status-bar" aria-label="Simulated status bar">
            <span>9:41</span>
            {profile.statusBar.island && (
              <span className="theme-status-island" aria-hidden="true" />
            )}
            <span aria-label="Battery full">▰</span>
          </div>
        )}
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
