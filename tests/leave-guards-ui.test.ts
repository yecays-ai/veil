import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import { copyPreset } from "../lib/preset-library";
import { createPresetDocument } from "../lib/preset";
import { addContact, normalizeContacts, type ContactDocument } from "../lib/contact-storage";
import { normalizeFoundation, type FoundationDocument } from "../lib/foundation-types";
import { defaultRegexGroup } from "../lib/regex-defaults";
import { newRegexGroup, newRegexRule } from "../lib/regex";
import { normalizeWorldBook } from "../lib/worldbook";
import { browserWorldBookStorage } from "../lib/worldbook-storage";
import { browserRegexStorage } from "../lib/regex-storage";
import { chatStorage } from "../lib/chat/storage";
import type { ChatSession } from "../lib/chat/types";
import { defaultSnapshot } from "../lib/theme-types";

// R2: an editor with real unsaved edits asks before an in-app leave; a clean one never does.
// "Leaves" means the click was not cancelled: the guard cancels it when the user answers No.
let foundation: FoundationDocument = normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }] });
let contacts: ContactDocument = normalizeContacts(null);
let failCommit = false;
const foundationBridge = { useFoundation: () => ({ document: foundation, ready: true,
  commit: async (update: (value: FoundationDocument) => FoundationDocument) => {
    if (failCommit) throw new Error("Could not save.");
    foundation = update(foundation); return foundation;
  } }) };
const contactsBridge = { useContacts: () => ({ document: contacts, ready: true, error: "", retry: async () => {},
  commit: async (update: (value: ContactDocument) => ContactDocument) => {
    if (failCommit) throw new Error("Could not save.");
    contacts = update(contacts); return contacts;
  } }) };

let theme = { current: defaultSnapshot(), presets: [] as unknown[] };
const themeBridge = { useTheme: () => ({ document: theme, ready: true, commit: async () => {}, resolveImage: () => null,
  updateProfile: async (update: (profile: typeof theme.current.profile) => typeof theme.current.profile) => {
    if (failCommit) throw new Error("Could not save.");
    theme = { ...theme, current: { ...theme.current, profile: update(theme.current.profile) } };
  } }) };

