import { allUniverses, characterUniverseId, sessionUniverseId } from "../universe";
import { UNIVERSE_ID } from "../foundation-types";
import { SUMMARY_CHARACTERS } from "../chat/summary";
import { memorySourceHash } from "../memory/source-hash";
import { sourceInvalidationValid } from "../memory/source-hash";
import { backgroundSnapshotValid, characterStateVersionValid, stateFoundationValid } from "../memory/state-foundation";
import { normalizeFoundation } from "../foundation-types";
import { normalizeDocument, themeImageAssetIds } from "../theme-types";
import { normalizeBindings } from "../bindings";
import { BUILTIN_PRESET_ID, validatePresetDocument } from "../preset";
import { validateRegexDocument } from "../regex";
import { validateWorldBookDocument } from "../worldbook";
import { normalizeContacts } from "../contact-storage";
import { normalizePresenceDocument } from "../presence/storage";
import { isValidBubbleTimingDelay, MEMORY_REF_LIMIT } from "../chat/types";
import { APP_IDS } from "../app-registry";
import { memoryFingerprint } from "../memory/fingerprint";
import { journalRowProblem } from "../memory/journal";
import { ongoingProblem } from "../memory/ongoing";
import { MEMORY_OPERATION_LIMIT } from "../memory/types";
import { memoryMessageEligible } from "../memory/sequence";
import { memoryBatchActive, validMemoryProgress } from "../memory/progress-types";
import type { ChatMessage } from "../chat/types";
import { isMessageReactions } from "../chat/reactions";
import { isMessageSticker } from "../chat/sticker-message";
import { isMessageAttachment } from "../chat/attachment";
import { parseBackupJson } from "./json";
import {
  BACKUP_SCHEMA, BACKUP_VERSION, BACKUP_DOMAIN_VERSIONS, BACKUP_READABLE_DOMAIN_VERSIONS, BackupValidationError,
  type BackupManifest, type BackupDomain, type BackupData, type BackupWarning, type ValidatedBackup,
} from "./format";

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const MAX_ASSETS = 10_000;
type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v === v.trim() && v.length <= 200
  && !["__proto__", "constructor", "prototype"].includes(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const safePath = (v: unknown): v is string => typeof v === "string" && v.length <= 240
  && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(v)
  && v.split("/").every((part) => part !== "." && part !== "..");
function check(condition: unknown, path: string, code = "invalid-data", detail?: string): asserts condition {
  if (!condition) throw new BackupValidationError(code, path, detail);
}
/** Field names come from stored rows; only plain identifiers are echoed, anything else is hidden. */
const fieldNames = (names: string[]) => names.slice(0, 5).map((name) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : "?").join(",");
function keys(row: unknown, allowed: string[], required: string[], path: string): asserts row is Row {
  check(record(row), path, "invalid-data", "not-an-object");
  // `generation` goes first so the five-name cap can never hide an unfinished reply.
  const extra = Object.keys(row).filter((key) => !allowed.includes(key)).sort((a, b) => Number(b === "generation") - Number(a === "generation"));
  check(!extra.length, path, "invalid-data", `unexpected-field:${fieldNames(extra)}`);
  const missing = required.filter((key) => !Object.hasOwn(row, key));
  check(!missing.length, path, "invalid-data", `missing-field:${fieldNames(missing)}`);
}
function unique(rows: unknown, field: string, path: string): asserts rows is Row[] {
  check(Array.isArray(rows), path);
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    check(record(row) && id(row[field]), `${path}[${index}]`);
    check(!seen.has(row[field]), `${path}[${index}]`, "duplicate-id");
    seen.add(row[field]);
  });
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (record(v)) return `{${Object.keys(v).sort().map((key) => `${JSON.stringify(key)}:${canonical(v[key])}`).join(",")}}`;
  return JSON.stringify(v);
}
function unchanged(value: unknown, validate: (v: unknown) => unknown, path: string) {
  try { check(canonical(value) === canonical(validate(value)), path, "lossy-data"); }
  catch (error) {
    if (error instanceof BackupValidationError) throw error;
    throw new BackupValidationError("invalid-data", path);
  }
}
function json(text: string, path: string): unknown {
  try { return parseBackupJson(text); }
  catch { throw new BackupValidationError("invalid-json", path); }
}

/** Parses only the manifest. Payload integrity and references require validateBackupPackage. */
export function parseBackupManifest(text: string): BackupManifest {
  check(new TextEncoder().encode(text).byteLength <= MAX_MANIFEST_BYTES, "manifest", "size-limit");
  const raw = json(text, "manifest");
  const fields = ["schema", "version", "backupId", "createdAt", "sourceCommit", "credentials", "domains", "assets"];
  keys(raw, fields, fields, "manifest");
  check(raw.schema === BACKUP_SCHEMA && raw.version === BACKUP_VERSION, "manifest.version", "unsupported-format");
  check(id(raw.backupId) && integer(raw.createdAt) && typeof raw.sourceCommit === "string"
    && /^[a-f0-9]{40}$/.test(raw.sourceCommit), "manifest.metadata");
  check(raw.credentials === "excluded", "manifest.credentials", "credentials-not-supported");
  check(Array.isArray(raw.domains) && raw.domains.length === Object.keys(BACKUP_DOMAIN_VERSIONS).length, "manifest.domains", "domain-coverage");
  check(Array.isArray(raw.assets) && raw.assets.length <= MAX_ASSETS, "manifest.assets", "size-limit");
  const domains = new Set<string>(), paths = new Set<string>(), assets = new Set<string>();
  let bytes = 0;
  const file = (entry: Row, path: string) => {
    check(safePath(entry.path) && integer(entry.bytes) && digest(entry.sha256), path);
    check(!paths.has(entry.path), path, "duplicate-path");
    paths.add(entry.path); bytes += entry.bytes as number;
    check(bytes <= MAX_PACKAGE_BYTES, "manifest", "size-limit");
  };
  raw.domains.forEach((section, index) => {
    const path = `manifest.domains[${index}]`;
    keys(section, ["domain", "version", "path", "bytes", "sha256", "records"], ["domain", "version", "path", "bytes", "sha256", "records"], path);
    check(typeof section.domain === "string" && Object.hasOwn(BACKUP_DOMAIN_VERSIONS, section.domain), path, "unsupported-domain");
    check(!domains.has(section.domain), path, "duplicate-domain"); domains.add(section.domain);
    check((section.version === BACKUP_DOMAIN_VERSIONS[section.domain as BackupDomain]
      || section.version === BACKUP_READABLE_DOMAIN_VERSIONS[section.domain as BackupDomain]), path, "unsupported-domain-version");
    check(integer(section.records), path);
    file(section, path);
    check((section.bytes as number) <= MAX_JSON_BYTES, path, "size-limit");
  });
  raw.assets.forEach((asset, index) => {
    const path = `manifest.assets[${index}]`;
    const fields = ["domain", "id", "path", "bytes", "sha256", "mime", "createdAt"];
    keys(asset, fields, fields, path);
    check(["appearance", "chat"].includes(String(asset.domain)) && id(asset.id) && integer(asset.createdAt), path);
    check(typeof asset.mime === "string" && /^image\/[a-z0-9.+-]+$/i.test(asset.mime), path);
    file(asset, path); check((asset.bytes as number) > 0, path);
    if (asset.domain === "appearance") check(digest(asset.id) && asset.id === asset.sha256, path, "asset-identity");
    const identity = `${asset.domain}:${asset.id}`;
    check(!assets.has(identity), path, "duplicate-id"); assets.add(identity);
  });
  return raw as unknown as BackupManifest;
}

