export function splitAssistantReply(content: string): string[] {
  const parts = content.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  // Some models render the requested empty-line separator as the literal word
  // "Blank". Treat it as formatting only when the repeated pattern makes that
  // intent clear; preserve a single standalone "Blank" as possible message text.
  const blankSeparators = parts.filter((part) => part.toLowerCase() === "blank").length;
  return blankSeparators > 1 ? parts.filter((part) => part.toLowerCase() !== "blank") : parts;
}
