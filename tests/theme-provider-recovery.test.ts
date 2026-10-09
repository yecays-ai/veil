import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "../components/theme-provider";
import { browserThemeStorage } from "../lib/theme-storage";
import { browserAppearanceImageStorage } from "../lib/appearance-image-storage";
import { defaultSnapshot, type ThemeDocument } from "../lib/theme-types";

const KEY = "companion-phone.appearance.v1";
type Theme = ReturnType<typeof useTheme>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function stored(accent: string, extra?: (document: ThemeDocument) => void): string {
  const document: ThemeDocument = { version: 1, current: defaultSnapshot(), presets: [] };
  document.current.profile.colors.accent = accent;
  extra?.(document);
  return JSON.stringify(document);
}
async function mounted(run: (env: {
  container: HTMLElement; root: ReturnType<typeof CreateRoot>; dom: JSDOM; theme: () => Theme;
}) => Promise<void>, strict = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://veil.test" });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  const keys = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window
      : key === "document" ? dom.window.document : dom.window[key as keyof typeof dom.window] });
  const container = dom.window.document.getElementById("root")!;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  let latest!: Theme;
  function Probe() {
    latest = useTheme();
    return createElement("output", { "data-ready": String(latest.ready), "data-accent": latest.document.current.profile.colors.accent });
  }
  await act(async () => {
    const provider = createElement(ThemeProvider, null, createElement(Probe));
    root.render(strict ? createElement(StrictMode, null, provider) : provider);
  });
  try { await run({ container, root, dom, theme: () => latest }); }
  finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    keys.forEach((key, index) => { if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key); });
  }
}
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert(Date.now() < deadline, "mounted UI did not reach the expected state");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}
const output = (container: HTMLElement) => container.querySelector("output")!;
const retryButton = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry");
const accentUpdate = (accent: string) => (theme: Theme) => theme.updateProfile((profile) => ({
  ...profile, colors: { ...profile.colors, accent } }));

test("Theme configuration publishes before pending images, which fill in without resetting it", async () => {
  const originalLoad = browserThemeStorage.load;
  const originalRead = browserAppearanceImageStorage.readBlob;
  const pending = deferred<Blob | null>();
  const saved = JSON.parse(stored("#112233")) as ThemeDocument;
  const source = `appearance-asset:${"a".repeat(64)}`;
  saved.current.profile.wallpaper.source = source;
  saved.current.profile.text.font = "serif";
  let reads = 0;
  browserThemeStorage.load = async () => saved;
  browserAppearanceImageStorage.readBlob = () => { reads++; return pending.promise; };
  try {
    await mounted(async ({ container, theme }) => {
      await waitFor(() => reads === 1);
      assert.equal(output(container).dataset.ready, "true", "configuration is ready while the Blob read remains pending");
      assert.equal(output(container).dataset.accent, "#112233");
      const surface = container.querySelector<HTMLElement>(".theme-surface")!;
      assert.equal(surface.style.getPropertyValue("--theme-accent"), "#112233");
      assert.equal(surface.style.getPropertyValue("--theme-font-family"), "Georgia, serif");
      assert.equal(theme().resolveImage(source), null);
      await act(async () => { pending.resolve(new Blob(["theme"], { type: "image/png" })); });
      await waitFor(() => !!theme().resolveImage(source));
      assert.equal(output(container).dataset.accent, "#112233");
      assert.ok(container.querySelector('[data-testid="home-wallpaper"]'));
      assert.equal(surface.style.getPropertyValue("--theme-font-family"), "Georgia, serif");
    });
  } finally {
    browserThemeStorage.load = originalLoad;
    browserAppearanceImageStorage.readBlob = originalRead;
  }
});

test("a slow current image does not block Theme ready", async () => {
  const originalLoad = browserThemeStorage.load;
  const originalRead = browserAppearanceImageStorage.readBlob;
  const saved = JSON.parse(stored("#112233")) as ThemeDocument;
  saved.current.profile.wallpaper.source = `appearance-asset:${"c".repeat(64)}`;
  browserThemeStorage.load = async () => saved;
  browserAppearanceImageStorage.readBlob = () => new Promise<Blob | null>(() => {});
  try {
    await mounted(async ({ container, theme }) => {
      await waitFor(() => output(container).dataset.ready === "true");
      assert.equal(output(container).dataset.accent, "#112233");
      assert.equal(theme().resolveImage(saved.current.profile.wallpaper.source), null,
        "the theme uses its normal wallpaper fallback after the bounded image wait");
    });
  } finally {
    browserThemeStorage.load = originalLoad;
    browserAppearanceImageStorage.readBlob = originalRead;
  }
});

