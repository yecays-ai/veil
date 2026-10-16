"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { chatStorage } from "../../../lib/chat/storage";
import type { ChatMessage } from "../../../lib/chat/types";

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** The picture of one message, read from its own asset. `null` while loading, `false` when the bytes are gone. */
function useAttachmentUrl(sessionId: string, messageId: string, assetId: string | undefined) {
  const [url, setUrl] = useState<string | null | false>(null);
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false, made: string | null = null;
    chatStorage.readMessageAttachment(sessionId, messageId).then((blob) => {
      if (cancelled) return;
      if (!blob) { setUrl(false); return; }
      made = URL.createObjectURL(blob);
      setUrl(made);
    }, () => { if (!cancelled) setUrl(false); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [sessionId, messageId, assetId]);
  return url;
}

function ImageViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(<div className="chat-image-viewer" role="dialog" aria-modal="true" aria-label="Image" onClick={onClose}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="" draggable={false} onClick={(event) => event.stopPropagation()} />
    <div className="chat-image-viewer-bar" onClick={(event) => event.stopPropagation()}>
      <a href={url} download={name}>Save</a>
      <button type="button" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></button>
    </div>
  </div>, document.body);
}

/** An image message's picture. Its box has the picture's proportions before the bytes load, so the list does not jump. */
export function ImageMessage({ message, multiSelect }: { message: ChatMessage; multiSelect: boolean }) {
  const attachment = message.attachment;
  const url = useAttachmentUrl(message.sessionId, message.id, attachment?.assetId);
  const [open, setOpen] = useState(false);
  if (!attachment) return null;
  const box = { aspectRatio: `${attachment.width} / ${attachment.height}` };
  if (url === false) return <span className="chat-image-missing" style={box} role="img" aria-label="Image unavailable">图片已丢失</span>;
  if (url === null) return <span className="chat-image-frame chat-image-loading" style={box} aria-hidden="true" />;
  return <>
    {/* A tap opens the picture; pressing and holding still opens the message actions. In selection mode a tap selects. */}
    <button type="button" className="chat-image-button" style={box} aria-label="View image"
      onClick={(event) => { if (multiSelect) return; event.stopPropagation(); setOpen(true); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="chat-image-message" src={url} alt="" width={attachment.width} height={attachment.height}
        decoding="async" draggable={false} />
    </button>
    {open && <ImageViewer url={url} name={`image.${EXTENSION[attachment.mime] ?? "img"}`} onClose={() => setOpen(false)} />}
  </>;
}
