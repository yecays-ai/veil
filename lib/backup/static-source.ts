import { CORE_DATABASE_NAME, CORE_DATABASE_VERSION } from "../core-document-storage";
import { FOUNDATION_STORAGE_KEY } from "../foundation-storage";
import { CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION } from "../chat/storage";
import { APPEARANCE_IMAGE_DATABASE_NAME, APPEARANCE_IMAGE_DATABASE_VERSION } from "../appearance-image-storage";
import { API_CONFIG_DATABASE_NAME, API_CONFIG_DATABASE_VERSION } from "../api-config-storage";
import { parseBackupJson } from "./json";
import { BackupValidationError, type BackupDomain } from "./format";
import { SAFETY_DATABASE_NAME } from "./safety-copy";
import { deleteLegacyChatDatabase, LEGACY_CHAT_DATABASE_NAME } from "./legacy-cleanup";

export const BACKUP_LOCAL_KEYS = {
  appearance: "companion-phone.appearance.v1", bindings: "veil.bindings.v1", presets: "veil.preset.v1",
  regex: "veil.regex.v1", worldbooks: "veil.worldbooks.v1", contacts: "veil.contacts.v1", presence: "veil.presence.v1",
} as const;
const DATABASES = [
  { name: CORE_DATABASE_NAME, version: CORE_DATABASE_VERSION, stores: ["documents"], key: "key" },
  { name: CHAT_DATABASE_NAME, version: CHAT_DATABASE_VERSION, stores: ["sessions", "messages", "chatSettings", "assets", "worldBookStates"], key: "id" },
  { name: APPEARANCE_IMAGE_DATABASE_NAME, version: APPEARANCE_IMAGE_DATABASE_VERSION, stores: ["assets"], key: "id" },
  { name: API_CONFIG_DATABASE_NAME, version: API_CONFIG_DATABASE_VERSION, stores: ["configs"], key: "id" },
] as const;
export type StaticBackupSource = { localStorage: Pick<Storage, "getItem">; indexedDB: IDBFactory };
export type StaticBackupSnapshot = {
  documents: Partial<Record<BackupDomain, unknown>>;
  chat: Record<string, unknown[]>;
  appearanceAssets: unknown[];
  apiConfigs: unknown[];
};
const fail = (code: string, path: string): never => { throw new BackupValidationError(code, path); };

/** Read one existing database in one readonly transaction; never bootstrap or upgrade a database. */
async function readDatabase(factory: IDBFactory, definition: typeof DATABASES[number]): Promise<Record<string, unknown[]>> {
  let database: IDBDatabase | undefined;
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open(definition.name);
      let rejected = false;
      const error = () => { rejected = true; reject(new BackupValidationError("source-unavailable", definition.name)); };
      opening.onupgradeneeded = () => { error(); opening.transaction?.abort(); };
      opening.onerror = error;
      opening.onblocked = error;
      opening.onsuccess = () => {
        if (rejected) { opening.result.close(); return; }
        resolve(opening.result);
      };
    });
    if (database.version !== definition.version || database.objectStoreNames.length !== definition.stores.length
      || definition.stores.some((name) => !database!.objectStoreNames.contains(name))) fail("unsupported-source-schema", definition.name);
    database.onversionchange = () => database?.close();
    return await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const tx = database!.transaction([...definition.stores], "readonly"), rows: Record<string, unknown[]> = {};
      const error = () => reject(new BackupValidationError("source-read-failed", definition.name));
      tx.onabort = tx.onerror = error;
      tx.oncomplete = () => resolve(rows);
      for (const name of definition.stores) {
        const store = tx.objectStore(name);
        if (store.keyPath !== definition.key || store.autoIncrement) {
          tx.abort(); reject(new BackupValidationError("unsupported-source-schema", definition.name)); return;
        }
        const operation = store.getAll();
        operation.onsuccess = () => { rows[name] = operation.result; };
        operation.onerror = error;
      }
    });
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    return fail("source-unavailable", definition.name);
  } finally { database?.close(); }
}

/** Capture static authorities directly. Per-database transactions do not provide cross-domain consistency. */
export async function readStaticBackupSource(source: StaticBackupSource): Promise<StaticBackupSnapshot> {
  const documents: StaticBackupSnapshot["documents"] = {};
  for (const [domain, key] of Object.entries(BACKUP_LOCAL_KEYS)) {
    let text: string | null;
    try { text = source.localStorage.getItem(key); } catch { return fail("source-read-failed", domain); }
    try {
      const value = text === null ? null : parseBackupJson(text);
      if (text !== null && value === null) fail("invalid-source-document", domain);
      documents[domain as BackupDomain] = value;
    }
    catch { return fail("invalid-source-json", domain); }
  }
  let catalog: IDBDatabaseInfo[];
  try {
    // Enumerate first: opening a missing DB would create one. Unsupported catalog APIs fail closed.
    catalog = await source.indexedDB.databases();
  } catch { return fail("source-catalog-unavailable", "databases"); }
  // Only the precisely named disposable development database may be deleted (Lan's S11 N1 decision).
  if (catalog.some((entry) => entry.name === LEGACY_CHAT_DATABASE_NAME)) {
    await deleteLegacyChatDatabase(source.indexedDB);
    try { catalog = await source.indexedDB.databases(); }
    catch { return fail("source-catalog-unavailable", "databases"); }
    if (catalog.some((entry) => entry.name === LEGACY_CHAT_DATABASE_NAME)) fail("legacy-cleanup-failed", "databases");
  }
  // Unknown databases may own business data. Refuse the whole operation rather than silently omit them.
  // The temporary rollback copy is the only explicit exclusion: it never belongs in a backup.
  for (const entry of catalog) {
    if (entry.name !== SAFETY_DATABASE_NAME && !DATABASES.some((definition) => definition.name === entry.name))
      fail("unsupported-source-database", "databases");
  }
  const snapshots: Record<string, Record<string, unknown[]>> = {};
  for (const definition of DATABASES) {
    const existing = catalog.find((entry) => entry.name === definition.name);
    if (!existing) { snapshots[definition.name] = {}; continue; }
    if (existing.version !== definition.version) fail("unsupported-source-schema", definition.name);
    snapshots[definition.name] = await readDatabase(source.indexedDB, definition);
  }
  const core = snapshots[CORE_DATABASE_NAME].documents ?? [];
  if (core.length > 1) fail("unsupported-source-document", "foundation");
  documents.foundation = null;
  if (core.length) {
    const row = core[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("invalid-source-document", "foundation");
    const record = row as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["key", "value", "updatedAt"].includes(key))
      || record.key !== FOUNDATION_STORAGE_KEY || typeof record.value !== "string") fail("unsupported-source-document", "foundation");
    try {
      documents.foundation = parseBackupJson(record.value as string);
      if (documents.foundation === null) fail("invalid-source-document", "foundation");
    }
    catch { return fail("invalid-source-json", "foundation"); }
  }
  const rawChat = snapshots[CHAT_DATABASE_NAME];
  return { documents,
    chat: Object.fromEntries(["sessions", "messages", "chatSettings", "assets", "worldBookStates"].map((key) => [key, rawChat[key] ?? []])),
    appearanceAssets: snapshots[APPEARANCE_IMAGE_DATABASE_NAME].assets ?? [],
    apiConfigs: snapshots[API_CONFIG_DATABASE_NAME].configs ?? [],
  };
}
