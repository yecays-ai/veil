// Legacy Chat Formatting record shape, used only for the one-time Regex migration.
export type ChatFormattingSettings = {
  id: "chat-formatting";
  hideActions: boolean;
  hideSpeakerName: boolean;
  hideQuotesAroundReplies: boolean;
  cleanFormattingArtifacts: boolean;
};
export function normalizeChatFormatting(value: unknown): ChatFormattingSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    id: "chat-formatting",
    hideActions: raw.hideActions !== false,
    hideSpeakerName: raw.hideSpeakerName !== false,
    hideQuotesAroundReplies: raw.hideQuotesAroundReplies !== false,
    cleanFormattingArtifacts: raw.cleanFormattingArtifacts !== false,
  };
}
