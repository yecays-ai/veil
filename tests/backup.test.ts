import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { exportBackupV1 } from "../lib/backup/export";
import {
  parseBackupV1,
  restoreBackupV1,
  type RestoreSources,
} from "../lib/backup/import";
import { BACKUP_MAX_BYTES, type BackupChat, type BackupSources } from "../lib/backup/types";
import { validateBackupV1 } from "../lib/backup/validate";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation } from "../lib/foundation-types";
import { normalizeDocument } from "../lib/theme-types";

function chat(): BackupChat {
  return {
    version: 1,
    sessions: [
      {
        id: "character:a",
        characterId: "a",
        updatedAt: 2,
        remark: null,
        autoReplyOnKeyboardDismiss: false,
        nextOrder: 2,
      },
    ],
    messages: [
      {
        id: "m1",
        sessionId: "character:a",
        role: "user",
        content: "hello",
        status: "sent",
        createdAt: 1,
        order: 1,
      },
    ],
  };
}

function sources(): BackupSources {
  return {
    foundation: { load: async () => defaultFoundation() },
    theme: { load: async () => normalizeDocument(null) },
    chat: { exportBackup: async () => chat() },
  };
}

test("V1 backup is stable, sorted, and contains no Text API configuration", async () => {
  const { backup, json } = await exportBackupV1(
    sources(),
    () => new Date("2026-10-04T00:00:00.000Z"),
  );
  assert.equal(backup.version, 1);
  assert.equal(backup.chat.sessions[0].id, "character:a");
  assert.equal(backup.chat.messages[0].id, "m1");
  assert(!json.includes("apiKey"));
  assert(!json.includes("Text API"));
});

test("backup retries once when foundation or theme changes around chat", async () => {
  let foundationLoads = 0;
  let chatExports = 0;
  const changing = sources();
  changing.foundation = {
    load: async () => {
      foundationLoads++;
      const result = defaultFoundation();
      result.user.name = foundationLoads < 3 ? `before-${foundationLoads}` : "stable";
      return result;
    },
  };
  changing.chat = {
    exportBackup: async () => {
      chatExports++;
      return chat();
    },
  };
  const { backup } = await exportBackupV1(changing);
  assert.equal(backup.foundation && (backup.foundation as { user: { name: string } }).user.name, "stable");
  assert.equal(chatExports, 2);
});

test("backup rejects invalid chat references and the 32 MiB limit", async () => {
  const invalid = await exportBackupV1(sources());
  invalid.backup.chat.messages[0].sessionId = "missing";
  assert.throws(() => validateBackupV1(invalid.backup));

  const tooLarge = sources();
  tooLarge.chat = {
    exportBackup: async () => ({
      ...chat(),
      messages: [{ ...chat().messages[0], content: "x".repeat(BACKUP_MAX_BYTES) }],
    }),
  };
  await assert.rejects(() => exportBackupV1(tooLarge), /32 MiB/);
});

test("backup rejects malformed envelopes, duplicate orders, and stale previews", async () => {
  assert.throws(() => validateBackupV1(null), /format/);
  assert.throws(
    () =>
      validateBackupV1({
        format: "veil-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        foundation: defaultFoundation(),
        theme: normalizeDocument(null),
        chat: { version: 1, sessions: [], messages: "not-an-array" },
      }),
    /chat data/,
  );

  const duplicateOrder = await exportBackupV1(sources());
  duplicateOrder.backup.chat.messages.push({
    ...duplicateOrder.backup.chat.messages[0],
    id: "m2",
  });
  assert.throws(() => validateBackupV1(duplicateOrder.backup));

  const stalePreview = await exportBackupV1(sources());
  stalePreview.backup.chat.sessions[0].lastMessageId = "missing";
  assert.throws(() => validateBackupV1(stalePreview.backup), /last message/);

  const invalidProfile = await exportBackupV1(sources());
  (invalidProfile.backup.foundation as { extra?: string }).extra = "unknown";
  assert.throws(() => validateBackupV1(invalidProfile.backup), /profile or appearance/);

  const duplicateCharacter = await exportBackupV1(sources());
  duplicateCharacter.backup.chat.sessions.push({
    ...duplicateCharacter.backup.chat.sessions[0],
    id: "character:duplicate",
  });
  assert.throws(() => validateBackupV1(duplicateCharacter.backup), /session IDs/);

  const invalidBatch = await exportBackupV1(sources());
  invalidBatch.backup.chat.messages[0].requestedBy = "missing-reply";
  assert.throws(() => validateBackupV1(invalidBatch.backup), /reply batch/);
});

