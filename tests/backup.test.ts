import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { exportBackupV1 } from "../lib/backup/export";
import {
  parseBackupV1,
  isOverwriteConfirmationValid,
  restoreBackupV1,
  requiresOverwriteRestore,
  type RestoreSources,
} from "../lib/backup/import";
import { BACKUP_MAX_BYTES, type BackupChat, type BackupSources } from "../lib/backup/types";
import { validateBackupV1 } from "../lib/backup/validate";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "../lib/chat/engine";
import { defaultFoundation } from "../lib/foundation-types";
import { normalizeDocument } from "../lib/theme-types";
import { createPresetDocument } from "../lib/preset";

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
    preset: { load: async () => createPresetDocument() },
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
  assert.equal(backup.preset.activePreset.id, "veil-default-v1");
  assert(!json.includes("apiKey"));
  assert(!json.includes("Text API"));
});

test("Preset edits are exported and restored while generated defaults remain an empty install", async () => {
  const source = sources();
  const preset = createPresetDocument();
  const directive = preset.activePreset.prompts.find((entry) =>
    entry.identifier === "response-directive")!;
  assert(directive.source === "prompt");
  directive.content = "Restored response rule";
  source.preset = { load: async () => preset };
  const { backup } = await exportBackupV1(source);
  assert.deepEqual(backup.preset.activePreset.prompts.find((entry) =>
    entry.identifier === "response-directive"), directive);
  const target = restoreSources();
  const legacyDefault = structuredClone(createPresetDocument()) as unknown as {
    version: number;
    activePreset: ReturnType<typeof createPresetDocument>["activePreset"];
  };
  legacyDefault.version = 1;
  legacyDefault.activePreset.prompts = legacyDefault.activePreset.prompts.filter((entry) =>
    entry.identifier !== "chat_output_format");
  legacyDefault.activePreset.promptOrder = legacyDefault.activePreset.promptOrder.filter((entry) =>
    entry.identifier !== "chat_output_format");
  await target.preset.replaceIfCurrent(null, legacyDefault as never);
  assert.equal(await requiresOverwriteRestore(target), false);
  await restoreBackupV1(backup, target);
  assert.deepEqual(JSON.parse((await target.preset.readRaw())!), preset);
  assert.equal(await requiresOverwriteRestore(target), true);
  assert(!JSON.stringify(backup).includes("apiKey"));
});

