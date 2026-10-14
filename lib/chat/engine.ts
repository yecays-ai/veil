import { resolveBindings } from "../bindings";
import type { BindingDocument } from "../bindings";
import { browserBindingStorage } from "../binding-storage";
import { browserApiConfigStorage } from "../api-config-storage";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { browserFoundationStorage } from "../foundation-storage";
import { characterNoteEventText } from "../presence/note-events";
import type { Character, FoundationDocument } from "../foundation-types";
import { createPresetDocument, presetForBinding, type PresetDocument } from "../preset";
import { browserPresetStorage } from "../preset-storage";
import { assembleChatPrompt, hasSystemCharacterSlot, hasSystemMemorySlot, journalTriggerTexts, memoryConversation } from "./prompt";
import { browserMemoryStorage } from "../memory/browser";
import { emptyMemoryContext, memoryEntryHash, selectMemoryContext } from "../memory/context";
import { journalEntry, selectJournal } from "../memory/journal";
import type { Memory } from "../memory/types";
import { selfState, type ReactionState, type SelfState } from "./self-context";
import { isSilence, maybeSilence, PROACTIVE_INSTRUCTION } from "./proactive";
import { browserContactStorage } from "../contact-storage";
import {
  openAITextProvider,
  validateApiConfig,
  type TextProvider,
} from "./provider";
import { ChatStorage, chatStorage } from "./storage";
import type { ChatMessage, ChatSession, MemoryRef } from "./types";
import { sanitizeHistoryTimestamps } from "./timestamp-sanitizer";
import { advanceLastSeen, browserPresenceStorage, presenceRecord, type PresenceStorage } from "../presence/storage";
import { characterActionApplier, splitActions, type ActionApplier } from "../presence/actions";
import { characterMayReact, reactionTarget, userReactionNotes } from "./reactions";
import { browserWorldBookStorage } from "../worldbook-storage";
import { emptyWorldBookDocument, selectBoundWorldBooks, type WorldBookDocument } from "../worldbook";
import { evaluateWorldBooks } from "../worldbook-activation";
import { browserRegexStorage } from "../regex-storage";
import { emptyRegexDocument, resolveRegexGroups, type RegexDocument } from "../regex";
import { applyRegex } from "../regex-engine";
import { loadWeatherState } from "../weather";
import type { Coordinates, WeatherState } from "../participant-config";
import { logPromptSummary, type CompletionSource, type CompletionRequestContext } from "./request-diagnostics";
import { browserStickerStorage, resolveStickerChoice, stickerMenu, type StickerChoice } from "./sticker-storage";
import type { MessageSticker } from "./sticker-message";
import { startGenerationPersistence, type GenerationPersistenceOutcome } from "./persistence-diagnostics";

/** Records when a Character's reply was committed, for Last Seen. Resolves once saved. */
type SentRecorder = (characterId: string, sentAt: number) => Promise<void>;
export const sentRecorder = (presence: Pick<PresenceStorage, "transact">): SentRecorder => (characterId, sentAt) =>
  presence.transact((document) => advanceLastSeen(document, characterId, { lastMessageAt: sentAt }, sentAt)).then(() => {});
const recordSentToPresence: SentRecorder = (characterId, sentAt) =>
  typeof window === "undefined" ? Promise.resolve() : sentRecorder(browserPresenceStorage)(characterId, sentAt);

/** What this Character knows about itself right now: the user's remark, its status, situation and signature. */
type SelfLoader = (character: Character, now: number, reply: { lastReplyAt: number | null; announceChange: boolean; allowActions: boolean; reactions?: ReactionState }) =>
  Promise<SelfState | undefined>;
const loadSelfState: SelfLoader = async (character, now, reply) => {
  if (typeof window === "undefined") return undefined;
  try {
    const [contacts, presence] = await Promise.all([browserContactStorage.load(), browserPresenceStorage.load()]);
    return selfState(character, contacts.contacts.find((item) => item.characterId === character.characterId),
      presenceRecord(presence, character.characterId), now, reply.lastReplyAt, reply.announceChange, reply.allowActions, reply.reactions);
  } catch {
    console.warn("[Presence] own state was not added to the reply context");
    return undefined;
  }
};