const asset = (letter: string) => `appearance-asset:${letter.repeat(64)}`;
const withImage = (accent: string, letter: string): ThemeDocument => {
  const saved = JSON.parse(stored(accent)) as ThemeDocument;
  saved.current.profile.wallpaper.source = asset(letter);
  return saved;
};
async function imageFixture(run: (resources: {
  created: string[]; revoked: string[]; reads: string[];
  setDocument: (document: ThemeDocument) => void;
  setRead: (read: (id: string) => Promise<Blob | null>) => void;
}) => Promise<void>) {
  const original = { load: browserThemeStorage.load, read: browserAppearanceImageStorage.readBlob };
  const create = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const created: string[] = [], revoked: string[] = [], reads: string[] = [];
  let document = withImage("#112233", "a");
  let read: (id: string) => Promise<Blob | null> = async () => new Blob(["image"]);
  browserThemeStorage.load = async () => document;
  browserAppearanceImageStorage.readBlob = (id) => { reads.push(id); return read(id); };
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => {
    const url = `blob:theme-${created.length}`; created.push(url); return url;
  } });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (url: string) => { revoked.push(url); } });
  try { await run({ created, revoked, reads,
    setDocument: (saved) => { document = saved; }, setRead: (next) => { read = next; } }); }
  finally {
    browserThemeStorage.load = original.load;
    browserAppearanceImageStorage.readBlob = original.read;
    if (create) Object.defineProperty(URL, "createObjectURL", create); else Reflect.deleteProperty(URL, "createObjectURL");
    if (revoke) Object.defineProperty(URL, "revokeObjectURL", revoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
}
async function peerChanged(dom: JSDOM) {
  await act(async () => { dom.window.dispatchEvent(new dom.window.StorageEvent("storage", { key: KEY })); });
}

test("a rejected image read leaves the mounted saved configuration ready without an unhandled rejection", async () => {
  await imageFixture(async ({ created, setRead }) => {
    const pending = deferred<Blob | null>();
    setRead(() => pending.promise);
    await mounted(async ({ container, theme }) => {
      assert.equal(output(container).dataset.ready, "true");
      await act(async () => { pending.reject(new Error("image unavailable")); });
      assert.equal(output(container).dataset.accent, "#112233");
      assert.equal(theme().resolveImage(asset("a")), null);
      assert.equal(output(container).dataset.ready, "true");
      assert.equal(container.querySelector("[role=alert]"), null);
      assert.deepEqual(created, []);
    });
  });
});

test("saving a ready configuration does not wait for pending images and its refresh keeps the latest settings", async () => {
  await imageFixture(async ({ setRead, setDocument, created }) => {
    const pending = deferred<Blob | null>();
    setRead(() => pending.promise);
    let saved = withImage("#112233", "a");
    setDocument(saved);
    const transact = browserThemeStorage.transact;
    browserThemeStorage.transact = async (update) => {
      saved = update(saved);
      setDocument(saved);
      return saved;
    };
    try {
      await mounted(async ({ container, theme }) => {
        await act(async () => { await accentUpdate("#445566")(theme()); });
        assert.equal(saved.current.profile.colors.accent, "#445566");
        assert.equal(output(container).dataset.ready, "true");
        assert.equal(output(container).dataset.accent, "#445566");
        assert.equal(theme().resolveImage(asset("a")), null);
        await act(async () => { pending.resolve(new Blob(["image"])); });
        await waitFor(() => !!theme().resolveImage(asset("a")));
        assert.equal(created.length, 1, "only the refreshed request creates a URL");
        assert.equal(output(container).dataset.accent, "#445566");
      });
    } finally { browserThemeStorage.transact = transact; }
  });
});

test("image timeout immediately releases partial URLs and ignores late completion without reverting configuration", async () => {
  await imageFixture(async ({ created, revoked, setRead, setDocument }) => {
    const pending = deferred<Blob | null>();
    const saved = withImage("#112233", "a");
    saved.current.profile.dock.image = asset("b");
    setDocument(saved);
    setRead(async (id) => id === "b".repeat(64) ? pending.promise : new Blob(["first"]));
    await mounted(async ({ container, theme }) => {
      assert.equal(output(container).dataset.ready, "true");
      await waitFor(() => created.length === 1);
      await waitFor(() => revoked.length === 1);
      assert.equal(output(container).dataset.accent, "#112233");
      assert.equal(output(container).dataset.ready, "true");
      assert.equal(theme().resolveImage(asset("a")), null);
      await act(async () => { pending.resolve(new Blob(["late"])); });
      assert.deepEqual(created, ["blob:theme-0"]);
      assert.deepEqual(revoked, created, "the timed-out partial URL is revoked exactly once");
      assert.equal(theme().resolveImage(asset("b")), null);
    });
  });
});

test("theme B supersedes pending theme A images and A cannot invalidate or overwrite B", async () => {
  await imageFixture(async ({ created, revoked, setRead, setDocument }) => {
    const pending = deferred<Blob | null>();
    setRead(async (id) => id === "a".repeat(64) ? pending.promise : new Blob([id]));
    await mounted(async ({ container, dom, theme }) => {
      assert.equal(output(container).dataset.accent, "#112233");
      setDocument(withImage("#445566", "b"));
      await peerChanged(dom);
      await waitFor(() => !!theme().resolveImage(asset("b")));
      const current = theme().resolveImage(asset("b"));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1050)); });
      await act(async () => { pending.resolve(new Blob(["obsolete"])); });
      assert.equal(output(container).dataset.accent, "#445566");
      assert.equal(theme().resolveImage(asset("b")), current);
      assert.equal(theme().resolveImage(asset("a")), null);
      assert.deepEqual(created, [current]);
      assert.deepEqual(revoked, []);
    });
    assert.deepEqual(revoked, created, "unmount releases the current theme URL");
  });
});

