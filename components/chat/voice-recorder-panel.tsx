"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { MAX_VOICE_RECORDING_MS } from "../../lib/chat/attachment";
import { VOICE_TRANSCRIPT_MAX } from "../../lib/chat/storage";
import { startVoiceRecording, VoiceRecordError, type Recording, type VoiceRecorder } from "../../lib/chat/voice-recorder";
import { browserTtsConfigStorage } from "../../lib/tts/config-storage";
import { ttsConfigProblem } from "../../lib/tts/config";
import { TtsError, ttsErrorMessage } from "../../lib/tts/speech";
import { transcribeAudio } from "../../lib/tts/transcribe";
import { clock } from "./messages/voice-message";

type Step = "idle" | "recording" | "review";

/**
 * Record a voice message, listen to it, check or write its words, then send. The words matter: they are what the
 * Character reads, so a message cannot be sent without them. With a speech-to-text model set in Voice settings the
 * words are filled in from one request made after recording; otherwise the person writes them.
 */
export function VoiceRecorderPanel({ disabled, onSend, onClose }: {
  disabled: boolean; onSend: (recording: Recording, transcript: string) => Promise<void>; onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recorder = useRef<VoiceRecorder | null>(null), timer = useRef<number | null>(null);
  const transcription = useRef<AbortController | null>(null), mounted = useRef(true), preview = useRef("");

  const clearTimer = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearInterval(timer.current);
      recorder.current?.cancel(); recorder.current = null;
      transcription.current?.abort();
      if (preview.current) URL.revokeObjectURL(preview.current);
    };
  }, []);
  const dropPreview = () => { if (preview.current) URL.revokeObjectURL(preview.current); preview.current = ""; setPreviewUrl(""); };

  async function begin() {
    if (disabled || step !== "idle") return;
    setError("");
    try { recorder.current = await startVoiceRecording(); }
    catch (err) { if (mounted.current) setError(err instanceof VoiceRecordError ? err.message : "Could not start recording."); return; }
    if (!mounted.current) { recorder.current.cancel(); recorder.current = null; return; }
    const started = performance.now();
    setElapsed(0); setStep("recording");
    timer.current = window.setInterval(() => {
      const ms = performance.now() - started;
      setElapsed(ms);
      if (ms >= MAX_VOICE_RECORDING_MS) void finish();
    }, 200);
  }
  async function finish() {
    const active = recorder.current;
    if (!active) return;
    recorder.current = null; clearTimer();
    try {
      const made = await active.stop();
      if (!mounted.current) return;
      dropPreview();
      preview.current = URL.createObjectURL(made.blob); setPreviewUrl(preview.current);
      setRecording(made); setStep("review"); setTranscript(""); setStatus("");
      void fillWords(made);
    } catch (err) {
      if (mounted.current) { setStep("idle"); setError(err instanceof Error ? err.message : "The recording failed."); }
    }
  }
  function discard() {
    recorder.current?.cancel(); recorder.current = null; clearTimer();
    transcription.current?.abort();
    dropPreview(); setRecording(null); setTranscript(""); setStatus(""); setError(""); setStep("idle");
  }
  async function fillWords(made: Recording) {
    let config;
    try { config = await browserTtsConfigStorage.load(); } catch { return; }
    if (!config.sttModel?.trim() || ttsConfigProblem(config)) return;
    const controller = new AbortController();
    transcription.current?.abort();
    transcription.current = controller;
    setStatus("Writing out the words…");
    try {
      const text = await transcribeAudio(config, made.blob, controller.signal);
      if (!controller.signal.aborted && mounted.current) setTranscript((current) => current.trim() ? current : text.slice(0, VOICE_TRANSCRIPT_MAX));
      if (mounted.current && !controller.signal.aborted) setStatus("");
    } catch (err) {
      if (controller.signal.aborted || !mounted.current) return;
      setStatus(err instanceof TtsError ? ttsErrorMessage(err).replace("voice", "speech recognition") : "Could not write out the words. Type them below.");
    }
  }
  async function send() {
    if (!recording || busy || disabled || !transcript.trim()) return;
    setBusy(true); setError("");
    try {
      transcription.current?.abort();
      await onSend(recording, transcript);
      if (mounted.current) { dropPreview(); setRecording(null); setStep("idle"); onClose(); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "The voice message was not sent.");
    } finally { if (mounted.current) setBusy(false); }
  }

  return <div className="chat-tray chat-voice-recorder" role="group" aria-label="Record a voice message">
    {step === "idle" && <>
      <button type="button" className="chat-voice-record" disabled={disabled} onClick={() => void begin()}>
        <Mic aria-hidden="true" /><span>Tap to record</span>
      </button>
      <small>Up to {Math.round(MAX_VOICE_RECORDING_MS / 60000)} minutes.</small>
    </>}
    {step === "recording" && <>
      <button type="button" className="chat-voice-record" data-recording="true" onClick={() => void finish()}>
        <Square aria-hidden="true" /><span>Stop · {clock(elapsed / 1000)}</span>
      </button>
      <button type="button" className="chat-voice-toggle" onClick={discard}>Cancel</button>
    </>}
    {step === "review" && recording && <>
      {previewUrl && <audio controls src={previewUrl} aria-label="Your recording" />}
      <textarea aria-label="What this voice message says" placeholder="What does it say?" maxLength={VOICE_TRANSCRIPT_MAX}
        value={transcript} onChange={(event) => setTranscript(event.target.value)} />
      <div className="chat-voice-recorder-actions">
        <button type="button" className="chat-voice-toggle" disabled={busy} onClick={discard}>Discard</button>
        <button type="button" className="chat-voice-record" disabled={busy || disabled || !transcript.trim()} onClick={() => void send()}>Send</button>
      </div>
    </>}
    {status && <small aria-live="polite">{status}</small>}
    {error && <small className="chat-voice-error" role="alert">{error}</small>}
  </div>;
}
