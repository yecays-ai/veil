import { BACKUP_SCHEMA, BACKUP_VERSION, BACKUP_DOMAIN_VERSIONS, BackupValidationError,
  type BackupManifest, type BackupData, type BackupDomain, type BackupWarning } from "./format";
import { validateBackupPackage } from "./validation";
import { readStaticBackupSource, type StaticBackupSnapshot, type StaticBackupSource } from "./static-source";

export type StaticBackupMetadata = Pick<BackupManifest, "backupId" | "createdAt" | "sourceCommit">;
export type StaticBackupPackage = { manifestJson: string; files: ReadonlyMap<string, Uint8Array>; warnings: BackupWarning[] };
const fail = (code: string, path: string): never => { throw new BackupValidationError(code, path); };

/** Hash exact output bytes; errors never expose the original source object. */
async function sha256(bytes: Uint8Array, path: string): Promise<string> {
  try {
    const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return fail("hash-unavailable", path); }
}

/** JSON can omit undefined optional object fields written by ChatStorage; all other lossy values fail. */
function encodeJson(value: unknown, path: string): Uint8Array {
  try {
    const seen = new Set<object>();
    function inspect(item: unknown, depth: number, allowUndefined = false): void {
      if (depth > 64) fail("invalid-source-data", path);
      if (typeof item === "number" && !Number.isFinite(item)) fail("invalid-source-data", path);
      if (["bigint", "function", "symbol"].includes(typeof item)) fail("invalid-source-data", path);
      if (item === undefined && !allowUndefined) fail("invalid-source-data", path);
      if (item && typeof item === "object") {
        if (seen.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))))
          fail("invalid-source-data", path);
        seen.add(item);
        if (Array.isArray(item)) for (const entry of item) inspect(entry, depth + 1);
        else for (const entry of Object.values(item)) inspect(entry, depth + 1, true);
        seen.delete(item);
      }
    }
    inspect(value, 0);
    return new TextEncoder().encode(JSON.stringify(value));
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    return fail("invalid-source-data", path);
  }
}

/**
 * Early builds stored an always-null `remark` on every conversation row; Contact now owns the name. Only that provably
 * empty legacy value is left out of the copy being exported. A non-null value is kept so validation still refuses
 * rather than silently losing a name. The stored row is never touched.
 */
function withoutEmptyLegacyRemark(sessions: unknown[]): unknown[] {
  return sessions.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || (row as Record<string, unknown>).remark !== null) return row;
    const rest = { ...(row as Record<string, unknown>) };
    delete rest.remark;
    return rest;
  });
}

/** Count top-level persisted records using the v1 contract, without initializing absent documents. */
export function recordCount(domain: BackupDomain, value: unknown): number {
  if (value === null) return 0;
  if (domain === "apiConfigs") return (value as unknown[]).length;
  if (domain === "chat" || domain === "memory")
    return Object.values(value as BackupData["chat"] | BackupData["memory"]).reduce((count, rows) => count + rows.length, 0);
  const arrayFields: Partial<Record<BackupDomain, string>> = {
    presets: "presets", regex: "groups", worldbooks: "books", contacts: "contacts", presence: "characters",
  };
  const field = arrayFields[domain];
  if (!field) return 1;
  const rows = (value as Record<string, unknown>)[field];
  if (!Array.isArray(rows)) return fail("invalid-source-data", domain);
  return rows.length;
}

/** Internal static export only: not wired to the app, download UI or recovery. Call it through `exportStaticBackupSnapshot` for a consistent capture. */
export async function exportStaticBackup(source: StaticBackupSource, metadata: StaticBackupMetadata,
  options: { inspect?: (snapshot: StaticBackupSnapshot) => Promise<void> } = {}): Promise<StaticBackupPackage> {
  const snapshot = await readStaticBackupSource(source);
  // The caller may refuse here, after the read and before any package byte is produced.
  await options.inspect?.(snapshot);
  const apiConfigs = snapshot.apiConfigs.map((item, index) => {
    const path = `apiConfigs[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("invalid-source-data", path);
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["id", "name", "provider", "baseUrl", "model", "apiKey"].includes(key))) fail("unsupported-source-data", path);
    // Whitelist only: do not serialize the credential and do not read another config's key.
    return { id: row.id, name: row.name, provider: row.provider, baseUrl: row.baseUrl, model: row.model };
  });
  const data: Record<BackupDomain, unknown> = {
    foundation: snapshot.documents.foundation, appearance: snapshot.documents.appearance,
    bindings: snapshot.documents.bindings, presets: snapshot.documents.presets, regex: snapshot.documents.regex,
    worldbooks: snapshot.documents.worldbooks, contacts: snapshot.documents.contacts, presence: snapshot.documents.presence,
    chat: { sessions: withoutEmptyLegacyRemark(snapshot.chat.sessions), messages: snapshot.chat.messages,
      chatSettings: snapshot.chat.chatSettings, worldBookStates: snapshot.chat.worldBookStates }, memory: snapshot.memory, apiConfigs,
  };
  const manifest: BackupManifest = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, ...metadata,
    credentials: "excluded", domains: [], assets: [] };
  const files = new Map<string, Uint8Array>();
  for (const domain of Object.keys(BACKUP_DOMAIN_VERSIONS) as BackupDomain[]) {
    const bytes = encodeJson(data[domain], domain), path = `domains/${domain}.json`;
    manifest.domains.push({ domain, version: BACKUP_DOMAIN_VERSIONS[domain], path,
      bytes: bytes.length, sha256: await sha256(bytes, domain), records: recordCount(domain, data[domain]) });
    files.set(path, bytes);
  }
  for (const [domain, assets] of [["appearance", snapshot.appearanceAssets], ["chat", snapshot.chat.assets]] as const) {
    for (let index = 0; index < assets.length; index++) {
      const item = assets[index], location = `${domain}.assets[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) fail("invalid-source-data", location);
      const row = item as Record<string, unknown>;
      const allowed = domain === "appearance" ? ["id", "blob", "type", "createdAt", "holders"] : ["id", "blob", "createdAt"];
      if (Object.keys(row).some((key) => !allowed.includes(key)) || typeof row.id !== "string" || !(row.blob instanceof Blob)
        || typeof row.createdAt !== "number") fail("invalid-source-data", location);
      const blob = row.blob as Blob;
      if (domain === "appearance" && row.type !== blob.type) fail("invalid-source-data", location);
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await blob.arrayBuffer()); } catch { return fail("asset-read-failed", location); }
      // Index-based paths prevent raw asset IDs from becoming filenames; original IDs remain in the manifest.
      const path = `assets/${domain}/${index}.bin`;
      manifest.assets.push({ domain, id: row.id as string, path, bytes: bytes.length,
        sha256: await sha256(bytes, location), mime: blob.type, createdAt: row.createdAt as number });
      files.set(path, bytes);
    }
  }
  const manifestJson = JSON.stringify(manifest);
  const verified = await validateBackupPackage(manifestJson, files);
  return { manifestJson, files, warnings: verified.warnings };
}