test("repeated mounted loads reuse current URLs, ignore preset images, and release replaced URLs", async () => {
  await imageFixture(async ({ created, revoked, reads, setDocument }) => {
    const saved = withImage("#112233", "a");
    const unused = defaultSnapshot();
    unused.profile.wallpaper.source = asset("c");
    saved.presets.push({ id: "unused", name: "Unused", snapshot: unused });
    setDocument(saved);
    await mounted(async ({ dom, theme }) => {
      await waitFor(() => !!theme().resolveImage(asset("a")));
      const first = theme().resolveImage(asset("a"));
      await peerChanged(dom);
      await waitFor(() => !!theme().resolveImage(asset("a")));
      assert.equal(theme().resolveImage(asset("a")), first);
      assert.deepEqual(reads, ["a".repeat(64)]);
      assert.deepEqual(created, [first]);
      setDocument(withImage("#445566", "b"));
      await peerChanged(dom);
      await waitFor(() => !!theme().resolveImage(asset("b")));
      assert.deepEqual(revoked, [first]);
      assert.equal(theme().resolveImage(asset("a")), null);
    });
    assert.deepEqual(revoked, created);
  });
});

test("reloading retains still-used published images while new assets are pending or time out", async () => {
  await imageFixture(async ({ created, revoked, setRead, setDocument }) => {
    const pending = deferred<Blob | null>();
    const initial = withImage("#112233", "a");
    initial.current.profile.dock.image = asset("b");
    setDocument(initial);
    await mounted(async ({ container, dom, theme }) => {
      await waitFor(() => !!theme().resolveImage(asset("b")));
      const wallpaper = theme().resolveImage(asset("a"));
      const oldDock = theme().resolveImage(asset("b"));
      const saved = withImage("#445566", "a");
      saved.current.profile.dock.image = asset("c");
      setDocument(saved);
      setRead(() => pending.promise);
      await peerChanged(dom);
      assert.equal(output(container).dataset.accent, "#445566");
      assert.equal(theme().resolveImage(asset("a")), wallpaper, "the still-used wallpaper never disappears during the new read");
      assert.ok(container.querySelector('[data-testid="home-wallpaper"]'));
      assert.equal(theme().resolveImage(asset("b")), null, "removed assets are not exposed by the retained map");
      assert.equal(theme().resolveImage(asset("c")), null);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1050)); });
      assert.equal(theme().resolveImage(asset("a")), wallpaper, "timeout preserves the still-used published URL");
      await act(async () => { pending.reject(new Error("late image failure")); });
      assert.equal(theme().resolveImage(asset("a")), wallpaper);
      assert.equal(output(container).dataset.ready, "true");
      assert.deepEqual(created, [wallpaper, oldDock]);
      assert.deepEqual(revoked, []);
    });
    assert.deepEqual(revoked, created);
  });
});