const applyActionsToStores: ActionApplier = (characterId, actions, now, messageId) =>
  typeof window === "undefined" ? Promise.resolve()
    : characterActionApplier({ presence: browserPresenceStorage, foundation: browserFoundationStorage,
      recallPreviousMessage: async (replyId) => { await chatStorage.recallPreviousAssistantMessage(replyId); },
      sendTransfer: async (replyId, amount, note) => { await chatStorage.createTransferForReply(replyId, amount, note); },
      actOnTransfer: async (id, transferId, action) => { await chatStorage.actOnTransferForCharacter(id, transferId, action); },
      noteChanged: async (id, note, at) => {
        const character = (await browserFoundationStorage.load()).characters.find((item) => item.characterId === id);
        if (character) await chatStorage.appendSystemEvent(id, characterNoteEventText(character.name, note), at);
      } })(characterId, actions, now, messageId);

/** The Character's sticker library, read twice per reply: the menu it is offered, and the check of its choice just before saving. */
export type StickerSource = {
  menu(characterId: string): Promise<StickerChoice[]>;
  resolve(characterId: string, choices: readonly StickerChoice[], code: string): Promise<MessageSticker | null>;
};
export const browserStickerSource: StickerSource = {
  menu: async (characterId) => typeof window === "undefined" ? [] : stickerMenu(await browserStickerStorage.load(), characterId),
  resolve: async (characterId, choices, code) =>
    typeof window === "undefined" ? null : resolveStickerChoice(await browserStickerStorage.load(), characterId, choices, code),
};

type WeatherLoader = (target: { label: string | null; coordinates: Coordinates | null }) => Promise<WeatherState>;
type StateLoader = (character: Character) => Promise<import("../memory/state-runtime").StateView | undefined>;
const loadCharacterState: StateLoader = (character) => typeof window === "undefined" ? Promise.resolve(undefined)
  : import("../memory/state-browser").then((module) => module.readBrowserCharacterState(character));
type MemoryLoader = (characterId: string) => Promise<readonly Memory[]>;
const loadMemory: MemoryLoader = (characterId) => typeof window === "undefined"
  ? Promise.resolve([]) : browserMemoryStorage.listMemories(characterId);

async function safeWeather(loader: WeatherLoader, location: FoundationDocument["user"]["location"]) {
  if (!location) return { status: "not-configured" } as const;
  try {
    return await loader({ label: location.label, coordinates: location.coordinates });
  } catch {
    return { status: "error", message: "Weather unavailable" } as const;
  }
}

