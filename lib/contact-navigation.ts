export type ContactReturnSource = string | undefined;

export function contactReturnTarget(characterId: string, source: ContactReturnSource): string {
  return source === "direct" && characterId.trim()
    ? `/messages/${encodeURIComponent(characterId)}`
    : "/contacts";
}

/** The explicit return marker lives in the URL query and is read on the client, so the route
 *  stays statically cacheable instead of re-rendering on the server for every visit. */
export function contactReturnSourceFromQuery(value: string | null | undefined): ContactReturnSource {
  return value === "direct" ? "direct" : undefined;
}
