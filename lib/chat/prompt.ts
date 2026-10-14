import { statePromptEntries, STATE_AUTHORITY, type StateView } from "../memory/state-runtime";
import type { Character, FoundationDocument, ProfileBasics } from "../foundation-types";
import { createBuiltinPreset, type Preset, type PresetMarker } from "../preset";
import type { ChatMessage, ChatSummary, PromptTurn } from "./types";
import { buildTimeContext, historyTimestamp, type RuntimeWeatherContext } from "./time-context";
import { messageHistoryContentWithBody } from "./quote";
import type { WorldBookActivation } from "../worldbook-activation";
import { applyRegex } from "../regex-engine";
import type { RegexGroup } from "../regex";
import { selfStateContent, type SelfState } from "./self-context";
import { backgroundBlock, selectBackground, splitBackground } from "./character-background";
import { historyEligible, RECENT_MESSAGES, summaryTurn, validSummary } from "./summary";
import type { MemoryConversation, MemoryContextMessage } from "../memory/context";
import { transferPromptContent } from "./transfer";
import { giftPromptContent } from "./gift";

export type MemorySlot = { entries: readonly string[] };
export const emptyMemorySlot = (): MemorySlot => ({ entries: [] });
export type PromptSection = { identifier: string; content: string };
export type PromptDiagnosticSection = { identifier: string; role: PromptTurn["role"]; characterLength: number };
export type PromptRuntimeContext = {
  foundation: FoundationDocument;
  character: Character;
  currentMessages: readonly ChatMessage[];
  pending: readonly ChatMessage[];
  memory: MemorySlot;
  state?: StateView;
  summary?: ChatSummary;
  worldInfo?: WorldBookActivation;
  time?: ReturnType<typeof buildTimeContext>;
  regexGroups?: readonly RegexGroup[];
};

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
    message.content && message.role !== "system" && (message.role !== "assistant" || message.status === "complete"));
}
function historyMessages(context: PromptRuntimeContext) {
  const pendingIds = new Set(context.pending.map((message) => message.id));
  return historyEligible(context.currentMessages).filter((message) => !pendingIds.has(message.id)).slice(-RECENT_MESSAGES);
}
function pendingMessages(context: PromptRuntimeContext) {
  const current = new Map(eligibleMessages(context).map((message) => [message.id, message]));
  return [...new Set(context.pending.map((message) => message.id))]
    .flatMap((id) => current.has(id) ? [current.get(id)!] : []).sort((a, b) => a.order - b.order);
}
function enabledMarkers(preset: Preset) {
  const prompts = new Map(preset.prompts.map((entry) => [entry.identifier, entry]));
  return preset.promptOrder.flatMap((ordered) => {
    const entry = prompts.get(ordered.identifier);
    return ordered.enabled && entry?.enabled && entry.source === "marker" ? [entry] : [];
  });
}
export const hasSystemCharacterSlot = (preset: Preset) =>
  enabledMarkers(preset).some((entry) => entry.marker === "character" && entry.role === "system");
export const hasSystemMemorySlot = (preset: Preset) =>
  enabledMarkers(preset).some((entry) => entry.marker === "memory" && entry.role === "system");

/** Retrieval sees the same configured History window and authoritative pending input as the request. */
export function memoryConversationText(context: PromptRuntimeContext, preset: Preset): string[] {
  const history = enabledMarkers(preset).some((entry) => entry.marker === "history") ? historyMessages(context) : [];
  return [...history, ...pendingMessages(context)]
    .filter((message) => message.status === "sent" || message.status === "complete")
    .map((message) => promptContent(message, context));
}
/**
 * Texts the Journal checks for one Character request: the round's new user input plus the Character messages that
 * arrived since the previous request (the contiguous assistant run right before it, e.g. the last reply and any
 * proactive messages). Derived from the request itself, so each message is judged once and nothing is stored or
 * re-read: the next request's run starts after this request's input.
 */
