import { UNIVERSE_ID, type Character, type FoundationDocument, type Universe } from "./foundation-types";
import type { ChatSession } from "./chat/types";

/** The original Universe remains the first partition; no partition is globally active. */
export function allUniverses(document: FoundationDocument): Universe[] {
  return [document.universe, ...(document.universes ?? [])];
}
export const characterUniverseId = (character: Pick<Character, "universeId">): string => character.universeId ?? UNIVERSE_ID;
export function universeForCharacter(document: FoundationDocument, character: Pick<Character, "universeId">): Universe {
  const universe = allUniverses(document).find((world) => world.id === characterUniverseId(character));
  if (!universe) throw new Error("Character Universe not found.");
  return universe;
}
export function sessionUniverseId(document: FoundationDocument, session: ChatSession): string | null {
  if (session.universeId) return session.universeId;
  const members = session.type === "group" ? session.participantIds ?? [] : [session.characterId];
  // Minimal default for old internal empty-group fixtures; new groups always retain their own id.
  if (!members.length) return UNIVERSE_ID;
  const ids = members.map((id) => document.characters.find((c) => c.characterId === id)).map((c) => c ? characterUniverseId(c) : null);
  return ids.length && ids[0] && ids.every((id) => id === ids[0]) ? ids[0] : null;
}
/** A local view for the relationship editor, never persisted as a replacement document. */
export function universeView(document: FoundationDocument, id: string): FoundationDocument {
  const universe = allUniverses(document).find((u) => u.id === id);
  if (!universe) throw new Error("Universe not found.");
  return { ...document, universe, characters: document.characters.filter((c) => characterUniverseId(c) === id) };
}
export function editUniverse(document: FoundationDocument, id: string, update: (view: FoundationDocument) => FoundationDocument): FoundationDocument {
  const next = update(universeView(document, id)).universe;
  return id === document.universe.id ? { ...document, universe: next }
    : { ...document, universes: (document.universes ?? []).map((u) => u.id === id ? next : u) };
}
export function createUniverse(document: FoundationDocument, name: string): FoundationDocument {
  if (!name.trim()) throw new Error("Universe name is required.");
  const now = Date.now();
  const universe: Universe = { id: crypto.randomUUID(), name: name.trim().slice(0, 100), worldSetting: null,
    relations: [], nodePositions: {}, createdAt: now, updatedAt: now };
  return { ...document, universes: [...(document.universes ?? []), universe] };
}
