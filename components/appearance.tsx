"use client";

import { useState, type ChangeEvent } from "react";
import { APP_REGISTRY } from "../lib/app-registry";
import { reverseAppPositions } from "../lib/desktop-layout";
import { applyPreset, deletePreset, savePreset } from "../lib/theme-presets";
import { exportTheme, importTheme } from "../lib/theme-package";
import { readImage } from "../lib/theme-storage";
import {
  CSS_VARIABLES,
  defaultSnapshot,
  imageSource,
  normalizeOverrides,
} from "../lib/theme-types";
import { useTheme } from "./theme-provider";
import { PageShell } from "./page-shell";

type ImageEditorProps = {
  label: string;
  source: string | null;
  onApply: (source: string | null) => Promise<void>;
};

// Capture controlled-input values before asynchronous persistence and React reconciliation.
const valueChange =
  (action: (value: string) => void) =>
  (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    action(event.currentTarget.value);
const checkedChange =
  (action: (value: boolean) => void) =>
  (event: ChangeEvent<HTMLInputElement>) =>
    action(event.currentTarget.checked);

function ImageEditor({ label, source, onApply }: ImageEditorProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const preview = draft ?? source;
  return (
    <fieldset className="image-editor" disabled={busy}>
      <legend>{label}</legend>
      {preview && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className="image-preview"
          src={preview}
          alt={`${label} preview`}
          onError={() => setBroken(true)}
          onLoad={() => setBroken(false)}
        />
      )}
      {broken && (
        <p role="alert">Image could not be loaded. Choose another image.</p>
      )}
      <label>
        Upload {label}
        <input
          type="file"
          accept="image/*,.heic,.heif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void run(async () => {
                setDraft(await readImage(file));
                setBroken(false);
              });
          }}
        />
      </label>
      <label>
        {label} URL
        <input
          type="url"
          value={url}
          placeholder="https://example.com/image.png"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          type="button"
          onClick={() => {
            const source = imageSource(url.trim());
            if (!source || !/^https?:/.test(source)) {
              setError("Enter a valid HTTP or HTTPS image URL.");
              return;
            }
            setDraft(source);
            setBroken(false);
            setError("");
          }}
        >
          Preview URL
        </button>
        <button
          type="button"
          disabled={!draft || broken}
          onClick={() =>
            void run(async () => {
              await onApply(draft);
              setDraft(null);
              setUrl("");
            })
          }
        >
          Apply {label}
        </button>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              await onApply(null);
              setDraft(null);
              setUrl("");
              setBroken(false);
            })
          }
        >
          Default {label}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