test("Strict Mode and unmount invalidate pending reads and revoke partial URLs before they finish", async () => {
  await imageFixture(async ({ created, revoked, setRead, setDocument }) => {
    const pending = deferred<Blob | null>();
    const saved = withImage("#112233", "a");
    saved.current.profile.dock.image = asset("b");
    setDocument(saved);
    setRead(async (id) => id === "b".repeat(64) ? pending.promise : new Blob(["first"]));
    await mounted(async ({ container }) => {
      assert.equal(output(container).dataset.ready, "true");
      await waitFor(() => created.length === 1);
    }, true);
    assert.deepEqual(revoked, created, "unmount revokes the partial batch while its other Blob is still pending");
    await act(async () => { pending.resolve(new Blob(["late"])); });
    assert.equal(created.length, 1, "obsolete Strict Mode and unmounted reads cannot create URLs");
    assert.deepEqual(revoked, created);
  });
});

// The provider calls these properties, so a test can fail or slow its reads without a second storage.
function instrument(options: { loads?: Array<() => Promise<ThemeDocument>> } = {}) {
  const original = { load: browserThemeStorage.load, transact: browserThemeStorage.transact };
  const state = { fail: false, failAfterWrite: false, loadCalls: 0, transactCalls: 0 };
  browserThemeStorage.load = async () => {
    state.loadCalls++;
    const scripted = options.loads?.shift();
    if (scripted) return scripted();
    if (state.fail) throw new Error("storage unreadable");
    return original.load.call(browserThemeStorage);
  };
  browserThemeStorage.transact = async (update) => {
    state.transactCalls++;
    const result = await original.transact.call(browserThemeStorage, update);
    if (state.failAfterWrite) state.fail = true;
    return result;
  };
  return { state, restore: () => Object.assign(browserThemeStorage, original) };
}

test("a failed first load recovers from the persisted data, then writes on top of it", async () => {
  const { state, restore } = instrument();
  try {
    state.fail = true;
    await mounted(async ({ container, dom, theme }) => {
      const persisted = stored("#112233", (document) => { document.presets.push({ id: "keep", name: "Keep", snapshot: defaultSnapshot() }); });
      dom.window.localStorage.setItem(KEY, persisted);
      await act(async () => { await theme().commit((d) => d).catch(() => {}); });
      assert.equal(output(container).dataset.ready, "false");
      assert.ok(retryButton(container), "a failed load offers an explicit retry");
      state.fail = false;
      await act(async () => { retryButton(container)!.click(); });
      await waitFor(() => output(container).dataset.ready === "true");
      assert.equal(output(container).dataset.accent, "#112233", "the real persisted data is shown, not defaults");
      assert.equal(retryButton(container), undefined);
      await act(async () => { await accentUpdate("#445566")(theme()); });
      const saved = JSON.parse(dom.window.localStorage.getItem(KEY)!) as ThemeDocument;
      assert.equal(saved.current.profile.colors.accent, "#445566");
      assert.deepEqual(saved.presets.map((preset) => preset.id), ["keep"], "unrelated persisted data survives");
    });
  } finally { restore(); }
});

test("a write after a failed load re-reads the persisted data on its own", async () => {
  const { state, restore } = instrument();
  try {
    state.fail = true;
    await mounted(async ({ container, dom, theme }) => {
      dom.window.localStorage.setItem(KEY, stored("#112233"));
      state.fail = false; // storage became readable again; nothing has retried yet
      assert.equal(output(container).dataset.ready, "false");
      await act(async () => { await accentUpdate("#445566")(theme()); });
      assert.equal(JSON.parse(dom.window.localStorage.getItem(KEY)!).current.profile.colors.accent, "#445566");
      assert.equal(output(container).dataset.ready, "true");
    });
  } finally { restore(); }
});

