import { BackupValidationError } from "./format";

/**
 * Single-file backup container: a plain ZIP (STORE only, no ZIP64, no extras). `manifest.json` holds the
 * manifest; every other entry is a package file at its manifest path. Content is not validated here.
 */
export const ARCHIVE_MANIFEST_NAME = "manifest.json";
export const MAX_ARCHIVE_ENTRIES = 4096;
export const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
/** Limit on the whole archive file; entry data plus ZIP headers must fit. */
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_NAME_BYTES = 512;

const LOCAL_SIG = 0x04034b50, CENTRAL_SIG = 0x02014b50, EOCD_SIG = 0x06054b50, ZIP64_LOCATOR_SIG = 0x07064b50;
const LOCAL_SIZE = 30, CENTRAL_SIZE = 46, EOCD_SIZE = 22;
const UTF8_FLAG = 0x800, VERSION = 20, DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 keeps bytes deterministic
// Error paths are fixed labels: names and contents come from untrusted input.
const PATH = "archive";
const fail = (code: string): never => { throw new BackupValidationError(code, PATH); };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checkName(name: string, nameBytes: number): void {
  if (!name || nameBytes > MAX_ARCHIVE_NAME_BYTES || name.includes("\\") || /[\u0000-\u001f\u007f]/.test(name)
    || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").some((part) => part === "" || part === "." || part === ".."))
    fail("archive-unsafe-name");
}

export function encodeBackupArchive(pkg: { manifestJson: string; files: ReadonlyMap<string, Uint8Array> }): Uint8Array {
  const encoder = new TextEncoder();
  const entries: { name: Uint8Array; data: Uint8Array }[] = [{ name: encoder.encode(ARCHIVE_MANIFEST_NAME), data: encoder.encode(pkg.manifestJson) }];
  for (const path of [...pkg.files.keys()].sort()) {
    const name = encoder.encode(path);
    checkName(path, name.length);
    if (path === ARCHIVE_MANIFEST_NAME) fail("archive-reserved-name");
    entries.push({ name, data: pkg.files.get(path)! });
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) fail("archive-too-many-entries");
  let total = EOCD_SIZE;
  for (const { name, data } of entries) {
    if (data.length > MAX_ARCHIVE_ENTRY_BYTES) fail("archive-entry-too-large");
    total += LOCAL_SIZE + CENTRAL_SIZE + 2 * name.length + data.length;
    if (total > MAX_ARCHIVE_BYTES) fail("archive-too-large");
  }
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const { name, data } of entries) {
    offsets.push(at);
    view.setUint32(at, LOCAL_SIG, true); view.setUint16(at + 4, VERSION, true); view.setUint16(at + 6, UTF8_FLAG, true);
    view.setUint16(at + 10, DOS_TIME, true); view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, crc32(data), true); view.setUint32(at + 18, data.length, true); view.setUint32(at + 22, data.length, true);
    view.setUint16(at + 26, name.length, true);
    out.set(name, at + LOCAL_SIZE); out.set(data, at + LOCAL_SIZE + name.length);
    at += LOCAL_SIZE + name.length + data.length;
  }
  const directory = at;
  entries.forEach(({ name, data }, i) => {
    view.setUint32(at, CENTRAL_SIG, true); view.setUint16(at + 4, VERSION, true); view.setUint16(at + 6, VERSION, true);
    view.setUint16(at + 8, UTF8_FLAG, true);
    view.setUint16(at + 12, DOS_TIME, true); view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, crc32(data), true); view.setUint32(at + 20, data.length, true); view.setUint32(at + 24, data.length, true);
    view.setUint16(at + 28, name.length, true); view.setUint32(at + 42, offsets[i], true);
    out.set(name, at + CENTRAL_SIZE);
    at += CENTRAL_SIZE + name.length;
  });
  view.setUint32(at, EOCD_SIG, true);
  view.setUint16(at + 8, entries.length, true); view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directory, true); view.setUint32(at + 16, directory, true);
  return out;
}

