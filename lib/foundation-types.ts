import { userConfig } from "../config/user";
import { normalizeBindings, type BindingDocument } from "./bindings";
import type { ManualLocation } from "./participant-config";

export const UNIVERSE_ID = "veil-universe" as const;
export type ProfileBasics = {
  avatar: string | null;
  name: string;
  gender: string | null;
  birthday: string | null;
  age: number | null;
  occupation: string | null;
  location: ManualLocation | null;
  timezone: string | null;
  appearance: string | null;
};
export type UserProfile = ProfileBasics & { aboutMe: string | null };
export type Character = ProfileBasics & {
  characterId: string;
  backstory: string | null;
  personality: string | null;
  speakingStyle: string | null;
};
export type CharacterInput = Omit<Character, "characterId">;
export type NodePosition = { x: number; y: number };
export type CharacterRelation = {
  id: string;
  characterAId: string;
  characterBId: string;
  label: string;
  aToBContext: string | null;
  bToAContext: string | null;
  sharedHistory: string | null;
};
export type RelationInput = Omit<CharacterRelation, "id">;
export type Universe = {
  id: typeof UNIVERSE_ID;
  name: string;
  worldSetting: string | null;
  relations: CharacterRelation[];
  nodePositions: Record<string, NodePosition>;
};
export type FoundationDocument = {
  version: 1;
  user: UserProfile;
  characters: Character[];
  selectedCharacterId: string | null;
  universe: Universe;
  bindings: BindingDocument;
};

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function optionalText(value: unknown, max = 12000): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}
export function validBirthday(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function validTimezone(value: unknown): string | null {
  const zone = optionalText(value, 100);
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return zone;
  } catch {
    return null;
  }
}
export function avatarSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 600000) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value))
    return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function normalizeLocation(value: unknown): ManualLocation | null {
  const raw = record(value),
    label = optionalText(raw.label, 200);
  if (!label) return null;
  const c = record(raw.coordinates);
  const coordinates =
    typeof c.latitude === "number" &&
    Number.isFinite(c.latitude) &&
    Math.abs(c.latitude) <= 90 &&
    typeof c.longitude === "number" &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.longitude) <= 180
      ? { latitude: c.latitude, longitude: c.longitude }
      : null;
  return { label, coordinates };
}
function basics(value: unknown): ProfileBasics {
  const raw = record(value);
  return {
    avatar: avatarSource(raw.avatar),
    name: optionalText(raw.name, 100) || "Character",
    gender: optionalText(raw.gender, 100),
    birthday: validBirthday(raw.birthday),
    age:
      typeof raw.age === "number" && Number.isInteger(raw.age) && raw.age >= 0
        ? raw.age
        : null,
    occupation: optionalText(raw.occupation, 200),
    location: normalizeLocation(raw.location),
    timezone: validTimezone(raw.timezone),
    appearance: optionalText(raw.appearance),
  };
}
export function normalizeUser(value: unknown): UserProfile {
  const raw = record(value);
  return {
    ...basics(raw),
    name: optionalText(raw.name, 100) || userConfig.name,
    aboutMe: optionalText(raw.aboutMe),
  };
}
export function normalizeCharacterInput(value: unknown): CharacterInput {
  const raw = record(value);
  return {
    ...basics(raw),
    backstory: optionalText(raw.backstory),
    personality: optionalText(raw.personality),
    speakingStyle: optionalText(raw.speakingStyle),
  };
}
export function normalizePosition(
  value: unknown,
  fallback: NodePosition,
): NodePosition {
  const raw = record(value);
  return {
    x:
      typeof raw.x === "number" && Number.isFinite(raw.x)
        ? Math.max(0, Math.min(5000, raw.x))
        : fallback.x,
    y:
      typeof raw.y === "number" && Number.isFinite(raw.y)
        ? Math.max(0, Math.min(5000, raw.y))
        : fallback.y,
  };
}
export function defaultFoundation(): FoundationDocument {
  return {
    version: 1,
    user: normalizeUser(userConfig),
    characters: [],
    selectedCharacterId: null,
    universe: {
      id: UNIVERSE_ID,
      name: "Universe",
      worldSetting: null,
      relations: [],
      nodePositions: {},
    },
    bindings: { global: {}, characters: {} },
  };
}
export function normalizeFoundation(value: unknown): FoundationDocument {
  const raw = record(value),
    world = record(raw.universe);
  const characters: Character[] = [],
    seen = new Set<string>();
  if (Array.isArray(raw.characters))
    for (const value of raw.characters) {
      const c = record(value),
        id = optionalText(c.characterId, 100);
      if (
        !id ||
        !/^[a-zA-Z0-9_-]+$/.test(id) ||
        ["__proto__", "constructor", "prototype"].includes(id) ||
        seen.has(id) ||
        !optionalText(c.name, 100)
      )
        continue;
      seen.add(id);
      characters.push({ characterId: id, ...normalizeCharacterInput(c) });
    }
  const relations: CharacterRelation[] = [],
    relationIds = new Set<string>(),
    pairs = new Set<string>();
  if (Array.isArray(world.relations))
    for (const value of world.relations) {
      const r = record(value),
        id = optionalText(r.id, 100),
        label = optionalText(r.label, 100);
      if (
        !id ||
        relationIds.has(id) ||
        !label ||
        typeof r.characterAId !== "string" ||
        typeof r.characterBId !== "string" ||
        r.characterAId === r.characterBId ||
        !seen.has(r.characterAId) ||
        !seen.has(r.characterBId)
      )
        continue;
      const pair = [r.characterAId, r.characterBId].sort().join(":");
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      relationIds.add(id);
      relations.push({
        id,
        label,
        characterAId: r.characterAId,
        characterBId: r.characterBId,
        aToBContext: optionalText(r.aToBContext),
        bToAContext: optionalText(r.bToAContext),
        sharedHistory: optionalText(r.sharedHistory),
      });
    }
  const nodePositions: Record<string, NodePosition> = {};
  characters.forEach((c, i) => {
    nodePositions[c.characterId] = normalizePosition(
      record(world.nodePositions)[c.characterId],
      { x: 32 + (i % 3) * 220, y: 36 + Math.floor(i / 3) * 130 },
    );
  });
  return {
    version: 1,
    user: normalizeUser(raw.user),
    characters,
    selectedCharacterId:
      typeof raw.selectedCharacterId === "string" &&
      seen.has(raw.selectedCharacterId)
        ? raw.selectedCharacterId
        : (characters[0]?.characterId ?? null),
    universe: {
      id: UNIVERSE_ID,
      name: optionalText(world.name, 100) || "Universe",
      worldSetting: optionalText(world.worldSetting),
      relations,
      nodePositions,
    },
    bindings: normalizeBindings(
      raw.bindings,
      characters.map((c) => c.characterId),
    ),
  };
}
