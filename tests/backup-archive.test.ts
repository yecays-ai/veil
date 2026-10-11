import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_MANIFEST_NAME, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ENTRY_BYTES, crc32, decodeBackupArchive, encodeBackupArchive,
} from "../lib/backup/archive";
import { BackupValidationError } from "../lib/backup/format";
import { validateBackupPackage } from "../lib/backup/validation";
import { packageFixture } from "./backup-fixture";

const text = new TextEncoder();
const rejects = (run: () => unknown, code: string) =>
  assert.throws(run, (error) => { assert.ok(error instanceof BackupValidationError); assert.equal(error.code, code); assert.equal(error.path, "archive"); return true; });
const sample = () => encodeBackupArchive({ manifestJson: '{"a":1}', files: new Map([["domains/a.json", text.encode("hello")], ["assets/chat/0.bin", new Uint8Array([1, 2, 3])]]) });
const u16 = (b: Uint8Array, at: number, v: number) => new DataView(b.buffer).setUint16(at, v, true);
const u32 = (b: Uint8Array, at: number, v: number) => new DataView(b.buffer).setUint32(at, v, true);
const get32 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint32(at, true);
const edit = (change: (b: Uint8Array, layout: { eocd: number; dir: number; centrals: number[] }) => void, base = sample()) => {
  const b = base.slice(), eocd = b.length - 22, dir = get32(b, eocd + 16), centrals: number[] = [];
  for (let at = dir; at < eocd; at += 46 + new DataView(b.buffer).getUint16(at + 28, true)) centrals.push(at);
  change(b, { eocd, dir, centrals });
  return b;
};
const names = (n: number) => new Map(Array.from({ length: n }, (_, i) => [`f/${i}`, new Uint8Array(0)] as const));

test("round trips a real package and validates", async () => {
  const { manifest, files } = await packageFixture();
  const manifestJson = JSON.stringify(manifest);
  const decoded = decodeBackupArchive(encodeBackupArchive({ manifestJson, files }));
  assert.equal(decoded.manifestJson, manifestJson);
  assert.deepEqual([...decoded.files.keys()].sort(), [...files.keys()].sort());
  for (const [path, bytes] of files) assert.deepEqual(decoded.files.get(path), bytes);
  await validateBackupPackage(decoded.manifestJson, decoded.files);
});

test("output is deterministic, manifest first, paths sorted, and a standard ZIP", () => {
  const a = sample(), b = encodeBackupArchive({ manifestJson: '{"a":1}', files: new Map([["assets/chat/0.bin", new Uint8Array([1, 2, 3])], ["domains/a.json", text.encode("hello")]]) });
  assert.deepEqual(a, b);
  edit((buf, { centrals }) => {
    const got = centrals.map((at) => new TextDecoder().decode(buf.subarray(at + 46, at + 46 + new DataView(buf.buffer).getUint16(at + 28, true))));
    assert.deepEqual(got, [ARCHIVE_MANIFEST_NAME, "assets/chat/0.bin", "domains/a.json"]);
  });
  assert.equal(crc32(text.encode("123456789")), 0xcbf43926);
  assert.equal(get32(a, 0), 0x04034b50);
});

test("empty package and large entry round trip", () => {
  assert.deepEqual(decodeBackupArchive(encodeBackupArchive({ manifestJson: "", files: new Map() })), { manifestJson: "", files: new Map() });
  const big = new Uint8Array(8 * 1024 * 1024).map((_, i) => (i * 31) & 255);
  const decoded = decodeBackupArchive(encodeBackupArchive({ manifestJson: "{}", files: new Map([["assets/chat/big.bin", big]]) }));
  assert.deepEqual(decoded.files.get("assets/chat/big.bin"), big);
});