async function fixture() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event"] as const) install(name, dom.window[name]);
  install("self", dom.window); install("IS_REACT_ACT_ENVIRONMENT", true);
  // Regex and WorldBook saves are serialised through Web Locks, which jsdom does not provide.
  Object.defineProperty(dom.window.navigator, "locks", { configurable: true, value: {
    request: async (_key: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("/foundation-provider")) return foundationBridge;
    if (request.endsWith("/use-contacts")) return contactsBridge;
    if (request.endsWith("/theme-provider")) return themeBridge;
    return originalLoad.call(this, request, ...rest);
  };
  failCommit = false;
  theme = { current: defaultSnapshot(), presets: [] };
  foundation = normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }] });
  contacts = addContact(normalizeContacts(null), "peter");
  const book = normalizeWorldBook({ name: "Lore", entries: [{ name: "Entry", content: "old lore" }] }, "b");
  book.entries[0].id = "e";
  dom.window.localStorage.setItem("veil.worldbooks.v1", JSON.stringify({ version: 1, books: [book] }));
  dom.window.localStorage.setItem("veil.regex.v1", JSON.stringify({ version: 1, groups: [defaultRegexGroup(),
    { ...newRegexGroup(), id: "g", name: "Group", rules: [{ ...newRegexRule(), id: "r", name: "Rule", find: "a", replace: "b" }] }] }));
  dom.window.localStorage.setItem("veil.preset.v1", JSON.stringify(copyPreset(createPresetDocument(), undefined, "Primary", "p")));
  const confirms: string[] = [];
  let answer = false;
  (dom.window as unknown as { confirm: (message: string) => boolean }).confirm = (message) => { confirms.push(message); return answer; };
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = (child: ReactNode) => act(async () => {
    root.render(createElement(AppRouterContext.Provider, { value: router as never }, child));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const doc = dom.window.document;
  const settle = () => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 20)); });
  const field = (labelText: string) => {
    const label = [...doc.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(labelText));
    const control = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    assert.ok(control, `field “${labelText}” exists`);
    return control;
  };
  const type = (control: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
    const proto = control instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(control, value);
    control.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const button = (label: string) => {
    const found = [...doc.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
    assert.ok(found, `button “${label}” exists`);
    return found;
  };
  const click = (element: HTMLElement) => act(async () => { element.click(); await Promise.resolve(); });
  /** Click an in-app link; true when the click was allowed through (the guard cancels it on "No"). */
  const followLink = async (label: string) => {
    const anchor = doc.querySelector<HTMLAnchorElement>(`a[aria-label="${label}"]`);
    assert.ok(anchor, `link “${label}” exists`);
    let allowed = false;
    await act(async () => { allowed = anchor.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    return allowed;
  };
  const close = async () => {
    await act(async () => { root.unmount(); await new Promise<void>((resolve) => setImmediate(resolve)); });
    loader._load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { dom, doc, confirms, answer: (value: boolean) => { answer = value; }, render, settle, field, type, button, click, followLink, close };
}
type Ui = Awaited<ReturnType<typeof fixture>>;

/** Shared checks for editors whose leave entry is a header link. */
async function leaveMatrix(ui: Ui, edit: () => Promise<void>, revert: () => Promise<void>, leave: () => Promise<boolean>, stillShows: () => string) {
  assert.equal(await leave(), true, "clean: leaves");
  assert.deepEqual(ui.confirms, [], "clean: no question");
  await edit();
  ui.answer(false);
  assert.equal(await leave(), false, "dirty + No: stays");
  assert.deepEqual(ui.confirms, ["Discard unsaved changes?"]);
  assert.match(stillShows(), /edited/, "No keeps every unsaved edit");
  ui.answer(true);
  assert.equal(await leave(), true, "dirty + Yes: continues to the original destination");
  ui.confirms.length = 0;
  await revert();
  assert.equal(await leave(), true, "editing back to the original value is clean again");
  assert.deepEqual(ui.confirms, [], "reverted: no question");
}

test("WorldBook entry editor: clean leaves, dirty asks, No keeps the draft, Yes leaves, reverting is clean", async () => {
  const { WorldBookEntryEditor } = await import("../components/settings/worldbooks/worldbook-entry-editor");
  const ui = await fixture();
  try {
    await ui.render(createElement(WorldBookEntryEditor, { bookId: "b", entryId: "e" }));
    await ui.settle();
    const content = () => ui.field("Content") as HTMLTextAreaElement;
    await leaveMatrix(ui, () => ui.type(content(), "edited lore"), () => ui.type(content(), "old lore"),
      () => ui.followLink("Back to WorldBook"), () => content().value);
  } finally { await ui.close(); }
});

test("a new WorldBook entry starts clean and asks only after it is edited", async () => {
  const { WorldBookEntryEditor } = await import("../components/settings/worldbooks/worldbook-entry-editor");
  const ui = await fixture();
  try {
    await ui.render(createElement(WorldBookEntryEditor, { bookId: "b", entryId: "new" }));
    await ui.settle();
    assert.equal(await ui.followLink("Back to WorldBook"), true); assert.deepEqual(ui.confirms, []);
    await ui.type(ui.field("Name / Comment"), "edited name");
    ui.answer(false);
    assert.equal(await ui.followLink("Back to WorldBook"), false);
    assert.equal(ui.confirms.length, 1);
  } finally { await ui.close(); }
});

test("WorldBook entry: a successful Save is clean afterwards; a failed Save keeps asking", async () => {
  const { WorldBookEntryEditor } = await import("../components/settings/worldbooks/worldbook-entry-editor");
  const ui = await fixture();
  const original = browserWorldBookStorage.transact;
  try {
    await ui.render(createElement(WorldBookEntryEditor, { bookId: "b", entryId: "e" }));
    await ui.settle();
    await ui.type(ui.field("Content"), "edited lore");
    browserWorldBookStorage.transact = async () => { throw new Error("Disk full"); };
    await ui.click(ui.button("Save")); await ui.settle();
    ui.answer(false);
    assert.equal(await ui.followLink("Back to WorldBook"), false, "after a failed save the edits are still unsaved");
    assert.equal(ui.confirms.length, 1);
    browserWorldBookStorage.transact = original;
    ui.confirms.length = 0;
    await ui.click(ui.button("Save")); await ui.settle();
    assert.equal(await ui.followLink("Back to WorldBook"), true, "after a successful save the draft is the saved value");
    assert.deepEqual(ui.confirms, []);
  } finally { browserWorldBookStorage.transact = original; await ui.close(); }
});

test("switching to another WorldBook entry does not carry the previous entry's dirty state", async () => {
  const { WorldBookEntryEditor } = await import("../components/settings/worldbooks/worldbook-entry-editor");
  const ui = await fixture();
  try {
    await ui.render(createElement(WorldBookEntryEditor, { bookId: "b", entryId: "e" }));
    await ui.settle();
    await ui.type(ui.field("Content"), "edited lore");
    await ui.render(createElement(WorldBookEntryEditor, { bookId: "b", entryId: "new" }));
    await ui.settle();
    assert.equal(await ui.followLink("Back to WorldBook"), true, "the new entry is clean");
    assert.deepEqual(ui.confirms, []);
  } finally { await ui.close(); }
});

test("WorldBook detail and Regex detail guard their header Back link", async () => {
  const { WorldBookDetail } = await import("../components/settings/worldbooks/worldbook-detail");
  const { RegexDetail } = await import("../components/settings/regex/regex-detail");
  for (const [element, back] of [[createElement(WorldBookDetail, { bookId: "b" }), "Back to WorldBooks"],
    [createElement(RegexDetail, { groupId: "g" }), "Back to Regex Groups"]] as const) {
    const ui = await fixture();
    try {
      await ui.render(element); await ui.settle();
      const name = () => ui.field("Name") as HTMLInputElement;
      const original = name().value;
      await leaveMatrix(ui, () => ui.type(name(), "edited"), () => ui.type(name(), original), () => ui.followLink(back), () => name().value);
    } finally { await ui.close(); }
  }
});

test("Regex rule editor guards its Back link and is clean after a successful save", async () => {
  const { RegexRuleEditor } = await import("../components/settings/regex/regex-rule-editor");
  const ui = await fixture();
  try {
    await ui.render(createElement(RegexRuleEditor, { groupId: "g", ruleId: "r" })); await ui.settle();
    const find = () => ui.field("Find") as HTMLTextAreaElement;
    await leaveMatrix(ui, () => ui.type(find(), "edited"), () => ui.type(find(), "a"), () => ui.followLink("Back to Regex Group"), () => find().value);
    ui.confirms.length = 0;
    await ui.type(find(), "saved pattern");
    const original = browserRegexStorage.transact;
    browserRegexStorage.transact = async () => { throw new Error("Disk full"); };
    try {
      await ui.click(ui.button("Save")); await ui.settle();
      ui.answer(false);
      assert.equal(await ui.followLink("Back to Regex Group"), false, "a failed save is still unsaved");
    } finally { browserRegexStorage.transact = original; }
    ui.confirms.length = 0;
    await ui.click(ui.button("Save")); await ui.settle();
    assert.equal(await ui.followLink("Back to Regex Group"), true); assert.deepEqual(ui.confirms, []);
  } finally { await ui.close(); }
});

test("New Regex group: clean until edited; an unsaved rule edit asks before leaving the rule view", async () => {
  const { RegexNew } = await import("../components/settings/regex/regex-new");
  const ui = await fixture();
  try {
    await ui.render(createElement(RegexNew)); await ui.settle();
    assert.equal(await ui.followLink("Cancel new Regex Group"), true); assert.deepEqual(ui.confirms, []);
    await ui.click(ui.button("Add Rule")); await ui.settle();
    assert.ok(ui.doc.querySelector("h1")?.textContent?.includes("New Rule"), "the rule view is open");
    await ui.click(ui.button("Back to new Regex Group"));
    assert.deepEqual(ui.confirms, [], "an untouched new rule goes back freely");
    await ui.click(ui.button("Add Rule")); await ui.settle();
    await ui.type(ui.field("Find"), "edited");
    ui.answer(false);
    await ui.click(ui.button("Back to new Regex Group"));
    assert.equal(ui.confirms.length, 1);
    assert.equal((ui.field("Find") as HTMLTextAreaElement).value, "edited", "No keeps the rule draft");
    ui.answer(true);
    await ui.click(ui.button("Back to new Regex Group"));
    assert.equal(ui.confirms.length, 2);
    await ui.settle();
    await ui.type(ui.field("Name *"), "edited group");
    ui.answer(false);
    assert.equal(await ui.followLink("Cancel new Regex Group"), false, "the group draft is now dirty");
  } finally { await ui.close(); }
});

test("chat Custom CSS: Back asks only for real edits, Apply leaves without asking", async () => {
  const { CustomCSSSettings } = await import("../components/chat/custom-css-settings");
  const ui = await fixture();
  const session = { id: "s", characterId: "peter", customCSS: ":root { --a: 1; }" } as unknown as ChatSession;
  const original = chatStorage.updateSessionSettings;
  let backs = 0; let applied: unknown;
  chatStorage.updateSessionSettings = (async (_id: string, patch: { customCSS?: string | null }) => { applied = patch; }) as typeof original;
  try {
    await ui.render(createElement(CustomCSSSettings, { session, onBack: () => { backs++; } }));
    const area = () => ui.doc.querySelector<HTMLTextAreaElement>("textarea")!;
    await ui.click(ui.button("Back to Chat Info"));
    assert.equal(backs, 1); assert.deepEqual(ui.confirms, [], "clean: leaves");
    await ui.type(area(), ":root { --a: 2; }");
    ui.answer(false);
    await ui.click(ui.button("Back to Chat Info"));
    assert.equal(backs, 1, "No: stays"); assert.equal(ui.confirms.length, 1);
    assert.equal(area().value, ":root { --a: 2; }", "No keeps the draft");
    await ui.type(area(), ":root { --a: 1; }");
    await ui.click(ui.button("Back to Chat Info"));
    assert.equal(backs, 2, "back to the saved value is clean"); assert.equal(ui.confirms.length, 1);
    await ui.type(area(), ":root { --a: 3; }");
    ui.answer(true);
    await ui.click(ui.button("Apply")); await ui.settle();
    assert.deepEqual(applied, { customCSS: ":root { --a: 3; }" });
    assert.equal(backs, 3, "a successful Apply closes the editor"); assert.equal(ui.confirms.length, 1, "without asking");
    ui.answer(true);
    await ui.click(ui.button("Back to Chat Info")); // dirty again only if the draft differs from the session prop
  } finally { chatStorage.updateSessionSettings = original; await ui.close(); }
});

test("Contact Info: Cancel and Back ask only for real edits; a saved edit is clean; another contact starts clean", async () => {
  const ui = await fixture();
  const { ContactInfo } = await import("../components/contact-info");
  foundation = normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }, { characterId: "lan", name: "Lan" }] });
  contacts = addContact(addContact(normalizeContacts(null), "peter"), "lan");
  try {
    await ui.render(createElement(ContactInfo, { characterId: "peter" })); await ui.settle();
    await ui.click(ui.button("Edit"));
    await ui.click(ui.button("Cancel"));
    assert.deepEqual(ui.confirms, [], "an untouched draft cancels freely");
    await ui.click(ui.button("Edit"));
    const name = () => ui.doc.querySelector<HTMLInputElement>('[aria-label="Contact name"]')!;
    await ui.type(name(), "Pete");
    ui.answer(false);
    assert.equal(await ui.followLink("Back to Contacts"), false, "Back asks"); await ui.click(ui.button("Cancel"));
    assert.equal(ui.confirms.length, 2); assert.equal(name().value, "Pete", "No keeps the draft");
    await ui.type(name(), "");
    assert.equal(await ui.followLink("Back to Contacts"), true, "erased back to the original value is clean");
    assert.equal(ui.confirms.length, 2);
    await ui.type(name(), "Pete");
    failCommit = true;
    await ui.click(ui.button("Save")); await ui.settle();
    ui.answer(false);
    assert.equal(await ui.followLink("Back to Contacts"), false, "a failed save is still unsaved");
    failCommit = false;
    await ui.click(ui.button("Save")); await ui.settle();
    ui.confirms.length = 0;
    assert.equal(await ui.followLink("Back to Contacts"), true, "after a successful save nothing is pending");
    assert.deepEqual(ui.confirms, []);
    await ui.click(ui.button("Edit")); await ui.type(name(), "Pete 2");
    await ui.render(createElement(ContactInfo, { characterId: "lan" })); await ui.settle();
    assert.equal(await ui.followLink("Back to Contacts"), true, "switching contact drops the previous draft and its dirty state");
    assert.deepEqual(ui.confirms, []);
  } finally { await ui.close(); }
});

