import type { Character, FoundationDocument, ProfileBasics } from "../foundation-types";
import { createBuiltinPreset, type Preset, type PresetMarker } from "../preset";
import type { ChatMessage, PromptTurn } from "./types";
import { buildTimeContext, historyTimestamp } from "./time-context";
import { messageHistoryContent } from "./quote";
import type { WorldBookActivation } from "../worldbook-activation";

export type MemorySlot = { entries: readonly string[] };
export const emptyMemorySlot = (): MemorySlot => ({ entries: [] });
export type PromptSection = { identifier: string; content: string };
export type PromptRuntimeContext = {
  foundation: FoundationDocument;
  character: Character;
  currentMessages: readonly ChatMessage[];
  pending: readonly ChatMessage[];
  memory: MemorySlot;
  worldInfo?: WorldBookActivation;
  time?: ReturnType<typeof buildTimeContext>;
};

const RECENT_MESSAGES = 40;
function profile(value: ProfileBasics) {
  return Object.fromEntries(Object.entries({ name: value.name, gender: value.gender,
    birthday: value.birthday, age: value.age, occupation: value.occupation,
    location: value.location?.label, timezone: value.timezone, appearance: value.appearance,
  }).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}
function directRelations({ foundation, character }: PromptRuntimeContext) {
  return foundation.universe.relations
    .filter((relation) => relation.characterAId === character.characterId ||
      relation.characterBId === character.characterId)
    .flatMap((relation) => {
      const a = foundation.characters.find((item) => item.characterId === relation.characterAId);
      const b = foundation.characters.find((item) => item.characterId === relation.characterBId);
      return a && b ? [{ from: a.name, to: b.name, label: relation.label,
        fromToContext: relation.aToBContext, toFromContext: relation.bToAContext,
        sharedHistory: relation.sharedHistory }] : [];
    });
}
function eligibleMessages(context: PromptRuntimeContext) {
  return context.currentMessages.filter((message) =>
    message.content && (message.role !== "assistant" || message.status === "complete"));
}

export function resolvePresetMarker(
  marker: PresetMarker,
  context: PromptRuntimeContext,
): string | PromptTurn[] | null {
  switch (marker) {
    case "user":
      return JSON.stringify({ ...profile(context.foundation.user), aboutMe: context.foundation.user.aboutMe });
    case "universe":
      return JSON.stringify({ name: context.foundation.universe.name,
        worldSetting: context.foundation.universe.worldSetting });
    case "world-info-before":
      return context.worldInfo?.before.map((item) => item.entry.content).join("\n\n") || null;
    case "world-info-after":
      return context.worldInfo?.after.map((item) => item.entry.content).join("\n\n") || null;
    case "character":
      return JSON.stringify({ ...profile(context.character), backstory: context.character.backstory,
        personality: context.character.personality, speakingStyle: context.character.speakingStyle });
    case "relations":
      return JSON.stringify(directRelations(context));
    case "memory":
      return context.memory.entries.length ? context.memory.entries.join("\n") : null;
    case "history": {
      const pendingIds = new Set(context.pending.map((message) => message.id));
      return eligibleMessages(context).filter((message) => !pendingIds.has(message.id))
        .sort((a, b) => a.order - b.order).slice(-RECENT_MESSAGES)
        .map((message) => ({ role: message.role, content: context.time
          ? `${historyTimestamp(message.createdAt, context.time.user.timezone)}\n${messageHistoryContent(message)}` : messageHistoryContent(message) }));
    }
  }
}
function append(messages: PromptTurn[], turn: PromptTurn) {
  const previous = messages.at(-1);
  if (turn.role === "system" && previous?.role === "system")
    previous.content += `\n\n${turn.content}`;
  else messages.push(turn);
}

export function assembleChatPrompt(
  foundation: FoundationDocument,
  character: Character,
  currentMessages: readonly ChatMessage[],
  pending: readonly ChatMessage[],
  memory: MemorySlot = emptyMemorySlot(),
  preset: Preset = createBuiltinPreset(),
  now: Date = new Date(),
  worldInfo?: WorldBookActivation,
): { sections: PromptSection[]; messages: PromptTurn[] } {
  const time = foundation.runtime?.timeAware !== false
    ? buildTimeContext(now, foundation.user.timezone, character.timezone) : undefined;
  const context = { foundation, character, currentMessages, pending, memory, time, worldInfo };
  const prompts = new Map(preset.prompts.map((entry) => [entry.identifier, entry]));
  const sections: PromptSection[] = [], messages: PromptTurn[] = [];
  let timeInjected = false;
  const injectTime = () => {
    if (!time || timeInjected) return;
    timeInjected = true;
    append(messages, { role: "system", content: time.content });
  };
  for (const ordered of preset.promptOrder) {
    const entry = prompts.get(ordered.identifier);
    if (!ordered.enabled || !entry?.enabled) continue;
    if ((entry.source === "marker" && entry.marker === "history") || entry.role !== "system")
      injectTime();
    const resolved = entry.source === "prompt" ? entry.content
      : resolvePresetMarker(entry.marker, context);
    if (Array.isArray(resolved)) {
      for (const turn of resolved) messages.push(turn);
    } else if (resolved?.trim()) {
      sections.push({ identifier: entry.identifier, content: resolved });
      append(messages, { role: entry.role,
        content: entry.role === "system" ? `[${entry.identifier}]\n${resolved}` : resolved });
    }
  }
  // Runtime facts remain present even when a custom Preset omits History.
  injectTime();
  // Pending input is request ownership, not configurable Preset content.
  const current = new Map(eligibleMessages(context).map((message) => [message.id, message]));
  const pendingTurns = [...new Set(pending.map((message) => message.id))]
    .flatMap((id) => current.has(id) ? [current.get(id)!] : [])
    .sort((a, b) => a.order - b.order)
    .map((message) => ({ role: message.role, content: messageHistoryContent(message) }));
  messages.push(...pendingTurns);
  return { sections, messages };
}
