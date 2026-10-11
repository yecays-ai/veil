import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { BackupCoordinator, BACKUP_LOCK_NAME, type BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { ApiConfigConflictError, ApiConfigStorage } from "../lib/api-config-storage";
import { createBindingStorage, type BindingStorage } from "../lib/binding-storage";
import { deleteApiConfigAndBindings } from "../lib/settings/text-api";
import { lockOrigin } from "./generation-lock-fixture";

const config = { id: "target", name: "Simulated", provider: "Custom" as const,
  baseUrl: "https://example.test/v1", apiKey: "simulated-key", model: "simulated" };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const origin = lockOrigin(), counts = { shared: 0 };
  const manager = { request: ((...args: Parameters<LockManager["request"]>) => {
    if (args[0] === BACKUP_LOCK_NAME && (args[1] as LockOptions).mode === "shared") counts.shared++;
    return origin.client().request(...args);
  }) as BackupLockManager["request"] };
  const gate = createPersistenceWriteGate(() => manager);
  const values = new Map<string, string>();
  const raw = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const bindings = createBindingStorage(() => raw, () => origin.client(), gate);
  const api = new ApiConfigStorage(() => new IDBFactory(), gate);
  await api.saveApiConfig(config, null);
  await bindings.save({ global: { apiConfigId: "target" }, characters: {} });
  counts.shared = 0;
  return { manager, gate, bindings, api, counts };
}

for (const fails of [false, true]) {
  test(`Text API deletion holds one shared lease through ${fails ? "failed Binding cleanup and rollback" : "Binding cleanup"}`, async () => {
    const env = await fixture();
    const entered = deferred(), finish = deferred(), failure = new Error("Simulated cleanup failure");
    const paused: Pick<BindingStorage, "transact"> = { async transact(update, scope) {
      entered.resolve(); await finish.promise;
      if (fails) throw failure;
      return env.bindings.transact(update, scope);
    } };
    const deleting = deleteApiConfigAndBindings("target", env.api, paused, undefined, env.gate);
    const settled = fails ? assert.rejects(deleting, (error) => error === failure) : deleting;
    await entered.promise;
    let captured = false;
    const capture = new BackupCoordinator(env.manager).withSnapshot(async () => {
      captured = true;
      // The snapshot never sees "config deleted, Binding still pointing at it".
      const stored = await env.api.getApiConfig("target");
      const bound = JSON.stringify(await env.bindings.load()).includes("target");
      assert.equal(!!stored, fails);
      assert.equal(bound, fails);
    });
    await Promise.resolve();
    assert.equal(captured, false, "a queued snapshot waits for the whole deletion");
    assert.equal(env.counts.shared, 1, "delete, cleanup and rollback share one outer lease");
    finish.resolve(); await settled; await capture;
    assert.equal(captured, true);
    assert.equal(env.counts.shared, 1);
  });
}

test("a Text API changed elsewhere is kept and nothing in the failed cleanup is overwritten", async () => {
  const env = await fixture();
  const stale = (await env.api.getApiConfig("target"))!;
  await env.api.saveApiConfig({ ...stale, name: "Newer" }, stale);
  await assert.rejects(deleteApiConfigAndBindings("target", env.api, env.bindings, stale, env.gate), ApiConfigConflictError);
  assert.equal((await env.api.getApiConfig("target"))?.name, "Newer");
  assert.equal((await env.bindings.load()).global.apiConfigId, "target");
});