function validateChat(value: unknown, version: number) {
  const fields = ["sessions", "messages", "chatSettings", "worldBookStates"];
  keys(value, fields, fields, "chat");
  unique(value.sessions, "id", "chat.sessions"); unique(value.messages, "id", "chat.messages");
  unique(value.chatSettings, "id", "chat.chatSettings"); unique(value.worldBookStates, "id", "chat.worldBookStates");
  const sessions = new Map(value.sessions.map((row) => [row.id, row])), direct = new Set<string>();
  value.sessions.forEach((row, index) => {
    const path = `chat.sessions[${index}]`;
    keys(row, ["id", "characterId", "universeId", "type", "participantIds", "title", "updatedAt", "pinned", "lastMessageId", "lastMessagePreview", "autoReplyOnKeyboardDismiss", "streamOnline", "backgroundImage", "backgroundBlur", "customCSS", "nextOrder", "memorySequence", "summary", "proactiveAttempts", "unreadCount", "lifeMode"],
      ["id", "characterId", "updatedAt", "autoReplyOnKeyboardDismiss", "nextOrder"], path);
    check(typeof row.characterId === "string", path, "invalid-data", "characterId-not-string");
    check(integer(row.updatedAt), path, "invalid-data", "updatedAt-not-integer");
    check(integer(row.nextOrder) && (row.nextOrder as number) >= 1, path, "invalid-data", "nextOrder-invalid");
    check(typeof row.autoReplyOnKeyboardDismiss === "boolean", path, "invalid-data", "autoReplyOnKeyboardDismiss-not-boolean");
    check(row.universeId === undefined || id(row.universeId), path, "invalid-data", "universeId-invalid");
    check(row.type === undefined || ["direct", "group"].includes(String(row.type)), path, "invalid-data", "type-invalid");
    if (row.memorySequence !== undefined) {
      keys(row.memorySequence, ["epoch", "nextSeq"], ["epoch", "nextSeq"], path);
      check(row.type !== "group" && id(row.memorySequence.epoch) && integer(row.memorySequence.nextSeq) && (row.memorySequence.nextSeq as number) >= 1, path);
    }
    if (row.summary !== undefined) {
      keys(row.summary, ["text", "throughOrder", "digest", "updatedAt"], ["text", "throughOrder", "digest", "updatedAt"], path);
      check(row.type !== "group" && typeof row.summary.text === "string" && row.summary.text.trim().length > 0 && row.summary.text.length <= SUMMARY_CHARACTERS
        && integer(row.summary.throughOrder) && (row.summary.throughOrder as number) >= 1 && (row.summary.throughOrder as number) < (row.nextOrder as number)
        && typeof row.summary.digest === "string" && /^\d+:[0-9a-f]{1,14}$/.test(row.summary.digest) && integer(row.summary.updatedAt),
        path, "invalid-data", "summary-invalid");
    }
    if (row.proactiveAttempts !== undefined)
      check(row.type !== "group" && Array.isArray(row.proactiveAttempts) && row.proactiveAttempts.length >= 1
        && row.proactiveAttempts.length <= 10 && row.proactiveAttempts.every(integer), path, "invalid-data", "proactiveAttempts-invalid");
    if (row.lifeMode !== undefined) check(row.type !== "group" && row.lifeMode === true, path, "invalid-data", "lifeMode-invalid");
    if (row.unreadCount !== undefined)
      check(row.type !== "group" && integer(row.unreadCount) && (row.unreadCount as number) >= 1, path, "invalid-data", "unreadCount-invalid");
    for (const key of ["pinned", "streamOnline"]) check(row[key] === undefined || typeof row[key] === "boolean", path, "invalid-data", `${key}-not-boolean`);
    for (const key of ["title", "lastMessagePreview", "customCSS"]) check(row[key] === undefined || typeof row[key] === "string", path, "invalid-data", `${key}-not-string`);
    for (const key of ["lastMessageId", "backgroundImage"]) check(row[key] === undefined || id(row[key]), path, "invalid-data", `${key}-invalid-id`);
    check(row.backgroundBlur === undefined || (number(row.backgroundBlur) && (row.backgroundBlur as number) >= 0 && (row.backgroundBlur as number) <= 20),
      path, "invalid-data", "backgroundBlur-out-of-range");
    if (row.type === "group") {
      check(Array.isArray(row.participantIds) && row.participantIds.every(id)
        && new Set(row.participantIds).size === row.participantIds.length, path, "invalid-data", "participantIds-invalid");
      check(row.participantIds.length ? row.participantIds.includes(row.characterId) : row.characterId === "",
        path, "invalid-data", "group-characterId-mismatch");
    } else {
      check(id(row.characterId), path, "invalid-data", "direct-characterId-invalid");
      check(row.participantIds === undefined, path, "invalid-data", "direct-has-participantIds");
      check(row.title === undefined, path, "invalid-data", "direct-has-title");
      check(!direct.has(row.characterId), path, "duplicate-direct-chat"); direct.add(row.characterId);
    }
  });
  const messages = new Map(value.messages.map((row) => [row.id, row])), orders = new Set<string>(), memorySeqs = new Set<string>();
  // Multi-bubble turn IDs may survive deletion of their first bubble. Ownership still matters.
  const turns = new Map<unknown, unknown>(), attempts = new Map<unknown, unknown>();
  value.messages.forEach((row, index) => {
    for (const [field, owners] of [["turnId", turns], ["attemptId", attempts]] as const) {
      if (row[field] === undefined) continue;
      check(id(row[field]), `chat.messages[${index}]`);
      check(!owners.has(row[field]) || owners.get(row[field]) === row.sessionId,
        `chat.messages[${index}]`, "cross-session-reference");
      owners.set(row[field], row.sessionId);
    }
  });
  const attachmentAssets = new Set<string>();
  value.messages.forEach((row, index) => {
    const path = `chat.messages[${index}]`;
    keys(row, ["id", "sessionId", "role", "content", "status", "createdAt", "sentAt", "order", "requestedBy", "error", "quote", "turnId", "attemptId", "attemptFor", "attemptMode", "outcome", "finishReason", "failureStage", "confirmed", "memorySequence", "memoryRefs", "reactions", "sticker", "voice", "imageGen", "attachment", "transfer", "transferEvent", "gift", "giftEvent", "recalled"],
      ["id", "sessionId", "role", "content", "status", "createdAt", "order"], path);
    check(id(row.sessionId) && sessions.has(row.sessionId), path, "missing-session");
    check(["user", "assistant", "system"].includes(String(row.role)) && typeof row.content === "string"
      && ["sent", "complete", "cancelled", "error"].includes(String(row.status)) && integer(row.createdAt)
      && integer(row.order) && (row.order as number) >= 1, path);
    check(row.sentAt === undefined || integer(row.sentAt), path, "invalid-data", "sentAt-invalid");
    const order = `${row.sessionId}:${row.order}`;
    check(!orders.has(order), path, "duplicate-order"); orders.add(order);
    check((row.order as number) < (sessions.get(row.sessionId)!.nextOrder as number), path, "invalid-next-order");
    for (const key of ["requestedBy", "turnId", "attemptId", "attemptFor"]) check(row[key] === undefined || id(row[key]), path);
    for (const key of ["error", "finishReason"]) check(row[key] === undefined || typeof row[key] === "string", path);
    check(row.confirmed === undefined || typeof row.confirmed === "boolean", path);
    if (row.recalled !== undefined) {
      keys(row.recalled, ["at", "by"], ["at", "by"], path);
      check(integer(row.recalled.at) && (row.recalled.by === "user" || row.recalled.by === "assistant")
        && row.role === row.recalled.by && row.content === "", path);
    }
    if (row.memoryRefs !== undefined) {
      // Ids and content hashes only: a backup never carries injected memory text inside a chat message.
      check(Array.isArray(row.memoryRefs) && row.memoryRefs.length <= MEMORY_REF_LIMIT && row.role === "assistant", path);
      for (const ref of row.memoryRefs as unknown[]) {
        keys(ref, ["id", "hash", "journal"], ["id", "hash"], path);
        check(id(ref.id) && typeof ref.hash === "string" && /^[0-9a-f]{16}$/.test(ref.hash) && (ref.journal === undefined || ref.journal === true), path);
      }
    }
    check(row.reactions === undefined || (isMessageReactions(row.reactions) && (row.role === "user" || row.role === "assistant")), path);
    // A voice bubble is the Character's own words; the audio is made again from them and never travels in a backup.
    check(row.voice === undefined || (version >= 2 && row.voice === true && row.role === "assistant" && row.sticker === undefined && row.attachment === undefined
      && row.transfer === undefined && row.transferEvent === undefined && row.gift === undefined && row.giftEvent === undefined && row.recalled === undefined), path, "invalid-data", "voice-invalid");
    // A picture still being made (or that failed): only its request is kept, and it can be asked again after a restore.
    const asked = row.imageGen as { prompt?: unknown; character?: unknown } | undefined;
    check(row.imageGen === undefined || (version >= 2 && !!asked && typeof asked === "object" && !Array.isArray(asked) && Object.keys(asked).length === 2
      && typeof asked.prompt === "string" && asked.prompt.trim().length > 0 && Array.from(asked.prompt).length <= 400 && typeof asked.character === "boolean"
      && row.role === "assistant" && row.sticker === undefined && row.attachment === undefined && row.voice === undefined
      && row.transfer === undefined && row.transferEvent === undefined && row.gift === undefined && row.giftEvent === undefined && row.recalled === undefined), path, "invalid-data", "image-request-invalid");
    check(row.sticker === undefined || (isMessageSticker(row.sticker) && (row.role === "user" || row.role === "assistant")), path);
    if (row.attachment !== undefined) {
      // A message owns its asset one-to-one (the asset is deleted with the message), and a recalled one keeps nothing.
      check(version >= 2 && isMessageAttachment(row.attachment) && (row.role === "user" || row.role === "assistant")
        && row.sticker === undefined && row.transfer === undefined && row.transferEvent === undefined
        && row.gift === undefined && row.giftEvent === undefined && row.recalled === undefined, path, "invalid-data", "attachment-invalid");
      check(!attachmentAssets.has(row.attachment.assetId), path, "duplicate-id", "attachment-asset-shared");
      attachmentAssets.add(row.attachment.assetId);
    }
    if (row.transfer !== undefined) {
      keys(row.transfer, ["amount", "note", "sender", "recipient", "status"], ["amount", "note", "sender", "recipient", "status"], path);
      const transfer = row.transfer;
      check(number(transfer.amount) && (transfer.amount as number) > 0 && (transfer.amount as number) <= 1_000_000_000_000
        && typeof transfer.note === "string" && transfer.note.length <= 240
        && ["user", "assistant"].includes(String(transfer.sender))
        && ["user", "assistant"].includes(String(transfer.recipient)) && transfer.sender !== transfer.recipient
        && ["pending", "received", "declined", "returned"].includes(String(transfer.status))
        && row.role === transfer.sender && row.transferEvent === undefined && row.recalled === undefined, path);
    }
    if (row.transferEvent !== undefined) {
      keys(row.transferEvent, ["transferId", "action", "actor", "amount", "note"], ["transferId", "action", "actor", "amount", "note"], path);
      const event = row.transferEvent, source = messages.get(String(event.transferId));
      const sourceTransfer = source && record(source.transfer) ? source.transfer : null;
      check(id(event.transferId) && !!sourceTransfer && source?.sessionId === row.sessionId
        && ["receive", "decline", "return"].includes(String(event.action))
        && ["user", "assistant"].includes(String(event.actor)) && row.role === event.actor
        && number(event.amount) && event.amount === sourceTransfer.amount
        && typeof event.note === "string" && event.note.length <= 240 && row.transfer === undefined, path);
    }
    if (row.gift !== undefined) {
      keys(row.gift, ["icon", "content", "sender", "recipient", "status"], ["icon", "content", "sender", "recipient", "status"], path);
      const gift = row.gift;
      check(typeof gift.icon === "string" && gift.icon.length > 0 && Array.from(gift.icon).length <= 24
        && typeof gift.content === "string" && gift.content.trim().length > 0 && Array.from(gift.content).length <= 500
        && ["user", "assistant"].includes(String(gift.sender)) && ["user", "assistant"].includes(String(gift.recipient))
        && gift.sender !== gift.recipient && ["pending", "accepted", "declined"].includes(String(gift.status))
        && row.role === gift.sender && row.transfer === undefined && row.transferEvent === undefined
        && row.giftEvent === undefined && row.recalled === undefined, path);
    }
    if (row.giftEvent !== undefined) {
      keys(row.giftEvent, ["giftId", "action", "actor", "icon", "content"], ["giftId", "action", "actor", "icon", "content"], path);
      const event = row.giftEvent, source = messages.get(String(event.giftId));
      const sourceGift = source && record(source.gift) ? source.gift : null;
      check(id(event.giftId) && !!sourceGift && source?.sessionId === row.sessionId
        && (event.action === "accept" || event.action === "decline")
        && ["user", "assistant"].includes(String(event.actor)) && row.role === event.actor
        && typeof event.icon === "string" && event.icon.length > 0 && Array.from(event.icon).length <= 24
        && typeof event.content === "string" && event.content.trim().length > 0 && Array.from(event.content).length <= 500
        && event.icon === sourceGift.icon && event.content === sourceGift.content
        && row.gift === undefined && row.transfer === undefined && row.transferEvent === undefined, path);
    }
    if (row.memorySequence !== undefined) {
      keys(row.memorySequence, ["epoch", "seq"], ["epoch"], path);
      const session = sessions.get(row.sessionId)!, tracking = session.memorySequence as { epoch?: string; nextSeq?: number } | undefined;
      check(id(row.memorySequence.epoch) && row.memorySequence.epoch === tracking?.epoch, path);
      if (row.memorySequence.seq !== undefined) {
        check(integer(row.memorySequence.seq) && (row.memorySequence.seq as number) >= 1 && (row.memorySequence.seq as number) < tracking!.nextSeq!
          && row.recalled === undefined && memoryMessageEligible(row as unknown as ChatMessage), path);
        const seqKey = `${row.sessionId}\u0000${row.memorySequence.epoch}\u0000${row.memorySequence.seq}`;
        check(!memorySeqs.has(seqKey), path, "duplicate-memory-sequence"); memorySeqs.add(seqKey);
      }
    }
    check(row.attemptMode === undefined || ["regenerate", "continue"].includes(String(row.attemptMode)), path);
    check(row.outcome === undefined || ["success", "stopped", "failed", "truncated", "interrupted"].includes(String(row.outcome)), path);
    check(row.failureStage === undefined || ["preparing", "provider", "finalizing"].includes(String(row.failureStage)), path);
    if (row.quote !== undefined) {
      keys(row.quote, ["messageId", "preview", "role"], ["messageId", "preview", "role"], path);
      check(id(row.quote.messageId) && typeof row.quote.preview === "string" && ["user", "assistant"].includes(String(row.quote.role)), path);
      const target = messages.get(row.quote.messageId);
      check(!target || target.sessionId === row.sessionId, path, "cross-session-reference");
    }
    // requestedBy is a message reference; an identically named turn is a separate namespace.
    const requested = messages.get(row.requestedBy);
    check(!requested || requested.sessionId === row.sessionId, path, "cross-session-reference");
    // turnId ownership was checked above. attemptFor stores target.turnId ?? target.id;
    // surviving turn ownership wins, with a message-ID fallback for legacy replies.
    const attemptOwner = turns.has(row.attemptFor) ? turns.get(row.attemptFor) : messages.get(row.attemptFor)?.sessionId;
    check(attemptOwner === undefined || attemptOwner === row.sessionId, path, "cross-session-reference");
  });
  value.sessions.forEach((row, index) => {
    if (row.lastMessageId !== undefined) check(messages.get(row.lastMessageId)?.sessionId === row.id,
      `chat.sessions[${index}]`, "missing-last-message");
  });
  value.chatSettings.forEach((row, index) => {
    const path = `chat.chatSettings[${index}]`;
    if (row.id === "chat-background") {
      keys(row, ["id", "globalChatBackgroundImage", "blur"], ["id"], path);
      check(row.globalChatBackgroundImage === undefined || id(row.globalChatBackgroundImage), path);
      check(row.blur === undefined || (number(row.blur) && (row.blur as number) >= 0 && (row.blur as number) <= 20), path);
    } else {
      keys(row, ["id", "bubbleTiming", "hereThereEnabled", "nextCommentAt"], ["id", "bubbleTiming", "hereThereEnabled", "nextCommentAt"], path);
      check(row.id === "global-profile-settings" && typeof row.hereThereEnabled === "boolean" && (row.nextCommentAt === null || integer(row.nextCommentAt)), path);
      keys(row.bubbleTiming, ["shortMs", "mediumMs", "longMs"], ["shortMs", "mediumMs", "longMs"], path);
      check(Object.values(row.bubbleTiming).every(isValidBubbleTimingDelay), path);
    }
  });
  value.worldBookStates.forEach((row, index) => {
    const path = `chat.worldBookStates[${index}]`;
    keys(row, ["id", "state"], ["id", "state"], path); check(sessions.has(row.id), path, "missing-session");
    keys(row.state, ["cycle", "prefix", "signature", "entries"], ["cycle", "prefix", "entries"], path);
    check(integer(row.state.cycle) && Array.isArray(row.state.prefix) && row.state.prefix.every((v) => typeof v === "string")
      && (row.state.signature === undefined || typeof row.state.signature === "string") && record(row.state.entries), path);
    Object.values(row.state.entries).forEach((entry) => {
      keys(entry, ["firstMatch", "stickyUntil", "cooldownUntil"], [], path);
      check(Object.values(entry).every(integer), path);
    });
  });
}

