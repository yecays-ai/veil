"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Image as ImageIcon } from "lucide-react";
import { useFoundation } from "../foundation-provider";
import { ImageCropDialog } from "../image-crop-dialog";
import { Switch } from "./ui/switch";
import { chatStorage } from "../../lib/chat/storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "../../lib/chat/background";
import { readImage } from "../../lib/theme-storage";
import { normalizeBackgroundBlur, isValidBubbleTimingDelay, DEFAULT_BUBBLE_TIMING, type BubbleTiming, type ChatBackgroundSettings,
  type GlobalProfileSettings } from "../../lib/chat/types";

export function GlobalProfileSettings() {
  const { ready } = useFoundation();
  const [settings, setSettings] = useState<GlobalProfileSettings | null>(null);
  const [background, setBackground] = useState<ChatBackgroundSettings>({ id: "chat-background" });
  const [preview, setPreview] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backgroundExpanded, setBackgroundExpanded] = useState(false);
  const [timingExpanded, setTimingExpanded] = useState(false);
  const mounted = useRef(false);
  const fileRevision = useRef(0);
  const blurRevision = useRef(0);
  const reloadBackground = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    let backgroundRevision = 0;
    const refreshProfile = async () => {
      const profile = await chatStorage.readGlobalProfileSettings();
      if (active) setSettings(profile);
    };
    const refreshBackground = async () => {
      const revision = ++backgroundRevision;
      const chat = await chatStorage.readChatBackgroundSettings();
      if (active && revision === backgroundRevision) setBackground(chat);
    };
    reloadBackground.current = refreshBackground;
    const invalidateSelections = () => { fileRevision.current++; blurRevision.current++; };
    void Promise.all([refreshProfile(), refreshBackground()])
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Settings could not be loaded."); });
    const unsubscribe = chatStorage.subscribe((change) => {
      if (change.domain === "global-profile") void refreshProfile().catch(() => {});
      if (change.domain === "chat-background") void refreshBackground().catch(() => {});
    });
    return () => {
      active = false; mounted.current = false; invalidateSelections();
      reloadBackground.current = null; unsubscribe();
    };
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
    })().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Background preview could not be loaded."); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [background.globalChatBackgroundImage]);

  async function saveCrop(value: string) {
    fileRevision.current++;
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
    fileRevision.current++;
    setBusy(true); setError("");
    try { await chatStorage.updateGlobalChatBackground(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Global background could not be cleared."); }
    finally { setBusy(false); }
  }

  async function chooseBackground(file: File) {
    const revision = ++fileRevision.current;
    setError("");
    try {
      const source = await readImage(file);
      if (mounted.current && revision === fileRevision.current) setCropSource(source);
    } catch (reason) {
      if (mounted.current && revision === fileRevision.current)
        setError(reason instanceof Error ? reason.message : "Image could not be opened.");
    }
  }

  async function saveBackgroundBlur(blur: number) {
    const revision = ++blurRevision.current;
    setError("");
    try {
      await chatStorage.updateGlobalChatBackgroundBlur(blur);
      if (mounted.current && revision === blurRevision.current) await reloadBackground.current?.();
    } catch (reason) {
      if (mounted.current && revision === blurRevision.current) {
        await reloadBackground.current?.().catch(() => {});
        if (mounted.current && revision === blurRevision.current)
          setError(reason instanceof Error ? reason.message : "Blur could not be saved.");
      }
    }
  }

  async function saveBubbleTiming(tier: keyof BubbleTiming, raw: string) {
    const delayMs = Number(raw) * 1000;
    if (!isValidBubbleTimingDelay(delayMs)) {
      setError("Use a delay greater than 0 and at most 60 seconds.");
      return;
    }
    setError("");
    try {
      await chatStorage.updateBubbleTiming({ [tier]: delayMs });
      setSettings(await chatStorage.readGlobalProfileSettings());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Timing could not be saved.");
    }
  }

  return <>
    <div className="global-profile-settings-list">
      <section className="chat-info-group profile-chat-settings-group" aria-label="Profile chat settings">
        <div className="global-profile-disclosure global-chat-disclosure-panel">
        <button type="button" className="chat-session-setting chat-info-row global-profile-disclosure-row" aria-expanded={backgroundExpanded}
          onClick={() => setBackgroundExpanded((expanded) => !expanded)}>
          <span>Global Chat Background</span>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
        {backgroundExpanded && <div className="global-profile-disclosure-content">
          <div className="global-background-card">
            <div className="global-background-preview" aria-label="Global chat background preview">
              {preview ? <div aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(preview)})`,
                filter: `blur(${normalizeBackgroundBlur(background.blur)}px)` }} /> : <ImageIcon aria-hidden="true" />}
            </div>
            <div className="global-background-actions">
              <label className="settings-button">Choose Global Background
                <input hidden type="file" accept="image/*" disabled={!ready || busy} onChange={(event) => {
                  const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
                  if (file) void chooseBackground(file);
                }} />
              </label>
              {background.globalChatBackgroundImage && <button className="settings-button" disabled={busy}
                onClick={() => void clearGlobalBackground()}>Clear Global Background</button>}
            </div>
            <label className="global-background-blur">Global blur ({normalizeBackgroundBlur(background.blur)}px)
              <input type="range" min="0" max="20" step="1" disabled={busy}
                value={normalizeBackgroundBlur(background.blur)} onChange={(event) => {
                  const blur = Number(event.currentTarget.value);
                  void saveBackgroundBlur(blur);
                }} />
            </label>
            <small>Conversations use this background unless they have their own override.</small>
          </div>
        </div>}
        </div>

        <div className="global-profile-disclosure global-chat-disclosure-panel">
        <button type="button" className="chat-session-setting chat-info-row global-profile-disclosure-row" aria-expanded={timingExpanded}
          onClick={() => setTimingExpanded((expanded) => !expanded)}>
          <span>Message Bubble Timing</span>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
        {timingExpanded && <div className="global-profile-disclosure-content">
          <div className="global-timing-fields">
            {([{ tier: "shortMs", label: "1–60 characters" }, { tier: "mediumMs", label: "61–200 characters" },
              { tier: "longMs", label: "200+ characters" }] as const).map(({ tier, label }) => {
              const delayMs = settings?.bubbleTiming[tier] ?? DEFAULT_BUBBLE_TIMING[tier];
              return <label className="global-timing-row" key={tier}><span>{label}</span>
                <span className="global-timing-value"><input key={delayMs} className="settings-input" aria-label={`${label} seconds`}
                  type="number" inputMode="decimal" min="0.001" max="60" step="any" defaultValue={delayMs / 1000}
                  disabled={!settings || busy} onBlur={(event) => void saveBubbleTiming(tier, event.currentTarget.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> seconds</span>
              </label>;
            })}
          </div>
        </div>}
        </div>

        <label className="chat-session-setting chat-info-toggle global-here-there-toggle">
          <strong>Here &amp; There Comments</strong>
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
    </div>
    {error && <p className="settings-alert" role="alert">{error}</p>}
    {cropSource && <ImageCropDialog source={cropSource} shape="portrait" title="Adjust chat background"
      onSave={saveCrop} onCancel={() => { fileRevision.current++; setCropSource(null); }} />}
  </>;
}
