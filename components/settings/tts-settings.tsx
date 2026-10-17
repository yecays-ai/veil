"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "../page-shell";
import { useBindings } from "../use-bindings";
import { useFoundation } from "../foundation-provider";
import { Alert } from "./ui/feedback";
import { Input, Select } from "./ui/form";
import { setBindingField, resolveScopeBindings } from "../../lib/bindings";
import { browserTtsConfigStorage } from "../../lib/tts/config-storage";
import { DEFAULT_TTS_BASE_URL, EMPTY_TTS_CONFIG, providerOf, resolveVoice, ttsConfigProblem, TTS_PROVIDERS, type TtsConfig, type TtsProvider } from "../../lib/tts/config";
import { synthesizeSpeech, ttsErrorMessage } from "../../lib/tts/speech";

const SAMPLE = "你好，这是一条试听。Hello, this is a preview.";
const MODEL_HINT: Record<TtsProvider, string> = { openai: "tts-1", minimax: "speech-2.8-hd", elevenlabs: "eleven_multilingual_v2" };

export function TtsSettings() {
  const { bindings, ready: bindingsReady, error: bindingError, commit } = useBindings();
  const { document: foundation } = useFoundation();
  const [saved, setSaved] = useState<TtsConfig | null>(null);
  const [draft, setDraft] = useState<TtsConfig>(EMPTY_TTS_CONFIG);
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(false), request = useRef<AbortController | null>(null), player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const stopPlayback = useCallback(() => {
    const current = player.current;
    player.current = null;
    if (!current) return;
    current.audio.pause();
    URL.revokeObjectURL(current.url);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void browserTtsConfigStorage.load().then((config) => {
      if (!mounted.current) return;
      setSaved(config); setDraft(config);
    }).catch(() => { if (mounted.current) setError("Could not load Voice settings. Saved settings have not been changed."); });
    return () => { mounted.current = false; request.current?.abort(); stopPlayback(); };
  }, [stopPlayback]);

  const provider = providerOf(draft);
  const unchanged = !!saved && JSON.stringify(saved) === JSON.stringify(draft);
  const update = (patch: Partial<TtsConfig>) => { setDraft((current) => ({ ...current, ...patch })); setNotice(""); setError(""); };
  async function run(action: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try { await work(); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "The operation failed."); }
    finally { if (mounted.current) setBusy(""); }
  }
  const save = () => run("Saving…", async () => {
    const problem = ttsConfigProblem(draft);
    if (problem) throw new Error(problem);
    const next = await browserTtsConfigStorage.save(draft);
    if (mounted.current) { setSaved(next); setDraft(next); setNotice("Saved on this device. The key is not included in backups."); }
  });
  const clear = () => run("Clearing…", async () => {
    await browserTtsConfigStorage.clear();
    if (mounted.current) { setSaved(EMPTY_TTS_CONFIG); setDraft(EMPTY_TTS_CONFIG); setNotice("Voice settings cleared."); }
  });
  // A preview is one request with the values on screen (saved or not); a new one replaces the one still running.
  const preview = (voice: string, label: string) => {
    request.current?.abort(); stopPlayback();
    const controller = new AbortController();
    request.current = controller;
    return run(label, async () => {
      try {
        const blob = await synthesizeSpeech(draft, { text: SAMPLE, voice }, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        const url = URL.createObjectURL(blob), audio = new Audio(url);
        audio.onended = stopPlayback;
        player.current = { audio, url };
        await audio.play();
      } catch (err) {
        if (controller.signal.aborted) return;
        stopPlayback();
        throw new Error(ttsErrorMessage(err));
      } finally { if (request.current === controller) request.current = null; }
    });
  };
  const saveVoice = (characterId: string, value: string) => commit((current) =>
    setBindingField(current, { characterId }, "ttsVoice", value.trim() || undefined))
    .then(() => setVoices((rows) => { const next = { ...rows }; delete next[characterId]; return next; }))
    .catch(() => setError("Could not save this voice. Nothing was changed."));
  const characters = foundation.characters;
  const globalVoice = resolveScopeBindings(bindings, {}).ttsVoice;

  return (
    <PageShell className="settings-app" title="Voice (TTS)" backHref="/settings" backLabel="Back to Settings">
      {!saved && !error && <Alert>Loading Voice settings…</Alert>}
      <form className="settings-editor" autoComplete="off" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Provider
          <Select value={provider} disabled={!saved || !!busy}
            onChange={(e) => { const next = e.target.value as TtsProvider; update({ provider: next === "openai" ? undefined : next, baseUrl: "" }); }}>
            {TTS_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
        </label>
        <label>{provider === "openai" ? "Base URL" : "Base URL (optional)"}
          <Input type="url" required={provider === "openai"} placeholder={provider === "openai" ? "https://api.example.com/v1" : DEFAULT_TTS_BASE_URL[provider]}
            value={draft.baseUrl} disabled={!saved || !!busy} onChange={(e) => update({ baseUrl: e.target.value })} />
        </label>
        <label>API Key
          <Input type="password" required autoComplete="new-password" value={draft.apiKey} disabled={!saved || !!busy}
            onChange={(e) => update({ apiKey: e.target.value })} />
        </label>
        <label>Model
          <Input required placeholder={MODEL_HINT[provider]} value={draft.model} disabled={!saved || !!busy}
            onChange={(e) => update({ model: e.target.value })} />
        </label>
        <label>{provider === "openai" ? "Default voice" : "Default voice ID"}
          <Input placeholder={provider === "openai" ? "alloy" : "voice_id from your account"} value={draft.voice} disabled={!saved || !!busy}
            onChange={(e) => update({ voice: e.target.value })} />
        </label>
        <strong>Speech-to-text (optional)</strong>
        <p className="settings-hint">Writes out the voice messages you record. It is an OpenAI-compatible service of its own{provider === "openai" ? "; leave the address and key empty to use the service above" : ""}.</p>
        <label>Model
          <Input placeholder="whisper-1" value={draft.sttModel ?? ""} disabled={!saved || !!busy}
            onChange={(e) => update({ sttModel: e.target.value })} />
        </label>
        <label>Base URL
          <Input type="url" placeholder="https://api.example.com/v1" value={draft.sttBaseUrl ?? ""} disabled={!saved || !!busy}
            onChange={(e) => update({ sttBaseUrl: e.target.value })} />
        </label>
        <label>API Key
          <Input type="password" autoComplete="new-password" value={draft.sttApiKey ?? ""} disabled={!saved || !!busy}
            onChange={(e) => update({ sttApiKey: e.target.value })} />
        </label>
        <div className="settings-action-row">
          <button className="settings-button" type="submit" disabled={!saved || !!busy || unchanged}>{busy === "Saving…" ? busy : "Save"}</button>
          <button className="settings-button" type="button" disabled={!saved || !!busy || !!ttsConfigProblem(draft)}
            onClick={() => void preview(resolveVoice({ ttsVoice: globalVoice }, draft), "Previewing…")}>
            {busy === "Previewing…" ? busy : "Preview voice"}
          </button>
          <button className="settings-button settings-danger" type="button" disabled={!saved || !!busy} onClick={() => void clear()}>Clear</button>
        </div>
        <p className="settings-hint">{unchanged ? "Saved" : "Unsaved changes"}. Preview uses the values above and does not save them. The key stays on this device and is not included in backups.</p>
      </form>
      {!!characters.length && (
        <section className="settings-editor" aria-label="Character voices">
          <strong>Character voices</strong>
          <p className="settings-hint">A voice set here is used for that Character instead of the default voice above.</p>
          {characters.map((character) => {
            const own = resolveScopeBindings(bindings, { characterId: character.characterId }).ttsVoice;
            const shown = voices[character.characterId] ?? (bindings.characters[character.characterId]?.defaults.ttsVoice ?? "");
            return (
              <div key={character.characterId} className="settings-action-row">
                <label>{character.name}
                  <Input placeholder={resolveVoice({ ttsVoice: globalVoice }, draft) || "voice ID"} value={shown} disabled={!bindingsReady}
                    onChange={(e) => setVoices((rows) => ({ ...rows, [character.characterId]: e.target.value }))}
                    onBlur={() => { if (voices[character.characterId] !== undefined) void saveVoice(character.characterId, voices[character.characterId]); }} />
                </label>
                <button className="settings-button" type="button" disabled={!!busy || !!ttsConfigProblem(draft)}
                  aria-label={`Preview ${character.name}'s voice`}
                  onClick={() => void preview(resolveVoice({ ttsVoice: voices[character.characterId]?.trim() || own }, draft), `Previewing ${character.name}…`)}>
                  {busy === `Previewing ${character.name}…` ? "Previewing…" : "Preview"}
                </button>
              </div>
            );
          })}
        </section>
      )}
      {notice && <Alert>{notice}</Alert>}
      {(error || bindingError) && <Alert variant="danger">{error || bindingError}</Alert>}
    </PageShell>
  );
}