export function Appearance() {
  const { document, ready, commit, updateProfile } = useTheme();
  const profile = document.current.profile;
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [css, setCss] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);

  async function run(action: () => Promise<void>, message = "Saved.") {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save appearance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      title="Appearance"
      backHref="/"
      backLabel="Back to Home"
      bodyClassName="theme-page appearance-page"
    >
      <p className="theme-notice" role="status" aria-live="polite">
        {notice || (!ready ? "Loading appearance…" : "")}
      </p>
      <fieldset className="appearance-controls" disabled={!ready || busy}>
        <section aria-labelledby="appearance-heading">
          <h2 id="appearance-heading">Appearance</h2>
          <details open>
            <summary>主题色</summary>
            {Object.entries(profile.colors).map(([key, value]) => (
              <label key={key}>
                {key}
                <input
                  aria-label={`${key} color`}
                  type="color"
                  value={value}
                  onChange={valueChange(
                    (value) =>
                      void run(() =>
                        updateProfile((p) => ({
                          ...p,
                          colors: { ...p.colors, [key]: value },
                        })),
                      ),
                  )}
                />
              </label>
            ))}
          </details>
          <details open>
            <summary>壁纸</summary>
            <ImageEditor
              label="Wallpaper"
              source={profile.wallpaper.source}
              onApply={(source) =>
                updateProfile((p) => ({
                  ...p,
                  wallpaper: { ...p.wallpaper, source },
                }))
              }
            />
            <label>
              Wallpaper fit
              <select
                value={profile.wallpaper.fit}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        wallpaper: {
                          ...p.wallpaper,
                          fit: value as "cover" | "contain",
                        },
                      })),
                    ),
                )}
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </select>
            </label>
            {(
              [
                ["opacity", 0, 1, 0.05],
                ["blur", 0, 20, 1],
                ["scale", 100, 200, 1],
                ["x", 0, 100, 1],
                ["y", 0, 100, 1],
              ] as const
            ).map(([key, min, max, step]) => (
              <label key={key}>
                Wallpaper {key} ({profile.wallpaper[key]})
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={profile.wallpaper[key]}
                  onChange={valueChange(
                    (value) =>
                      void run(() =>
                        updateProfile((p) => ({
                          ...p,
                          wallpaper: { ...p.wallpaper, [key]: Number(value) },
                        })),
                      ),
                  )}
                />
              </label>
            ))}
          </details>
          <details open>
            <summary>图标</summary>
            {APP_REGISTRY.map((app) => (
              <ImageEditor
                key={app.id}
                label={`${app.label} icon`}
                source={profile.icons[app.id] ?? null}
                onApply={(source) =>
                  updateProfile((p) => {
                    const icons = { ...p.icons };
                    if (source) icons[app.id] = source;
                    else delete icons[app.id];
                    return { ...p, icons };
                  })
                }
              />
            ))}
            <button
              onClick={() =>
                void run(() =>
                  commit((d) => ({
                    ...d,
                    current: {
                      ...d.current,
                      iconLayout: reverseAppPositions(d.current),
                    },
                  })),
                )
              }
            >
              Reverse Home icon order
            </button>
          </details>
          <details>
            <summary>Dock</summary>
            <label>
              Dock background
              <input
                type="color"
                value={profile.dock.background}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        dock: { ...p.dock, background: value },
                      })),
                    ),
                )}
              />
            </label>
            <label>
              Dock radius
              <input
                type="range"
                min="0"
                max="40"
                value={profile.dock.radius}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        dock: { ...p.dock, radius: Number(value) },
                      })),
                    ),
                )}
              />
            </label>
            <ImageEditor
              label="Dock image"
              source={profile.dock.image}
              onApply={(image) =>
                updateProfile((p) => ({ ...p, dock: { ...p.dock, image } }))
              }
            />
            {APP_REGISTRY.map((app) => (
              <label key={app.id}>
                <input
                  type="checkbox"
                  checked={document.current.dockLayout.includes(app.id)}
                  onChange={checkedChange(
                    (checked) =>
                      void run(() =>
                        commit((d) => ({
                          ...d,
                          current: {
                            ...d.current,
                            dockLayout: checked
                              ? [...d.current.dockLayout, app.id]
                              : d.current.dockLayout.filter(
                                  (id) => id !== app.id,
                                ),
                          },
                        })),
                      ),
                  )}
                />
                {app.label} in Dock
              </label>
            ))}
            <button
              onClick={() =>
                void run(() =>
                  commit((d) => ({
                    ...d,
                    current: {
                      ...d.current,
                      dockLayout: [...d.current.dockLayout].reverse(),
                    },
                  })),
                )
              }
            >
              Reverse Dock order
            </button>
          </details>
        </section>
        <section aria-labelledby="system-settings-heading">
          <h2 id="system-settings-heading">System Settings</h2>
          <details>
            <summary>状态栏</summary>
            <label>
              <input
                type="checkbox"
                checked={profile.statusBar.visible}
                onChange={checkedChange(
                  (checked) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        statusBar: { ...p.statusBar, visible: checked },
                      })),
                    ),
                )}
              />
              Show status bar
            </label>
            <label>
              Status bar color
              <input
                type="color"
                value={profile.statusBar.color}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        statusBar: { ...p.statusBar, color: value },
                      })),
                    ),
                )}
              />
            </label>
          </details>
          <details>
            <summary>文字</summary>
            <label>
              Font
              <select
                value={profile.text.font}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        text: { ...p.text, font: value as typeof p.text.font },
                      })),
                    ),
                )}
              >
                <option value="system">System</option>
                <option value="serif">Serif</option>
                <option value="monospace">Monospace</option>
              </select>
            </label>
            <label>
              Text size
              <input
                type="range"
                min="12"
                max="24"
                value={profile.text.size}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        text: { ...p.text, size: Number(value) },
                      })),
                    ),
                )}
              />
            </label>
            <label>
              Text weight
              <select
                value={profile.text.weight}
                onChange={valueChange(
                  (value) =>
                    void run(() =>
                      updateProfile((p) => ({
                        ...p,
                        text: { ...p.text, weight: Number(value) },
                      })),
                    ),
                )}
              >
                <option value="400">Regular</option>
                <option value="500">Medium</option>
                <option value="700">Bold</option>
              </select>
            </label>
          </details>
        </section>
        <section aria-labelledby="presets-heading">
          <h2 id="presets-heading">Theme Presets</h2>
          <label>
            Preset name
            <input
              value={presetName}
              maxLength={60}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </label>
          <button
            onClick={() =>
              void run(
                () => commit((d) => savePreset(d, presetName, d.current)),
                "Preset saved.",
              )
            }
          >
            Save current theme
          </button>
          {document.presets.length === 0 && <p>No presets yet.</p>}
          {document.presets.map((preset) => (
            <div className="preset-row" key={preset.id}>
              <span>{preset.name}</span>
              <button
                aria-label={`Apply preset ${preset.name}`}
                onClick={() =>
                  void run(
                    () => commit((d) => applyPreset(d, preset.id)),
                    "Preset applied.",
                  )
                }
              >
                Apply
              </button>
              <button
                aria-label={`Delete preset ${preset.name}`}
                onClick={() =>
                  void run(
                    () => commit((d) => deletePreset(d, preset.id)),
                    "Preset deleted.",
                  )
                }
              >
                Delete
              </button>
            </div>
          ))}
        </section>
        <section aria-labelledby="advanced-heading">
          <h2 id="advanced-heading">Advanced</h2>
          <details>
            <summary>CSS 变量</summary>
            <p>
              JSON object. Supported variables:{" "}
              {Object.keys(CSS_VARIABLES).join(", ")}. Colors use #RRGGBB; font
              size 12–24px; icon radius 0–32px. Overrides take priority over
              controls above.
            </p>
            <label htmlFor="css-overrides">CSS variable overrides</label>
            <textarea
              id="css-overrides"
              rows={7}
              value={css ?? JSON.stringify(profile.cssOverrides, null, 2)}
              onChange={(e) => setCss(e.target.value)}
              spellCheck={false}
            />
            <button
              onClick={() =>
                void run(async () => {
                  const parsed: unknown = JSON.parse(
                    css ?? JSON.stringify(profile.cssOverrides),
                  );
                  const valid = normalizeOverrides(parsed);
                  if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed) ||
                    Object.keys(valid).length !== Object.keys(parsed).length
                  )
                    throw new Error("Unsupported variable or invalid value.");
                  await updateProfile((p) => ({ ...p, cssOverrides: valid }));
                  setCss(null);
                }, "CSS variables applied.")
              }
            >
              Apply CSS variables
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await updateProfile((p) => ({ ...p, cssOverrides: {} }));
                  setCss(null);
                })
              }
            >
              Clear CSS variables
            </button>
          </details>
        </section>
        <section aria-labelledby="system-heading">
          <h2 id="system-heading">System</h2>
          <button
            onClick={() => {
              const blob = new Blob([exportTheme(document.current)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const anchor = window.document.createElement("a");
              anchor.href = url;
              anchor.download = "companion-phone-theme.json";
              anchor.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice("Theme exported.");
            }}
          >
            Export theme
          </button>
          <label>
            Import theme
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void run(async () => {
                    if (file.size > 3_000_000)
                      throw new Error(
                        "Theme package is too large (maximum 3 MB).",
                      );
                    const snapshot = importTheme(await file.text());
                    await commit((d) => ({ ...d, current: snapshot }));
                    setCss(null);
                  }, "Theme imported.");
              }}
            />
          </label>
          <button onClick={() => setResetPending(true)}>Restore Default</button>
          {resetPending && (
            <div className="reset-confirm">
              <p>
                Restore current appearance and layouts? Saved presets will be
                kept.
              </p>
              <button
                onClick={() =>
                  void run(async () => {
                    await commit((d) => ({ ...d, current: defaultSnapshot() }));
                    setCss(null);
                    setResetPending(false);
                  }, "Default appearance restored.")
                }
              >
                Confirm restore
              </button>
              <button onClick={() => setResetPending(false)}>Cancel</button>
            </div>
          )}
        </section>
      </fieldset>
    </PageShell>
  );
}
