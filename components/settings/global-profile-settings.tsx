"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useFoundation } from "../foundation-provider";
import { ImageCropDialog } from "../image-crop-dialog";
import { Switch } from "./ui/switch";
import { chatStorage } from "../../lib/chat/storage";
import { bubbleDelayMsPerCharacterFromInput } from "../../lib/chat/bubble-pacing";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "../../lib/chat/background";
import { readImage } from "../../lib/theme-storage";
import { normalizeBackgroundBlur, normalizeBubbleDelayMsPerCharacter, type ChatBackgroundSettings,
  type GlobalProfileSettings } from "../../lib/chat/types";

export function GlobalProfileSettings() {
  const { ready } = useFoundation();
  const [settings, setSettings] = useState<GlobalProfileSettings | null>(null);
  const [timingCharacters, setTimingCharacters] = useState("20");
  const [timingSeconds, setTimingSeconds] = useState("0.3");
  const timingInitialized = useRef(false);
  const [background, setBackground] = useState<ChatBackgroundSettings>({ id: "chat-background" });
  const [preview, setPreview] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [profile, chat] = await Promise.all([chatStorage.readGlobalProfileSettings(), chatStorage.readChatBackgroundSettings()]);
      if (active) {
        setSettings(profile); setBackground(chat);
        if (!timingInitialized.current) {
          const seconds = 20 * normalizeBubbleDelayMsPerCharacter(profile.bubbleDelayMsPerCharacter) / 1000;
          setTimingSeconds(Number(seconds.toPrecision(8)).toString());
          timingInitialized.current = true;
        }
      }
    };
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Settings could not be loaded."));
    const unsubscribe = chatStorage.subscribe(() => void refresh().catch(() => {}));
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void (async () => {
      const blob = background.globalChatBackgroundImage
        ? await getChatImageFromIndexedDB(background.globalChatBackgroundImage) : null;
      if (!active) return;
      if (blob) { url = URL.createObjectURL(blob); setPreview(url); }
      else setPreview(null);
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [background.globalChatBackgroundImage]);

  async function saveCrop(value: string) {
    setBusy(true); setError("");
    let id: string | undefined;
    try {
      id = await saveChatImageToIndexedDB(await (await fetch(value)).blob());
      await chatStorage.updateGlobalChatBackground(id);
      setCropSource(null);
    } catch (reason) {
      if (id) await chatStorage.deleteChatImageIfUnused(id);
      setError(reason instanceof Error ? reason.message : "Chat background could not be saved.");
    } finally { setBusy(false); }
  }

  async function clearGlobalBackground() {
    setBusy(true); setError("");
    try { await chatStorage.updateGlobalChatBackground(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Global background could not be cleared."); }
    finally { setBusy(false); }
  }

  async function saveBubbleTiming() {
    const characters = Number(timingCharacters);
    const seconds = Number(timingSeconds);
    const bubbleDelayMsPerCharacter = bubbleDelayMsPerCharacterFromInput(characters, seconds);
    if (bubbleDelayMsPerCharacter === null) {
      setError("Enter a positive whole number of characters and a positive number of seconds.");
      return;
    }
    setBusy(true); setError("");
    try {
      await chatStorage.updateBubbleDelayMsPerCharacter(bubbleDelayMsPerCharacter);
      setSettings(await chatStorage.readGlobalProfileSettings());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Timing could not be saved.");
    } finally { setBusy(false); }
  }

  return <>
    <section className="global-profile-section">
      <h2 className="settings-section-label">Global Chat Background</h2>
      <div className="global-background-card">
        <div className="global-background-preview" aria-label="Global chat background preview">
          {preview ? <div aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(preview)})`,
            filter: `blur(${normalizeBackgroundBlur(background.blur)}px)` }} /> : <ImageIcon aria-hidden="true" />}
        </div>
        <div className="global-background-actions">
          <label className="settings-button">Choose Global Background
            <input hidden type="file" accept="image/*" disabled={!ready || busy} onChange={(event) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
              if (file) void readImage(file).then(setCropSource).catch((reason) => setError(reason instanceof Error ? reason.message : "Image could not be opened."));
            }} />
          </label>
          {background.globalChatBackgroundImage && <button className="settings-button" disabled={busy}
            onClick={() => void clearGlobalBackground()}>Clear Global Background</button>}
        </div>
        <label className="global-background-blur">Global blur ({normalizeBackgroundBlur(background.blur)}px)
          <input type="range" min="0" max="20" step="1" disabled={busy}
            value={normalizeBackgroundBlur(background.blur)} onChange={(event) => {
              const blur = Number(event.currentTarget.value);
              setBackground((current) => ({ ...current, blur }));
              void chatStorage.updateGlobalChatBackgroundBlur(blur).catch((reason) => setError(reason instanceof Error ? reason.message : "Blur could not be saved."));
            }} />
        </label>
        <small>Conversations use this background unless they have their own override.</small>
      </div>
    </section>

    <section className="global-profile-section">
      <h2 className="settings-section-label">Message Bubble Timing</h2>
      <div className="global-timing-fields">
        <label className="global-timing-row"><span>Characters</span>
          <input className="settings-input" aria-label="Characters" type="number" inputMode="numeric" min="1" step="1"
            value={timingCharacters} disabled={!settings || busy} onChange={(event) => setTimingCharacters(event.currentTarget.value)} />
        </label>
        <label className="global-timing-row"><span>Seconds</span>
          <input className="settings-input" aria-label="Seconds" type="number" inputMode="decimal" min="0.001" step="any"
            value={timingSeconds} disabled={!settings || busy} onChange={(event) => setTimingSeconds(event.currentTarget.value)} />
        </label>
        <small>Set how many seconds the selected number of characters take to appear. Default: 20 characters in 0.3 seconds.</small>
        <button className="settings-button global-timing-save" type="button" disabled={!settings || busy}
          onClick={() => void saveBubbleTiming()}>{busy ? "Saving…" : "Save Timing"}</button>
      </div>
    </section>

    <section className="global-profile-section">
      <h2 className="settings-section-label">Here &amp; There Comments</h2>
      <label className="settings-runtime-toggle">
        <span><strong>Here &amp; There Comments</strong><small>Allow occasional short Character remarks about the local time and weather.</small></span>
        <Switch checked={settings?.hereThereEnabled ?? true} disabled={!settings || busy}
          onChange={async (enabled) => {
            setBusy(true); setError("");
            try {
              await chatStorage.updateHereThereEnabled(enabled);
              setSettings(await chatStorage.readGlobalProfileSettings());
            } catch (reason) { setError(reason instanceof Error ? reason.message : "Setting could not be saved."); }
            finally { setBusy(false); }
          }} />
      </label>
    </section>
    {error && <p className="settings-alert" role="alert">{error}</p>}
    {cropSource && <ImageCropDialog source={cropSource} shape="portrait" title="Adjust chat background"
      onSave={saveCrop} onCancel={() => setCropSource(null)} />}
  </>;
}
