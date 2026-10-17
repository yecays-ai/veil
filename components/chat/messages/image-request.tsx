"use client";

import { useState, useSyncExternalStore } from "react";
import { Camera } from "lucide-react";
import { chatEngine } from "../../../lib/chat/engine";
import type { ChatMessage } from "../../../lib/chat/types";
import { imageJobStatus, subscribeImageJobs } from "../../../lib/imagegen/job";

/**
 * The bubble of a picture the Character is taking: while it is being made it says so; when it was not made (it failed,
 * or this page was closed meanwhile) it keeps what the Character asked for as text and offers to ask again, with new
 * words if wanted. Once the picture exists the message becomes an ordinary image message.
 */
export function ImageRequest({ message, multiSelect }: { message: ChatMessage; multiSelect: boolean }) {
  const status = useSyncExternalStore(subscribeImageJobs, () => imageJobStatus(message.id), () => "idle");
  const asked = message.imageGen;
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(asked?.prompt ?? "");
  if (!asked) return null;
  const running = status === "running", failure = status.startsWith("error:") ? status.slice(6) : "";
  const retry = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (multiSelect) return;
    setEditing(false);
    void chatEngine.retryImage(message.sessionId, message.id, editing ? draft : undefined);
  };
  return <span className="chat-image-request">
    <span className="chat-image-request-row" aria-busy={running}>
      <Camera aria-hidden="true" />
      <span>{running ? "Taking a photo…" : "Photo not ready"}</span>
    </span>
    {!running && !editing && <span className="chat-image-request-text">{asked.prompt}</span>}
    {editing && <textarea aria-label="What the photo shows" value={draft} maxLength={400} onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)} />}
    {failure && <span className="chat-voice-error" aria-live="polite">{failure}</span>}
    {!running && <span className="chat-image-request-actions">
      <button type="button" className="chat-voice-toggle" onClick={retry} disabled={editing && !draft.trim()}>Try again</button>
      {!editing && <button type="button" className="chat-voice-toggle"
        onClick={(event) => { event.stopPropagation(); if (!multiSelect) { setDraft(asked.prompt); setEditing(true); } }}>Change words</button>}
    </span>}
  </span>;
}
