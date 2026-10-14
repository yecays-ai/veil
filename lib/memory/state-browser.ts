import { browserDocumentStorage } from "../core-document-storage";
import { FOUNDATION_STORAGE_KEY } from "../foundation-storage";
import { normalizeFoundation, type Character } from "../foundation-types";
import { chatStorage } from "../chat/storage";
import { browserMemoryStorage } from "./instance";
import { readCharacterStateDetail } from "./state-runtime";

/** Resolve saved authority under one lease. Stale route/request props cannot authorize old State. */
export function readBrowserCharacterStateDetail(character: Pick<Character, "characterId" | "backstory">) {
  return browserMemoryStorage.withExclusive(async (scope) => {
    const raw = await browserDocumentStorage.readExisting(FOUNDATION_STORAGE_KEY, scope);
    const current = raw && normalizeFoundation(JSON.parse(raw)).characters.find((row) => row.characterId === character.characterId);
    if (!current || current.backstory !== character.backstory) throw new Error("Character data changed. Reload this profile.");
    return readCharacterStateDetail(browserMemoryStorage, current, scope, (sessionId, ids) => chatStorage.readStateSources(sessionId, ids, scope));
  });
}

export const readBrowserCharacterState = (character: Pick<Character, "characterId" | "backstory">) =>
  readBrowserCharacterStateDetail(character).then((detail) => detail.view);