test("ChatStorage backup reads conversations but omits saved API keys", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const session = await storage.openSession("a");
  await storage.send(session.id, "private conversation");
  await storage.saveApiConfig({
    id: "api",
    baseUrl: "https://provider.example/v1",
    apiKey: "never-export-this",
    model: "model",
  });
  const exported = await storage.exportBackup();
  assert.equal(exported.sessions.length, 1);
  assert.equal(exported.messages[0].content, "private conversation");
  assert(!JSON.stringify(exported).includes("never-export-this"));
});

test("restore preflights an empty installation and can parse its V1 JSON", async () => {
  const exportSources = sources();
  exportSources.foundation = {
    load: async () => ({ ...defaultFoundation(), user: { ...defaultFoundation().user, name: "Restored" } }),
  };
  exportSources.theme = {
    load: async () => ({
      ...normalizeDocument(null),
      current: {
        ...normalizeDocument(null).current,
        profile: {
          ...normalizeDocument(null).current.profile,
          colors: { ...normalizeDocument(null).current.profile.colors, accent: "#112233" },
        },
      },
    }),
  };
  const { backup, json } = await exportBackupV1(exportSources);
  assert.deepEqual(parseBackupV1(json), backup);
  let foundationWrites = 0;
  let themeWrites = 0;
  let chatWrites = 0;
  const restoreSources: RestoreSources = {
    foundation: {
      load: async () => defaultFoundation(),
      hasStoredDocument: async () => false,
      replaceIfEmpty: async () => {
        foundationWrites++;
        return defaultFoundation();
      },
    },
    theme: {
      load: async () => normalizeDocument(null),
      hasStoredDocument: async () => false,
      saveIfEmpty: async () => {
        themeWrites++;
      },
    },
    chat: {
      exportBackup: async () => ({ version: 1, sessions: [], messages: [] }),
      importBackup: async () => {
        chatWrites++;
      },
    },
  };
  await restoreBackupV1(backup, restoreSources);
  assert.deepEqual([foundationWrites, themeWrites, chatWrites], [1, 1, 1]);
});

test("restore never overwrites an existing installation", async () => {
  const { backup } = await exportBackupV1(sources());
  const current = defaultFoundation();
  current.user.name = "Already configured";
  let writes = 0;
  const source: RestoreSources = {
    foundation: {
      load: async () => current,
      hasStoredDocument: async () => true,
      replaceIfEmpty: async () => {
        writes++;
        return current;
      },
    },
    theme: {
      load: async () => normalizeDocument(null),
      hasStoredDocument: async () => false,
      saveIfEmpty: async () => {},
    },
    chat: {
      exportBackup: async () => ({ version: 1, sessions: [], messages: [] }),
      importBackup: async () => {},
    },
  };
  await assert.rejects(() => restoreBackupV1(backup, source), /empty installation/);
  assert.equal(writes, 0);
});

test("ChatStorage restore writes only sessions and messages, retaining API configs", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  await storage.saveApiConfig({
    id: "api",
    baseUrl: "https://provider.example/v1",
    apiKey: "keep-this-key",
    model: "model",
  });
  await storage.importBackup(chat());
  assert.equal((await storage.readSession("character:a")).messages[0].content, "hello");
  assert.equal((await storage.getApiConfig("api"))?.apiKey, "keep-this-key");
  await assert.rejects(() => storage.importBackup(chat()), /no longer empty/);
});
