import { defaultFoundation, normalizeFoundation } from "../lib/foundation-types";
import { defaultSnapshot, normalizeDocument } from "../lib/theme-types";
import { createPresetDocument } from "../lib/preset";
import { defaultRegexGroup } from "../lib/regex-defaults";
import { normalizeContacts } from "../lib/contact-storage";
import { normalizePresenceDocument } from "../lib/presence/storage";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import type { Memory, Suppression } from "../lib/memory/types";
import { BACKUP_SCHEMA, BACKUP_VERSION, BACKUP_DOMAIN_VERSIONS, type BackupData, type BackupManifest, type BackupDomain } from "../lib/backup/format";

export const TEST_COMMIT = "1a281e33c8317f9ea9dbd71f5b700fc916dc2669";
export const TEST_NOW = 1_700_000_000_000;
/** Memory rows for Character peter. One source points at a message that no longer exists, which the format allows. */
export function memoryData(): BackupData["memory"] {
  const memory = (id: string, text: string, extra: Partial<Memory> = {}): Memory => ({ id, characterId: "peter", kind: "fact", text, subject: "user",
    status: "active", origin: "auto", sources: [{ sessionId: "character:peter", messageId: "user-test" }], lineage: {},
    fingerprint: memoryFingerprint(text), createdAt: TEST_NOW, updatedAt: TEST_NOW, ...extra });
  const suppression: Suppression = { id: "suppress-1", characterId: "peter", fingerprint: memoryFingerprint("old fact"), reason: "deleted",
    sources: [{ sessionId: "character:peter", messageId: "reply-test" }], createdAt: TEST_NOW };
  const first = memory("memory-1", "Likes tea");
  return {
    backgrounds: [], states: [],
    memories: [first, memory("memory-2", "Moved house", { origin: "manual", sources: [{ sessionId: "character:peter", messageId: "deleted-message" }] })],
    suppressions: [suppression],
    operations: [{ id: "peter\u00001", characterId: "peter", seq: 1, label: "add", createdAt: TEST_NOW, changes: [{ before: null, after: first }],
      suppressionChanges: [{ before: null, after: suppression }] }],
    cursors: [{ id: "peter\u0000character:peter", characterId: "peter", sessionId: "character:peter", processedMessageId: "reply-test", failureCount: 0, updatedAt: TEST_NOW }],
  };
}
export function backupData(): BackupData {
  const foundation = normalizeFoundation({ ...defaultFoundation(), characters: [
    { characterId: "peter", name: "Peter", statusMessage: "Test signature" },
    { characterId: "pep", name: "Pep" },
  ] });
  const appearance = normalizeDocument({ version: 1, current: defaultSnapshot(), presets: [
    { id: "saved-look", name: "Saved", snapshot: defaultSnapshot() },
  ] });
  return {
    foundation, appearance,
    bindings: { global: { apiConfigId: "api-test", worldBookIds: ["book-test"], regexIds: ["veil-default-chat-rules"] },
      characters: { peter: { defaults: { presetId: null }, apps: { messages: { worldBookIds: [], apiConfigId: null } } } } },
    presets: createPresetDocument(), regex: { version: 1, groups: [defaultRegexGroup()] },
    worldbooks: { version: 1, books: [{ id: "book-test", name: "Test world", description: "", enabled: true, entries: [] }] },
    contacts: normalizeContacts({ version: 1, contacts: [{ id: "contact-test", characterId: "peter", createdAt: TEST_NOW,
      remark: "Test remark", heroBackground: null, lastRemarkChange: { type: "remark-changed", fromRemark: null, toRemark: "Test remark", createdAt: TEST_NOW } }] }),
    presence: normalizePresenceDocument({ version: 1, characters: [{ characterId: "peter", lastMessageAt: TEST_NOW,
      routine: { routine: { defaultStatus: "online", blocks: [], jitterMinutes: 0 }, changedAt: TEST_NOW, source: "generated:test" } }] }),
    chat: {
      sessions: [ { id: "character:peter", characterId: "peter", updatedAt: TEST_NOW, autoReplyOnKeyboardDismiss: false,
        streamOnline: false, nextOrder: 3, lastMessageId: "reply-test", lastMessagePreview: "Test reply", pinned: true },
      { id: "empty-group", characterId: "", type: "group", participantIds: [], title: "Empty group", updatedAt: 0,
        autoReplyOnKeyboardDismiss: false, streamOnline: false, nextOrder: 1 } ],
      messages: [ { id: "user-test", sessionId: "character:peter", role: "user", content: "模拟数据：hello", status: "sent", createdAt: TEST_NOW,
        order: 1, requestedBy: "reply-test" },
      { id: "reply-test", sessionId: "character:peter", role: "assistant", content: "Test reply", status: "complete", createdAt: TEST_NOW,
        order: 2, turnId: "reply-test", confirmed: true, outcome: "success", quote: { messageId: "user-test", preview: "模拟数据：hello", role: "user" } } ],
      chatSettings: [{ id: "global-profile-settings", bubbleTiming: { shortMs: 900, mediumMs: 2500, longMs: 5000 }, hereThereEnabled: true, nextCommentAt: TEST_NOW },
        { id: "chat-background", blur: 3 }],
      worldBookStates: [{ id: "character:peter", state: { cycle: 1, prefix: [], entries: {} } }],
    },
    memory: memoryData(),
    apiConfigs: [{ id: "api-test", name: "Test API", provider: "OpenAI-compatible", model: "test-model", baseUrl: "https://example.invalid/v1" }],
  };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export type Fixture = { manifest: BackupManifest; files: Map<string, Uint8Array> };
export async function packageFixture(data: BackupData = backupData()): Promise<Fixture> {
  const manifest: BackupManifest = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, backupId: "simulated-backup", createdAt: TEST_NOW,
    sourceCommit: TEST_COMMIT, credentials: "excluded", domains: [], assets: [] };
  const files = new Map<string, Uint8Array>();
  for (const domain of Object.keys(BACKUP_DOMAIN_VERSIONS) as BackupDomain[]) {
    const payload = data[domain], bytes = new TextEncoder().encode(JSON.stringify(payload)), path = `domains/${domain}.json`;
    let records: number;
    if (payload === null) records = 0;
    else if (domain === "chat") records = Object.values(data.chat).reduce((sum, rows) => sum + rows.length, 0);
    else if (domain === "memory") records = Object.values(data.memory).reduce((sum, rows) => sum + rows.length, 0);
    else if (domain === "apiConfigs") records = data.apiConfigs.length;
    else if (domain === "presets") records = data.presets!.presets.length;
    else if (domain === "regex") records = data.regex!.groups.length;
    else if (domain === "worldbooks") records = data.worldbooks!.books.length;
    else if (domain === "contacts") records = data.contacts!.contacts.length;
    else if (domain === "presence") records = data.presence!.characters.length;
    else records = 1;
    manifest.domains.push({ domain, version: BACKUP_DOMAIN_VERSIONS[domain], path, bytes: bytes.length, sha256: await sha256(bytes), records });
    files.set(path, bytes);
  }
  return { manifest, files };
}
export async function replacePayload(fixture: Fixture, domain: BackupDomain, value: unknown) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const section = fixture.manifest.domains.find((row) => row.domain === domain)!;
  section.bytes = bytes.length; section.sha256 = await sha256(bytes);
  fixture.files.set(section.path, bytes);
}

/** Real image bytes in both image domains, used to exercise restore failures rather than skip them. */
export async function packageFixtureWithImages(): Promise<Fixture> {
  const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=", "base64"));
  const imageId = await sha256(bytes), data = backupData();
  data.appearance!.current.profile.wallpaper.source = `appearance-asset:${imageId}`;
  data.chat.sessions[0].backgroundImage = "simulated-chat-image";
  const fixture = await packageFixture(data);
  for (const domain of ["appearance", "chat"] as const) {
    const path = `assets/${domain}/0.bin`;
    fixture.manifest.assets.push({ domain, id: domain === "appearance" ? imageId : "simulated-chat-image",
      path, bytes: bytes.length, sha256: imageId, mime: "image/png", createdAt: TEST_NOW });
    fixture.files.set(path, bytes);
  }
  return fixture;
}
