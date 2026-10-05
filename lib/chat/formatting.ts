export type ChatFormattingSettings = {
  id: "chat-formatting";
  hideActions: boolean;
  hideSpeakerName: boolean;
  hideQuotesAroundReplies: boolean;
  cleanFormattingArtifacts: boolean;
};
export const defaultChatFormatting = (): ChatFormattingSettings => ({
  id: "chat-formatting", hideActions: true, hideSpeakerName: true,
  hideQuotesAroundReplies: true, cleanFormattingArtifacts: true,
});
export function normalizeChatFormatting(value: unknown): ChatFormattingSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const defaults = defaultChatFormatting();
  return {
    id: "chat-formatting",
    hideActions: typeof raw.hideActions === "boolean" ? raw.hideActions : defaults.hideActions,
    hideSpeakerName: typeof raw.hideSpeakerName === "boolean" ? raw.hideSpeakerName : defaults.hideSpeakerName,
    hideQuotesAroundReplies: typeof raw.hideQuotesAroundReplies === "boolean" ? raw.hideQuotesAroundReplies : defaults.hideQuotesAroundReplies,
    cleanFormattingArtifacts: typeof raw.cleanFormattingArtifacts === "boolean"
      ? raw.cleanFormattingArtifacts : defaults.cleanFormattingArtifacts,
  };
}

function unwrapArtifact(text: string) {
  const match = text.match(/^\s*```(?:text|chat|message)\r?\n([\s\S]+?)\r?\n```\s*$/i);
  if (!match) return text;
  const body = match[1].trim();
  return body && body.length <= 500 && body.split(/\r?\n/).length <= 3 &&
    !/[{}<>;`]/.test(body) ? body : text;
}
function hideLeadingAction(text: string) {
  // Only a standalone, leading, third-person action line followed by speech.
  return text.replace(/^\s*\*(?:He|She|They)\s+(?:rubs|scratches|nods|shakes|smiles|laughs|sighs|leans|looks|glances|shrugs|tilts|blinks|frowns|grins|waves|reaches|brushes|folds|raises|lowers|taps|turns|steps|pulls|pushes|pauses)\b[^*\r\n]{0,140}[.!?]\*\s*\r?\n(?:[ \t]*\r?\n)?(?=\S)/i, "");
}
function hideLeadingSpeaker(text: string, characterName: string) {
  const name = characterName.trim();
  if (!name) return text;
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const body = text.slice(leading.length);
  if (body.slice(0, name.length).toLocaleLowerCase() !== name.toLocaleLowerCase()) return text;
  const separator = body.slice(name.length).match(/^[ \t]*[:：][ \t]*/);
  const rest = separator ? body.slice(name.length + separator[0].length) : "";
  return rest.trim() ? leading + rest : text;
}
function unwrapOuterQuotes(text: string) {
  const match = text.match(/^(\s*)(["“])([^\r\n]+)(["”])(\s*)$/);
  if (!match || !((match[2] === '"' && match[4] === '"') ||
    (match[2] === "“" && match[4] === "”"))) return text;
  const inner = match[3];
  return inner.trim() && !/["“”]/.test(inner) ? match[1] + inner + match[5] : text;
}

// Built-in display formatting runs before user Advanced Display Regex.
// Neither phase changes persisted content, prompt history, or WorldBook input.
export function formatAssistantMessage(text: string, characterName: string, settings: ChatFormattingSettings): string {
  let result = text;
  if (settings.cleanFormattingArtifacts) result = unwrapArtifact(result);
  if (settings.hideActions) result = hideLeadingAction(result);
  if (settings.hideSpeakerName) result = hideLeadingSpeaker(result, characterName);
  if (settings.hideQuotesAroundReplies) result = unwrapOuterQuotes(result);
  return result;
}