export function decodeBackupArchive(bytes: Uint8Array): { manifestJson: string; files: Map<string, Uint8Array> } {
  if (bytes.length > MAX_ARCHIVE_BYTES) fail("archive-too-large");
  if (bytes.length < EOCD_SIZE) fail("archive-truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let eocd = -1;
  for (let i = bytes.length - EOCD_SIZE, stop = Math.max(0, i - 0xffff); i >= stop; i--)
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  if (eocd < 0) fail(view.getUint32(0, true) === LOCAL_SIG ? "archive-truncated" : "archive-not-zip");
  if (eocd + EOCD_SIZE + view.getUint16(eocd + 20, true) !== bytes.length) fail("archive-trailing-data");
  if (view.getUint16(eocd + 20, true) !== 0) fail("archive-unsupported");
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIG) fail("archive-zip64");
  const count = view.getUint16(eocd + 10, true), dirSize = view.getUint32(eocd + 12, true), dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) fail("archive-zip64");
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0 || view.getUint16(eocd + 8, true) !== count)
    fail("archive-multi-disk");
  if (count > MAX_ARCHIVE_ENTRIES) fail("archive-too-many-entries");
  if (dirOffset + dirSize !== eocd) fail("archive-bad-directory");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const spans: { start: number; end: number }[] = [];
  const found: { name: string; start: number; size: number; crc: number }[] = [];
  let at = dirOffset;
  for (let n = 0; n < count; n++) {
    if (at + CENTRAL_SIZE > eocd || view.getUint32(at, true) !== CENTRAL_SIG) fail("archive-bad-directory");
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true);
    const csize = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), nameLen = view.getUint16(at + 28, true);
    if (flags & 1) fail("archive-encrypted");
    if (flags & ~UTF8_FLAG) fail("archive-unsupported-flags");
    if (method !== 0) fail("archive-compressed");
    if (csize === 0xffffffff || size === 0xffffffff) fail("archive-zip64");
    if (csize !== size) fail("archive-size-mismatch");
    if (view.getUint16(at + 30, true) || view.getUint16(at + 32, true) || view.getUint16(at + 34, true)) fail("archive-unsupported");
    const local = view.getUint32(at + 42, true), nameStart = at + CENTRAL_SIZE;
    if (nameStart + nameLen > eocd) fail("archive-bad-directory");
    let name: string;
    try { name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen)); } catch { return fail("archive-unsafe-name"); }
    checkName(name, nameLen);
    if (seen.has(name)) fail("archive-duplicate-entry");
    seen.add(name);
    if (size > MAX_ARCHIVE_ENTRY_BYTES) fail("archive-entry-too-large");
    // Declared sizes are checked against the real buffer before anything is allocated.
    const start = local + LOCAL_SIZE + nameLen, end = start + size;
    if (local + LOCAL_SIZE > dirOffset || end > dirOffset) fail("archive-bad-offset");
    if (view.getUint32(local, true) !== LOCAL_SIG) fail("archive-bad-offset");
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== 0 || view.getUint16(local + 28, true) !== 0
      || view.getUint16(local + 26, true) !== nameLen || view.getUint32(local + 14, true) !== crc
      || view.getUint32(local + 18, true) !== size || view.getUint32(local + 22, true) !== size) fail("archive-header-mismatch");
    for (let i = 0; i < nameLen; i++) if (bytes[local + LOCAL_SIZE + i] !== bytes[nameStart + i]) fail("archive-header-mismatch");
    spans.push({ start: local, end });
    found.push({ name, start, size, crc });
    at = nameStart + nameLen;
  }
  if (at !== eocd) fail("archive-bad-directory");
  spans.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) fail("archive-overlap");
    if (span.start > cursor) fail("archive-gap");
    cursor = span.end;
  }
  if (cursor !== dirOffset) fail("archive-gap");

  const files = new Map<string, Uint8Array>();
  let manifest: Uint8Array | undefined;
  for (const { name, start, size, crc } of found) {
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== crc) fail("archive-crc-mismatch");
    if (name === ARCHIVE_MANIFEST_NAME) manifest = data; else files.set(name, data);
  }
  if (!manifest) fail("archive-missing-manifest");
  let manifestJson: string;
  try { manifestJson = decoder.decode(manifest); } catch { return fail("archive-bad-manifest"); }
  return { manifestJson, files };
}
