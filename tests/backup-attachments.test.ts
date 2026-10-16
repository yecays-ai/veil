import assert from "node:assert/strict";
import test from "node:test";
import { validateBackupPackage } from "../lib/backup/validation";
import { BackupValidationError, type BackupData } from "../lib/backup/format";
import type { ChatMessage, ChatSession } from "../lib/chat/types";
import { backupData, packageFixture, sha256, TEST_NOW, type Fixture } from "./backup-fixture";

const validate = (fixture: Fixture) => validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
const failure = (code: string, detail?: string) => (error: unknown) =>
  error instanceof BackupValidationError && error.code === code && (detail === undefined || error.detail === detail);
const PIXEL = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=", "base64"));
const attachment = (assetId: string) => ({ kind: "image" as const, assetId, mime: "image/png", width: 1, height: 1, bytes: PIXEL.length });
const imageMessage = (id: string, order: number, assetId: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, sessionId: "character:peter", role: "user", content: "[用户发送了一张图片]", status: "sent", createdAt: TEST_NOW, order,
    attachment: attachment(assetId), ...extra });

/** The standard simulated backup plus image messages (orders 3 and 4), with the given assets in the chat image domain. */
async function withImages(assets: string[], change: (data: BackupData) => void = () => {}, chatVersion?: number): Promise<Fixture> {
  const data = backupData();
  data.chat.messages.push(imageMessage("image-1", 3, "attachment-1"), imageMessage("image-2", 4, "attachment-2"));
  (data.chat.sessions[0] as ChatSession).nextOrder = 5;
  change(data);
  const fixture = await packageFixture(data);
  const digest = await sha256(PIXEL);
  assets.forEach((id, index) => {
    const path = `assets/chat/${index}.bin`;
    fixture.manifest.assets.push({ domain: "chat", id, path, bytes: PIXEL.length, sha256: digest, mime: "image/png", createdAt: TEST_NOW });
    fixture.files.set(path, PIXEL);
  });
  if (chatVersion !== undefined) fixture.manifest.domains.find((row) => row.domain === "chat")!.version = chatVersion;
  return fixture;
}

test("image messages and their assets are accepted and round-trip unchanged", async () => {
  const fixture = await withImages(["attachment-1", "attachment-2"]);
  const result = await validate(fixture);
  assert.deepEqual(result.warnings, [{ code: "credentials-required", path: "apiConfigs[0]" }]);
  assert.deepEqual(result.data.chat.messages.filter((message) => message.attachment).map((message) => message.attachment),
    [attachment("attachment-1"), attachment("attachment-2")]);
  assert.equal(fixture.manifest.domains.find((row) => row.domain === "chat")!.version, 2);
});

test("a message whose asset is not in the package is kept with a warning, not rejected", async () => {
  const result = await validate(await withImages(["attachment-1"]));
  assert(result.warnings.some((warning) => warning.code === "missing-attachment" && warning.path === "chat.messages[3]"));
  assert.equal(result.warnings.filter((warning) => warning.code === "missing-attachment").length, 1);
  assert.equal(result.data.chat.messages.length, 4);
});

test("an asset belongs to one message and cannot also be a wallpaper", async () => {
  await assert.rejects(validate(await withImages(["attachment-1"], (data) => {
    data.chat.messages[3].attachment = attachment("attachment-1");
  })), failure("duplicate-id", "attachment-asset-shared"));
  await assert.rejects(validate(await withImages(["attachment-1", "attachment-2"], (data) => {
    data.chat.sessions[0].backgroundImage = "attachment-2";
  })), failure("duplicate-id", "attachment-asset-shared"));
  await assert.rejects(validate(await withImages(["attachment-1", "attachment-2"], (data) => {
    data.chat.chatSettings.find((row) => row.id === "chat-background")!.globalChatBackgroundImage = "attachment-1";
  })), failure("duplicate-id", "attachment-asset-shared"));
});

test("the attachment must be exactly an image reference on a user or assistant message that is nothing else", async () => {
  const bad: [string, (data: BackupData) => void][] = [
    ["extra field", (data) => { Object.assign(data.chat.messages[2].attachment!, { url: "https://x.test/a.png" }); }],
    ["svg", (data) => { data.chat.messages[2].attachment!.mime = "image/svg+xml"; }],
    ["no size", (data) => { data.chat.messages[2].attachment!.width = 0; }],
    ["audio", (data) => { Object.assign(data.chat.messages[2].attachment!, { kind: "audio" }); }],
    ["system role", (data) => { data.chat.messages[2].role = "system"; }],
    ["recalled", (data) => { Object.assign(data.chat.messages[2], { content: "", recalled: { at: TEST_NOW, by: "user" } }); }],
    ["sticker too", (data) => { data.chat.messages[2].sticker = { packId: "p", packName: "P", stickerId: "s", name: "n", url: "https://img.test/1.png" }; }],
    ["transfer too", (data) => { data.chat.messages[2].transfer = { amount: 1, note: "", sender: "user", recipient: "assistant", status: "pending" }; }],
  ];
  for (const [label, change] of bad)
    await assert.rejects(validate(await withImages(["attachment-1", "attachment-2"], change)), failure("invalid-data"), label);
});

test("a version 1 chat package is still read, but cannot carry attachments", async () => {
  const plain = await packageFixture(backupData());
  plain.manifest.domains.find((row) => row.domain === "chat")!.version = 1;
  assert.equal((await validate(plain)).data.chat.messages.length, 2);
  await assert.rejects(validate(await withImages(["attachment-1", "attachment-2"], () => {}, 1)), failure("invalid-data", "attachment-invalid"));
  await assert.rejects(validate(await withImages(["attachment-1", "attachment-2"], () => {}, 3)), failure("unsupported-domain-version"));
  await assert.rejects(validate(await withImages(["attachment-1", "attachment-2"], () => {}, 0)), failure("unsupported-domain-version"));
});
