import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { exportBackup } from "../lib/backup/export";
import { isOverwriteConfirmationValid, parseBackup, requiresOverwriteRestore, restoreBackup,
  type RestoreSources } from "../lib/backup/import";
import { validateBackup } from "../lib/backup/validate";
import { ChatStorage } from "../lib/chat/storage";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { defaultFoundation, normalizeCharacterInput, normalizeFoundation } from "../lib/foundation-types";
import { normalizeDocument } from "../lib/theme-types";
import { createPresetDocument } from "../lib/preset";
import { defaultRegexGroup } from "../lib/regex-defaults";
import { emptyWorldBookDocument } from "../lib/worldbook";
import type { BackupSources } from "../lib/backup/types";

function documentStore<T>(initial: T) {
  let raw: string | null = JSON.stringify(initial);
  return {
    load: async () => structuredClone(JSON.parse(raw!)) as T,
    readRaw: async () => raw,
    async replaceIfCurrent(expected: string | null, value: T) {
      if (raw !== expected) throw new Error("Document changed while restoring.");
      raw = JSON.stringify(value); return raw;
    },
    async rollbackIfCurrent(expected: string, previous: string | null) {
      if (raw !== expected) return false;
      raw = previous; return true;
    },
  };
}

function setup() {
  const factory = new IDBFactory();
  let foundation = defaultFoundation();
  foundation.user.name = "Lan";
  foundation.characters = [{ characterId: "peter", ...normalizeCharacterInput({ name: "Peter" }) }];
  foundation = normalizeFoundation(foundation);
  const stores = {
    foundation: documentStore(foundation),
    bindings: documentStore({ global: { apiConfigId: "private-api" }, characters: {} }),
    theme: documentStore(normalizeDocument(null)),
    preset: documentStore(createPresetDocument()),
    regex: documentStore({ version: 1 as const, groups: [defaultRegexGroup()] }),
    worldBooks: documentStore(emptyWorldBookDocument()),
    chat: new ChatStorage(() => factory),
  };
  return { factory, stores };
}

test("current backup exports one strict contract without Text API credentials", async () => {
  const { stores } = setup();
  const session = await stores.chat.openSession("peter");
  await stores.chat.send(session.id, "hello");
  const first = await exportBackup(stores as BackupSources, () => new Date("2026-10-06T00:00:00Z"));
  const second = await exportBackup(stores as BackupSources, () => new Date("2026-10-06T00:00:00Z"));
  assert.equal(first.json, second.json);
  assert.deepEqual(Object.keys(first.backup).sort(), ["bindings", "chat", "exportedAt", "format",
    "foundation", "preset", "regex", "theme", "version", "worldBooks"]);
  assert.equal(first.backup.version, 1);
  assert(!first.json.includes("apiKey"));
  assert(!first.json.includes("private-test-secret"));
  assert.equal(first.backup.bindings.global.apiConfigId, "private-api");
});

test("current backup validator rejects old versions, missing documents and unknown credential fields", async () => {
  const { stores } = setup();
  const { backup } = await exportBackup(stores as BackupSources);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
  assert.throws(() => validateBackup({ ...backup, version: 2 }), /Unsupported backup format/);
  const missing = structuredClone(backup) as Record<string, unknown>;
  delete missing.regex;
  assert.throws(() => validateBackup(missing));
  assert.throws(() => validateBackup({ ...backup, apiKey: "secret" }), /unsupported fields/);
});

test("current restore round-trips product data and leaves independent API Config untouched", async () => {
  const source = setup();
  const session = await source.stores.chat.openSession("peter");
  await source.stores.chat.send(session.id, "hello");
  const { backup } = await exportBackup(source.stores as BackupSources);
  const target = setup();
  const targetRaw = await target.stores.foundation.readRaw();
  const targetFoundation = await target.stores.foundation.load();
  targetFoundation.user.name = "Existing User";
  await target.stores.foundation.replaceIfCurrent(targetRaw, targetFoundation);
  const api = new ApiConfigStorage(() => target.factory);
  await api.saveApiConfig({ id: "private-api", baseUrl: "https://example.test/v1",
    apiKey: "keep-this-key", model: "test" });
  const restore = target.stores as unknown as RestoreSources;
  assert.equal(await requiresOverwriteRestore(restore), true);
  await assert.rejects(restoreBackup(backup, restore), /empty installation/);
  assert(isOverwriteConfirmationValid("RESTORE"));
  await restoreBackup(backup, restore, true);
  assert.deepEqual((await target.stores.chat.readSession(session.id)).messages.map((message) => message.content), ["hello"]);
  assert.equal((await api.getApiConfig("private-api"))?.apiKey, "keep-this-key");
});

test("restore validation rejects broken chat references before changing current data", async () => {
  const source = setup(), target = setup();
  const { backup } = await exportBackup(source.stores as BackupSources);
  const invalid = structuredClone(backup);
  invalid.chat.messages.push({ id: "orphan", sessionId: "missing", role: "user", status: "sent",
    content: "bad", createdAt: 1, order: 1 });
  const before = await target.stores.chat.exportBackup();
  await assert.rejects(restoreBackup(invalid, target.stores as unknown as RestoreSources));
  assert.deepEqual(await target.stores.chat.exportBackup(), before);
});
