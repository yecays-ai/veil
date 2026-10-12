import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { createUnitWriters, recoverRestore, replaceWithBackup, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { previewRestore } from "../lib/backup/restore-preview";
import { createSafetyCopyStore } from "../lib/backup/safety-copy";
import { packageFixture } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";

async function setup(key = "SIMULATED_ONLY") {
  const raw = new Map<string, string>();
  const device = { indexedDB: new IDBFactory(), localStorage: { getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => { raw.set(k, v); }, removeItem: (k: string) => { raw.delete(k); } } };
  const locks = lockOrigin().client(), fixture = await packageFixture();
  const pack = { manifestJson: JSON.stringify(fixture.manifest), files: fixture.files };
  await restoreIntoEmpty(pack.manifestJson, pack.files, device, locks);
  const api = new ApiConfigStorage(() => device.indexedDB, { withWrite: (operation) => operation() });
  const config = (await api.listApiConfigs())[0];
  await api.saveApiConfig({ ...config, apiKey: key });
  const original = await readStaticBackupSource(device);
  const confirmed = await previewRestore(pack.manifestJson, pack.files, device, locks);
  const writers = createUnitWriters(device);
  return { device, raw, locks, pack, confirmed, writers, original };
}
const configs = async (env: Awaited<ReturnType<typeof setup>>) => (await readStaticBackupSource(env.device)).apiConfigs;

for (const key of ["SIMULATED_ONLY", ""]) test(`equal metadata replacement removes ${key ? "populated" : "empty"} credential fields without changing bindings`, async () => {
  const env = await setup(key);
  await replaceWithBackup(env.pack.manifestJson, env.pack.files, env.device, env.locks, { confirmed: env.confirmed });
  const actual = await readStaticBackupSource(env.device);
  const expected = env.original.apiConfigs.map((row) => { const { apiKey: _key, ...rest } = row as Record<string, unknown>; void _key; return rest; });
  assert.deepEqual(actual.apiConfigs, expected);
  assert.deepEqual(actual.documents.bindings, env.original.documents.bindings);
  assert.equal(env.raw.has(RESTORE_JOURNAL_KEY), false);
});

test("credential removal that lands then fails restores the original key from the safety copy", async () => {
  const env = await setup();
  await assert.rejects(replaceWithBackup(env.pack.manifestJson, env.pack.files, env.device, env.locks, {
    confirmed: env.confirmed, writers: { ...env.writers, apiConfigs: { ...env.writers.apiConfigs,
      write: async (snapshot) => {
        await env.writers.apiConfigs.write(snapshot);
        if (!(snapshot.apiConfigs[0] as Record<string, unknown>).apiKey) throw new Error("injected after credential removal");
      } } },
  }), (error) => error instanceof RestoreError && error.code === "restore-failed-rolled-back");
  assert.deepEqual(await configs(env), env.original.apiConfigs);
  assert.equal(env.raw.has(RESTORE_JOURNAL_KEY), false);
});

for (const action of ["resume", "rollback"] as const) test(`credential-only interrupted replacement can ${action} safely`, async () => {
  const env = await setup();
  await assert.rejects(replaceWithBackup(env.pack.manifestJson, env.pack.files, env.device, env.locks, {
    confirmed: env.confirmed, newId: () => "credential-interruption", writers: { ...env.writers, apiConfigs: { ...env.writers.apiConfigs,
      write: async (snapshot) => {
        if ((snapshot.apiConfigs[0] as Record<string, unknown>).apiKey) throw new Error("interrupted rollback");
        await env.writers.apiConfigs.write(snapshot); throw new Error("interrupted after removal");
      } } },
  }));
  assert.ok(env.raw.has(RESTORE_JOURNAL_KEY));
  assert.ok(await createSafetyCopyStore(env.device.indexedDB).load("credential-interruption"));
  await recoverRestore(action, env.device, env.locks, action === "resume" ? env.pack : null);
  if (action === "rollback") assert.deepEqual(await configs(env), env.original.apiConfigs);
  else assert.ok((await configs(env)).every((row) => !Object.hasOwn(row as object, "apiKey")));
  assert.equal(env.raw.has(RESTORE_JOURNAL_KEY), false);
});

test("a writer that reports success but retains credentials cannot pass restore verification", async () => {
  const env = await setup();
  await assert.rejects(replaceWithBackup(env.pack.manifestJson, env.pack.files, env.device, env.locks, {
    confirmed: env.confirmed, writers: { ...env.writers, apiConfigs: { ...env.writers.apiConfigs,
      write: async () => { /* simulated no-op writer */ } } },
  }), (error) => error instanceof RestoreError && error.code === "verify-failed-rolled-back");
  assert.deepEqual(await configs(env), env.original.apiConfigs);
});

test("a rollback writer that drops the original key cannot falsely clear the journal", async () => {
  const env = await setup();
  await assert.rejects(replaceWithBackup(env.pack.manifestJson, env.pack.files, env.device, env.locks, {
    confirmed: env.confirmed, writers: { ...env.writers, apiConfigs: { ...env.writers.apiConfigs,
      write: async (snapshot) => {
        const stripped = snapshot.apiConfigs.map((row) => { const { apiKey: _key, ...rest } = row as Record<string, unknown>; void _key; return rest; });
        await env.writers.apiConfigs.write({ ...snapshot, apiConfigs: stripped });
        if (!(snapshot.apiConfigs[0] as Record<string, unknown>).apiKey) throw new Error("injected after removal");
      } } },
  }), (error) => error instanceof RestoreError && error.code === "rollback-failed" && error.journal === "kept");
  assert.ok(env.raw.has(RESTORE_JOURNAL_KEY));
  await recoverRestore("rollback", env.device, env.locks, null);
  assert.deepEqual(await configs(env), env.original.apiConfigs);
});