const MEMORY_SOURCE_FIELDS = ["sessionId", "messageId"];
function memorySources(value: unknown, path: string): asserts value is Row[] {
  check(Array.isArray(value), path, "invalid-data", "sources-not-array");
  const seen = new Set<string>();
  value.forEach((source, index) => {
    keys(source, MEMORY_SOURCE_FIELDS, MEMORY_SOURCE_FIELDS, `${path}[${index}]`);
    check(id(source.sessionId) && id(source.messageId), `${path}[${index}]`, "invalid-data", "source-id-invalid");
    const key = `${source.sessionId}\u0000${source.messageId}`;
    check(!seen.has(key), `${path}[${index}]`, "duplicate-id"); seen.add(key);
  });
}
function memoryRow(row: unknown, path: string): asserts row is Row {
  const fields = ["id", "characterId", "kind", "text", "subject", "status", "origin", "sources", "lineage", "fingerprint", "createdAt", "updatedAt"];
  // `keywords` exists on Journal rows only (absent otherwise); no DB or manifest version change is needed for it.
  keys(row, [...fields, ...((row as Row | null)?.origin === "journal" ? ["keywords"] : []), ...((row as Row | null)?.kind === "ongoing" ? ["ongoing"] : [])], fields, path);
  check(id(row.id) && id(row.characterId), path, "invalid-data", "id-invalid");
  check(typeof row.kind === "string" && typeof row.text === "string" && typeof row.subject === "string", path, "invalid-data", "text-field-not-string");
  check(["active", "superseded", "archived", "flagged"].includes(String(row.status)), path, "invalid-data", "status-invalid");
  check(["manual", "auto", "journal"].includes(String(row.origin)), path, "invalid-data", "origin-invalid");
  memorySources(row.sources, `${path}.sources`);
  keys(row.lineage, ["mergedFrom", "supersededBy", "previousStatus"], [], `${path}.lineage`);
  check(row.lineage.previousStatus === undefined || (["active", "archived", "flagged"].includes(String(row.lineage.previousStatus)) && row.lineage.supersededBy !== undefined), path);
  check(row.lineage.mergedFrom === undefined || (Array.isArray(row.lineage.mergedFrom) && row.lineage.mergedFrom.every(id)
    && new Set(row.lineage.mergedFrom).size === row.lineage.mergedFrom.length && !row.lineage.mergedFrom.includes(row.id)),
    path, "invalid-data", "mergedFrom-invalid");
  check(row.lineage.supersededBy === undefined || (id(row.lineage.supersededBy) && row.lineage.supersededBy !== row.id), path, "invalid-data", "supersededBy-invalid");
  // The fingerprint is always derived from the text; a stored value that disagrees is a damaged or edited file.
  check(typeof row.fingerprint === "string" && !!row.fingerprint && row.fingerprint === memoryFingerprint(row.text as string), path, "invalid-data", "fingerprint-mismatch");
  check(integer(row.createdAt) && integer(row.updatedAt), path, "invalid-data", "timestamp-invalid");
  check(ongoingProblem(row as never) === null, path, "invalid-data", "ongoing-invalid");
  if (row.origin === "journal") check(journalRowProblem(row as never) === null, path, "invalid-data", "journal-invalid");
}
function suppressionRow(row: unknown, path: string): asserts row is Row {
  const fields = ["id", "characterId", "fingerprint", "reason", "sources", "createdAt"];
  keys(row, fields, fields, path);
  check(id(row.id) && id(row.characterId) && typeof row.fingerprint === "string" && !!row.fingerprint, path, "invalid-data", "id-invalid");
  check(["corrected", "deleted"].includes(String(row.reason)) && integer(row.createdAt), path, "invalid-data", "field-invalid");
  memorySources(row.sources, `${path}.sources`);
}