test("tampering is caught by CRC, and by checksum when the CRC is fixed up", async () => {
  const { manifest, files } = await packageFixture();
  const bytes = encodeBackupArchive({ manifestJson: JSON.stringify(manifest), files });
  const target = files.get("domains/chat.json")!;
  let at = -1;
  for (let i = 0; i + target.length <= bytes.length && at < 0; i++) if (bytes.subarray(i, i + target.length).every((v, k) => v === target[k])) at = i;
  assert.ok(at > 0);
  const tampered = bytes.slice(); tampered[at + 2] ^= 1;
  rejects(() => decodeBackupArchive(tampered), "archive-crc-mismatch");
  const fixed = tampered.slice(), crc = crc32(fixed.subarray(at, at + target.length));
  u32(fixed, at - 30 - "domains/chat.json".length + 14, crc);
  const dir = get32(fixed, fixed.length - 6);
  for (let c = dir; c < fixed.length - 22; c += 46 + new DataView(fixed.buffer).getUint16(c + 28, true))
    if (get32(fixed, c + 42) === at - 30 - "domains/chat.json".length) u32(fixed, c + 16, crc);
  const decoded = decodeBackupArchive(fixed);
  await assert.rejects(validateBackupPackage(decoded.manifestJson, decoded.files), (error) => error instanceof BackupValidationError);
});

test("rejects non-zip, truncated, bad end record, and trailing data", () => {
  rejects(() => decodeBackupArchive(new Uint8Array(0)), "archive-truncated");
  rejects(() => decodeBackupArchive(text.encode("this is definitely not a zip archive")), "archive-not-zip");
  const ok = sample();
  rejects(() => decodeBackupArchive(ok.slice(0, ok.length - 10)), "archive-truncated");
  rejects(() => decodeBackupArchive(ok.slice(0, 40)), "archive-truncated");
  rejects(() => decodeBackupArchive(edit((b, l) => b[l.eocd] = 0)), "archive-truncated");
  rejects(() => decodeBackupArchive(new Uint8Array([...ok, 0])), "archive-trailing-data");
  rejects(() => decodeBackupArchive(new Uint8Array([...edit((b, l) => u16(b, l.eocd + 20, 4)), 1, 2, 3, 4])), "archive-unsupported");
});

test("rejects compression, encryption, descriptors, zip64, multi-disk", () => {
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.centrals[1] + 10, 8))), "archive-compressed");
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.centrals[1] + 8, 0x801))), "archive-encrypted");
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.centrals[1] + 8, 0x808))), "archive-unsupported-flags");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[1] + 24, 0xffffffff))), "archive-zip64");
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.eocd + 10, 0xffff))), "archive-zip64");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.eocd + 16, 0xffffffff))), "archive-zip64");
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.eocd + 4, 1))), "archive-multi-disk");
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.eocd + 8, 1))), "archive-multi-disk");
  rejects(() => decodeBackupArchive(edit((b, l) => u16(b, l.centrals[1] + 30, 4))), "archive-unsupported");
});

test("rejects size, crc, header and directory inconsistencies", () => {
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[1] + 20, 99))), "archive-size-mismatch");
  rejects(() => decodeBackupArchive(edit((b, l) => { u32(b, l.centrals[1] + 20, 5); u32(b, l.centrals[1] + 24, 5); })), "archive-header-mismatch");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[1] + 16, 1))), "archive-header-mismatch");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[1] + 20, 0x7fffffff))), "archive-size-mismatch");
  rejects(() => decodeBackupArchive(edit((b, l) => { u32(b, l.centrals[1] + 20, 0x7fffffff); u32(b, l.centrals[1] + 24, 0x7fffffff); })), "archive-entry-too-large");
  rejects(() => decodeBackupArchive(edit((b, l) => { u32(b, l.centrals[1] + 20, MAX_ARCHIVE_ENTRY_BYTES); u32(b, l.centrals[1] + 24, MAX_ARCHIVE_ENTRY_BYTES); })), "archive-bad-offset");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.eocd + 12, 5))), "archive-bad-directory");
  rejects(() => decodeBackupArchive(edit((b, l) => { u16(b, l.eocd + 10, 5); u16(b, l.eocd + 8, 5); })), "archive-bad-directory");
  rejects(() => decodeBackupArchive(edit((b, l) => b[l.centrals[0]] = 0)), "archive-bad-directory");
});