test("User profile edit: Cancel and Back ask only after a real edit; saving makes it clean", async () => {
  const ui = await fixture();
  const { UserProfilePage } = await import("../components/profile-pages");
  try {
    await ui.render(createElement(UserProfilePage)); await ui.settle();
    await ui.click(ui.button("Edit"));
    assert.equal(await ui.followLink("Back to Profile"), true, "clean form"); assert.deepEqual(ui.confirms, []);
    const name = () => ui.field("Name") as HTMLInputElement;
    const original = name().value;
    await ui.type(name(), `${original}x`);
    ui.answer(false);
    assert.equal(await ui.followLink("Back to Profile"), false);
    await ui.click(ui.button("Cancel"));
    assert.equal(ui.confirms.length, 2); assert.ok(ui.doc.querySelector("form"), "No keeps the form open with its edits");
    assert.equal(name().value, `${original}x`);
    await ui.type(name(), original);
    assert.equal(await ui.followLink("Back to Profile"), true, "restored value is clean");
    assert.equal(ui.confirms.length, 2);
    await ui.type(name(), `${original}x`);
    failCommit = true;
    await ui.click(ui.button("Save")); await ui.settle();
    assert.ok(ui.doc.querySelector("form"), "a failed save keeps the form");
    ui.answer(false);
    assert.equal(await ui.followLink("Back to Profile"), false, "still unsaved");
    failCommit = false;
    ui.answer(true);
    await ui.click(ui.button("Save")); await ui.settle();
    ui.confirms.length = 0;
    assert.equal(await ui.followLink("Back to Profile"), true, "saved: no question"); assert.deepEqual(ui.confirms, []);
  } finally { await ui.close(); }
});

