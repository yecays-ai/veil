import {
  normalizeCharacterInput,
  normalizeFoundation,
  normalizePosition,
  normalizeUser,
  optionalText,
  validBirthday,
  validTimezone,
  type CharacterInput,
  type FoundationDocument,
  type NodePosition,
  type RelationInput,
  type UserProfile,
} from "./foundation-types";

export class CharacterConflictError extends Error {}

function validateProfile(input: CharacterInput | UserProfile) {
  if (!input.name.trim()) throw new Error("Name is required.");
  if (input.birthday && !validBirthday(input.birthday))
    throw new Error("Enter a valid birthday.");
  if (input.age !== null && (!Number.isInteger(input.age) || input.age < 0))
    throw new Error("Age must be a non-negative whole number or empty.");
  if (input.timezone && !validTimezone(input.timezone))
    throw new Error(
      "Enter a valid IANA timezone, for example UTC. Leave empty to use device time.",
    );
}
export function saveUser(
  document: FoundationDocument,
  input: UserProfile,
): FoundationDocument {
  validateProfile(input);
  return { ...document, user: normalizeUser(input) };
}
export function createCharacter(
  document: FoundationDocument,
  input: CharacterInput,
): FoundationDocument {
  validateProfile(input);
  const characterId = crypto.randomUUID();
  return normalizeFoundation({
    ...document,
    characters: [
      ...document.characters,
      { ...normalizeCharacterInput(input), characterId },
    ],
  });
}
export function updateCharacter(
  document: FoundationDocument,
  characterId: string,
  input: CharacterInput,
  expected?: CharacterInput,
): FoundationDocument {
  validateProfile(input);
  const current = document.characters.find((c) => c.characterId === characterId);
  if (!current) {
    if (expected) throw new CharacterConflictError("Character not found. It was deleted elsewhere; your draft was not saved.");
    throw new Error("Character not found.");
  }
  if (expected && JSON.stringify(normalizeCharacterInput(current))
    !== JSON.stringify(normalizeCharacterInput(expected)))
    throw new CharacterConflictError("This Character changed elsewhere. Your draft was not saved. Reopen it to review the latest version.");
  return {
    ...document,
    characters: document.characters.map((c) =>
      c.characterId === characterId
        ? { characterId, ...normalizeCharacterInput(input) }
        : c,
    ),
  };
}
export function deleteCharacter(
  document: FoundationDocument,
  characterId: string,
  expected?: CharacterInput,
): FoundationDocument {
  if (expected) {
    const current = document.characters.find((c) => c.characterId === characterId);
    if (!current) throw new CharacterConflictError("Character not found. It was deleted elsewhere.");
    if (JSON.stringify(normalizeCharacterInput(current)) !== JSON.stringify(normalizeCharacterInput(expected)))
      throw new CharacterConflictError("This Character changed elsewhere and was not deleted. Reopen it to review the latest version.");
  }
  // Normalization removes dangling relations and nodes.
  return normalizeFoundation({
    ...document,
    characters: document.characters.filter(
      (c) => c.characterId !== characterId,
    ),
  });
}
export function saveUniverse(
  document: FoundationDocument,
  name: string,
  worldSetting: string,
): FoundationDocument {
  if (!name.trim()) throw new Error("Universe name is required.");
  return {
    ...document,
    universe: {
      ...document.universe,
      name: optionalText(name, 100)!,
      worldSetting: optionalText(worldSetting),
    },
  };
}
export function saveRelation(
  document: FoundationDocument,
  input: RelationInput,
  id?: string,
): FoundationDocument {
  if (!input.label.trim()) throw new Error("Relationship label is required.");
  if (
    input.characterAId === input.characterBId ||
    ![input.characterAId, input.characterBId].every((id) =>
      document.characters.some((c) => c.characterId === id),
    )
  )
    throw new Error("Choose two different existing Characters.");
  if (id && !document.universe.relations.some((r) => r.id === id))
    throw new Error("Relationship not found.");
  if (
    document.universe.relations.some(
      (r) =>
        r.id !== id &&
        [r.characterAId, r.characterBId].every((c) =>
          [input.characterAId, input.characterBId].includes(c),
        ),
    )
  )
    throw new Error(
      "This pair already has a relationship. Edit its existing connection.",
    );
  const relation = { ...input, id: id ?? crypto.randomUUID() };
  return normalizeFoundation({
    ...document,
    universe: {
      ...document.universe,
      relations: [
        ...document.universe.relations.filter((r) => r.id !== id),
        relation,
      ],
    },
  });
}
export function deleteRelation(
  document: FoundationDocument,
  id: string,
): FoundationDocument {
  return {
    ...document,
    universe: {
      ...document.universe,
      relations: document.universe.relations.filter((r) => r.id !== id),
    },
  };
}
export function setNodePosition(
  document: FoundationDocument,
  characterId: string,
  position: NodePosition,
): FoundationDocument {
  if (!document.characters.some((c) => c.characterId === characterId))
    throw new Error("Character not found.");
  return {
    ...document,
    universe: {
      ...document.universe,
      nodePositions: {
        ...document.universe.nodePositions,
        [characterId]: normalizePosition(position, { x: 32, y: 36 }),
      },
    },
  };
}