/** Structure only; references to Characters and chat are checked in `references` once every domain is parsed. */
function validateMemory(value: unknown, version: number) {
  const stores = ["memories", "suppressions", "operations", "cursors", ...(version === 1 ? [] : ["backgrounds", "states"])];
  keys(value, stores, stores, "memory");
  for (const name of stores) unique(value[name], "id", `memory.${name}`);
  if (version !== 1) {
    const state = value as unknown as BackupData["memory"];
    state.backgrounds.forEach((row, index) => check(backgroundSnapshotValid(row), `memory.backgrounds[${index}]`, "invalid-data", "background-invalid"));
    state.states.forEach((row, index) => check(characterStateVersionValid(row), `memory.states[${index}]`, "invalid-data", "state-invalid"));
    check(stateFoundationValid(state), "memory.states", "invalid-data", "state-graph-invalid");
  }
  const { memories, suppressions, operations, cursors } = value as Record<string, Row[]>;
  memories.forEach((row, index) => memoryRow(row, `memory.memories[${index}]`));
  suppressions.forEach((row, index) => suppressionRow(row, `memory.suppressions[${index}]`));
  const perCharacter = new Map<string, Set<number>>();
  operations.forEach((row, index) => {
    const path = `memory.operations[${index}]`;
    keys(row, ["id", "characterId", "seq", "label", "createdAt", "changes", "suppressionChanges"], ["id", "characterId", "seq", "label", "createdAt", "changes"], path);
    check(id(row.characterId) && integer(row.seq) && (row.seq as number) >= 1 && row.id === `${row.characterId}\u0000${row.seq}`, path, "invalid-data", "id-invalid");
    check(typeof row.label === "string" && integer(row.createdAt) && Array.isArray(row.changes), path, "invalid-data", "field-invalid");
    const seqs = perCharacter.get(row.characterId as string) ?? new Set<number>();
    seqs.add(row.seq as number); perCharacter.set(row.characterId as string, seqs);
    check(seqs.size <= MEMORY_OPERATION_LIMIT, path, "invalid-data", "operation-limit");
    const owned = (item: Row, at: string) => check(item.characterId === row.characterId, at, "cross-character-reference");
    (row.changes as unknown[]).forEach((change, at) => {
      const where = `${path}.changes[${at}]`;
      keys(change, ["before", "after"], ["before", "after"], where);
      check(change.before !== null || change.after !== null, where, "invalid-data", "empty-change");
      for (const side of ["before", "after"] as const)
        if (change[side] !== null) { memoryRow(change[side], `${where}.${side}`); owned(change[side] as Row, where); }
    });
    if (row.suppressionChanges !== undefined) {
      check(Array.isArray(row.suppressionChanges), path, "invalid-data", "suppressionChanges-not-array");
      (row.suppressionChanges as unknown[]).forEach((change, at) => {
        const where = `${path}.suppressionChanges[${at}]`;
        keys(change, ["before", "after"], ["before", "after"], where);
        suppressionRow(change.after, `${where}.after`); owned(change.after as Row, where);
        if (change.before !== null) { suppressionRow(change.before, `${where}.before`); owned(change.before as Row, where); }
      });
    }
  });
  const cursorKeys = new Set<string>();
  cursors.forEach((row, index) => {
    const path = `memory.cursors[${index}]`;
    keys(row, ["id", "characterId", "sessionId", "processedMessageId", "extraction", "failureCount", "failureReason", "clearRequestedAt", "clearToken", "clearMessageIds", "clearLineageIds", "sourceInvalidation", "updatedAt"],
      ["id", "characterId", "sessionId", "failureCount", "updatedAt"], path);
    check(id(row.characterId) && id(row.sessionId) && row.id === `${row.characterId}\u0000${row.sessionId}`, path, "invalid-data", "id-invalid");
    check(row.processedMessageId === undefined || id(row.processedMessageId), path, "invalid-data", "processedMessageId-invalid");
    if (row.extraction !== undefined) {
      check(validMemoryProgress(row.extraction), path, "invalid-memory-progress");
      check(!row.extraction.batches.some(memoryBatchActive), path, "memory-batch-active");
    }
    check(integer(row.failureCount) && integer(row.updatedAt) && (row.failureReason === undefined || typeof row.failureReason === "string")
      && (row.clearRequestedAt === undefined || integer(row.clearRequestedAt)), path, "invalid-data", "field-invalid");
    check(row.clearMessageIds === undefined || (row.clearRequestedAt !== undefined && Array.isArray(row.clearMessageIds)
      && row.clearMessageIds.every(id) && new Set(row.clearMessageIds).size === row.clearMessageIds.length), path, "invalid-data", "clearMessageIds-invalid");
    check(row.clearLineageIds === undefined || (row.clearRequestedAt !== undefined && Array.isArray(row.clearLineageIds)
      && row.clearLineageIds.every(id) && new Set(row.clearLineageIds).size === row.clearLineageIds.length), path, "invalid-data", "clearLineageIds-invalid");
    check(row.sourceInvalidation === undefined || (row.clearRequestedAt !== undefined && Array.isArray(row.clearMessageIds) && sourceInvalidationValid(row.sourceInvalidation, row.clearMessageIds as string[])), path, "invalid-data", "sourceInvalidation-invalid");
    check(row.clearToken === undefined || (row.clearRequestedAt !== undefined && id(row.clearToken)), path, "invalid-data", "clearToken-invalid");
    check(!cursorKeys.has(row.id as string), path, "duplicate-id"); cursorKeys.add(row.id as string);
  });
}