export function journalTriggerTexts(context: PromptRuntimeContext, preset: Preset): string[] {
  const settled = (message: ChatMessage) => message.status === "sent" || message.status === "complete";
  const history = historyMessages(context).filter(settled);
  const pending = pendingMessages(context).filter(settled);
  const current = pending.length ? pending : history.filter((message) => message.role === "user").slice(-1);
  if (!current.length) return [];
  const run: ChatMessage[] = [];
  if (enabledMarkers(preset).some((entry) => entry.marker === "history")) {
    const before = history.filter((message) => message.order < Math.min(...current.map((item) => item.order)));
    for (let i = before.length - 1; i >= 0 && before[i].role === "assistant"; i--) run.unshift(before[i]);
  }
  return [...run, ...current].map((message) => promptContent(message, context));
}
/** Same transmitted window, partitioned for retrieval only; no extra history reads or prompt changes. */
export function memoryConversation(context: PromptRuntimeContext, preset: Preset): MemoryConversation {
  const history = enabledMarkers(preset).some((entry) => entry.marker === "history") ? historyMessages(context)
    .filter((message) => message.status === "sent" || message.status === "complete") : [];
  const pending = pendingMessages(context).filter((message) => message.status === "sent" || message.status === "complete");
  const current = pending.length ? pending : history.filter((message) => message.role === "user").slice(-1);
  const currentIds = new Set(current.map((message) => message.id));
  const groups: ChatMessage[][] = [];
  for (const message of history) {
    const last = groups.at(-1);
    if (!last || (message.role === "user" && last.some((item) => item.role === "assistant"))) groups.push([message]);
    else last.push(message);
  }
  const recentGroups = groups.filter((turn) => turn.some((message) => message.role === "user")
    && turn.some((message) => message.role === "assistant")).slice(-2);
  const recentIds = new Set(recentGroups.flat().map((message) => message.id));
  const body = (message: ChatMessage): MemoryContextMessage => ({ role: message.role === "assistant" ? "assistant" : "user", content: promptContent(message, context) });
  return { current: current.map(body),
    recent: recentGroups.map((turn) => turn.filter((message) => !currentIds.has(message.id)).map(body)).filter((turn) => turn.length),
    earlier: history.filter((message) => !currentIds.has(message.id) && !recentIds.has(message.id)).map(body) };
}
function promptContent(message: ChatMessage, context: PromptRuntimeContext) {
  const transfer = transferPromptContent(message, context.character.name);
  if (transfer) return messageHistoryContentWithBody(message, transfer);
  const gift = giftPromptContent(message);
  if (gift) return messageHistoryContentWithBody(message, gift);
  // A sticker's semantic text is VEIL's own, not the user's or the Character's wording, so user regex rules leave it alone.
  const body = !message.sticker && (message.role === "user" || message.role === "assistant")
    ? applyRegex(message.content, context.regexGroups ?? [], message.role, "prompt",
      { character: context.character.name, user: context.foundation.user.name })
    : message.content;
  return messageHistoryContentWithBody(message, body);
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
    case "character": {
      const currentState = statePromptEntries(context.state, context.character);
      const setting = { ...profile(context.character), backstory: splitBackground(context.character.backstory).core,
        personality: context.character.personality, speakingStyle: context.character.speakingStyle };
      // Explicit temporal authority: the baseline is historical for overridden life fields, not a competing current fact.
      return JSON.stringify(currentState.length ? { backgroundBaseline: setting, stateAuthority: STATE_AUTHORITY, currentState } : setting);
    }
    case "relations":
      return JSON.stringify(directRelations(context));
    case "memory":
      return context.memory.entries.length ? context.memory.entries.join("\n") : null;
    case "history": {
      const turns = historyMessages(context)
        .map((message) => ({ role: message.role, content: context.time
          ? `${historyTimestamp(message.createdAt, context.time.user.timezone)}\n${promptContent(message, context)}` : promptContent(message, context) }));
      // Only a summary whose covered messages are still unchanged is ever shown.
      return validSummary(context.summary, context.currentMessages) ? [summaryTurn(context.summary), ...turns] : turns;
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
  regexGroups: readonly RegexGroup[] = [],
  weather?: RuntimeWeatherContext,
  self?: SelfState,
  state?: StateView,
  summary?: ChatSummary,
): { sections: PromptSection[]; messages: PromptTurn[]; diagnostics: PromptDiagnosticSection[] } {
  const time = foundation.runtime?.timeAware !== false
    ? buildTimeContext(now, foundation.user.timezone, character.timezone, undefined, weather) : undefined;
  const context = { foundation, character, currentMessages, pending, memory, time, worldInfo, regexGroups, state, summary };
  const prompts = new Map(preset.prompts.map((entry) => [entry.identifier, entry]));
  const sections: PromptSection[] = [], diagnostics: PromptDiagnosticSection[] = [], messages: PromptTurn[] = [];
  let historyTurns: PromptTurn[] = [];
  let historyDiagnostics: PromptDiagnosticSection[] = [];
  let timeInjected = false;
  let memoryInjected = false, characterInjected = false;
  const injectTime = () => {
    if (!time || timeInjected) return;
    timeInjected = true;
    messages.push({ role: "system", content: time.content });
    diagnostics.push({ identifier: "runtime", role: "system", characterLength: time.content.length });
  };
  const selfContent = selfStateContent(self);
  const injectSelf = () => {
    if (!selfContent) return;
    messages.push({ role: "system", content: selfContent });
    diagnostics.push({ identifier: "self", role: "system", characterLength: selfContent.length });
  };
  for (const ordered of preset.promptOrder) {
    const entry = prompts.get(ordered.identifier);
    if (!ordered.enabled || !entry?.enabled) continue;
    if (entry.source === "marker" && entry.marker === "memory") {
      if (entry.role !== "system" || memoryInjected) continue;
      memoryInjected = true;
    }
    const includeState = entry.source === "marker" && entry.marker === "character" && entry.role === "system" && !characterInjected;
    if (includeState) characterInjected = true;
    const resolved = entry.source === "prompt" ? entry.content
      : resolvePresetMarker(entry.marker, includeState ? context : { ...context, state: undefined });
    if (Array.isArray(resolved)) {
      const entries = resolved.map((turn) =>
        ({ identifier: entry.identifier, role: turn.role, characterLength: turn.content.length }));
      if (entry.source === "marker" && entry.marker === "history") {
        historyTurns = resolved;
        historyDiagnostics = entries;
      } else {
        messages.push(...resolved);
        diagnostics.push(...entries);
      }
    } else if (resolved?.trim()) {
      sections.push({ identifier: entry.identifier, content: resolved });
      append(messages, { role: entry.role,
        content: entry.role === "system" ? `[${entry.identifier}]\n${resolved}` : resolved });
      diagnostics.push({ identifier: entry.identifier, role: entry.role, characterLength: resolved.length });
    }
  }
  // Keep stable Preset context cacheable, then add history, runtime facts and pending input.
  messages.push(...historyTurns);
  diagnostics.push(...historyDiagnostics);
  // Relevant Background excerpts follow History so the Character section stays stable; only with the system Character slot.
  if (characterInjected) {
    const conversation = memoryConversation(context, preset);
    const picked = selectBackground(splitBackground(character.backstory).retrievable,
      conversation.current.map((message) => message.content).join("\n"),
      conversation.recent.flat().map((message) => message.content).join("\n"));
    if (picked.entries.length) {
      const content = backgroundBlock(picked.entries);
      messages.push({ role: "system", content });
      diagnostics.push({ identifier: "background", role: "system", characterLength: content.length });
    }
    // Sentences longer than the whole budget can never be injected; make that visible instead of dropping them silently.
    if (picked.skippedOversizeCharacters) diagnostics.push({ identifier: "background-skipped-oversize", role: "system", characterLength: picked.skippedOversizeCharacters });
  }
  // Runtime facts remain present even when a custom Preset omits History.
  injectTime();
  injectSelf();
  // Pending input is request ownership, not configurable Preset content.
  const pendingTurns = pendingMessages(context)
    .map((message) => ({ role: message.role, content: promptContent(message, context) }));
  messages.push(...pendingTurns);
  for (const turn of pendingTurns)
    diagnostics.push({ identifier: "pending", role: turn.role, characterLength: turn.content.length });
  return { sections, messages, diagnostics };
}
