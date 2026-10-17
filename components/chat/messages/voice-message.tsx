"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { chatStorage } from "../../../lib/chat/storage";
import type { ChatMessage } from "../../../lib/chat/types";
import { resolveScopeBindings } from "../../../lib/bindings";
import { browserTtsConfigStorage } from "../../../lib/tts/config-storage";
import { resolveVoice } from "../../../lib/tts/config";
import { TtsError, ttsErrorMessage } from "../../../lib/tts/speech";
import { sweepVoiceCache, voiceAudio } from "../../../lib/tts/voice-cache";
import { useBindings } from "../../use-bindings";

type Phase = "idle" | "loading" | "playing" | "paused";
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
/** Only one voice bubble sounds at a time: starting one stops the one before it. */
let stopSounding: (() => void) | null = null;

/** A Character's voice bubble. The sound is made when it is first tapped, kept for later, and the words are one tap away. The list keys it by its words, so edited words start a fresh bubble. */
export function VoiceMessage({ message, text, characterId, multiSelect }: { message: ChatMessage; text: string; characterId: string; multiSelect: boolean }) {
  const { bindings } = useBindings();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState<number | null>(null);
  const [showText, setShowText] = useState(false);
  const player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const mounted = useRef(true), run = useRef(0);
  const release = () => {
    const current = player.current;
    player.current = null;
    if (!current) return;
    current.audio.pause();
    URL.revokeObjectURL(current.url);
  };
  useEffect(() => {
    const runs = run;
    mounted.current = true;
    return () => { mounted.current = false; runs.current++; release(); };
  }, []);

  async function toggle(event: React.MouseEvent) {
    if (multiSelect) return;
    event.stopPropagation();
    const current = player.current;
    if (current && phase === "playing") { current.audio.pause(); setPhase("paused"); return; }
    if (current && phase === "paused") { stopSounding?.(); stopSounding = stop; void current.audio.play(); setPhase("playing"); return; }
    if (phase === "loading") return;
    const attempt = ++run.current;
    setError(""); setPhase("loading");
    try {
      const config = await browserTtsConfigStorage.load();
      await sweepVoiceCache((ids) => chatStorage.listVoiceMessageIds(ids));
      const voice = resolveVoice(resolveScopeBindings(bindings, { characterId }), config);
      const blob = await voiceAudio({ messageId: message.id, text: message.content, voice, config });
      if (!mounted.current || attempt !== run.current) return;
      release();
      const url = URL.createObjectURL(blob), audio = new Audio(url);
      audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration)) setSeconds(audio.duration); };
      audio.onended = () => { setPhase("idle"); audio.currentTime = 0; };
      player.current = { audio, url };
      stopSounding?.(); stopSounding = stop;
      await audio.play();
      if (mounted.current && attempt === run.current) setPhase("playing");
    } catch (err) {
      if (!mounted.current || attempt !== run.current) return;
      release(); setPhase("idle"); setError(err instanceof Error && !(err instanceof TtsError) ? err.message : ttsErrorMessage(err));
    }
  }
  function stop() { player.current?.audio.pause(); if (mounted.current) setPhase((now) => now === "playing" ? "paused" : now); }

  return <span className="chat-voice">
    <span className="chat-voice-row">
      <button type="button" className="chat-voice-button" aria-label={phase === "playing" ? "Pause voice message" : "Play voice message"}
        aria-busy={phase === "loading"} onClick={(event) => void toggle(event)}>
        {phase === "playing" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <span className="chat-voice-wave" data-phase={phase} aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span className="chat-voice-time">{phase === "loading" ? "…" : seconds === null ? "Voice" : clock(seconds)}</span>
      <button type="button" className="chat-voice-toggle" aria-expanded={showText}
        onClick={(event) => { if (multiSelect) return; event.stopPropagation(); setShowText((open) => !open); }}>{showText ? "Hide text" : "Text"}</button>
    </span>
    {showText && <span className="chat-voice-text">{text}</span>}
    {error && <span className="chat-voice-error" aria-live="polite">{error}</span>}
  </span>;
}
