"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chatStorage } from "../../lib/chat/storage";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../../lib/chat/types";
import { validateApiConfig } from "../../lib/chat/provider";

export function ChatApiSettings() {
  const [config, setConfig] = useState<ApiConfig>({
    id: DEFAULT_API_CONFIG_ID,
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    chatStorage
      .getApiConfig()
      .then((saved) => {
        if (active) {
          if (saved) setConfig(saved);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Could not load API settings. Saved credentials have not been changed.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="chat-app chat-api-settings">
      <Link className="back-link" href="/messages">
        ‹ Messages
      </Link>
      <h1>Text API</h1>
      <p>
        Use an OpenAI-compatible text provider. These settings are stored only
        in this browser, separately from profiles and themes. Requests go
        directly to your provider, which must allow browser access (CORS).
      </p>
      <form
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || saving) return;
          setSaving(true);
          setError("");
          setNotice("");
          try {
            validateApiConfig(config);
            await chatStorage.saveApiConfig({
              ...config,
              baseUrl: config.baseUrl.trim(),
              model: config.model.trim(),
              apiKey: config.apiKey.trim(),
            });
            setNotice("API settings saved.");
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not save API settings.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Base URL
          <input
            type="url"
            required
            placeholder="https://your-provider.example/v1"
            value={config.baseUrl}
            disabled={!ready || saving}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            required
            autoComplete="new-password"
            value={config.apiKey}
            disabled={!ready || saving}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          />
        </label>
        <label>
          Model
          <input
            required
            placeholder="Model name"
            value={config.model}
            disabled={!ready || saving}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
        </label>
        <button disabled={!ready || saving} type="submit">
          {saving ? "Saving…" : "Save API settings"}
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
