import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { addSituation, markSignatureChange, markSituationChange, setUserNote } from "../lib/presence/storage";
import type { PresenceDocument } from "../lib/presence/storage";
import type { FoundationDocument } from "../lib/foundation-types";
import { characterNoteEventText, userNoteEventText } from "../lib/presence/note-events";
import { exportStaticBackup } from "../lib/backup/static-export";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, replaceWithBackup, restoreIntoEmpty, RestoreError, type RestoreDevice } from "../lib/backup/restore";
import { lockOrigin } from "./generation-lock-fixture";
import { packageFixture, TEST_NOW, TEST_COMMIT } from "./backup-fixture";

function device(): RestoreDevice {
  const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: {
    getItem: (key) => raw.get(key) ?? null, setItem: (key, value) => { raw.set(key, value); }, removeItem: (key) => { raw.delete(key); },
  } };
}
async function setup() {
  const source = device(), locks = lockOrigin().client(), f = await packageFixture(), original = { manifestJson: JSON.stringify(f.manifest), files: f.files };
  await restoreIntoEmpty(original.manifestJson, original.files, source, locks);
  const writers = createUnitWriters(source), snapshot = await readStaticBackupSource(source);
  const mark = { changedAt: TEST_NOW + 1, source: "character:reply-test" };
  let presence = snapshot.documents.presence as PresenceDocument;
  presence = addSituation(presence, "peter", { status: "busy", reason: "Simulated activity", startsAt: TEST_NOW, endsAt: TEST_NOW + 3_600_000 }, mark, TEST_NOW);
  presence = markSituationChange(markSignatureChange(setUserNote(presence, "peter", "Test nickname", mark), "peter", mark), "peter", mark);
  const foundation = snapshot.documents.foundation as FoundationDocument;
  await writers.presence.write({ ...snapshot, documents: { ...snapshot.documents, presence } });
  await writers.foundation.write({ ...snapshot, documents: { ...snapshot.documents,
    foundation: { ...foundation, characters: foundation.characters.map((row) => row.characterId === "peter" ? { ...row, statusMessage: "Changed signature" } : row) },
  } });
  const chat = new ChatStorage(() => source.indexedDB, () => undefined, { withWrite: (run) => run() });
  await chat.appendSystemEvent("peter", characterNoteEventText("Peter", "Test nickname"), TEST_NOW + 1);
  await chat.appendSystemEvent("peter", userNoteEventText("Peter", "Test remark"), TEST_NOW + 2);
  const backup = await exportStaticBackup(source, { backupId: "presence-latest", createdAt: TEST_NOW + 2, sourceCommit: TEST_COMMIT });
  return { source, locks, original, backup, expected: await readStaticBackupSource(source) };
}

for (const mode of ["empty", "replace"] as const) {
  test(`Presence T7/T8 fields and both note events survive ${mode} full backup recovery`, async () => {
    const { locks, original, backup, expected } = await setup(), target = device();
    if (mode === "empty") await restoreIntoEmpty(backup.manifestJson, backup.files, target, locks);
    else {
      await restoreIntoEmpty(original.manifestJson, original.files, target, locks);
      const confirmed = await previewRestore(backup.manifestJson, backup.files, target, locks);
      await replaceWithBackup(backup.manifestJson, backup.files, target, locks, { confirmed });
    }
    assert.deepEqual(await readStaticBackupSource(target), expected);
    assert.equal(expected.chat.messages.filter((row) => (row as { role: string }).role === "system").length, 2);
    assert.equal((expected.documents.presence as PresenceDocument).characters[0].userNote?.text, "Test nickname");
  });
}

test("failed coverage restore preserves the newer Presence data and note events from its safety copy", async () => {
  const { source, locks, original, expected } = await setup(), writers = createUnitWriters(source);
  const confirmed = await previewRestore(original.manifestJson, original.files, source, locks);
  await assert.rejects(replaceWithBackup(original.manifestJson, original.files, source, locks, { confirmed, writers: { ...writers,
    foundation: { ...writers.foundation, write: async () => { throw new Error("injected late failure"); } },
  } }), (error) => error instanceof RestoreError && error.code === "restore-failed-rolled-back");
  assert.deepEqual(await readStaticBackupSource(source), expected);
});
