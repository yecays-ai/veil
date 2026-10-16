"use client";

import { useEffect, useState } from "react";
import { ATTACHMENT_EXTENSION, ImageViewer, useAttachmentUrl } from "./chat/messages/image-message";
import { affectsChatSession, chatStorage } from "../lib/chat/storage";
import type { MessageAttachment } from "../lib/chat/attachment";

/** How many of the newest pictures the section shows. */
export const SHARED_MEDIA_LIMIT = 8;
type Item = { messageId: string; attachment: MessageAttachment };

/** One picture from the conversation. Its bytes are read from the message's own asset; a picture whose bytes are gone shows nothing. */
function SharedImage({ sessionId, item }: { sessionId: string; item: Item }) {
  const url = useAttachmentUrl(sessionId, item.messageId, item.attachment.assetId);
  const [open, setOpen] = useState(false);
  if (url === false) return null;
  if (url === null) return <div className="contact-media-slot" aria-hidden="true" />;
  return <>
    <button type="button" className="contact-media-slot contact-media-image" aria-label="View image" onClick={() => setOpen(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />
    </button>
    {open && <ImageViewer url={url} name={`image.${ATTACHMENT_EXTENSION[item.attachment.mime] ?? "img"}`} onClose={() => setOpen(false)} />}
  </>;
}

/** The pictures sent in this Character's conversation, newest first: the chat's own image messages, no separate library. */
export function ContactSharedMedia({ characterId }: { characterId: string }) {
  const [shared, setShared] = useState<{ characterId: string; sessionId: string | null; items: Item[] } | null>(null);
  useEffect(() => {
    let current = true, request = 0, sessionId: string | null = null;
    const load = () => {
      const mine = ++request;
      chatStorage.listSessionImages(characterId, SHARED_MEDIA_LIMIT).then((found) => {
        if (!current || mine !== request) return;
        sessionId = found?.sessionId ?? null;
        setShared({ characterId, sessionId, items: found?.images ?? [] });
      }, () => { if (current && mine === request) setShared({ characterId, sessionId: null, items: [] }); });
    };
    load();
    // A message deleted, recalled or added elsewhere (another tab, the chat itself) changes this list.
    const unsubscribe = chatStorage.subscribe((change) => {
      if (sessionId === null ? change.domain === "session" : affectsChatSession(change, sessionId)) load();
    });
    return () => { current = false; unsubscribe(); };
  }, [characterId]);
  const ready = shared?.characterId === characterId ? shared : null;
  if (!ready) return <div className="contact-media-grid" aria-busy="true" />;
  if (!ready.sessionId || !ready.items.length) return <p className="contact-media-empty">No photos yet.</p>;
  return <div className="contact-media-grid" aria-label="Shared Media">
    {ready.items.map((item) => <SharedImage key={item.messageId} sessionId={ready.sessionId!} item={item} />)}
  </div>;
}
