"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import {
  DEFAULT_API_CONFIG_ID,
  type NamedApiConfig,
} from "../../lib/chat/types";
import { validateApiConfig } from "../../lib/chat/provider";
import {
  apiConfigReferences,
  fetchTextApiModels,
  testTextApiConnection,
} from "../../lib/settings/text-api";

export function TextApiSettings() {
  const { document, ready: foundationReady, commit } = useFoundation();
  const [configs, setConfigs] = useState<NamedApiConfig[]>([]);
  const [draft, setDraft] = useState<NamedApiConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    chatStorage
      .listApiConfigs()
      .then((value) => {
        if (active) {
          setConfigs(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Could not load Text APIs. Saved credentials have not been changed.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const saved = configs.find((config) => config.id === draft?.id);
  const unchanged =
    !!draft && !!saved && JSON.stringify(saved) === JSON.stringify(draft);
  const globalId =
    document.bindings.global.apiConfigId === undefined
      ? DEFAULT_API_CONFIG_ID
      : document.bindings.global.apiConfigId;
  function edit(config: NamedApiConfig | null) {
    setDraft(config);
    setNotice("");
    setError("");
    setConnection("");
    setModels([]);
    setDeleting(false);
  }
  function update(patch: Partial<NamedApiConfig>) {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setConnection("");
    setNotice("");
    setError("");
    setDeleting(false);
  }
  async function run(action: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The operation failed. Saved settings have not been changed.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="settings-app">
      <Link className="back-link" href="/settings">
        ‹ Settings
      </Link>
      <h1>Text API</h1>
      <p>
        Named OpenAI-compatible providers, stored privately in this browser.
        Direct requests require your provider to allow browser access (CORS).
      </p>
      {!draft ? (
        <>
          <button
            disabled={!ready || !!busy}
            onClick={() =>
              edit({
                id: crypto.randomUUID(),
                name: "",
                provider: "Custom",
                baseUrl: "",
                apiKey: "",
                model: "",
              })
            }
          >
            Create Text API
          </button>
          <nav aria-label="Text API configs">
            {configs.map((config) => (
              <button
                className="settings-row"
                key={config.id}
                onClick={() => edit({ ...config })}
              >
                <strong>{config.name}</strong>
                <span>
                  {config.model} · {config.provider}
                  {globalId === config.id ? " · Default" : ""}
                </span>
              </button>
            ))}
          </nav>
          {ready && !configs.length && <p>No Text API configs yet.</p>}
          {ready && !configs.some((config) => config.id === globalId) && (
            <p>
              No usable default is selected. Save a config and choose “Use as
              default”.
            </p>
          )}
        </>
      ) : (
        <>
          <button disabled={!!busy} onClick={() => edit(null)}>
            ‹ Configs
          </button>
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void run("Saving…", async () => {
                if (!draft.name.trim())
                  throw new Error("Enter a name for this config.");
                validateApiConfig(draft);
                const next = {
                  ...draft,
                  name: draft.name.trim(),
                  baseUrl: draft.baseUrl.trim(),
                  apiKey: draft.apiKey.trim(),
                  model: draft.model.trim(),
                };
                await chatStorage.saveApiConfig(next);
                setConfigs(await chatStorage.listApiConfigs());
                setDraft(next);
                setConnection("");
                setNotice("Saved. Connection has not been tested.");
              });
            }}
          >
            <label>
              Name
              <input
                required
                value={draft.name}
                disabled={!!busy}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Provider
              <select
                value={draft.provider}
                disabled={!!busy}
                onChange={(e) =>
                  update({
                    provider: e.target.value as NamedApiConfig["provider"],
                  })
                }
              >
                <option>Custom</option>
                <option>OpenAI-compatible</option>
              </select>
            </label>
            <label>
              Base URL
              <input
                type="url"
                required
                placeholder="https://your-provider.example/v1"
                value={draft.baseUrl}
                disabled={!!busy}
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                required
                autoComplete="new-password"
                value={draft.apiKey}
                disabled={!!busy}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </label>
            <label>
              Model
              <input
                required
                value={draft.model}
                disabled={!!busy}
                onChange={(e) => update({ model: e.target.value })}
              />
            </label>
            {!!models.length && (
              <label>
                Available models
                <select
                  value={models.includes(draft.model) ? draft.model : ""}
                  disabled={!!busy}
                  onChange={(e) => update({ model: e.target.value })}
                >
                  <option value="" disabled>
                    Choose a model
                  </option>
                  {models.map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </label>
            )}
            <button disabled={!ready || !!busy} type="submit">
              {busy === "Saving…" ? busy : "Save"}
            </button>
          </form>
          <p>
            {unchanged ? "Saved" : "Unsaved changes"}. Testing and fetching use
            the current fields and never save them.
          </p>
          <div className="settings-actions">
            <button
              disabled={!!busy}
              onClick={() =>
                void run("Testing…", async () => {
                  setConnection("Testing…");
                  try {
                    await testTextApiConnection(draft);
                    setConnection("Connected");
                  } catch (err) {
                    setConnection("Connection failed");
                    throw err;
                  }
                })
              }
            >
              Test Connection
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                void run("Fetching models…", async () => {
                  const fetched = await fetchTextApiModels(draft);
                  setModels(fetched);
                  setNotice(
                    fetched.length
                      ? `Fetched ${fetched.length} models.`
                      : "No models returned. Enter a model manually.",
                  );
                })
              }
            >
              Fetch Models
            </button>
            <button
              disabled={
                !unchanged ||
                !!busy ||
                !foundationReady ||
                globalId === draft.id
              }
              onClick={() =>
                void run("Selecting…", async () => {
                  await commit((d) => ({
                    ...d,
                    bindings: {
                      ...d.bindings,
                      global: { ...d.bindings.global, apiConfigId: draft.id },
                    },
                  }));
                  setNotice(
                    "Default selected. Existing Character and app overrides are preserved.",
                  );
                })
              }
            >
              Use as default
            </button>
            <button
              disabled={!saved || !!busy}
              onClick={() => setDeleting(true)}
            >
              Delete
            </button>
          </div>
          {deleting && (
            <div role="group" aria-label="Confirm deletion">
              <p>
                Delete “{draft.name}”?{" "}
                {apiConfigReferences(document.bindings, draft.id).length}{" "}
                explicit binding reference(s)
                {globalId === draft.id ? ", including the current default" : ""}
                . Referenced chats will stop working until a replacement is
                explicitly selected. Bindings will not be redirected.
              </p>
              <button
                disabled={!!busy}
                onClick={() =>
                  void run("Deleting…", async () => {
                    await chatStorage.deleteApiConfig(draft.id);
                    setConfigs(await chatStorage.listApiConfigs());
                    edit(null);
                  })
                }
              >
                Confirm delete
              </button>{" "}
              <button disabled={!!busy} onClick={() => setDeleting(false)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {busy && <p role="status">{busy}</p>}
      {connection && <p role="status">{connection}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
