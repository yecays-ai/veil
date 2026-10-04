"use client";
import { PageShell } from "../page-shell";
import { BottomSheet, ConfirmDialog } from "./ui/modal";
import { Input, Select } from "./ui/form";
import { Alert } from "./ui/feedback";
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
  const [discarding, setDiscarding] = useState(false);
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
    setDiscarding(false);
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
      await chatStorage.saveApiConfig(next);
      setConfigs(await chatStorage.listApiConfigs());
      setDraft(next);
      setConnection("");
      setNotice("Saved. Connection has not been tested.");
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
      {error && <Alert variant="danger">{error}</Alert>}
    </>
  );
  return (
    <PageShell
      className="settings-app"
      title="Text API"
      backHref="/settings"
      backLabel="Back to Settings"
      rightAction={
        <button
          className="settings-header-action"
          aria-label="Create Text API"
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
          <span aria-hidden="true">＋</span> Add
        </button>
      }
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
                      !foundationReady ||
                      globalId === draft.id
                    }
                    onClick={() =>
                      void run("Selecting…", async () => {
                        await commit((d) => ({
                          ...d,
                          bindings: {
                            ...d.bindings,
                            global: {
                              ...d.bindings.global,
                              apiConfigId: draft.id,
                            },
                          },
                        }));
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
                    await chatStorage.deleteApiConfig(draft.id);
                    setConfigs(await chatStorage.listApiConfigs());
                    edit(null);
                  })
                }
              >
                Delete “{draft.name}”?{" "}
                {apiConfigReferences(document.bindings, draft.id).length}{" "}
                explicit binding reference(s)
                {globalId === draft.id ? ", including the current default" : ""}
                . Referenced chats will stop working until a replacement is
                explicitly selected. Bindings will not be redirected.
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
      {ready && !configs.length && (
        <div className="settings-empty">
          <span className="settings-card-icon" aria-hidden="true">
            Aa
          </span>
          <h2>No Text APIs yet</h2>
          <p>Add a provider and model to start a conversation.</p>
        </div>
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
      <p className="settings-hint">
        Credentials stay in this browser. Your provider must allow direct
        browser access (CORS).
      </p>
    </PageShell>
  );
}
