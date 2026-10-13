"use client";
import { useBindings } from "../use-bindings";
import { PageShell } from "../page-shell";
import { BottomSheet, ConfirmDialog } from "./ui/modal";
import { Input, Select } from "./ui/form";
import { Alert } from "./ui/feedback";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiConfigConflictError, browserApiConfigStorage } from "../../lib/api-config-storage";
import {
  DEFAULT_API_CONFIG_ID,
  type NamedApiConfig,
} from "../../lib/api-config";
import { validateApiConfig } from "../../lib/chat/provider";
import { setBindingField } from "../../lib/bindings";
import { memoryApiState } from "../../lib/settings/api-layers";
import {
  apiConfigReferences,
  deleteApiConfigAndBindings,
  fetchTextApiModels,
  testTextApiConnection,
} from "../../lib/settings/text-api";

export function TextApiSettings() {
  const { bindings, ready: bindingsReady, error: bindingError, commit } = useBindings();
  const [configs, setConfigs] = useState<NamedApiConfig[]>([]);
  const [draft, setDraft] = useState<NamedApiConfig | null>(null);
  const [baseline, setBaseline] = useState<NamedApiConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const mounted = useRef(false), readRevision = useRef(0), running = useRef(false);
  const refreshConfigs = useCallback(() => {
    const request = ++readRevision.current;
    return browserApiConfigStorage.listApiConfigs().then((value) => {
      if (mounted.current && request === readRevision.current) { setConfigs(value); setReady(true); setError(""); }
    }).catch(() => {
      if (mounted.current && request === readRevision.current)
        setError("Could not load Text APIs. Saved credentials have not been changed.");
    });
  }, []);
  useEffect(() => {
    const revisions = readRevision;
    mounted.current = true;
    void refreshConfigs();
    return () => {
      mounted.current = false;
      revisions.current++;
    };
  }, [refreshConfigs]);
  const saved = baseline;
  const unchanged =
    !!draft && !!saved && JSON.stringify(saved) === JSON.stringify(draft);
  const globalId =
    bindings.global.apiConfigId === undefined
      ? DEFAULT_API_CONFIG_ID
      : bindings.global.apiConfigId;
  const memoryState = memoryApiState(bindings, configs);
  const memoryChoice = bindings.global.memoryApiConfigId === undefined ? "" : bindings.global.memoryApiConfigId === null ? "off" : bindings.global.memoryApiConfigId;
  const memoryStatus = memoryState.kind === "ready"
    ? `${memoryState.source === "default" ? "Using the Default API" : "Using"}: ${memoryState.name} · ${memoryState.model}`
    : memoryState.kind === "off" ? "Memory is off for Characters that do not choose their own API."
    : memoryState.kind === "missing" ? "The selected API no longer exists. Memory will not run until you choose another; nothing else is used instead."
    : `This API is not ready (${memoryState.reason}). Memory will not run; nothing else is used instead.`;
  function edit(config: NamedApiConfig | null) {
    setBaseline(config && configs.some((item) => item.id === config.id) ? structuredClone(config) : null);
    setDraft(config ? structuredClone(config) : null);
    setNotice("");
    setError("");
    setConnection("");
    setModels([]);
    setDeleting(false);
    setDiscarding(false);
  }
  function addConfig() {
    edit({
      id: crypto.randomUUID(),
      name: "",
      provider: "Custom",
      baseUrl: "",
      apiKey: "",
      model: "",
    });
  }
  function update(patch: Partial<NamedApiConfig>) {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setConnection("");
    setNotice("");
    setError("");
    setDeleting(false);
    setDiscarding(false);
  }
  async function run(action: string, operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (err) {
      if (err instanceof ApiConfigConflictError) await refreshConfigs();
      if (!mounted.current) return;
      setDeleting(false);
      setError(
        err instanceof Error
          ? err.message
          : "The operation failed. Saved settings have not been changed.",
      );
    } finally {
      running.current = false;
      if (mounted.current) setBusy("");
    }
  }
  function closeEditor() {
    if (busy) return;
    if (!unchanged && draft) setDiscarding(true);
    else edit(null);
  }
  async function save() {
    if (!draft) return;
    await run("Saving…", async () => {
      if (!draft.name.trim()) throw new Error("Enter a name for this config.");
      validateApiConfig(draft);
      const next = {
        ...draft,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim(),
      };
      const savedNext = await browserApiConfigStorage.saveApiConfig(next, baseline);
      readRevision.current++;
      setConfigs((current) => current.some((item) => item.id === savedNext.id)
        ? current.map((item) => item.id === savedNext.id ? savedNext : item) : [...current, savedNext]);
      setDraft(null);
      setBaseline(null);
      setConnection("");
      setNotice("");
    });
  }
  const feedback = (
    <>
      {connection && (
        <Alert
          variant={
            connection === "Connection failed"
              ? "danger"
              : connection === "Connected"
                ? "success"
                : "info"
          }
        >
          {connection}
        </Alert>
      )}
      {notice && <Alert>{notice}</Alert>}
      {(error || bindingError) && <Alert variant="danger">{error || bindingError}</Alert>}
    </>
  );
  return (
    <PageShell
      className="settings-app"
      title="Text API"
      backHref="/settings"
      backLabel="Back to Settings"
      overlay={
        draft ? (
          <>
            <BottomSheet
              title={saved ? "Edit Text API" : "New Text API"}
              onClose={closeEditor}
              suspended={deleting || discarding}
              headerAction={
                <button
                  className="settings-header-action"
                  type="submit"
                  form="text-api-editor"
                  disabled={!ready || !!busy}
                >
                  {busy === "Saving…" ? "Saving…" : "Save"}
                </button>
              }
            >
              <form
                id="text-api-editor"
                className="settings-editor"
                autoComplete="off"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label>
                  Name
                  <Input
                    required
                    value={draft.name}
                    placeholder="My text provider"
                    disabled={!!busy}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label>
                  Provider
                  <Select
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
                  </Select>
                </label>
                <label>
                  Base URL
                  <Input
                    type="url"
                    required
                    placeholder="https://api.example.com/v1"
                    value={draft.baseUrl}
                    disabled={!!busy}
                    onChange={(e) => update({ baseUrl: e.target.value })}
                  />
                </label>
                <label>
                  API Key
                  <Input
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
                  <Input
                    required
                    placeholder="Enter a model name"
                    value={draft.model}
                    disabled={!!busy}
                    onChange={(e) => update({ model: e.target.value })}
                  />
                </label>
                {!!models.length && (
                  <label>
                    Available models
                    <Select
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
                    </Select>
                  </label>
                )}
                <div className="settings-action-row">
                  <button
                    className="settings-button"
                    type="button"
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
                    {busy === "Fetching models…" ? busy : "Fetch Models"}
                  </button>
                  <button
                    className="settings-button"
                    type="button"
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
                    {busy === "Testing…" ? busy : "Test Connection"}
                  </button>
                </div>
                {feedback}
                <p className="settings-hint">
                  {unchanged ? "Saved" : "Unsaved changes"}. Testing and
                  fetching do not save your changes.
                </p>
                <div className="settings-default-row">
                  <div>
                    <strong>Default Text API</strong>
                    <p className="settings-hint">
                      {globalId === draft.id
                        ? "Used for conversations without an override."
                        : "Save this config to use it as your default."}
                    </p>
                  </div>
                  <button
                    className="settings-button"
                    type="button"
                    disabled={
                      !unchanged ||
                      !!busy ||
                      !bindingsReady ||
                      globalId === draft.id
                    }
                    onClick={() =>
                      void run("Selecting…", async () => {
                        await commit((d) => ({ ...d, global: { ...d.global, apiConfigId: draft.id } }));
                        setNotice(
                          "Default selected. Existing Character and app overrides are preserved.",
                        );
                      })
                    }
                  >
                    {globalId === draft.id ? "Default" : "Use as default"}
                  </button>
                </div>
                {saved && (
                  <button
                    className="settings-button settings-danger"
                    type="button"
                    disabled={!!busy}
                    onClick={() => setDeleting(true)}
                  >
                    Delete config
                  </button>
                )}
              </form>
            </BottomSheet>
            {deleting && (
              <ConfirmDialog
                title="Delete Text API?"
                confirmLabel="Delete config"
                busy={!!busy}
                onCancel={() => {
                  if (!busy) setDeleting(false);
                }}
                onConfirm={() =>
                  void run("Deleting…", async () => {
                    await deleteApiConfigAndBindings(draft.id, browserApiConfigStorage, { transact: commit }, baseline ?? undefined);
                    readRevision.current++;
                    setConfigs((current) => current.filter((item) => item.id !== draft.id));
                    edit(null);
                  })
                }
              >
                Delete “{draft.name}”?{" "}
                {apiConfigReferences(bindings, draft.id).length}{" "}
                explicit binding reference(s)
                {globalId === draft.id ? ", including the current default" : ""}
                . Referenced bindings will be cleared without selecting another provider.
              </ConfirmDialog>
            )}
            {discarding && (
              <ConfirmDialog
                title="Discard changes?"
                confirmLabel="Discard changes"
                onCancel={() => setDiscarding(false)}
                onConfirm={() => edit(null)}
              >
                Your unsaved changes will be discarded.
              </ConfirmDialog>
            )}
          </>
        ) : undefined
      }
    >
      {!ready && !error && <Alert>Loading Text APIs…</Alert>}
      {!ready && error && <button className="settings-button" type="button" onClick={() => void refreshConfigs()}>Retry loading Text APIs</button>}
      {ready && !configs.length && (
        <div className="settings-empty">
          <span className="settings-card-icon" aria-hidden="true">
            Aa
          </span>
          <h2>No Text APIs yet</h2>
          <p>Add a provider and model to start a conversation.</p>
          <button
            className="settings-button settings-page-add"
            type="button"
            aria-label="Create Text API"
            disabled={!ready || !!busy}
            onClick={addConfig}
          >
            Add provider
          </button>
        </div>
      )}
      {ready && !!configs.length && (
        <>
          <section className="settings-api-layers" aria-label="API layers">
            <h2 className="settings-section-label">Models</h2>
            <div className="settings-card">
              <strong>Default API</strong>
              <span>{configs.find((config) => config.id === globalId)?.name ?? "None selected"}. Text and Memory follow it unless a Character or the Memory choice below says otherwise.</span>
            </div>
            <label className="settings-card">
              <strong>Memory API</strong>
              <Select aria-label="Memory API" value={memoryChoice} disabled={!bindingsReady || !!busy}
                onChange={(event) => {
                  const value = event.target.value === "" ? undefined : event.target.value === "off" ? null : event.target.value;
                  void run("Saving…", async () => { await commit((d) => setBindingField(d, {}, "memoryApiConfigId", value)); });
                }}>
                <option value="">Use Default API</option>
                {configs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
                <option value="off">Off · do not run Memory</option>
              </Select>
              <span role="status">{memoryStatus}</span>
              <small>A Character that has its own API in Settings → Bindings keeps it.</small>
            </label>
          </section>
          <button
            className="settings-button settings-page-add"
            type="button"
            aria-label="Create Text API"
            disabled={!ready || !!busy}
            onClick={addConfig}
          >
            Add provider
          </button>
          <div className="settings-config-grid" aria-label="Text API configs">
            {configs.map((config) => (
              <button
                className="settings-config-card"
                key={config.id}
                onClick={() => edit({ ...config })}
                aria-label={`Edit ${config.name}`}
              >
                <strong>{config.name}</strong>
                <span className="settings-config-model">{config.model}</span>
                <span className="settings-config-meta">
                  <span>{config.provider}</span>
                  {globalId === config.id && (
                    <span className="settings-badge">Default</span>
                  )}
                </span>
                <span className="settings-config-edit" aria-hidden="true">
                  Edit ↗
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {ready &&
        !configs.some((config) => config.id === globalId) &&
        !!configs.length && (
          <Alert>
            No default selected. Open a saved config and choose “Use as
            default”.
          </Alert>
        )}
      {!draft && feedback}
    </PageShell>
  );
}