test("New Preset Prompt: a blank editor leaves freely; an edit asks; restoring blank is free; No keeps the draft", async () => {
  const { NewPromptEditor } = await import("../components/settings/presets/prompt-editor");
  const ui = await fixture();
  try {
    await ui.render(createElement(NewPromptEditor, { presetId: "p" })); await ui.settle();
    const back = "Back to Preset";
    const content = () => ui.field("Content") as HTMLTextAreaElement;
    await leaveMatrix(ui, () => ui.type(content(), "edited"), () => ui.type(content(), ""), () => ui.followLink(back), () => content().value);
  } finally { await ui.close(); }
});

test("Preset detail keeps its existing leave guard", async () => {
  const { PresetDetail } = await import("../components/settings/presets/preset-detail");
  const ui = await fixture();
  try {
    await ui.render(createElement(PresetDetail, { presetId: "p" })); await ui.settle();
    const name = () => ui.field("Name") as HTMLInputElement;
    const original = name().value;
    await leaveMatrix(ui, () => ui.type(name(), `${original} edited`), () => ui.type(name(), original),
      () => ui.followLink("Back to Presets"), () => name().value);
  } finally { await ui.close(); }
});

test("Appearance CSS variables: an unapplied edit asks before leaving; Apply and restoring the text make it clean", async () => {
  const ui = await fixture();
  const { Appearance } = await import("../components/appearance");
  try {
    await ui.render(createElement(Appearance)); await ui.settle();
    const area = () => ui.doc.querySelector<HTMLTextAreaElement>("#css-overrides")!;
    const original = area().value;
    assert.equal(await ui.followLink("Back to Home"), true, "other appearance controls apply immediately, so a clean page leaves freely");
    assert.deepEqual(ui.confirms, []);
    await ui.type(area(), "{ \"edited\": 1 }");
    ui.answer(false);
    assert.equal(await ui.followLink("Back to Home"), false, "an unapplied CSS edit asks");
    assert.equal(area().value, "{ \"edited\": 1 }", "No keeps the text");
    await ui.type(area(), original);
    ui.confirms.length = 0;
    assert.equal(await ui.followLink("Back to Home"), true, "restored text is clean"); assert.deepEqual(ui.confirms, []);
    await ui.type(area(), "{}");
    await ui.click(ui.button("Apply CSS variables")); await ui.settle();
    assert.equal(await ui.followLink("Back to Home"), true, "applied: nothing pending"); assert.deepEqual(ui.confirms, []);
  } finally { await ui.close(); }
});
