"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_RECORDING_MS } from "../../lib/chat/attachment";
import { startVoiceRecording, VoiceRecordError, type Recording, type VoiceRecorder } from "../../lib/chat/voice-recorder";

export type VoiceMode = "off" | "ready" | "recording";

/**
 * The composer's voice mode. "ready" waits for a tap, "recording" is a recording in progress, and a tap during it stops
 * the recording and sends it, after which the mode is "ready" again so the next message is one tap away. Only the
 * person leaves the mode, and a cancelled recording is dropped without a trace.
 */
export function useVoiceMode({ disabled, onSend }: { disabled: boolean; onSend: (recording: Recording) => Promise<void> }) {
  const [mode, setMode] = useState<VoiceMode>("off");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<VoiceRecorder | null>(null), timer = useRef<number | null>(null), mounted = useRef(true);
  const busy = useRef(false), send = useRef(onSend);
  useEffect(() => { send.current = onSend; });

  const clearTimer = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      recorder.current?.cancel(); recorder.current = null;
    };
  }, []);

  const finish = useCallback(async () => {
    const active = recorder.current;
    if (!active) return;
    recorder.current = null; clearTimer();
    setMode("ready"); // the bar is ready for the next message at once
    busy.current = true;
    try {
      const made = await active.stop();
      await send.current(made);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "The voice message was not sent.");
    } finally { busy.current = false; }
  }, []);

  const begin = useCallback(async () => {
    if (busy.current || recorder.current) return;
    busy.current = true; setError("");
    try { recorder.current = await startVoiceRecording(); }
    catch (reason) {
      busy.current = false;
      if (mounted.current) setError(reason instanceof VoiceRecordError ? reason.message : "Could not start recording.");
      return;
    }
    busy.current = false;
    if (!mounted.current) { recorder.current.cancel(); recorder.current = null; return; }
    const started = performance.now();
    setElapsed(0); setMode("recording");
    timer.current = window.setInterval(() => {
      const ms = performance.now() - started;
      setElapsed(ms);
      if (ms >= MAX_VOICE_RECORDING_MS) void finish();
    }, 200);
  }, [finish]);

  return {
    mode, elapsed, error,
    /** The first tap on the microphone only enters voice mode; nothing is recorded yet. */
    enter: () => { if (mode === "off") { setError(""); setMode("ready"); } },
    /** Back to typing. Not while recording. */
    exit: () => { if (mode === "ready") { setError(""); setMode("off"); } },
    /** The big bar: starts a recording, or stops the one in progress and sends it. */
    tap: () => { if (disabled && mode !== "recording") return; if (mode === "ready") void begin(); else if (mode === "recording") void finish(); },
    /** Drops the recording in progress and waits for the next tap. */
    cancel: () => {
      if (mode !== "recording") return;
      recorder.current?.cancel(); recorder.current = null; clearTimer();
      setError(""); setMode("ready");
    },
  };
}
