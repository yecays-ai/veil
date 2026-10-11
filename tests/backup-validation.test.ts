import assert from "node:assert/strict";
import test from "node:test";
import { parseBackupManifest, validateBackupPackage } from "../lib/backup/validation";
import { BackupValidationError, type BackupData } from "../lib/backup/format";
import { parseBackupJson } from "../lib/backup/json";
import { backupData, packageFixture, replacePayload, sha256, type Fixture } from "./backup-fixture";

const validate = (fixture: Fixture) => validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
const failure = (code: string) => (error: unknown) => error instanceof BackupValidationError && error.code === code;

test("full simulated package preserves identities, ordering, remarks, Presence and explicit Binding semantics", async () => {
  const data = backupData(), fixture = await packageFixture(data);
  const savedFiles = [...fixture.files].map(([path, bytes]) => [path, [...bytes]]);
  const savedManifest = structuredClone(fixture.manifest);
  const first = await validate(fixture), second = await validate(fixture);
  assert.deepEqual(first.data, data);
  assert.deepEqual(second, first);
  assert.deepEqual(first.warnings, [{ code: "credentials-required", path: "apiConfigs[0]" }]);
  assert.deepEqual(fixture.manifest, savedManifest);
  assert.deepEqual([...fixture.files].map(([path, bytes]) => [path, [...bytes]]), savedFiles);
  assert.equal(Object.hasOwn(first.data.apiConfigs[0], "apiKey"), false);
});

test("empty environment retains absent documents instead of materializing defaults", async () => {
  const data: BackupData = { foundation: null, appearance: null, bindings: null, presets: null, regex: null,
    worldbooks: null, contacts: null, presence: null, apiConfigs: [], chat: { sessions: [], messages: [], chatSettings: [], worldBookStates: [] } };
  const result = await validate(await packageFixture(data));
  assert.deepEqual(result.data, data); assert.deepEqual(result.warnings, []);
});

test("manifest rejects missing/duplicate/unknown domains, future versions and credential formats", async () => {
  for (const [change, code] of [
    [(f: Fixture) => { f.manifest.domains.pop(); }, "domain-coverage"],
    [(f: Fixture) => { f.manifest.domains[1] = { ...f.manifest.domains[0] }; }, "duplicate-domain"],
    [(f: Fixture) => { Object.assign(f.manifest.domains[0], { domain: "memory" }); }, "unsupported-domain"],
    [(f: Fixture) => { f.manifest.domains[0].version++; }, "unsupported-domain-version"],
    [(f: Fixture) => { Object.assign(f.manifest, { version: 2 }); }, "unsupported-format"],
    [(f: Fixture) => { Object.assign(f.manifest, { credentials: "encrypted" }); }, "credentials-not-supported"],
    [(f: Fixture) => { Object.assign(f.manifest, { futureField: true }); }, "invalid-data"],
  ] as const) {
    const fixture = await packageFixture(); change(fixture);
    await assert.rejects(validate(fixture), failure(code));
  }
});

test("manifest enforces safe paths, unique file paths and bounded sizes", async () => {
  for (const path of ["../data.json", "/data.json", "domains/../data.json", "domains\\data.json", "domains/a:b.json"]) {
    const fixture = await packageFixture(); fixture.manifest.domains[0].path = path;
    assert.throws(() => parseBackupManifest(JSON.stringify(fixture.manifest)), failure("invalid-data"));
  }
  const duplicate = await packageFixture(); duplicate.manifest.domains[1].path = duplicate.manifest.domains[0].path;
  await assert.rejects(validate(duplicate), failure("duplicate-path"));
  const large = await packageFixture(); large.manifest.domains[0].bytes = 129 * 1024 * 1024;
  await assert.rejects(validate(large), failure("size-limit"));
  const negative = await packageFixture(); negative.manifest.domains[0].records = -1;
  await assert.rejects(validate(negative), failure("invalid-data"));
});

test("missing/extra files, damaged bytes, wrong counts and malformed UTF-8 fail before acceptance", async () => {
  const missing = await packageFixture(); missing.files.delete(missing.manifest.domains[0].path);
  await assert.rejects(validate(missing), failure("file-coverage"));
  const extra = await packageFixture(); extra.files.set("domains/extra.json", new Uint8Array());
  await assert.rejects(validate(extra), failure("file-coverage"));
  const damaged = await packageFixture(); damaged.files.get(damaged.manifest.domains[0].path)![0] ^= 1;
  await assert.rejects(validate(damaged), failure("checksum-mismatch"));
  const size = await packageFixture(); size.manifest.domains[0].bytes++;
  await assert.rejects(validate(size), failure("file-size"));
  const count = await packageFixture(); count.manifest.domains[0].records++;
  await assert.rejects(validate(count), failure("record-count"));
  const utf8 = await packageFixture(), bytes = new Uint8Array([0xc3, 0x28]), section = utf8.manifest.domains[0];
  utf8.files.set(section.path, bytes); section.bytes = bytes.length; section.sha256 = await sha256(bytes);
  await assert.rejects(validate(utf8), failure("invalid-utf8"));
});

