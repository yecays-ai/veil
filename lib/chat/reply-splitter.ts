/** True only when an entire assistant bubble/segment is an empty-line label. */
export function isAssistantBlankLinePlaceholder(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/gu, " ");
  return /^blank(?: line)?[\p{P}\p{Zs}]*$/iu.test(normalized);
}

export function splitAssistantReply(content: string): string[] {
  return content.split(/\n\n+/).map((part) => part.trim()).filter((part) =>
    part && !isAssistantBlankLinePlaceholder(part));
}
