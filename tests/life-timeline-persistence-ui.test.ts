import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Character } from "../lib/foundation-types";
import { browserPresenceStorage, emptyPresenceDocument, presenceRecord, setRoutine } from "../lib/presence/storage";

const character: Pick<Character, "characterId" | "name" | "timezone"> = {
  characterId: "peter", name: "Peter", timezone: "UTC",
};
const routine = { defaultStatus: "offline" as const, jitterMinutes: 0,
  blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 9 * 60, endMinute: 17 * 60, status: "busy" as const }] };

async function mounted(initial: ReturnType<typeof emptyPresenceDocument>, run: (result: {
  dom: JSDOM; render: () => Promise<void>; text: () => string; wait: (check: () => boolean) => Promise<void>;
  settleTransactions: () => Promise<void>; transactCalls: () => number;
}) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const storage = dom.window.localStorage;
  storage.setItem("veil.presence.v1", JSON.stringify(initial));

  const names = ["window", "self", "document", "navigator", "HTMLElement", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name as keyof typeof dom.window] }));

  const originalTransact = browserPresenceStorage.transact;
  let transactCalls = 0;
  const transactions: Promise<unknown>[] = [];
  browserPresenceStorage.transact = ((...args: Parameters<typeof originalTransact>) => {
    transactCalls++;
    const transaction = originalTransact(...args);
    transactions.push(Promise.resolve(transaction));
    return transaction;
  }) as typeof originalTransact;
  const moduleIds = [require.resolve("../lib/presence/live"), require.resolve("../components/chat/life-timeline")];
  moduleIds.forEach((id) => { delete require.cache[id]; });
  const { LifeTimelineScreen } = await import("../components/chat/life-timeline");
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = () => act(async () => root.render(createElement(LifeTimelineScreen, {
    screenRef: { current: null }, character, onBack: () => {},
  })));
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!check()) {
      assert.ok(Date.now() < deadline, `timed out waiting for Life persistence: ${container.textContent}`);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  };
  try { await run({ dom, render, text: () => container.textContent ?? "", wait,
    settleTransactions: async () => { await Promise.all(transactions); }, transactCalls: () => transactCalls }); }
  finally {
    await act(async () => root.unmount());
    browserPresenceStorage.transact = originalTransact;
    moduleIds.forEach((id) => { delete require.cache[id]; });
    names.forEach((name, index) => previous[index] ? Object.defineProperty(globalThis, name, previous[index]!) : Reflect.deleteProperty(globalThis, name));
    dom.window.close();
  }
}

test("LifeTimelineScreen persists the matching Character's projected activities when Routine exists", async () => {
  const initial = setRoutine(emptyPresenceDocument(), character.characterId, routine, { changedAt: Date.now(), source: "test" });
  await mounted(initial, async ({ dom, render, wait, settleTransactions, transactCalls }) => {
    await render();
    await wait(() => !!presenceRecord(JSON.parse(dom.window.localStorage.getItem("veil.presence.v1")!), character.characterId)?.life?.activities.length);
    await settleTransactions();
    const saved = JSON.parse(dom.window.localStorage.getItem("veil.presence.v1")!);
    assert.ok(presenceRecord(saved, character.characterId)?.life?.activities.length);
    assert.equal(transactCalls(), 1);
  });
});

test("LifeTimelineScreen leaves storage unchanged when Routine, Situations and prior Life are absent", async () => {
  const initial = emptyPresenceDocument();
  const unchanged = { ...initial, characters: [{ characterId: character.characterId, routine: null, situations: [],
    signature: null, lastOnlineAt: null, lastMessageAt: null }] };
  await mounted(unchanged, async ({ dom, render, settleTransactions, transactCalls }) => {
    const before = dom.window.localStorage.getItem("veil.presence.v1");
    await render();
    await settleTransactions();
    assert.equal(transactCalls(), 1);
    assert.match(dom.window.document.body.textContent ?? "", /No activity yet\./);
    assert.equal(dom.window.localStorage.getItem("veil.presence.v1"), before);
  });
});

