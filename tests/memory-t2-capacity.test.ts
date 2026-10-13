import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceBacklog, maintenanceDue, MAINTENANCE_TRIGGER_SEQUENCES } from "../lib/memory/maintenance-capacity";
import { explicitMemoryRequest } from "../lib/memory/explicit-request";
import { buildMaintenanceInput } from "../lib/memory/maintenance-input";
import type { ChatSession } from "../lib/chat/types";
import type { MemoryCursor } from "../lib/memory/types";
import type { MemoryProgress } from "../lib/memory/progress-types";

const session = (nextSeq: number, extra: Partial<ChatSession> = {}): ChatSession => ({ id: "s", characterId: "c", updatedAt: 1, autoReplyOnKeyboardDismiss: false,
  nextOrder: 1, memorySequence: { epoch: "e", nextSeq }, ...extra });
const cursor = (extraction?: MemoryProgress, extra: Partial<MemoryCursor> = {}): MemoryCursor =>
  ({ id: "c:s", characterId: "c", sessionId: "s", failureCount: 0, extraction, ...extra } as MemoryCursor);
const batch = (state: MemoryProgress["batches"][number]["state"], fromSeq: number, toSeq: number, attempts = 0): MemoryProgress["batches"][number] =>
  ({ id: `b${fromSeq}`, fromSeq, toSeq, state, attempts, sources: [], candidates: [],
    ...(state === "ready" || state === "failed" || state === "uncertain" || state === "too-large" ? {} : { ownerId: "o", attemptId: "a" }) });

test("maintenance becomes due only when a full batch is waiting; there is no timer", () => {
  assert.equal(MAINTENANCE_TRIGGER_SEQUENCES, 20);
  assert.equal(maintenanceDue([session(20)], [], "c"), false, "19 numbered messages wait");
  assert.equal(maintenanceDue([session(21)], [], "c"), true, "20 numbered messages are a full batch");
  assert.equal(maintenanceDue([session(21, { updatedAt: 0 })], [], "c"), true, "age of the chat does not matter");
});
test("processed and hole ranges do not count; only fresh messages and recoverable ready batches do", () => {
  const done = { epoch: "e", incarnation: "i", throughSeq: 10, completed: [], batches: [] } as MemoryProgress;
  assert.deepEqual(maintenanceBacklog([session(26)], [cursor(done)], "c"), { fresh: 15, waiting: 0 });
  const holes = { ...done, throughSeq: 0, batches: [batch("failed", 1, 5, 1), batch("uncertain", 6, 8, 1), batch("too-large", 9, 10)] } as MemoryProgress;
  assert.deepEqual(maintenanceBacklog([session(12)], [cursor(holes)], "c"), { fresh: 1, waiting: 0 }, "failed ranges are never retried by capacity");
  const ready = { ...done, throughSeq: 0, batches: [batch("ready", 1, 5, 0)] } as MemoryProgress;
  assert.equal(maintenanceDue([session(6)], [cursor(ready)], "c"), true, "an interrupted batch is recovered without waiting for capacity");
  const spent = { ...done, throughSeq: 0, batches: [batch("ready", 1, 5, 2)] } as MemoryProgress;
  assert.equal(maintenanceDue([session(6)], [cursor(spent)], "c"), false, "a batch that used its safe claims is not re-offered");
});
test("a pending clear, a stale epoch, groups, untracked chats and other Characters add nothing", () => {
  assert.equal(maintenanceDue([session(40)], [cursor(undefined, { clearRequestedAt: 5 })], "c"), false);
  const stale = { epoch: "old", incarnation: "i", throughSeq: 0, completed: [], batches: [] } as MemoryProgress;
  assert.equal(maintenanceDue([session(40)], [cursor(stale)], "c"), false);
  assert.equal(maintenanceDue([session(40, { type: "group" })], [], "c"), false);
  assert.equal(maintenanceDue([session(40, { memorySequence: undefined })], [], "c"), false);
  assert.equal(maintenanceDue([session(40)], [], "other"), false);
  assert.equal(maintenanceDue([session(40, { generation: { id: "g", stage: "preparing" } })], [], "c"), false, "never while a reply generates");
  const twin = (nextSeq: number) => ({ ...session(nextSeq), id: "t", memorySequence: { epoch: "e2", nextSeq } });
  assert.equal(maintenanceDue([session(2), twin(20)], [], "c"), false, "a run reads one session, so 1 + 19 is not a full batch");
  assert.equal(maintenanceDue([session(2), twin(21)], [], "c"), true, "one session holds a full batch");
});

test("explicit memory requests are recognized locally and conservatively", () => {
  const yes = ["请记住我下周三要考试", "记住，我对花生过敏", "帮我记一下我的生日是三月五号", "别忘了我喜欢黑咖啡", "你要记着我不吃香菜", "麻烦你记下来我的猫叫年糕",
    "Please remember that I work nights.", "remember I'm allergic to peanuts", "Don't forget my sister's name is Mia", "今天好累。请记住我明天请假"];
  const no = ["你还记得吗？", "你还记得我上次说的话吗", "我记得你说过要去旅行", "你记得我生日吗", "我已经记住了你的名字", "他把密码记住了", "do you remember what I said?",
    "Can you please remember my birthday?", "I remember when we met", "remember when we went to the lake", "remember to drink water", "好的", "", "忘了也没关系"];
  for (const text of yes) assert.equal(explicitMemoryRequest(text), true, text);
  for (const text of no) assert.equal(explicitMemoryRequest(text), false, text);
});
test("maintenance input marks only the user's explicit requests", () => {
  const message = (id: string, role: "user" | "assistant", content: string) => ({ id, sessionId: "s", role, content, status: "complete" as const, createdAt: 1, order: 1,
    memorySequence: { epoch: "e", seq: 1 } });
  const input = buildMaintenanceInput({ characterId: "c", sessionId: "s", messages: [message("1", "user", "请记住我下周三考试"), message("2", "assistant", "请记住我会陪你"),
    message("3", "user", "你还记得吗？")], candidates: [], manual: [], suppressions: [] } as never, { characterId: "c", context: "{}" });
  const sent = JSON.parse(input[1].content).messages as { id: string; explicitRequest?: boolean }[];
  assert.deepEqual(sent.map((m) => [m.id, m.explicitRequest === true]), [["1", true], ["2", false], ["3", false]]);
  assert.match(input[0].content, /explicitRequest:true/);
});
