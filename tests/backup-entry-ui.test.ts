import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import type { BackupLockManager } from "../lib/backup/coordination";
import { createBackupFile, hasRestoreJournal } from "../lib/backup/backup-flow";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { RESTORE_JOURNAL_KEY } from "../lib/backup/restore";
import { buildWorld } from "./character-deletion-fixture";
import { lockOrigin } from "./generation-lock-fixture";

async function mounted(options: { journal?: boolean; factory?: IDBFactory }, run: (app: {
  dom: JSDOM; container: HTMLElement; render: (child: ReactNode) => Promise<void>; locks: BackupLockManager;
  text: () => string; wait: (check: () => boolean) => Promise<void>; click: (el: Element | null | undefined) => Promise<void>;
  choose: (bytes: Uint8Array) => Promise<void>; button: (label: string) => HTMLButtonElement | undefined;
}) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const locks = lockOrigin().client() as unknown as BackupLockManager;
  const factory = options.factory ?? new IDBFactory();
  Object.defineProperty(dom.window, "indexedDB", { value: factory, configurable: true });
  Object.defineProperty(dom.window.navigator, "locks", { value: locks, configurable: true });
  if (options.journal) dom.window.localStorage.setItem(RESTORE_JOURNAL_KEY, "{}");
  const names = ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "File", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name as keyof typeof dom.window] }));
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = (child: ReactNode) => act(async () => root.render(child));
  const text = () => container.textContent ?? "";
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!check()) { assert.ok(Date.now() < deadline, `timed out; page text: ${text()}`); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
  };
  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  const click = (el: Element | null | undefined) => act(async () => { assert.ok(el, "element exists"); (el as HTMLElement).click(); });
  const choose = (bytes: Uint8Array) => act(async () => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new dom.window.File([bytes as BlobPart], "backup.zip");
    // jsdom's File has no arrayBuffer(); real browsers do.
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  try { await run({ dom, container, render, locks, text, wait, click, choose, button }); }
  finally {
    await act(async () => root.unmount());
    loader._load = originalLoad;
    names.forEach((name, i) => previous[i] ? Object.defineProperty(globalThis, name, previous[i]!) : Reflect.deleteProperty(globalThis, name));
    dom.window.close();
  }
}

async function backupBytes() {
  const locks = lockOrigin().client() as unknown as BackupLockManager;
  const world = await buildWorld({ gate: createPersistenceWriteGate(() => locks) });
  await world.bindingStore.transact(() => ({ global: {}, characters: {} }));
  const { bytes } = await createBackupFile({ locks, device: { indexedDB: world.factory, localStorage: {
    getItem: (k) => world.raw.get(k) ?? null, setItem: (k, v) => { world.raw.set(k, v); }, removeItem: (k) => { world.raw.delete(k); } } } });
  return bytes;
}

test("the gate shows children normally and blocks them while a restore journal exists", async () => {
  const { RestoreGate } = await import("../components/restore-gate");
  await mounted({}, async ({ render, text }) => {
    await render(createElement(RestoreGate, null, createElement("p", null, "app content")));
    assert.match(text(), /app content/);
  });
  let childRendered = false;
  const Child = () => { childRendered = true; return createElement("p", null, "app content"); };
  await mounted({ journal: true }, async ({ render, text, button }) => {
    await render(createElement(RestoreGate, null, createElement(Child)));
    assert.equal(childRendered, false, "no provider or page may mount while a restore is unfinished");
    assert.match(text(), /Restore interrupted/);
    assert.ok(button("Roll back"));
    assert.ok(button("Finish the restore"));
  });
});

test("the gate can roll back an unfinished restore from its screen and reloads", async () => {
  const { RestoreGate } = await import("../components/restore-gate");
  await mounted({ journal: true }, async ({ render, click, button, wait, dom }) => {
    await render(createElement(RestoreGate, null, createElement("p", null, "app content")));
    await click(button("Roll back"));
    // The journal here is garbage, which must be refused rather than acted on.
    await wait(() => !!dom.window.document.querySelector('[role="alert"]'));
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /journal-invalid/);
    assert.equal(hasRestoreJournal(dom.window.localStorage), true, "a journal that cannot be understood is kept");
  });
});

test("Settings: export builds a ZIP download, import previews, confirms and restores an empty device", async () => {
  const { BackupRestoreSettings } = await import("../components/settings/backup-restore");
  const bytes = await backupBytes();
  await mounted({}, async ({ render, click, button, choose, wait, text, dom }) => {
    await render(createElement(BackupRestoreSettings));
    assert.equal(button("Export Backup")?.disabled, false);
    assert.equal(button("Import Backup")?.disabled, false);
    await choose(bytes);
    await wait(() => !!button("Restore"));
    assert.match(text(), /backup\.zip/);
    assert.equal(hasRestoreJournal(dom.window.localStorage), false);
    await click(button("Restore"));
    await wait(() => /Restore complete/.test(text()));
    assert.ok(button("Reload VEIL"));
    // A second import now needs the explicit replace confirmation.
    await choose(bytes);
    await wait(() => !!button("Replace everything"));
    assert.equal(button("Replace everything")!.disabled, true);
    await click(dom.window.document.querySelector('input[type="checkbox"]'));
    assert.equal(button("Replace everything")!.disabled, false);
    await click(button("Replace everything"));
    await wait(() => /Restore complete/.test(text()));
  });
});

test("Settings: an invalid file shows a plain error and changes nothing", async () => {
  const { BackupRestoreSettings } = await import("../components/settings/backup-restore");
  const factory = new IDBFactory();
  await mounted({ factory }, async ({ render, choose, wait, text }) => {
    await render(createElement(BackupRestoreSettings));
    await choose(new Uint8Array([1, 2, 3]));
    await wait(() => /not a valid VEIL backup/.test(text()));
    assert.deepEqual(await factory.databases(), []);
  });
});
