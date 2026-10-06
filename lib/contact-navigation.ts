export type ContactReturnSource = string | undefined;

export function contactReturnTarget(characterId: string, source: ContactReturnSource): string {
  return source === "direct" && characterId.trim()
    ? `/messages/${encodeURIComponent(characterId)}`
    : "/contacts";
}
