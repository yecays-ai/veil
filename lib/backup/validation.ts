import { normalizeFoundation } from "../foundation-types";
import { normalizeDocument, themeImageAssetIds } from "../theme-types";
import { normalizeBindings } from "../bindings";
import { BUILTIN_PRESET_ID, validatePresetDocument } from "../preset";
import { validateRegexDocument } from "../regex";
import { validateWorldBookDocument } from "../worldbook";
import { normalizeContacts } from "../contact-storage";
import { normalizePresenceDocument } from "../presence/storage";
import { isValidBubbleTimingDelay } from "../chat/types";
import { APP_IDS } from "../app-registry";
import { parseBackupJson } from "./json";
import {
  BACKUP_SCHEMA, BACKUP_VERSION, BACKUP_DOMAIN_VERSIONS, BackupValidationError,
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
function check(condition: unknown, path: string, code = "invalid-data"): asserts condition {
  if (!condition) throw new BackupValidationError(code, path);
}
function keys(row: unknown, allowed: string[], required: string[], path: string): asserts row is Row {
  check(record(row) && Object.keys(row).every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(row, key)), path);
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
    check(section.version === BACKUP_DOMAIN_VERSIONS[section.domain as BackupDomain], path, "unsupported-domain-version");
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

function validateChat(value: unknown) {
  const fields = ["sessions", "messages", "chatSettings", "worldBookStates"];
  keys(value, fields, fields, "chat");
  unique(value.sessions, "id", "chat.sessions"); unique(value.messages, "id", "chat.messages");
  unique(value.chatSettings, "id", "chat.chatSettings"); unique(value.worldBookStates, "id", "chat.worldBookStates");
  const sessions = new Map(value.sessions.map((row) => [row.id, row])), direct = new Set<string>();
  value.sessions.forEach((row, index) => {
    const path = `chat.sessions[${index}]`;
    keys(row, ["id", "characterId", "type", "participantIds", "title", "updatedAt", "pinned", "lastMessageId", "lastMessagePreview", "autoReplyOnKeyboardDismiss", "streamOnline", "backgroundImage", "backgroundBlur", "customCSS", "nextOrder"],
      ["id", "characterId", "updatedAt", "autoReplyOnKeyboardDismiss", "nextOrder"], path);
    check(typeof row.characterId === "string" && integer(row.updatedAt) && integer(row.nextOrder) && (row.nextOrder as number) >= 1
      && typeof row.autoReplyOnKeyboardDismiss === "boolean", path);
    check(row.type === undefined || ["direct", "group"].includes(String(row.type)), path);
    for (const key of ["pinned", "streamOnline"]) check(row[key] === undefined || typeof row[key] === "boolean", path);
    for (const key of ["title", "lastMessagePreview", "customCSS"]) check(row[key] === undefined || typeof row[key] === "string", path);
    for (const key of ["lastMessageId", "backgroundImage"]) check(row[key] === undefined || id(row[key]), path);
    check(row.backgroundBlur === undefined || (number(row.backgroundBlur) && (row.backgroundBlur as number) >= 0 && (row.backgroundBlur as number) <= 20), path);
    if (row.type === "group") {
      check(Array.isArray(row.participantIds) && row.participantIds.every(id)
        && new Set(row.participantIds).size === row.participantIds.length
        && (row.participantIds.length ? row.participantIds.includes(row.characterId) : row.characterId === ""), path);
    } else {
      check(id(row.characterId) && row.participantIds === undefined && row.title === undefined, path);
      check(!direct.has(row.characterId), path, "duplicate-direct-chat"); direct.add(row.characterId);
    }
  });
  const messages = new Map(value.messages.map((row) => [row.id, row])), orders = new Set<string>();
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
  value.messages.forEach((row, index) => {
    const path = `chat.messages[${index}]`;
    keys(row, ["id", "sessionId", "role", "content", "status", "createdAt", "order", "requestedBy", "error", "quote", "turnId", "attemptId", "attemptFor", "attemptMode", "outcome", "finishReason", "failureStage", "confirmed"],
      ["id", "sessionId", "role", "content", "status", "createdAt", "order"], path);
    check(id(row.sessionId) && sessions.has(row.sessionId), path, "missing-session");
    check(["user", "assistant", "system"].includes(String(row.role)) && typeof row.content === "string"
      && ["sent", "complete", "cancelled", "error"].includes(String(row.status)) && integer(row.createdAt)
      && integer(row.order) && (row.order as number) >= 1, path);
    const order = `${row.sessionId}:${row.order}`;
    check(!orders.has(order), path, "duplicate-order"); orders.add(order);
    check((row.order as number) < (sessions.get(row.sessionId)!.nextOrder as number), path, "invalid-next-order");
    for (const key of ["requestedBy", "turnId", "attemptId", "attemptFor"]) check(row[key] === undefined || id(row[key]), path);
    for (const key of ["error", "finishReason"]) check(row[key] === undefined || typeof row[key] === "string", path);
    check(row.confirmed === undefined || typeof row.confirmed === "boolean", path);
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

function validateDomain(domain: BackupDomain, value: unknown): number {
  if (domain === "chat") {
    validateChat(value);
    const chat = value as BackupData["chat"];
    return chat.sessions.length + chat.messages.length + chat.chatSettings.length + chat.worldBookStates.length;
  }
  if (domain === "apiConfigs") {
    unique(value, "id", domain);
    value.forEach((row, index) => {
      const fields = ["id", "name", "provider", "baseUrl", "model"];
      keys(row, fields, fields, `apiConfigs[${index}]`);
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
  data.contacts?.contacts.forEach((row, index) => character(row.characterId, `contacts[${index}]`));
  data.presence?.characters.forEach((row, index) => character(row.characterId, `presence[${index}]`));
  data.chat.sessions.forEach((row, index) => {
    const path = `chat.sessions[${index}]`;
    if (row.type === "group") row.participantIds?.forEach((member) => character(member, path));
    else character(row.characterId, path);
    if (row.backgroundImage) check(assets.has(`chat:${row.backgroundImage}`), path, "missing-asset");
  });
  data.chat.chatSettings.forEach((row, index) => {
    if (row.id === "chat-background" && row.globalChatBackgroundImage)
      check(assets.has(`chat:${row.globalChatBackgroundImage}`), `chat.chatSettings[${index}]`, "missing-asset");
  });
  const messages = new Set(data.chat.messages.map((row) => row.id));
  data.chat.messages.forEach((row, index) => {
    if (row.quote && !messages.has(row.quote.messageId)) warnings.push({ code: "missing-quote", path: `chat.messages[${index}]` });
  });
  const apis = new Set(data.apiConfigs.map((row) => row.id)), presets = new Set(data.presets?.presets.map((row) => row.id));
  if (!data.presets) presets.add(BUILTIN_PRESET_ID); // Absent library uses the app's official default.
  const books = new Set(data.worldbooks?.books.map((row) => row.id)), regex = new Set(data.regex?.groups.map((row) => row.id));
  const slot = (value: NonNullable<BackupData["bindings"]>["global"], path: string) => {
    for (const [field, catalog] of [["apiConfigId", apis], ["presetId", presets]] as const)
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
      check(validateDomain(entry.domain, value) === entry.records, entry.domain, "record-count");
      Object.assign(data, { [entry.domain]: value });
    }
  }
  const validated = data as BackupData;
  return { manifest, data: validated, warnings: references(validated, manifest) };
}
