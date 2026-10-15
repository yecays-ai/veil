import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { BubbleRevealQueue, hiddenForReveal } from "../lib/chat/bubble-pacing";
import { DEFAULT_BUBBLE_TIMING, type ChatMessage } from "../lib/chat/types";
import { useBackgroundReplyReveal } from "../components/chat/use-background-reply-reveal";

const bubble = (id: string, role: ChatMessage["role"] = "assistant", status: ChatMessage["status"] = "complete", sessionId = "s"): ChatMessage =>
  ({ id, sessionId, role, status, content: id, createdAt: 0, order: 0 });

type Props = { sessionId?: string; generationId?: string; messages: ChatMessage[]; streaming?: boolean; owned?: boolean; running?: boolean };

async function mount(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/messages/a" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const queue = new BubbleRevealQueue();
  function Probe({ sessionId, generationId, messages, streaming = false, owned = false, running = true }: Props) {
    useBackgroundReplyReveal(queue, { sessionId, generationId, messages, streaming, owned, running: () => running, timing: DEFAULT_BUBBLE_TIMING });
    return null;
  }
  t.after(async () => {
    await act(async () => { root.unmount(); });
    queue.cancel();
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return {
    queue,
    render: (props: Props) => act(async () => { root.render(createElement(Probe, props)); }),
    tick: (ms: number) => act(async () => { t.mock.timers.tick(ms); }),
  };
}

test("a reply this page did not start reveals its bubbles one by one with the user's timing", async (t) => {
  const { queue, render, tick } = await mount(t);
  const user = bubble("u1", "user");
  await render({ sessionId: "s", generationId: "g", messages: [bubble("old"), user, bubble("draft", "assistant", "streaming")] });
  assert.equal(queue.getSnapshot().awaiting, true);
  // Until the reply is paced, a finished bubble that arrives is hidden, while earlier history stays visible.
  assert.equal(hiddenForReveal(bubble("draft"), queue.getSnapshot()), true);
  assert.equal(hiddenForReveal(bubble("old"), queue.getSnapshot()), false);
  await render({ sessionId: "s", messages: [bubble("old"), user, bubble("draft"), bubble("a2"), bubble("a3")] });
  assert.deepEqual(queue.getSnapshot().replyIds, ["draft", "a2", "a3"]);
  await tick(DEFAULT_BUBBLE_TIMING.shortMs);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["a2", "a3"]);
  await tick(DEFAULT_BUBBLE_TIMING.shortMs - 1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["a2", "a3"]);
  await tick(1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["a3"]);
  await tick(DEFAULT_BUBBLE_TIMING.shortMs);
  assert.equal(queue.getSnapshot().pending, false);
  assert.equal(queue.getSnapshot().hiddenIds.size, 0);
});

test("a reply the page runs itself keeps its own pacing, even after the page lets go first", async (t) => {
  const { queue, render } = await mount(t);
  const own = queue.begin("s", [], false, 0);
  await render({ sessionId: "s", generationId: "g", messages: [bubble("u1", "user")], owned: true });
  queue.complete("s", [bubble("a1"), bubble("a2")], 0, own);
  assert.deepEqual(queue.getSnapshot().replyIds, ["a1", "a2"], "the page's own reveal still owns the queue");
  // The page's finally can clear its flag before storage publishes the end of the generation.
  await render({ sessionId: "s", generationId: "g", messages: [bubble("u1", "user"), bubble("a1"), bubble("a2")], owned: false });
  await render({ sessionId: "s", messages: [bubble("u1", "user"), bubble("a1"), bubble("a2")] });
  assert.deepEqual(queue.getSnapshot().replyIds, ["a1", "a2"]);
  assert.equal(queue.getSnapshot().hiddenIds.size, 2, "the page's own reveal was neither restarted nor cancelled");
});

test("streaming conversations, empty endings and switching away never hide anything", async (t) => {
  const { queue, render } = await mount(t);
  await render({ sessionId: "s", generationId: "g1", messages: [bubble("u1", "user")], streaming: true });
  assert.equal(queue.getSnapshot().awaiting, false);
  await render({ sessionId: "s", messages: [bubble("u1", "user"), bubble("a1")], streaming: true });
  assert.equal(queue.getSnapshot().pending, false);
  // A reply given up without a bubble (interjection, failure) releases the wait.
  await render({ sessionId: "s", generationId: "g2", messages: [bubble("u2", "user")] });
  assert.equal(queue.getSnapshot().pending, true);
  await render({ sessionId: "s", messages: [bubble("u2", "user"), bubble("u3", "user")] });
  assert.equal(queue.getSnapshot().pending, false);
  // A generation that only reaches the page after it already ended (a failed Send) is not waited for.
  await render({ sessionId: "s", generationId: "g-stale", messages: [bubble("u3", "user")], running: false });
  assert.equal(queue.getSnapshot().pending, false);
  await render({ sessionId: "s", messages: [bubble("u3", "user")] });
  // Leaving for another conversation mid-reply hides nothing there.
  await render({ sessionId: "s", generationId: "g3", messages: [bubble("u3", "user")] });
  await render({ sessionId: "other", messages: [bubble("x1", "assistant", "complete", "other")] });
  assert.equal(queue.getSnapshot().pending, false);
  assert.equal(queue.getSnapshot().hiddenIds.size, 0);
});

test("the chat page paces replies it did not start with the same queue and timing", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  assert.match(room, /useBackgroundReplyReveal\(revealQueue, \{ sessionId: session\?\.characterId === characterId \? session\.id : undefined,\s+generationId: session\?\.generation\?\.id, messages, streaming: session\?\.streamOnline === true, owned: generating, running: chatEngine\.isGenerating, timing: bubbleTiming \}\)/);
});