test("strict JSON rejects duplicate escaped members, unsafe keys, nonfinite values and excessive nesting", async () => {
  for (const value of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}', '{"constructor":1}', '1e999', '[1,]', '{"a":}',
    '['.repeat(66) + '0' + ']'.repeat(66)]) assert.throws(() => parseBackupJson(value));
  assert.deepEqual(parseBackupJson('{"a":["\\\"","中文",true,false,null,-2.5e2]}'), { a: ['"', '中文', true, false, null, -250] });
  const fixture = await packageFixture();
  await replacePayload(fixture, "bindings", '{"global":{},"global":{},"characters":{}}');
  await assert.rejects(validate(fixture), failure("invalid-json"));
});

test("unknown, truncated or normalized-away fields are rejected instead of repaired", async () => {
  for (const [domain, change] of [
    ["foundation", (d: BackupData) => { d.foundation!.characters.push(structuredClone(d.foundation!.characters[0])); }],
    ["foundation", (d: BackupData) => { Object.assign(d.foundation!, { futureState: true }); }],
    ["appearance", (d: BackupData) => { d.appearance!.current.profile.text.size = 999; }],
    ["contacts", (d: BackupData) => { d.contacts!.contacts[0].remark = "x".repeat(101); }],
    ["presence", (d: BackupData) => { Object.assign(d.presence!.characters[0], { situationChange: null }); }],
    ["bindings", (d: BackupData) => { d.bindings!.global.worldBookIds = ["book-test", "book-test"]; }],
  ] as const) {
    const data = backupData(); change(data);
    await assert.rejects(validate(await packageFixture(data)), failure("lossy-data"), domain);
  }
});

test("API keys are rejected, bindings remain intact, and errors never echo sensitive values", async () => {
  const fixture = await packageFixture(), key = "SIMULATED_SECRET_DO_NOT_ECHO";
  const api = backupData().apiConfigs;
  Object.assign(api[0], { apiKey: key });
  await replacePayload(fixture, "apiConfigs", api);
  await assert.rejects(validate(fixture), (error: unknown) => {
    assert(error instanceof BackupValidationError);
    assert.equal(error.message.includes(key), false);
    assert.equal(error.message.includes("example.invalid"), false);
    return error.code === "invalid-data";
  });
  const data = backupData(); data.bindings!.global.apiConfigId = "api-not-in-backup";
  await assert.rejects(validate(await packageFixture(data)), failure("missing-binding-resource"));
});

test("duplicate records, multiple private sessions and message order corruption are rejected", async () => {
  for (const [change, code] of [
    [(d: BackupData) => { d.chat.messages.push(structuredClone(d.chat.messages[0])); }, "duplicate-id"],
    [(d: BackupData) => { d.chat.sessions.push({ ...d.chat.sessions[0], id: "second-direct" }); }, "duplicate-direct-chat"],
    [(d: BackupData) => { d.chat.messages[1].order = 1; }, "duplicate-order"],
    [(d: BackupData) => { d.chat.sessions[0].nextOrder = 2; }, "invalid-next-order"],
    [(d: BackupData) => { d.apiConfigs.push(structuredClone(d.apiConfigs[0])); }, "duplicate-id"],
    [(d: BackupData) => { d.contacts!.contacts.push({ ...d.contacts!.contacts[0], characterId: "pep" }); }, "duplicate-id"],
  ] as const) {
    const data = backupData(); change(data);
    await assert.rejects(validate(await packageFixture(data)), failure(code));
  }
});

test("mandatory graph references are checked without consulting another device's catalogs", async () => {
  for (const [change, code] of [
    [(d: BackupData) => { d.contacts!.contacts[0].characterId = "missing"; }, "missing-character"],
    [(d: BackupData) => { d.chat.messages[0].sessionId = "missing"; }, "missing-session"],
    [(d: BackupData) => { d.chat.sessions[0].lastMessageId = "missing"; }, "missing-last-message"],
    [(d: BackupData) => { d.chat.worldBookStates[0].id = "missing"; }, "missing-session"],
    [(d: BackupData) => { d.chat.messages[1].quote!.messageId = "user-other";
      d.chat.messages.push({ ...d.chat.messages[0], id: "user-other", sessionId: "empty-group", requestedBy: undefined });
      d.chat.sessions[1].nextOrder = 2; }, "cross-session-reference"],
    [(d: BackupData) => { d.chat.sessions[0].backgroundImage = "missing"; }, "missing-asset"],
    [(d: BackupData) => { d.appearance!.presets[0].snapshot.profile.wallpaper.source = "appearance-asset:" + "a".repeat(64); }, "missing-asset"],
  ] as const) {
    const data = backupData(); change(data);
    await assert.rejects(validate(await packageFixture(data)), failure(code));
  }
});