function validateDomain(domain: BackupDomain, value: unknown, version: number): number {
  if (domain === "chat") {
    validateChat(value, version);
    const chat = value as BackupData["chat"];
    return chat.sessions.length + chat.messages.length + chat.chatSettings.length + chat.worldBookStates.length;
  }
  if (domain === "memory") {
    validateMemory(value, version);
    return Object.values(value as BackupData["memory"]).reduce((count, rows) => count + rows.length, 0);
  }
  if (domain === "apiConfigs") {
    unique(value, "id", domain);
    value.forEach((row, index) => {
      const fields = ["id", "name", "provider", "baseUrl", "model"];
      keys(row, [...fields, "imageInput", "imageLimit"], fields, `apiConfigs[${index}]`);
      check((row.imageInput === undefined || typeof row.imageInput === "boolean")
        && (row.imageLimit === undefined || (Number.isInteger(row.imageLimit) && (row.imageLimit as number) >= 1 && (row.imageLimit as number) <= 4)),
        `apiConfigs[${index}]`);
      check(typeof row.name === "string" && !!row.name.trim() && typeof row.baseUrl === "string" && typeof row.model === "string"
        && ["OpenAI-compatible", "Custom"].includes(String(row.provider)), `apiConfigs[${index}]`);
    });
    return value.length;
  }
  if (value === null) return 0;
  check(record(value), domain);
  if (domain !== "bindings") check(value.version === BACKUP_DOMAIN_VERSIONS[domain], domain, "unsupported-domain-version");
  switch (domain) {
    case "foundation": unchanged(value, normalizeFoundation, domain); return 1;
    case "appearance": unchanged(value, (v) => normalizeDocument(v, false), domain); return 1;
    case "bindings": unchanged(value, (v) => normalizeBindings(v,
      record(value.characters) ? Object.keys(value.characters) : []), domain); return 1;
    case "presets": unchanged(value, validatePresetDocument, domain); return (value.presets as unknown[]).length;
    case "regex": unchanged(value, validateRegexDocument, domain); return (value.groups as unknown[]).length;
    case "worldbooks": unchanged(value, validateWorldBookDocument, domain); return (value.books as unknown[]).length;
    case "contacts": unique(value.contacts, "id", domain); unchanged(value, normalizeContacts, domain); return value.contacts.length;
    case "presence": unchanged(value, normalizePresenceDocument, domain); return (value.characters as unknown[]).length;
  }
}

