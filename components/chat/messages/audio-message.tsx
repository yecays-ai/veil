"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { ChatMessage } from "../../../lib/chat/types";
import { claimSound, clock } from "./voice-message";
import { useAttachmentUrl } from "./image-message";

/** A voice message the user recorded: it plays its own recording, and its words (the transcript) are one tap away. */
export function AudioMessage({ message, multiSelect, showText = false }: { message: ChatMessage; multiSelect: boolean; showText?: boolean }) {
  const attachment = message.attachment?.kind === "audio" ? message.attachment : undefined;
  const url = useAttachmentUrl(message.sessionId, message.id, attachment?.assetId);
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
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

  return <span className="chat-voice">
    <span className="chat-voice-row">
      <button type="button" className="chat-voice-button" aria-label={playing ? "Pause voice message" : "Play voice message"}
        disabled={url === false} onClick={(event) => void toggle(event)}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <span className="chat-voice-wave" data-phase={playing ? "playing" : "idle"} aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span className="chat-voice-time">{clock(attachment.durationMs / 1000)}</span>
    </span>
    {showText && <span className="chat-voice-text">{message.content}</span>}
    {(failed || url === false) && <span className="chat-voice-error" aria-live="polite">{url === false ? "This recording is no longer available." : "Could not play this recording."}</span>}
  </span>;
}
