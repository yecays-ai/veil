import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";

regressionContract("bindings.default-all-list-selection", "render-lifecycle",
  "mounted Binding editor shows Default (All) for unset WorldBook/Regex lists and persists explicit None, partial and override choices", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings/bindings", pretendToBeVisual: true });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event"] as const)
      install(name, dom.window[name]);
    install("indexedDB", new IDBFactory()); install("self", dom.window);
    install("IS_REACT_ACT_ENVIRONMENT", true);
    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { BindingEditor, BindingHome } = await import("../components/settings/bindings/binding-manager");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { browserPresetStorage } = await import("../lib/preset-storage");
    const { browserWorldBookStorage } = await import("../lib/worldbook-storage");
    const { browserRegexStorage } = await import("../lib/regex-storage");
    const { createPresetDocument } = await import("../lib/preset");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const { BINDING_STORAGE_KEY } = await import("../lib/binding-storage");
    const foundation = normalizeFoundation({ characters: [{ characterId: "p", name: "Peter" }] });
    const originals = [browserFoundationStorage.load, browserApiConfigStorage.listApiConfigs,
      browserPresetStorage.load, browserWorldBookStorage.load, browserRegexStorage.load] as const;
    browserFoundationStorage.load = async () => foundation;
    browserApiConfigStorage.listApiConfigs = async () => [];
    browserPresetStorage.load = async () => createPresetDocument();
    browserWorldBookStorage.load = async () => ({ books: [{ id: "b1", name: "Lore" }, { id: "b2", name: "Map" }] }) as never;
    browserRegexStorage.load = async () => ({ groups: [{ id: "r1", name: "Clean" }, { id: "r2", name: "Style" }] }) as never;
    const doc = dom.window.document;
    const stored = () => JSON.parse(dom.window.localStorage.getItem(BINDING_STORAGE_KEY) ?? "{}");
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (true) {
        assert.ok(Date.now() < deadline, "mounted UI condition timed out");
        let ready = false;
        await act(async () => { ready = condition(); if (!ready) await new Promise((r) => setTimeout(r, 10)); });
        if (ready) return;
      }
    };
    const field = (label: string) => [...doc.querySelectorAll<HTMLElement>(".binding-field")]
      .find((el) => el.querySelector("strong")?.textContent === label)!;
    const summary = (label: string) => field(label).querySelector(".binding-field-main small")!.textContent;
    const choice = (label: string, text: string) => [...field(label).querySelectorAll<HTMLButtonElement>(".binding-picker button")]
      .find((el) => el.textContent?.trim().startsWith(text))!;
    const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };
    const open = async (label: string) => {
      const main = field(label).querySelector<HTMLButtonElement>(".binding-field-main")!;
      if (main.getAttribute("aria-expanded") !== "true") await click(main);
    };
    let activeUnmount: (() => Promise<void>) | undefined;
    const mount = async (props: { characterId?: string }) => {
      const root = createRoot(doc.getElementById("root")!);
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(props.characterId ? BindingEditor : BindingHome, props))); });
      await wait(() => !!doc.querySelector(".binding-field"));
      const unmount = async () => {
        if (activeUnmount === unmount) activeUnmount = undefined;
        await act(async () => { root.unmount(); });
      };
      activeUnmount = unmount;
      return unmount;
    };
    try {
      // Initial state: nothing stored; both resources are Default (All), never None.
      let unmount = await mount({});
      for (const label of ["WorldBook", "Regex"]) assert.equal(summary(label), "Default (All)");
      assert.deepEqual(stored().global ?? {}, {});
      for (const label of ["WorldBook", "Regex"]) {
        // Explicit None persists [] (not undefined) and displays None.
        await open(label); await click(choice(label, "None"));
        await wait(() => summary(label) === "None");
      }
      assert.deepEqual(stored().global, { worldBookIds: [], regexIds: [] });
      // Partial selection persists exactly the picked ids.
      await open("WorldBook"); await click(choice("WorldBook", "Lore"));
      await open("Regex"); await click(choice("Regex", "Style"));
      await wait(() => summary("WorldBook") === "Lore" && summary("Regex") === "Style");
      assert.deepEqual(stored().global, { worldBookIds: ["b1"], regexIds: ["r2"] });
      // Reopen after save: reads back the same selection.
      await unmount(); unmount = await mount({});
      assert.equal(summary("WorldBook"), "Lore"); assert.equal(summary("Regex"), "Style");
      // Back to Default (All) removes the key, and it shows Default (All) again.
      for (const label of ["WorldBook", "Regex"]) {
        await open(label); await click(choice(label, "Default (All)"));
        await wait(() => summary(label) === "Default (All)");
      }
      assert.deepEqual(stored().global ?? {}, {});
      // Reload from storage: still Default (All), not None.
      await unmount(); unmount = await mount({});
      for (const label of ["WorldBook", "Regex"]) assert.equal(summary(label), "Default (All)");
      await unmount();

      // Character override: inherits Default (All), explicit None overrides, reset inherits again.
      unmount = await mount({ characterId: "p" });
      for (const label of ["WorldBook", "Regex"]) assert.equal(summary(label), "Inherited: Default (All)");
      for (const label of ["WorldBook", "Regex"]) {
        await open(label); await click(choice(label, "None"));
        await wait(() => summary(label) === "Override: None");
      }
      assert.deepEqual(stored().characters.p.defaults, { worldBookIds: [], regexIds: [] });
      assert.deepEqual(stored().global ?? {}, {});
      await open("WorldBook"); await click(choice("WorldBook", "Inherit Global"));
      await wait(() => summary("WorldBook") === "Inherited: Default (All)");
      assert.deepEqual(stored().characters.p.defaults, { regexIds: [] });
      await unmount();
    } finally {
      await activeUnmount?.();
      browserFoundationStorage.load = originals[0]; browserApiConfigStorage.listApiConfigs = originals[1];
      browserPresetStorage.load = originals[2]; browserWorldBookStorage.load = originals[3];
      browserRegexStorage.load = originals[4];
      dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