test("deleted quote snapshots are preserved with warnings; stale activation state is not rewritten", async () => {
  const data = backupData(); data.chat.messages[1].quote!.messageId = "already-deleted";
  data.chat.worldBookStates[0].state = { cycle: 5, prefix: ['["deleted"]'], signature: "old resource content",
    entries: { "deleted-book:deleted-entry": { stickyUntil: 7 } } };
  data.appearance!.current.profile.wallpaper.source = "https://example.invalid/wallpaper.png";
  const result = await validate(await packageFixture(data));
  assert.deepEqual(result.data, data);
  assert(result.warnings.some((row) => row.code === "missing-quote"));
  assert(result.warnings.some((row) => row.code === "external-image"));
});

test("shared multi-bubble turn ownership remains isolated after the first bubble was deleted", async () => {
  const data = backupData();
  data.chat.messages[1].turnId = "deleted-first-bubble";
  data.chat.sessions[1].nextOrder = 2;
  data.chat.messages.push({ ...data.chat.messages[1], id: "group-reply", sessionId: "empty-group", order: 1, quote: undefined });
  await assert.rejects(validate(await packageFixture(data)), failure("cross-session-reference"));
});

test("message references do not acquire ownership from another session's identically named turn", async () => {
  const data = backupData();
  data.chat.messages[1].turnId = "local-turn";
  data.chat.sessions[1].nextOrder = 2;
  data.chat.messages.push({ ...data.chat.messages[1], id: "group-reply", sessionId: "empty-group", order: 1,
    turnId: "reply-test", quote: undefined });
  // requestedBy refers to the local message reply-test, not the group's turn reply-test.
  const result = await validate(await packageFixture(data));
  assert.deepEqual(result.data, JSON.parse(JSON.stringify(data)));
});

test("turn references use surviving turn ownership even when another session has the same message ID", async () => {
  const data = backupData();
  data.chat.messages[1].turnId = "deleted-first-bubble";
  data.chat.messages.push({ ...data.chat.messages[1], id: "retry-local", order: 3,
    turnId: "retry-local", attemptFor: "deleted-first-bubble", status: "error", quote: undefined });
  data.chat.sessions[0].nextOrder = 4;
  data.chat.sessions[1].nextOrder = 2;
  data.chat.messages.push({ ...data.chat.messages[1], id: "deleted-first-bubble", sessionId: "empty-group",
    order: 1, turnId: "group-turn", quote: undefined });
  assert.deepEqual((await validate(await packageFixture(data))).data, JSON.parse(JSON.stringify(data)));
  data.chat.messages[2].attemptFor = "group-turn";
  await assert.rejects(validate(await packageFixture(data)), failure("cross-session-reference"));
});

test("active generation and streaming are rejected without changing or calling their owner", async () => {
  const data = backupData(); Object.assign(data.chat.sessions[0], { generation: { id: "active", stage: "provider" } });
  await assert.rejects(validate(await packageFixture(data)), failure("invalid-data"));
  delete (data.chat.sessions[0] as unknown as Record<string, unknown>).generation;
  data.chat.messages[1].status = "streaming";
  await assert.rejects(validate(await packageFixture(data)), failure("invalid-data"));
});

test("binary images verify by bytes and retain original cross-domain IDs", async () => {
  const data = backupData(), bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=", "base64"));
  const hash = await sha256(bytes);
  data.appearance!.current.profile.wallpaper.source = "appearance-asset:" + hash;
  data.appearance!.presets[0].snapshot.profile.dock.image = "appearance-asset:" + hash;
  data.chat.sessions[0].backgroundImage = "chat-image-original";
  const fixture = await packageFixture(data);
  for (const [domain, id] of [["appearance", hash], ["chat", "chat-image-original"]] as const) {
    const path = `assets/${domain}/image.png`;
    fixture.manifest.assets.push({ domain, id, path, bytes: bytes.length, sha256: hash, mime: "image/png", createdAt: 1 });
    fixture.files.set(path, bytes.slice());
  }
  assert.deepEqual((await validate(fixture)).data, data);
  fixture.files.get("assets/chat/image.png")![0] ^= 1;
  await assert.rejects(validate(fixture), failure("checksum-mismatch"));
});

test("validation never accesses browser storage, credentials, network or model APIs", async () => {
  const fixture = await packageFixture();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  let touched = 0;
  for (const key of ["window", "localStorage", "sessionStorage", "indexedDB", "navigator", "fetch"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, get() { touched++; throw new Error("Unexpected side effect"); } });
  }
  try {
    await validate(fixture);
    fixture.manifest.domains[0].records++;
    await assert.rejects(validate(fixture), failure("record-count"));
    assert.equal(touched, 0);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
