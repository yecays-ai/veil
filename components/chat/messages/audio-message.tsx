"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import type { ChatMessage } from "../../../lib/chat/types";
import { chatEngine } from "../../../lib/chat/engine";
import { subscribeTranscriptions, transcriptionStatus } from "../../../lib/chat/transcription-job";
import { claimSound, clock } from "./voice-message";
import { useAttachmentUrl } from "./image-message";

/** A voice message the user recorded: it plays its own recording, and its words (the transcript) are one tap away. */
export function AudioMessage({ message, multiSelect, showText = false }: { message: ChatMessage; multiSelect: boolean; showText?: boolean }) {
  const attachment = message.attachment?.kind === "audio" ? message.attachment : undefined;
  const url = useAttachmentUrl(message.sessionId, message.id, attachment?.assetId);
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [fresh, setFresh] = useState(() => Date.now() - message.createdAt < 5000);
  useEffect(() => { if (!fresh) return; const timer = window.setTimeout(() => setFresh(false), 5000); return () => window.clearTimeout(timer); }, [fresh]);
  const status = useSyncExternalStore(subscribeTranscriptions, () => transcriptionStatus(message.id), () => "idle");
  useEffect(() => () => { audio.current?.pause(); audio.current = null; }, [url]);
  if (!attachment) return null;

  async function toggle(event: React.MouseEvent) {
    if (multiSelect || !url) return;
    event.stopPropagation();
    if (!audio.current) {
      const made = new Audio(url);
      made.onended = () => { setPlaying(false); made.currentTime = 0; };
      audio.current = made;
    }
    const current = audio.current;
    if (playing) { current.pause(); setPlaying(false); return; }
    claimSound(() => { current.pause(); setPlaying(false); });
    setFailed(false);
    try { await current.play(); setPlaying(true); } catch { setFailed(true); setPlaying(false); }
  }

  const waiting = attachment.untranscribed === true;
  // A message just sent is still being handed to the job; only an older one with no job running has really not been written out.
  const writing = status === "running" || (status === "idle" && fresh);
  const reason = status.startsWith("error:") ? status.slice(6) : "";
  const retry = (event: React.MouseEvent) => { event.stopPropagation(); if (!multiSelect) void chatEngine.retryTranscription(message.sessionId, message.id); };

  return <span className="chat-voice">
    <span className="chat-voice-row">
      <button type="button" className="chat-voice-button" aria-label={playing ? "Pause voice message" : "Play voice message"}
        disabled={url === false} onClick={(event) => void toggle(event)}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <span className="chat-voice-wave" data-phase={playing ? "playing" : "idle"} aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span className="chat-voice-time">{clock(attachment.durationMs / 1000)}</span>
    </span>
    {waiting && writing && <span className="chat-voice-note" aria-live="polite">Transcribing…</span>}
    {waiting && !writing && <span className="chat-voice-error" role="status">
      Transcription failed{reason ? `. ${reason}` : ""}{" "}
      <button type="button" className="chat-voice-toggle" onClick={retry}>Retry</button>
    </span>}
    {showText && !waiting && <span className="chat-voice-text">{message.content}</span>}
    {(failed || url === false) && <span className="chat-voice-error" aria-live="polite">{url === false ? "This recording is no longer available." : "Could not play this recording."}</span>}
  </span>;
}