test("legacy V1 backups without Preset data migrate to the built-in default", async () => {
  const { backup } = await exportBackupV1(sources());
  const legacy = structuredClone(backup) as unknown as Record<string, unknown>;
  delete legacy.preset;
  assert.deepEqual(validateBackupV1(legacy).preset, createPresetDocument());
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

function restoreSources(): RestoreSources {
  function documentStore() {
    let raw: string | null = null;
    return {
      readRaw: async () => raw,
      replaceIfCurrent: async (expected: string | null, document: unknown) => {
        assert.equal(raw, expected);
        return raw = JSON.stringify(document);
      },
      rollbackIfCurrent: async (expected: string, previous: string | null) => {
        if (raw !== expected) return false;
        raw = previous;
        return true;
      },
    };
  }
  return {
    foundation: documentStore(),
    theme: documentStore(),
    preset: documentStore(),
    chat: new ChatStorage(() => new IDBFactory()),
  };
}

test("restore preflights an empty installation and can parse its V1 JSON", async () => {
  const { backup, json } = await exportBackupV1(sources());
  assert.deepEqual(parseBackupV1(json), backup);
  const target = restoreSources();
  await restoreBackupV1(backup, target);
  assert.deepEqual(JSON.parse((await target.foundation.readRaw())!), backup.foundation);
  assert.deepEqual(JSON.parse((await target.theme.readRaw())!), backup.theme);
  assert.deepEqual(await target.chat.exportBackup(), backup.chat);
  await restoreBackupV1(backup, target); // Retrying the identical backup is safe.
});

test("restore never overwrites an existing installation without confirmation", async () => {
  const { backup } = await exportBackupV1(sources());
  const target = restoreSources();
  const current = defaultFoundation();
  current.user.name = "Already configured";
  await target.foundation.replaceIfCurrent(null, current);
  await assert.rejects(() => restoreBackupV1(backup, target), /empty installation/);
  assert.deepEqual(JSON.parse((await target.foundation.readRaw())!), current);
  await restoreBackupV1(backup, target, true);
  assert.deepEqual(JSON.parse((await target.foundation.readRaw())!), backup.foundation);
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

test("overwrite restore replaces all backup sections while retaining API configuration", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const original = await storage.openSession("old");
  await storage.send(original.id, "old message");
  await storage.saveApiConfig({
    id: "api",
    baseUrl: "https://provider.example/v1",
    apiKey: "keep-this-key",
    model: "model",
  });
  const expected = await storage.exportBackup();
  await storage.replaceBackup(expected, chat());
  assert.equal((await storage.readSession("character:a")).messages[0].content, "hello");
  assert.equal((await storage.getApiConfig("api"))?.apiKey, "keep-this-key");
});

test("overwrite restore rolls back earlier stores when a later replacement fails", async () => {
  const { backup } = await exportBackupV1(sources());
  let foundation = "before-foundation";
  const source: RestoreSources = {
    foundation: {
      readRaw: async () => foundation,
      replaceIfCurrent: async (expected) => {
        assert.equal(expected, "before-foundation");
        foundation = "backup-foundation";
        return foundation;
      },
      rollbackIfCurrent: async (expected, previous) => {
        if (foundation !== expected) return false;
        foundation = previous ?? "";
        return true;
      },
    },
    theme: {
      readRaw: async () => "before-theme",
      replaceIfCurrent: async () => {
        throw new Error("theme write failed");
      },
      rollbackIfCurrent: async () => true,
    },
    preset: {
      readRaw: async () => null,
      replaceIfCurrent: async () => assert.fail("preset replacement must not run"),
      rollbackIfCurrent: async () => true,
    },
    chat: {
      exportBackup: async () => ({ version: 1, sessions: [], messages: [] }),
      replaceBackup: async () => assert.fail("chat replacement must not run"),
    },
  };
  await assert.rejects(() => restoreBackupV1(backup, source, true), /Previous data was restored/);
  assert.equal(foundation, "before-foundation");
});

test("overwrite restore confirmation requires an exact RESTORE token", () => {
  assert.equal(isOverwriteConfirmationValid("RESTORE"), true);
  assert.equal(isOverwriteConfirmationValid("restore"), false);
  assert.equal(isOverwriteConfirmationValid(" RESTORE"), false);
});

test("chat failure rolls back both documents for empty and overwrite restores", async () => {
  const { backup } = await exportBackupV1(sources());
  for (const overwrite of [false, true]) {
    const target = restoreSources();
    if (overwrite) {
      await target.foundation.replaceIfCurrent(null, defaultFoundation());
      await target.theme.replaceIfCurrent(null, normalizeDocument(null));
    }
    const before = await Promise.all([
      target.foundation.readRaw(), target.theme.readRaw(), target.preset.readRaw(),
    ]);
    target.chat.replaceBackup = async () => { throw new Error("chat failed"); };
    await assert.rejects(() => restoreBackupV1(backup, target, overwrite), /Previous data was restored/);
    assert.deepEqual(await Promise.all([
      target.foundation.readRaw(), target.theme.readRaw(), target.preset.readRaw(),
    ]), before);
  }
});

test("rollback reports concurrent changes instead of overwriting them", async () => {
  const { backup } = await exportBackupV1(sources());
  const target = restoreSources();
  const edited = defaultFoundation();
  edited.user.name = "Concurrent edit";
  target.chat.replaceBackup = async () => {
    await target.foundation.replaceIfCurrent(await target.foundation.readRaw(), edited);
    throw new Error("chat failed");
  };
  await assert.rejects(() => restoreBackupV1(backup, target), /Rollback was incomplete/);
  assert.equal(JSON.parse((await target.foundation.readRaw())!).user.name, "Concurrent edit");
});

test("failed chat replacement is atomic and preserves the previous conversations", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  await storage.importBackup(chat());
  const before = await storage.exportBackup();
  const invalid = chat();
  invalid.messages.push({ ...invalid.messages[0] });
  await assert.rejects(() => storage.replaceBackup(before, invalid));
  assert.deepEqual(await storage.exportBackup(), before);
});

function streamingChat(content = ""): BackupChat {
  const snapshot = chat();
  snapshot.sessions[0].nextOrder = 3;
  snapshot.sessions[0].lastMessageId = "reply";
  snapshot.sessions[0].lastMessagePreview = "Replying…";
  snapshot.messages[0].requestedBy = "reply";
  snapshot.messages.push({ id: "reply", sessionId: "character:a", role: "assistant",
    content, status: "streaming", createdAt: 2, order: 2 });
  return snapshot;
}

test("export stops snapshot streaming without changing live messages or batch claims", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  await storage.importBackup(streamingChat("partial reply"));
  const live = await storage.exportBackup();
  const exported = await exportBackupV1({ ...sources(), chat: storage });
  assert.equal(exported.backup.chat.messages[1].status, "cancelled");
  assert.equal(exported.backup.chat.messages[0].requestedBy, "reply");
  assert.equal(exported.backup.chat.sessions[0].lastMessagePreview, "partial reply");
  assert.deepEqual(await storage.exportBackup(), live);
});

test("legacy streaming backups restore as stopped, retry safely, and cannot be revived", async () => {
  for (const content of ["", "partial reply"]) {
    const { backup } = await exportBackupV1(sources());
    backup.chat = streamingChat(content);
    const original = structuredClone(backup);
    const target = restoreSources();
    await restoreBackupV1(backup, target);
    const restored = await target.chat.exportBackup();
    assert.equal(restored.messages[1].status, "cancelled");
    assert.equal(restored.messages[0].requestedBy, "reply");
    assert.equal(restored.sessions[0].lastMessagePreview, content || "Reply stopped");
    assert.deepEqual(backup, original);
    await restoreBackupV1(backup, target);
    const storage = target.chat as ChatStorage;
    await storage.updateReply("reply", { content: "late chunk", status: "streaming" });
    assert.deepEqual(await storage.exportBackup(), restored);
    const engine = createChatEngine(storage, async () => defaultFoundation());
    assert.equal(await engine.requestReply("character:a"), null);
  }
});

test("validator rejects unknown fields at every backup/chat boundary before writing", async () => {
  const { backup } = await exportBackupV1(sources());
  for (const field of ["apiKey", "apiConfigs", "unknown"]) {
    for (const section of ["envelope", "preset", "chat", "session", "message"]) {
      const invalid = structuredClone(backup);
      const object = section === "envelope" ? invalid : section === "preset" ? invalid.preset
        : section === "chat" ? invalid.chat
        : section === "session" ? invalid.chat.sessions[0] : invalid.chat.messages[0];
      Object.assign(object, { [field]: "not allowed" });
      const target = restoreSources();
      await assert.rejects(() => restoreBackupV1(invalid, target));
      assert.equal(await target.foundation.readRaw(), null);
      assert.equal(await target.theme.readRaw(), null);
      assert.equal((await target.chat.exportBackup()).messages.length, 0);
    }
  }
});

test("validator rejects unusable timestamps and malformed chat records", async () => {
  const { backup } = await exportBackupV1(sources());
  for (const value of [1e100, -1e100, Infinity, NaN, "123", null]) {
    const invalid = structuredClone(backup);
    Object.assign(invalid.chat.sessions[0], { updatedAt: value });
    assert.throws(() => validateBackupV1(invalid));
    Object.assign(invalid.chat.sessions[0], { updatedAt: 0 });
    Object.assign(invalid.chat.messages[0], { createdAt: value });
    assert.throws(() => validateBackupV1(invalid));
  }
  for (const value of [null, [], "message", 42]) {
    assert.throws(() => validateBackupV1({ ...backup,
      chat: { ...backup.chat, sessions: [value] } }));
    assert.throws(() => validateBackupV1({ ...backup,
      chat: { ...backup.chat, messages: [value] } }));
  }
});

test("reply batch references must link a user to a later assistant in the same session", async () => {
  const { backup } = await exportBackupV1(sources());
  backup.chat = streamingChat();
  assert.doesNotThrow(() => validateBackupV1(backup));
  for (const role of ["assistant", "system"] as const) {
    const invalid = structuredClone(backup);
    invalid.chat.messages[0].role = role;
    assert.throws(() => validateBackupV1(invalid), /reply batch/);
  }
  const self = structuredClone(backup);
  self.chat.messages[1].requestedBy = "reply";
  assert.throws(() => validateBackupV1(self), /reply batch/);
  const reversed = structuredClone(backup);
  reversed.chat.messages[0].order = 2;
  reversed.chat.messages[1].order = 1;
  assert.throws(() => validateBackupV1(reversed), /reply batch/);
});

test("successful chat write cannot hide concurrent foundation/theme edits", async () => {
  const { backup } = await exportBackupV1(sources());
  for (const section of ["foundation", "theme"] as const) {
    const target = restoreSources();
    const replace = target.chat.replaceBackup.bind(target.chat);
    let first = true;
    let concurrent: string | null = null;
    target.chat.replaceBackup = async (expected, next) => {
      await replace(expected, next);
      if (first) {
        first = false;
        if (section === "foundation") {
          const document = structuredClone(backup.foundation);
          document.user.name = "Concurrent edit";
          concurrent = await target.foundation.replaceIfCurrent(await target.foundation.readRaw(), document);
        } else {
          const document = structuredClone(backup.theme);
          document.current.profile.colors.accent = "#123456";
          concurrent = await target.theme.replaceIfCurrent(await target.theme.readRaw(), document);
        }
      }
    };
    await assert.rejects(() => restoreBackupV1(backup, target), /changed during restore.*Rollback was incomplete/);
    assert.equal(await target[section].readRaw(), concurrent);
    assert.equal(await target[section === "foundation" ? "theme" : "foundation"].readRaw(), null);
    assert.deepEqual(await target.chat.exportBackup(), { version: 1, sessions: [], messages: [] });
  }
});

test("chat rollback preserves concurrent conversation edits and reports incomplete rollback", async () => {
  const { backup } = await exportBackupV1(sources());
  const target = restoreSources();
  const storage = target.chat as ChatStorage;
  const replace = storage.replaceBackup.bind(storage);
  let first = true;
  target.chat.replaceBackup = async (expected, next) => {
    await replace(expected, next);
    if (first) {
      first = false;
      await storage.send("character:a", "concurrent message");
    }
  };
  await assert.rejects(() => restoreBackupV1(backup, target), /changed during restore.*Rollback was incomplete/);
  assert.equal((await storage.readSession("character:a")).messages.at(-1)?.content, "concurrent message");
  assert.equal(await target.foundation.readRaw(), null);
  assert.equal(await target.theme.readRaw(), null);
});

test("observer failures do not turn committed restore writes into failures", async () => {
  const { backup } = await exportBackupV1(sources());
  const target = restoreSources();
  (target.chat as ChatStorage).subscribe(() => { throw new Error("observer failed"); });
  await restoreBackupV1(backup, target);
  assert.deepEqual(await target.chat.exportBackup(), backup.chat);
});

test("valid empty optional chat strings round-trip and do not cause false CAS failures", async () => {
  const { backup } = await exportBackupV1(sources());
  backup.chat.sessions[0].lastMessagePreview = "";
  backup.chat.messages[0].error = "";
  const target = restoreSources();
  await restoreBackupV1(backup, target);
  assert.deepEqual(await target.chat.exportBackup(), backup.chat);
  await restoreBackupV1(backup, target);
});

test("failed final verification of an overwrite restore restores old chats and keeps API keys", async () => {
  const { backup } = await exportBackupV1(sources());
  const target = restoreSources();
  const storage = target.chat as ChatStorage;
  const oldSession = await storage.openSession("old");
  await storage.send(oldSession.id, "original conversation");
  await storage.saveApiConfig({ id: "api", baseUrl: "https://provider.example/v1",
    apiKey: "keep-this-key", model: "model" });
  const before = await storage.exportBackup();
  const replace = storage.replaceBackup.bind(storage);
  let first = true;
  target.chat.replaceBackup = async (expected, next) => {
    await replace(expected, next);
    if (first) {
      first = false;
      const edited = structuredClone(backup.foundation);
      edited.user.name = "Concurrent edit";
      await target.foundation.replaceIfCurrent(await target.foundation.readRaw(), edited);
    }
  };
  await assert.rejects(() => restoreBackupV1(backup, target, true), /changed during restore/);
  assert.deepEqual(await storage.exportBackup(), before);
  assert.equal((await storage.getApiConfig("api"))?.apiKey, "keep-this-key");
});
