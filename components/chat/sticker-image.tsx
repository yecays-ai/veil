"use client";

import { useState } from "react";

/** A sticker picture from its saved link. A link that no longer loads shows the sticker's name instead of a broken image. */
export function StickerImage({ url, name, className, onLoadError }: { url: string; name: string; className?: string; onLoadError?: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`sticker-missing${className ? ` ${className}` : ""}`} role="img" aria-label={name}>{name}</span>;
  // referrerPolicy: the image host is told nothing about VEIL; no-referrer is the only request detail we control.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={url} alt={name} loading="lazy" decoding="async" draggable={false}
    referrerPolicy="no-referrer" onError={() => { setFailed(true); onLoadError?.(); }} />;
}
