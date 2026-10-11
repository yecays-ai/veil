import { BackupValidationError } from "./format";

/** Stable image metadata plus actual byte hashes, shared by preview and recovery comparisons. */
export async function digestImageRows(rows: readonly unknown[], includeByteHash = true): Promise<unknown[]> {
  return Promise.all(rows.map(async (row) => {
    const { blob, ...rest } = row as { blob?: unknown };
    if (!(blob instanceof Blob)) return { ...rest, blob: null };
    // Existing interrupted journals retain their original comparison contract until recovery finishes.
    if (!includeByteHash) return { ...rest, blob: { size: blob.size, type: blob.type } };
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await blob.arrayBuffer()); }
    catch { throw new BackupValidationError("asset-read-failed", "assets"); }
    let hash: ArrayBuffer;
    try { hash = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)); }
    catch { throw new BackupValidationError("hash-unavailable", "assets"); }
    const sha256 = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { ...rest, blob: { size: blob.size, type: blob.type, sha256 } };
  }));
}