test("a load that keeps failing refuses every write and leaves the persisted bytes alone", async () => {
  const { state, restore } = instrument();
  try {
    state.fail = true;
    await mounted(async ({ container, dom, theme }) => {
      const persisted = stored("#112233");
      dom.window.localStorage.setItem(KEY, persisted);
      const reasons: unknown[] = [];
      for (let attempt = 0; attempt < 2; attempt++)
        await act(async () => { await accentUpdate("#445566")(theme()).catch((reason) => reasons.push(reason)); });
      await act(async () => { retryButton(container)!.click(); });
      assert.equal(reasons.length, 2);
      assert.match((reasons[0] as Error).message, /storage unreadable/);
      assert.equal(state.transactCalls, 0, "no write is attempted from a default runtime state");
      assert.equal(dom.window.localStorage.getItem(KEY), persisted);
      assert.equal(output(container).dataset.ready, "false");
      assert.ok(retryButton(container), "retry stays available");
    });
  } finally { restore(); }
});

test("a durable save is reported as saved when the following refresh fails, and a later write recovers", async () => {
  const { state, restore } = instrument();
  try {
    await mounted(async ({ container, dom, theme }) => {
      dom.window.localStorage.setItem(KEY, stored("#112233"));
      await act(async () => { await theme().commit((d) => d); });
      assert.equal(output(container).dataset.ready, "true");
      state.failAfterWrite = true; // every read fails once this write has committed
      let outcome: unknown = "pending";
      await act(async () => { outcome = await accentUpdate("#445566")(theme()).then(() => "resolved", (reason) => reason); });
      assert.equal(outcome, "resolved", "the committed write is not reported as a failed save");
      assert.equal(JSON.parse(dom.window.localStorage.getItem(KEY)!).current.profile.colors.accent, "#445566");
      assert.match(container.querySelector("[role=alert]")!.textContent!, /saved, but could not be reloaded/);
      assert.equal(output(container).dataset.ready, "false");
      state.failAfterWrite = false; state.fail = false;
      await act(async () => { await accentUpdate("#778899")(theme()); });
      assert.equal(JSON.parse(dom.window.localStorage.getItem(KEY)!).current.profile.colors.accent, "#778899");
      assert.equal(output(container).dataset.accent, "#778899");
      assert.equal(output(container).dataset.ready, "true");
    });
  } finally { restore(); }
});

test("queued writes behind a failed load recover once, apply in order and keep both changes", async () => {
  const { state, restore } = instrument();
  try {
    state.fail = true;
    await mounted(async ({ container, dom, theme }) => {
      dom.window.localStorage.setItem(KEY, stored("#112233"));
      state.fail = false;
      const loadsBefore = state.loadCalls;
      await act(async () => {
        await Promise.all([accentUpdate("#445566")(theme()), theme().updateProfile((profile) => ({
          ...profile, colors: { ...profile.colors, background: "#abcdef" } }))]);
      });
      const saved = JSON.parse(dom.window.localStorage.getItem(KEY)!) as ThemeDocument;
      assert.equal(saved.current.profile.colors.accent, "#445566");
      assert.equal(saved.current.profile.colors.background, "#abcdef");
      assert.equal(state.loadCalls - loadsBefore, 3, "one recovery read plus one refresh per write; the second write did not recover again");
      assert.equal(output(container).dataset.ready, "true");
    });
  } finally { restore(); }
});

test("overlapping retries share one read and an older read cannot replace a newer one", async () => {
  const slow = deferred<ThemeDocument>();
  const parse = (accent: string) => JSON.parse(stored(accent)) as ThemeDocument;
  const { state, restore } = instrument({ loads: [
    async () => { throw new Error("storage unreadable"); }, // first mount load
    () => slow.promise, // first retry: stays pending
  ] });
  try {
    await mounted(async ({ container, dom, theme }) => {
      assert.equal(output(container).dataset.ready, "false");
      const callsBefore = state.loadCalls;
      await act(async () => { retryButton(container)!.click(); retryButton(container)!.click(); });
      assert.equal(state.loadCalls - callsBefore, 1, "a retry during a running read joins it");
      // A newer read (another tab wrote) completes first.
      dom.window.localStorage.setItem(KEY, stored("#00ff00"));
      await act(async () => { dom.window.dispatchEvent(new dom.window.StorageEvent("storage", { key: KEY })); });
      await waitFor(() => output(container).dataset.accent === "#00ff00");
      await act(async () => { slow.resolve(parse("#ff0000")); await slow.promise; });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      assert.equal(output(container).dataset.accent, "#00ff00", "the older read did not overwrite the newer state");
      assert.equal(output(container).dataset.ready, "true");
      await act(async () => { await theme().commit((d) => d); });
      assert.equal(JSON.parse(dom.window.localStorage.getItem(KEY)!).current.profile.colors.accent, "#00ff00");
    });
  } finally { restore(); }
});
