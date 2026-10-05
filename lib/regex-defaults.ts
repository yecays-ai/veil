import type { RegexGroup, RegexRule } from "./regex";

export const DEFAULT_REGEX_GROUP_ID = "veil-default-chat-rules";
export const DEFAULT_RULE_IDS = {
  hideActions: "veil-hide-actions",
  hideSpeakerName: "veil-hide-speaker-name",
  hideQuotesAroundReplies: "veil-hide-reply-quotes",
  cleanFormattingArtifacts: "veil-clean-formatting-artifacts",
} as const;

const displayRule = (id: string, name: string, find: string, replace: string): RegexRule => ({
  id, name, find, replace, enabled: true, appliesTo: ["assistant"], mode: "display",
});

export function defaultRegexGroup(): RegexGroup {
  return {
    id: DEFAULT_REGEX_GROUP_ID, name: "Default Rules", description: "",
    enabled: true, createdAt: 0, updatedAt: 0,
    rules: [
      displayRule(DEFAULT_RULE_IDS.cleanFormattingArtifacts, "Clean Formatting Artifacts",
        "/^\\s*\\x60{3}(?:text|chat|message)\\r?\\n([^\\x60{}<>;]{1,500})\\r?\\n\\x60{3}\\s*$/i", "$1"),
      displayRule(DEFAULT_RULE_IDS.hideActions, "Hide Actions",
        String.raw`/^\s*\*(?:He|She|They)\s+(?:rubs|scratches|nods|shakes|smiles|laughs|sighs|leans|looks|glances|shrugs|tilts|blinks|frowns|grins|waves|reaches|brushes|folds|raises|lowers|taps|turns|steps|pulls|pushes|pauses)\b[^*\r\n]{0,140}[.!?]\*\s*\r?\n(?:[ \t]*\r?\n)?(?=\S)/i`, ""),
      displayRule(DEFAULT_RULE_IDS.hideSpeakerName, "Hide Speaker Name",
        String.raw`/^\s*{{character}}[ \t]*[:：][ \t]*(\S[\s\S]*)$/i`, "$1"),
      displayRule(DEFAULT_RULE_IDS.hideQuotesAroundReplies, "Hide Quotes Around Replies",
        String.raw`/^\s*(?:"([^"“”\r\n]+)"|“([^"“”\r\n]+)”)\s*$/`, "$1$2"),
    ],
  };
}

export function withDefaultRegexGroup(groups: RegexGroup[]): RegexGroup[] {
  const existing = groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID);
  return existing ? [existing, ...groups.filter((group) => group.id !== DEFAULT_REGEX_GROUP_ID)]
    : [defaultRegexGroup(), ...groups];
}
