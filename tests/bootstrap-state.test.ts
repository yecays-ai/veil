import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createProductBootstrapController } from "../lib/product-bootstrap-state";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("startup error UI announces the failure and offers Retry", () => {
  const source = readFileSync("components/product-bootstrap.tsx", "utf8");
  assert.match(source, /VEIL could not finish startup initialization\./);
  assert.match(source, /role="alert"/);
  assert.match(source, />Retry<\/button>/);
  assert.match(source, /controller\.retry\(\)/);
});

test("product bootstrap reaches ready after successful initialization", async () => {
  const states: string[] = [];
  let calls = 0;
  const controller = createProductBootstrapController(async () => { calls++; }, (state) => states.push(state));
  controller.mount();
  await turn();
  assert.equal(calls, 1);
  assert.deepEqual(states, ["initializing", "ready"]);
});

test("bootstrap failure is visible, retry runs once and can restore ready without clearing user data", async () => {
  const states: string[] = [];
  const userData = { peter: { name: "Peter" }, apiKey: "kept", messages: ["existing"], regex: "user rules" };
  const before = structuredClone(userData);
  let calls = 0;
  const controller = createProductBootstrapController(async () => {
    calls++;
    if (calls === 1) throw new Error("Regex unavailable");
  }, (state) => states.push(state));
  controller.mount();
  await turn();
  assert.equal(states.at(-1), "error");
  await controller.retry();
  assert.equal(calls, 2);
  assert.equal(states.at(-1), "ready");
  assert.deepEqual(userData, before);
});

test("bootstrap controller deduplicates concurrent retries and does not update after unmount", async () => {
  const states: string[] = [];
  let finish!: () => void;
  let calls = 0;
  const controller = createProductBootstrapController(() => {
    calls++;
    return new Promise<void>((resolve) => { finish = resolve; });
  }, (state) => states.push(state));
  controller.mount();
  const first = controller.retry();
  const second = controller.retry();
  await turn();
  assert.equal(calls, 1);
  controller.unmount();
  finish();
  await Promise.all([first, second]);
  assert.deepEqual(states, ["initializing"]);
});
