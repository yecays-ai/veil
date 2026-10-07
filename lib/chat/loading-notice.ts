/** Only unavailable identity data or a failed conversation needs a visible notice.
 * A validated header/composer can paint while the authoritative session read runs.
 */
export function chatLoadingNotice(foundationReady: boolean, characterAvailable: boolean,
  loadError: string): string | undefined {
  if (!foundationReady) return "Loading Character…";
  if (!characterAvailable) return "This Character is no longer available.";
  if (loadError) return "Conversation unavailable.";
  return undefined;
}