test("rejects bad local offsets, overlap and hidden gaps", () => {
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[1] + 42, 0x10000))), "archive-bad-offset");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[1] + 42, 3))), "archive-bad-offset");
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[2] + 42, get32(b, l.centrals[1] + 42)))), "archive-header-mismatch");
  // Two entries sharing one local record (same bytes, different names is caught as header mismatch; same name is duplicate).
  const twin = encodeBackupArchive({ manifestJson: "{}", files: new Map([["a", text.encode("x")], ["b", text.encode("x")]]) });
  rejects(() => decodeBackupArchive(edit((b, l) => u32(b, l.centrals[2] + 42, get32(b, l.centrals[1] + 42)), twin)), "archive-header-mismatch");
  // Hidden bytes between entries: shift the second entry forward by growing the first's local extra gap.
  const gap = edit((b, l) => u32(b, l.centrals[0] + 42, get32(b, l.centrals[0] + 42)), sample());
  const padded = new Uint8Array(gap.length + 1);
  const dir = get32(gap, gap.length - 6);
  padded.set(gap.subarray(0, dir)); padded.set(gap.subarray(dir), dir + 1);
  u32(padded, padded.length - 6, dir + 1);
  rejects(() => decodeBackupArchive(padded), "archive-gap");
});

test("rejects duplicate and unsafe names and a missing manifest", () => {
  const rename = (from: string, to: string) => edit((b, l) => {
    for (const c of l.centrals) {
      const name = new TextDecoder().decode(b.subarray(c + 46, c + 46 + from.length));
      if (name === from && to.length === from.length) {
        b.set(text.encode(to), c + 46);
        const local = get32(b, c + 42); b.set(text.encode(to), local + 30);
      }
    }
  }, encodeBackupArchive({ manifestJson: "{}", files: new Map([[from, text.encode("x")]]) }));
  rejects(() => decodeBackupArchive(rename("ab/c", "ab\\c")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("a/bb", "/abb")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("a/bb", "a/..")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("a/bb", "../b")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("abc", "a\u0001c")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("abc", "a\u0000c")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("abcd", "C:bc")), "archive-unsafe-name");
  rejects(() => decodeBackupArchive(rename("a/bb", "a//b")), "archive-unsafe-name");
  // duplicate: two entries with the same name (both local and central records agree)
  rejects(() => decodeBackupArchive((() => {
    const two = encodeBackupArchive({ manifestJson: "{}", files: new Map([["a", text.encode("x")], ["b", text.encode("x")]]) });
    return edit((b, l) => {
      b.set(text.encode("a"), l.centrals[2] + 46);
      b.set(text.encode("a"), get32(b, l.centrals[2] + 42) + 30);
    }, two);
  })()), "archive-duplicate-entry");
  // no manifest: rename it to another valid name
  rejects(() => decodeBackupArchive(edit((b, l) => {
    b.set(text.encode("manifest.jsoX"), l.centrals[0] + 46); b.set(text.encode("manifest.jsoX"), 30);
  })), "archive-missing-manifest");
  rejects(() => encodeBackupArchive({ manifestJson: "{}", files: new Map([[ARCHIVE_MANIFEST_NAME, new Uint8Array(1)]]) }), "archive-reserved-name");
  rejects(() => encodeBackupArchive({ manifestJson: "{}", files: new Map([["../x", new Uint8Array(1)]]) }), "archive-unsafe-name");
});

test("enforces entry count and size limits without large allocations", () => {
  const many = names(MAX_ARCHIVE_ENTRIES);
  rejects(() => encodeBackupArchive({ manifestJson: "{}", files: many }), "archive-too-many-entries");
  const full = encodeBackupArchive({ manifestJson: "{}", files: names(MAX_ARCHIVE_ENTRIES - 1) });
  assert.equal(decodeBackupArchive(full).files.size, MAX_ARCHIVE_ENTRIES - 1);
  rejects(() => decodeBackupArchive(edit((b, l) => { u16(b, l.eocd + 10, MAX_ARCHIVE_ENTRIES + 1); u16(b, l.eocd + 8, MAX_ARCHIVE_ENTRIES + 1); })), "archive-too-many-entries");
  rejects(() => encodeBackupArchive({ manifestJson: "{}", files: new Map([["big", { length: MAX_ARCHIVE_ENTRY_BYTES + 1 } as Uint8Array]]) }), "archive-entry-too-large");
  rejects(() => encodeBackupArchive({ manifestJson: "{}", files: new Map([["n".repeat(513), new Uint8Array(0)]]) }), "archive-unsafe-name");
});