export function createChatEngine(
  storage: ChatStorage,
  foundation: () => Promise<FoundationDocument>,
  provider: TextProvider = openAITextProvider,
  presets: () => Promise<PresetDocument> = async () => createPresetDocument(),
  now: () => Date = () => new Date(),
  worldBooks: () => Promise<WorldBookDocument> = () =>
    typeof window === "undefined" ? Promise.resolve(emptyWorldBookDocument()) : browserWorldBookStorage.load(),
  regex: () => Promise<RegexDocument> = () =>
    typeof window === "undefined" ? Promise.resolve(emptyRegexDocument()) : browserRegexStorage.load(),
  bindings: () => Promise<BindingDocument> = () => typeof window === "undefined"
    ? Promise.resolve({ global: {}, characters: {} }) : browserBindingStorage.load(),
  weatherLoader: WeatherLoader = (target) => loadWeatherState(target),
  apiConfig: (id: string) => Promise<ApiConfig | undefined> = (id) => browserApiConfigStorage.getApiConfig(id),
  recordSent: SentRecorder = recordSentToPresence,
  self: SelfLoader = loadSelfState,
  applyActions: ActionApplier = applyActionsToStores,
  memories: MemoryLoader = loadMemory,
  states: StateLoader = loadCharacterState,
  stickerSource: StickerSource = browserStickerSource,
) {
  const active = new Map<string, { controller: AbortController; id?: string }>();
  let stopSequence = 0;
  const lastStop = new Map<string, number>();
  // Cancellation races the awaited stage, not its underlying service. A late
  // resolver cannot resume this attempt; weather/network timeout policy is separate.
  function awaited<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal.reason); };
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      promise.then((value) => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve(value); },
        (error) => { cleanup(); reject(error); });
    });
  }
  async function prepareGeneration(characterId: string, signal: AbortSignal) {
    const document = await awaited(foundation(), signal);
    const character = document.characters.find((item) => item.characterId === characterId);
    if (!character) throw new Error("This Character is no longer available.");
    const binding = resolveBindings(await awaited(bindings(), signal), character.characterId, "messages");
    if (binding.apiConfigId === null) throw new Error("The Messages API binding is disabled for this Character.");
    const config = await awaited(apiConfig(binding.apiConfigId ?? DEFAULT_API_CONFIG_ID), signal);
    if (!config) throw new Error("The selected Text API is missing. Choose a saved config in Settings → Text API.");
    validateApiConfig(config);
    const preset = presetForBinding(await awaited(presets(), signal), binding.presetId);
    return { document, character, config, preset, binding };
  }
  async function sendMessage(sessionId: string, content: string, quoteMessageId?: string, attemptId?: string, signal?: AbortSignal) {
    const check = () => signal?.throwIfAborted();
    const wait = <T>(promise: Promise<T>) => signal ? awaited(promise, signal) : promise;
    const { session } = await wait(storage.readSession(sessionId));
    const document = await wait(foundation());
    const ids = resolveBindings(await wait(bindings()), session.characterId, "messages").regexIds;
    const groups = resolveRegexGroups(await wait(regex()), ids);
    const character = document.characters.find((item) => item.characterId === session.characterId);
    check();
    return storage.send(sessionId, applyRegex(content, groups, "user", "stored",
      { character: character?.name, user: document.user.name }), quoteMessageId, attemptId);
  }
  async function hasUnansweredUserTurn(sessionId: string) {
    try { return (await storage.readSession(sessionId)).messages.some((m) => m.role === "user" && !m.requestedBy); }
    catch { return true; } // Cannot tell: keep the recorded outcome rather than hide a possible pending turn.
  }
  type Draft = { content: string; quoteMessageId?: string; onSent?: () => void };
  async function generateReply(sessionId: string, onFinalized?: (messages: readonly ChatMessage[]) => void,
    regenerateId?: string, source: CompletionSource = "manual-reply", draft?: Draft): Promise<ChatMessage | null> {
    if (active.has(sessionId)) throw new Error("A reply is already in progress.");
    const attempt = { controller: new AbortController(), id: undefined as string | undefined };
    const { controller } = attempt;
    active.set(sessionId, attempt); // Exists synchronously, before Send or storage awaits.
    let unsubscribe = () => {};
    let assistant: ChatMessage | undefined;
    let rawContent = "", finishReason: string | undefined;
    let iterator: AsyncIterator<string> | undefined;
    let draftSaved = false;
    let before: Pick<ChatSession, "updatedAt" | "lastMessageId" | "lastMessagePreview"> | undefined;
    const proactive = source === "proactive";
    const recordPersistence = startGenerationPersistence(source);
    let persisted: GenerationPersistenceOutcome = "nothing-persisted";
    try {
      // Validate prerequisites before any ownership or pending-message claim; failures here
      // leave no attempt, claim or failed assistant behind.
      const { session: target } = await awaited(storage.readSession(sessionId), controller.signal);
      before = { updatedAt: target.updatedAt, lastMessageId: target.lastMessageId, lastMessagePreview: target.lastMessagePreview };
      const prepared = await prepareGeneration(target.characterId, controller.signal);
      attempt.id = await storage.claimGeneration(sessionId, regenerateId,
        source === "continue" ? "continue" : proactive ? "initiate" : "regenerate");
      controller.signal.throwIfAborted();
      unsubscribe = storage.subscribe((change) => {
        if (change.domain === "messages" && change.generationChanged && change.sessionId === sessionId)
          void storage.generationIsCurrent(sessionId, attempt.id!).then((current) => {
            if (!current) controller.abort();
          }).catch(() => { controller.abort(); });
      });
      if (draft?.content.trim()) {
        await awaited(sendMessage(sessionId, draft.content, draft.quoteMessageId, attempt.id, controller.signal).then(() => {
          draftSaved = true;
          try { draft.onSent?.(); } catch { /* Saved user content remains authoritative. */ }
        }), controller.signal);
        controller.signal.throwIfAborted();
      }
      const batch = await storage.beginReply(sessionId, regenerateId, attempt.id,
        source === "continue" ? "continue" : proactive ? "initiate" : "regenerate");
      if (!batch) return null;
      assistant = batch.assistant;
      controller.signal.throwIfAborted();
      const { document, character, config, preset, binding } = prepared;
      const regexGroups = resolveRegexGroups(await awaited(regex(), controller.signal), binding.regexIds);
      // An explicit Binding selection decides book order; only Default All uses library order.
      const books = selectBoundWorldBooks((await awaited(worldBooks(), controller.signal)).books, binding.worldBookIds);
      // Overlap the local read with existing weather/self preparation; no retries or Memory writes.
      const memoryRead = hasSystemMemorySlot(preset)
        ? Promise.resolve().then(() => memories(character.characterId)).then(
          (rows) => {
            const runtime = { foundation: document, character, currentMessages: batch.messages, pending: batch.pending,
              memory: { entries: [] }, regexGroups };
            const context = selectMemoryContext(character.characterId, rows, memoryConversation(runtime, preset));
            // Journal has its own single-entry quota beside Memory's; no match adds nothing.
            const journal = selectJournal(character.characterId, rows, journalTriggerTexts(runtime, preset));
            const used = journal ? { ...context, slot: { ...context.slot, entries: [...context.slot.entries, journalEntry(journal)] },
              ids: [...context.ids, journal.id], outcome: "selected" as const } : context;
            // Remember which exact entries went into this request, for the reply's Memory panel.
            return Promise.all(used.ids.map(async (id): Promise<MemoryRef> => {
              const row = rows.find((candidate) => candidate.id === id)!;
              return { id, hash: await memoryEntryHash(row), ...(row.origin === "journal" ? { journal: true as const } : {}) };
            })).then((refs) => ({ ...used, refs }));
          }).catch(() => ({ ...emptyMemoryContext("unavailable"), refs: undefined as MemoryRef[] | undefined }))
        : Promise.resolve({ ...emptyMemoryContext("preset-disabled"), refs: [] as MemoryRef[] });
      const activation = evaluateWorldBooks(books, batch.messages,
        await awaited(storage.readWorldBookState(sessionId), controller.signal));
      const weather = document.runtime?.timeAware === false ? undefined : await awaited(Promise.all([
        safeWeather(weatherLoader, document.user.location), safeWeather(weatherLoader, character.location),
      ]).then(([user, characterWeather]) => ({
        ...(user.status === "ready" && document.user.location ? {
          user: { location: document.user.location.label, temperatureC: user.temperatureC, summary: user.summary },
        } : {}),
        ...(characterWeather.status === "ready" && character.location ? {
          character: { location: character.location.label, temperatureC: characterWeather.temperatureC, summary: characterWeather.summary },
        } : {}),
      })), controller.signal);
      // Only a reply to the user may react to the user's message; Continue and Character-initiated turns have none.
      const reaction = proactive || source === "continue" ? null : reactionTarget(batch.messages, batch.assistant.order);
      const reactions: ReactionState = { canReact: !!reaction && characterMayReact(batch.messages, reaction), notes: userReactionNotes(batch.messages) };
      const ownState = await awaited(self(character, now().getTime(), { announceChange: source !== "continue",
          allowActions: source !== "continue", reactions,
          lastReplyAt: batch.messages.reduce<number | null>((latest, message) =>
            message.role === "assistant" && message.status === "complete" && (latest === null || message.createdAt > latest)
              ? message.createdAt : latest, null) }), controller.signal);
      // Stickers are offered like the other own actions: not on Continue, and not twice in a row.
      const previousReply = batch.messages.findLast((message) => message.role === "assistant" && message.status === "complete");
      const choices = ownState && source !== "continue" && !previousReply?.sticker
        ? await awaited(stickerSource.menu(character.characterId).catch((): StickerChoice[] => []), controller.signal) : [];
      const offered = ownState && choices.length ? { ...ownState, stickers: choices } : ownState;
      const memory = await awaited(memoryRead, controller.signal);
      await storage.generationStage(sessionId, attempt.id, "provider");
      if (!await awaited(storage.generationIsCurrent(sessionId, attempt.id), controller.signal)) controller.abort();
      controller.signal.throwIfAborted();
      // Last local authority read before provider dispatch; no second model call, retry or stored context.
      const characterState = hasSystemCharacterSlot(preset)
        ? await awaited(Promise.resolve().then(() => states(character)).catch(() => undefined), controller.signal) : undefined;
      controller.signal.throwIfAborted();
      const prompt = assembleChatPrompt(document, character, batch.messages, batch.pending, memory.slot, preset,
        now(), activation, regexGroups, weather, offered, characterState, batch.session.summary);
      if (source === "continue") prompt.messages.push({ role: "system",
        content: "Continue the last assistant turn from where its visible text ended. Output only new continuation text; do not repeat the existing reply." });
      if (proactive) prompt.messages.push({ role: "system", content: PROACTIVE_INSTRUCTION });
      const request: CompletionRequestContext = { requestId: attempt.id, source, sessionId };
      logPromptSummary(request, config.model, prompt.diagnostics, prompt.messages, {
        ids: memory.ids, characterLength: memory.characterLength, outcome: memory.outcome,
      });
      controller.signal.throwIfAborted();
      iterator = provider(config, prompt.messages, controller.signal, preset.generation, request,
        (reason) => { finishReason = reason; })[Symbol.asyncIterator]();
      while (true) {
        const chunk = await awaited(iterator.next(), controller.signal);
        if (chunk.done) break;
        rawContent += chunk.value;
        controller.signal.throwIfAborted();
        const visible = splitActions(rawContent).text;
        // The silence tag is held back, so a Character that stays quiet never flashes text.
        if (proactive && maybeSilence(visible)) continue;
        await storage.updateReply(assistant.id, { content: sanitizeHistoryTimestamps(visible, true), status: "streaming" },
          undefined, attempt.id, controller.signal);
      }
      controller.signal.throwIfAborted();
      await storage.generationStage(sessionId, attempt.id, "finalizing");
      controller.signal.throwIfAborted();
      const { text: replyText, actions } = splitActions(rawContent);
      // The Character's choice is checked against the library as it is now; an unknown or no longer bound code is dropped.
      const sticker = actions?.sticker && choices.length
        ? await awaited(stickerSource.resolve(character.characterId, choices, actions.sticker).catch(() => null), controller.signal) : null;
      if (proactive && !sticker && isSilence(replyText)) {
        // The attempt stays counted; nothing is left in the conversation and nothing is retried.
        await storage.discardReply(sessionId, attempt.id, assistant.id, before!);
        return null;
      }
      const completed = await storage.finalizeReply(assistant.id, sanitizeHistoryTimestamps(replyText), activation.nextState,
        (part) => applyRegex(part, regexGroups, "assistant", "stored", { character: character.name, user: document.user.name }),
        attempt.id, finishReason, controller.signal, undefined, memory.refs, sticker ?? undefined);
      persisted = "committed";
      // Last Seen only: a failure here can neither undo the committed reply nor delay it.
      void Promise.resolve().then(() => recordSent(target.characterId, now().getTime()))
        .catch(() => { console.warn("[Presence] last message time was not saved"); });
      // The Character's own changes: after the commit, once, and never for Continue, which only extends a reply.
      const { reactToUser, ...ownChanges } = actions ?? {};
      delete ownChanges.sticker; // chat data, saved with the reply itself
      if (Object.keys(ownChanges).length && source !== "continue") void Promise.resolve().then(() => applyActions(target.characterId, ownChanges, now().getTime(), completed[0].id))
        .catch(() => { console.warn("[Presence] the Character's own change was not saved"); });
      // The reaction is chat data: checked again against what is stored now, and a failure never undoes the reply.
      if (reactToUser && reaction && reactions.canReact) void storage.readSession(sessionId).then(({ messages }) => {
        const current = messages.find((message) => message.id === reaction.id);
        return current && characterMayReact(messages, current) ? storage.setReaction(current.id, "character", reactToUser) : undefined;
      }).catch(() => { console.warn("[Chat] the Character's reaction was not saved"); });
      try { onFinalized?.(completed); } catch { /* Presentation cannot undo a committed turn. */ }
      return completed[0];
    } catch (error) {
      if (!attempt.id) {
        // Stopped before any claim: nothing was persisted, so there is nothing to report either.
        if (controller.signal.aborted) return null;
        throw error;
      }
      // A Character-initiated attempt that failed or was stopped before writing anything leaves no marker: no one asked for it.
      if (proactive) {
        if (assistant && await storage.discardReply(sessionId, attempt.id, assistant.id, before!).catch(() => false)) return null;
        if (!assistant) { if (controller.signal.aborted) return null; throw error; }
      }
      // Stopped before the draft reached storage: there is no user turn to answer, and a stopped reply here
      // would be an empty bubble whose Retry asks the model to answer nothing. Genuine failures stay recorded.
      if (controller.signal.aborted && !assistant && regenerateId === undefined && draft?.content.trim()
        && !(await hasUnansweredUserTurn(sessionId))) return null;
      // No persisted question exists for a failed reply to retry. Leave the draft
      // with its caller and all earlier inputs unclaimed, rather than saving an empty attempt.
      if (!controller.signal.aborted && !assistant && draft?.content.trim() && !draftSaved) throw error;
      const outcome = controller.signal.aborted ? "stopped" : "failed";
      // Ownership/eligibility rejection is not a provider failure or a new turn.
      if (!assistant && regenerateId !== undefined) {
        if (controller.signal.aborted) return null;
        throw error;
      }
      try {
        const saved = await storage.failGeneration(sessionId, attempt.id, outcome,
          outcome === "stopped" ? "Reply stopped. Retry or delete this attempt." :
            error instanceof Error ? error.message : "Generation failed. Retry or delete this attempt.");
        // null: the attempt no longer owns the session, so no marker was written.
        persisted = saved ? (outcome === "stopped" ? "stopped-recorded" : "failure-recorded") : "owner-lost";
        return saved;
      } catch (markerError) {
        persisted = "failure-record-failed";
        throw markerError;
      }
    } finally {
      unsubscribe();
      // Do not await an uncooperative provider's return(): Stop must settle now.
      if (controller.signal.aborted) void iterator?.return?.().catch(() => {});
      let releaseFailed = false;
      try { if (attempt.id) await storage.releaseGeneration(sessionId, attempt.id); }
      catch (releaseError) { releaseFailed = true; throw releaseError; }
      finally {
        if (active.get(sessionId) === attempt) active.delete(sessionId);
        // An attempt that never claimed ownership has no persisted state to report.
        if (attempt.id) recordPersistence(attempt.id, persisted, releaseFailed);
      }
    }
  }
  return {
    send: (sessionId: string, content: string, quoteMessageId?: string) => sendMessage(sessionId, content, quoteMessageId),
    /** The user's sticker: saved as a sent message like Send; a reply is still requested separately. */
    sendSticker: (sessionId: string, sticker: MessageSticker, quoteMessageId?: string) => storage.sendSticker(sessionId, sticker, quoteMessageId),
    isGenerating: (sessionId: string) => active.has(sessionId),
    /** The Character writes first (or stays silent). One model attempt, counted against the proactive budget; no retry. */
    initiate: (sessionId: string) => generateReply(sessionId, undefined, undefined, "proactive"),
    // Lifecycle cleanup only aborts a local attempt; persisting a Stop is an explicit user action.
    stop: (sessionId: string, options?: { persist?: boolean }) => {
      lastStop.set(sessionId, ++stopSequence);
      const attempt = active.get(sessionId);
      if (attempt) attempt.controller.abort();
      else if (options?.persist) void storage.stopGeneration(sessionId).catch(() => { console.warn("[Chat generation] stop persistence failed"); });
    },
    requestReply: (sessionId: string, onFinalized?: (messages: readonly ChatMessage[]) => void,
      source: CompletionSource = "manual-reply", draft?: Draft) => generateReply(sessionId, onFinalized, undefined, source, draft),
    async regenerateMessage(messageId: string, onFinalized?: (messages: readonly ChatMessage[]) => void, expectedSessionId?: string) {
      const observed = stopSequence;
      const sessionId = expectedSessionId ?? await storage.regenerationSessionId(messageId);
      if ((lastStop.get(sessionId) ?? 0) > observed) return null;
      return generateReply(sessionId, onFinalized, messageId, "regenerate");
    },
    async continueMessage(messageId: string, onFinalized?: (messages: readonly ChatMessage[]) => void, expectedSessionId?: string) {
      const observed = stopSequence;
      const sessionId = expectedSessionId ?? await storage.regenerationSessionId(messageId);
      if ((lastStop.get(sessionId) ?? 0) > observed) return null;
      return generateReply(sessionId, onFinalized, messageId, "continue");
    },
  };
}
export const chatEngine = createChatEngine(chatStorage, () =>
  browserFoundationStorage.load(),
  openAITextProvider,
  () => browserPresetStorage.load(),
);
