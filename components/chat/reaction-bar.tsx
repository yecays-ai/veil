"use client";

import { Plus } from "lucide-react";
import { lazy, Suspense, type Ref } from "react";
import { QUICK_REACTIONS } from "../../lib/chat/reactions";

// The full picker carries the whole emoji dataset, so it is fetched only when "more" is tapped.
const EmojiPicker = lazy(() => import("./reaction-picker"));

/** One row of common emoji above the previewed bubble; the last button opens the full picker. */
export function ReactionBar({ barRef, current, onPick, onMore }: {
  barRef: Ref<HTMLDivElement>;
  current: string | undefined;
  /** `null` clears the reaction (tapping the one already chosen). */
  onPick: (emoji: string | null) => void;
  onMore: () => void;
}) {
  const custom = current && !(QUICK_REACTIONS as readonly string[]).includes(current) ? current : undefined;
  return <div ref={barRef} className="chat-reaction-bar" role="toolbar" aria-label="Reactions"
    style={{ left: 0, top: 0, visibility: "hidden" }} onPointerDown={(e) => e.stopPropagation()}>
    {[...(custom ? [custom] : []), ...QUICK_REACTIONS].map((emoji) => <button key={emoji} type="button"
      aria-label={`React ${emoji}`} aria-pressed={emoji === current}
      className={emoji === current ? "chat-reaction-chosen" : undefined}
      onClick={() => onPick(emoji === current ? null : emoji)}>{emoji}</button>)}
    <button type="button" aria-label="More reactions" onClick={onMore}><Plus size={22} strokeWidth={1.9} /></button>
  </div>;
}

export function ReactionPickerSheet({ onPick }: { onPick: (emoji: string) => void }) {
  return <div className="chat-reaction-picker" role="dialog" aria-label="All reactions" onPointerDown={(e) => e.stopPropagation()}>
    <Suspense fallback={<p className="chat-reaction-picker-loading" role="status">Loading…</p>}>
      <EmojiPicker onPick={onPick} />
    </Suspense>
  </div>;
}
