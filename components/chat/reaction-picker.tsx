"use client";

import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

/** Native emoji only: the Apple/Google image styles would fetch every glyph from a CDN. */
export default function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return <EmojiPicker emojiStyle={EmojiStyle.NATIVE} theme={Theme.AUTO} width="100%" height={380}
    lazyLoadEmojis skinTonesDisabled previewConfig={{ showPreview: false }}
    onEmojiClick={(data) => onPick(data.emoji)} />;
}