function references(data: BackupData, manifest: BackupManifest): BackupWarning[] {
  const warnings: BackupWarning[] = [];
  const characters = new Set(data.foundation?.characters.map((row) => row.characterId));
  const character = (value: string, path: string) => check(characters.has(value), path, "missing-character");
  const assets = new Set(manifest.assets.map((row) => `${row.domain}:${row.id}`));
  const image = (value: string | null | undefined, path: string) => {
    if (value?.startsWith("http:") || value?.startsWith("https:")) warnings.push({ code: "external-image", path });
  };
  if (data.appearance) {
    for (const assetId of themeImageAssetIds(data.appearance)) check(assets.has(`appearance:${assetId}`), "appearance", "missing-asset");
    [data.appearance.current, ...data.appearance.presets.map((row) => row.snapshot)].forEach((snapshot, index) => {
      const path = `appearance.snapshots[${index}]`;
      snapshot.widgets.forEach((widget) => {
        if (widget.config.characterId) character(widget.config.characterId, path);
        if (widget.config.comment) check(widget.config.comment.characterId === widget.config.characterId, path, "cross-character-reference");
      });
      [snapshot.profile.wallpaper.source, snapshot.profile.dock.image, ...Object.values(snapshot.profile.icons)].forEach((source) => image(source, path));
    });
  }
  data.foundation?.characters.forEach((row, index) => image(row.avatar, `foundation.characters[${index}]`));
  image(data.foundation?.user.avatar, "foundation.user");
  data.worldbooks?.books.forEach((book, index) => check(!!data.foundation && allUniverses(data.foundation).some((u) => u.id === (book.universeId ?? UNIVERSE_ID)), `worldbooks[${index}]`, "cross-character-reference"));
  data.contacts?.contacts.forEach((row, index) => character(row.characterId, `contacts[${index}]`));
  data.presence?.characters.forEach((row, index) => character(row.characterId, `presence[${index}]`));
  data.chat.sessions.forEach((row, index) => {
    const path = `chat.sessions[${index}]`;
    if (row.type === "group") row.participantIds?.forEach((member) => character(member, path));
    else character(row.characterId, path);
    if (data.foundation) {
      const universeId = sessionUniverseId(data.foundation, row);
      check(universeId !== null && allUniverses(data.foundation).some((u) => u.id === universeId), path, "cross-character-reference");
      const members = row.type === "group" ? row.participantIds ?? [] : [row.characterId];
      check(members.every((id) => data.foundation!.characters.some((c) => c.characterId === id && characterUniverseId(c) === universeId)), path, "cross-character-reference");
    }
    if (row.backgroundImage) check(assets.has(`chat:${row.backgroundImage}`), path, "missing-asset");
  });
  data.chat.chatSettings.forEach((row, index) => {
    if (row.id === "chat-background" && row.globalChatBackgroundImage)
      check(assets.has(`chat:${row.globalChatBackgroundImage}`), `chat.chatSettings[${index}]`, "missing-asset");
  });
  const messages = new Set(data.chat.messages.map((row) => row.id));
  const wallpapers = new Set([...data.chat.sessions.map((row) => row.backgroundImage),
    ...data.chat.chatSettings.map((row) => "globalChatBackgroundImage" in row ? row.globalChatBackgroundImage : undefined)].filter(Boolean));
  data.chat.messages.forEach((row, index) => {
    const path = `chat.messages[${index}]`;
    if (row.quote && !messages.has(row.quote.messageId)) warnings.push({ code: "missing-quote", path });
    if (row.attachment) {
      // Deleting a message deletes its asset, so an asset a wallpaper also uses would be taken from it.
      check(!wallpapers.has(row.attachment.assetId), path, "duplicate-id", "attachment-asset-shared");
      // The message stays and shows its media as unavailable; the rest of the backup is not held back.
      if (!assets.has(`chat:${row.attachment.assetId}`)) warnings.push({ code: "missing-attachment", path });
    }
  });
  // Memory keeps pointers, not chat text. A message may have been deleted since, so a missing message is allowed;
  // a session must still exist unless a cleanup intent for it is pending. Nothing is invented to satisfy this.
  const sessionsById = new Map(data.chat.sessions.map((row) => [row.id, row]));
  const messagesById = new Map(data.chat.messages.map((row) => [row.id, row]));
  const pendingClears = new Set(data.memory.cursors.filter((row) => row.clearRequestedAt !== undefined).map((row) => `${row.characterId}\u0000${row.sessionId}`));
  const memoryPointer = (owner: string, sessionId: string, messageId: string | undefined, path: string) => {
    const session = sessionsById.get(sessionId);
    if (!session) { check(pendingClears.has(`${owner}\u0000${sessionId}`), path, "missing-session"); return; }
    check(session.type === "group" ? !!session.participantIds?.includes(owner) : session.characterId === owner, path, "cross-character-reference");
    const message = messageId === undefined ? undefined : messagesById.get(messageId);
    check(!message || message.sessionId === sessionId, path, "cross-session-reference");
  };
  const memoryRows = (row: { characterId: string; sources: { sessionId: string; messageId: string }[] }, path: string) => {
    character(row.characterId, path);
    row.sources.forEach((source, at) => memoryPointer(row.characterId, source.sessionId, source.messageId, `${path}.sources[${at}]`));
  };
  data.memory.backgrounds.forEach((row, index) => character(row.characterId, `memory.backgrounds[${index}]`));
  data.memory.states.forEach((row, index) => {
    const path = `memory.states[${index}]`; memoryRows(row, path);
    row.sources.forEach((source) => {
      // Unlike old Memory pointers, State prose requires extant private-chat evidence.
      // Refuse an export pending deletion rather than carry deleted content into a backup.
      const message = messagesById.get(source.messageId);
      check(!!message, path, "missing-message");
      const session = sessionsById.get(source.sessionId);
      check(session?.type !== "group" && session?.characterId === row.characterId, path, "cross-character-reference");
      check(!data.memory.cursors.some((cursor) => cursor.characterId === row.characterId && cursor.sessionId === source.sessionId
        && cursor.clearRequestedAt !== undefined && (!cursor.clearMessageIds || cursor.clearMessageIds.includes(source.messageId))), path, "invalid-data", "state-source-cleanup-pending");
    });
  });
  const memoriesById = new Map(data.memory.memories.map((row) => [row.id, row]));
  data.memory.memories.forEach((row, index) => {
    const path = `memory.memories[${index}]`;
    memoryRows(row, path);
    for (const other of [...(row.lineage.mergedFrom ?? []), ...(row.lineage.supersededBy ? [row.lineage.supersededBy] : [])]) {
      const target = memoriesById.get(other);
      check(!target || target.characterId === row.characterId, path, "cross-character-reference");
    }
  });
  data.memory.suppressions.forEach((row, index) => memoryRows(row, `memory.suppressions[${index}]`));
  data.memory.operations.forEach((row, index) => character(row.characterId, `memory.operations[${index}]`));
  data.memory.cursors.forEach((row, index) => {
    const path = `memory.cursors[${index}]`;
    character(row.characterId, path);
    if (row.clearRequestedAt === undefined || sessionsById.has(row.sessionId)) memoryPointer(row.characterId, row.sessionId, row.processedMessageId, path);
    if (row.extraction) {
      const session = sessionsById.get(row.sessionId), tracking = session?.memorySequence;
      if (row.clearRequestedAt === undefined) {
        check(session?.type !== "group" && tracking?.epoch === row.extraction.epoch && row.extraction.throughSeq < tracking.nextSeq, path, "invalid-memory-progress");
        check([...row.extraction.completed, ...row.extraction.batches.map((b) => [b.fromSeq, b.toSeq])].every((range) => range[1] < tracking.nextSeq), path, "invalid-memory-progress");
      }
      for (const batch of row.extraction.batches) {
        for (const source of batch.sources) {
          memoryPointer(row.characterId, row.sessionId, source.messageId, path);
          const message = messagesById.get(source.messageId);
          check(!message || (message.memorySequence?.epoch === row.extraction.epoch && message.memorySequence.seq === source.seq), path, "invalid-memory-progress");
        }
        for (const candidate of batch.candidates) {
          const memory = memoriesById.get(candidate.id);
          check(!memory || memory.characterId === row.characterId, path, "cross-character-reference");
        }
      }
    }
  });
  const apis = new Set(data.apiConfigs.map((row) => row.id)), presets = new Set(data.presets?.presets.map((row) => row.id));
  if (!data.presets) presets.add(BUILTIN_PRESET_ID); // Absent library uses the app's official default.
  const books = new Set(data.worldbooks?.books.map((row) => row.id)), regex = new Set(data.regex?.groups.map((row) => row.id));
  const slot = (value: NonNullable<BackupData["bindings"]>["global"], path: string) => {
    for (const [field, catalog] of [["memoryApiConfigId", apis], ["apiConfigId", apis], ["presetId", presets]] as const)
      if (typeof value[field] === "string") check(catalog.has(value[field]), path, "missing-binding-resource");
    for (const resource of value.worldBookIds ?? []) check(books.has(resource), path, "missing-binding-resource");
    for (const resource of value.regexIds ?? []) check(regex.has(resource), path, "missing-binding-resource");
  };
  if (data.bindings) {
    slot(data.bindings.global, "bindings.global");
    Object.entries(data.bindings.characters).forEach(([owner, binding], index) => {
      const path = `bindings.characters[${index}]`; character(owner, path); slot(binding.defaults, path);
      Object.entries(binding.apps).forEach(([app, value]) => {
        check(APP_IDS.includes(app as typeof APP_IDS[number]), path); slot(value, path);
      });
    });
  }
  data.apiConfigs.forEach((_, index) => warnings.push({ code: "credentials-required", path: `apiConfigs[${index}]` }));
  return warnings;
}

