export function splitAssistantReply(content: string): string[] {
  return content.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
}
