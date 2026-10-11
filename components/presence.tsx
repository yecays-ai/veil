"use client";
import type { Presence } from "../lib/foundation-types";
import { useCharacterPresence } from "./use-character-presence";

export { presenceLabel } from "../lib/presence/view";

export function PresenceBadge({ presence }: { presence: Presence }) {
  return <span className={`presence-badge presence-${presence}`} aria-label={presence} title={presence} />;
}

/** The status dot for one Character, from the shared Presence reading; nothing until it has loaded. */
export function CharacterPresenceBadge({ character }: { character: { characterId: string; timezone: string | null } }) {
  const presence = useCharacterPresence(character);
  return presence.ready ? <PresenceBadge presence={presence.status} /> : null;
}

/** Dot, status and Last Seen for one Character; the line keeps its height while loading. */
export function CharacterPresenceLine({ character }: { character: { characterId: string; timezone: string | null } }) {
  const presence = useCharacterPresence(character, { lastSeen: true });
  return <span className="contact-presence">{presence.ready && <PresenceBadge presence={presence.status} />}{presence.text}</span>;
}