/** Validates extracted, caller-owned file bytes. No archive extraction, storage, fetch or restore. */
export async function validateBackupPackage(manifestJson: string, files: ReadonlyMap<string, Uint8Array>): Promise<ValidatedBackup> {
  const manifest = parseBackupManifest(manifestJson);
  const entries = [...manifest.domains, ...manifest.assets];
  check(files.size === entries.length, "files", "file-coverage");
  const data: Partial<BackupData> = {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], path = `files[${index}]`, bytes = files.get(entry.path);
    check(bytes instanceof Uint8Array && bytes.byteLength === entry.bytes, path, "file-size");
    // Own the bytes across asynchronous hashing so caller mutation cannot change parsed content.
    const snapshot = new Uint8Array(bytes);
    let hash: ArrayBuffer;
    try { hash = await globalThis.crypto.subtle.digest("SHA-256", snapshot); }
    catch { throw new BackupValidationError("hash-unavailable", path); }
    const actual = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("");
    check(actual === entry.sha256, path, "checksum-mismatch");
    if ("version" in entry) {
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot); }
      catch { throw new BackupValidationError("invalid-utf8", path); }
      const value = json(text, entry.domain);
      check(validateDomain(entry.domain, value, entry.version) === entry.records, entry.domain, "record-count");
      // Legacy Memory-domain v1 has no State; normalize only the imported copy, never local rows.
      if (entry.domain === "memory" && entry.version === 1) Object.assign(value as object, { backgrounds: [], states: [] });
      Object.assign(data, { [entry.domain]: value });
    }
  }
  const validated = data as BackupData;
  const warnings = references(validated, manifest);
  const messages = new Map(validated.chat.messages.map((m) => [m.id, m]));
  for (const row of validated.memory.states) for (const source of row.sourceHashes ?? []) {
    const message = messages.get(source.messageId);
    check(!!message && message.sessionId === source.sessionId && await memorySourceHash(message) === source.hash,
      "memory.states", "invalid-data", "state-source-replaced");
  }
  return { manifest, data: validated, warnings };
}
