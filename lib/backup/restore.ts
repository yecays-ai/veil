import { ApiConfigStorage } from "../api-config-storage";
import { AppearanceImageStorage, type ImageAsset } from "../appearance-image-storage";
import { IndexedDBDocumentStorage } from "../core-document-storage";
import { ChatStorage } from "../chat/storage";
import { FOUNDATION_STORAGE_KEY } from "../foundation-storage";
import { BackupCoordinator, type BackupLockManager, type BackupLockOptions } from "./coordination";
import { type BackupDomain, type ValidatedBackup } from "./format";
import { parseBackupJson } from "./json";
import { previewValidatedBackup, restorePreviewChanged, type RestorePreview } from "./restore-preview";
import { BACKUP_LOCAL_KEYS, readStaticBackupSource, type StaticBackupSnapshot } from "./static-source";
import { validateBackupPackage } from "./validation";
import { createSafetyCopyStore, type SafetyCopyStore } from "./safety-copy";

export const RESTORE_JOURNAL_KEY = "veil.restore-journal.v1";
/** Write order. Chat rows and chat images are one atomic transaction; the foundation document goes last. */
export const RESTORE_UNITS = ["chat", "appearanceAssets", "apiConfigs", "appearance", "bindings", "presets", "regex",
  "worldbooks", "contacts", "presence", "foundation"] as const;
export type RestoreUnit = typeof RESTORE_UNITS[number];
const EMPTY = "empty";
const CHAT_STORES = ["sessions", "messages", "chatSettings", "assets", "worldBookStates"] as const;

export type RestoreJournal = {
  version: 1; kind: "empty-restore" | "replace"; restoreId: string; backupId: string; startedAt: number;
  /** Per unit: the digest the device must hold when the unit is done, or "empty" if the backup has nothing for it. */
  expected: Record<RestoreUnit, string>;
  /** Per unit: the digest the device held before the restore. All "empty" for an empty-environment restore. */
  previous: Record<RestoreUnit, string>;
};

/** `code` says what failed; `unit` names the step. `journal` tells the caller whether recovery is still owed. */
export class RestoreError extends Error {
  constructor(readonly code: "restore-in-progress" | "not-empty-restore" | "preview-changed" | "restore-failed-rolled-back"
    | "rollback-failed" | "verify-failed-rolled-back" | "journal-write-failed" | "no-journal" | "journal-invalid"
    | "package-mismatch" | "safety-copy-failed" | "safety-copy-missing" | "replace-not-confirmed" | "target-changed" | "resume-failed" | "journal-clear-failed",
    readonly journal: "none" | "kept" | "unknown", readonly unit?: RestoreUnit, readonly preview?: RestorePreview) {
    super(`Restore failed (${code})${unit ? ` at ${unit}` : ""}.`);
    this.name = "RestoreError";
  }
}

export type RestoreDevice = {
  indexedDB: IDBFactory;
  localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
};
/** Each writer replaces one unit completely; `clear` empties it. Tests wrap these to inject faults. */
export type UnitWriters = Record<RestoreUnit, { write(snapshot: StaticBackupSnapshot): Promise<void>; clear(): Promise<void> }>;

/** Restore storages use a passthrough gate: the caller already holds the exclusive snapshot lock. */
export function createUnitWriters(device: RestoreDevice): UnitWriters {
  const passthrough = { withWrite: <T,>(operation: () => Promise<T>) => operation() };
  const factory = () => device.indexedDB;
  const core = new IndexedDBDocumentStorage(factory, passthrough);
  const chat = new ChatStorage(factory, () => undefined, passthrough);
  const appearance = new AppearanceImageStorage(factory, Date.now, passthrough);
  const api = new ApiConfigStorage(factory, passthrough);
  const none = { sessions: [], messages: [], chatSettings: [], assets: [], worldBookStates: [] };
  const local = (domain: keyof typeof BACKUP_LOCAL_KEYS) => ({
    write: async (snapshot: StaticBackupSnapshot) => {
      const value = snapshot.documents[domain];
      if (value === null || value === undefined) device.localStorage.removeItem(BACKUP_LOCAL_KEYS[domain]);
      else device.localStorage.setItem(BACKUP_LOCAL_KEYS[domain], JSON.stringify(value));
    },
    clear: async () => device.localStorage.removeItem(BACKUP_LOCAL_KEYS[domain]),
  });
  return {
    chat: { write: (s) => chat.replaceAllRows(s.chat as typeof none), clear: () => chat.replaceAllRows(none) },
    appearanceAssets: { write: (s) => appearance.replaceAllAssets(s.appearanceAssets as ImageAsset[]), clear: () => appearance.replaceAllAssets([]) },
    apiConfigs: { write: (s) => api.replaceAllConfigs(s.apiConfigs as never[]), clear: () => api.replaceAllConfigs([]) },
    appearance: local("appearance"), bindings: local("bindings"), presets: local("presets"), regex: local("regex"),
    worldbooks: local("worldbooks"), contacts: local("contacts"), presence: local("presence"),
    foundation: {
      write: async (s) => core.replaceAllDocuments(s.documents.foundation == null ? []
        : [{ key: FOUNDATION_STORAGE_KEY, value: JSON.stringify(s.documents.foundation), updatedAt: Date.now() }]),
      clear: () => core.replaceAllDocuments([]),
    },
  };
}

async function sha256(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const picture = (row: unknown) => {
  const { blob, ...rest } = row as { blob?: unknown };
  return { ...rest, blob: blob instanceof Blob ? { size: blob.size, type: blob.type } : null };
};

/** IndexedDB returns rows in key order; a backup lists them in export order. Compare by id. */
const byId = <T,>(rows: readonly T[]): T[] => [...rows].sort((a, b) => {
  const x = String((a as { id?: unknown }).id), y = String((b as { id?: unknown }).id);
  return x < y ? -1 : x > y ? 1 : 0;
});

/** One digest per unit, computed identically for a backup and for the device. Credentials and image bytes are excluded. */
export async function digestUnits(snapshot: StaticBackupSnapshot): Promise<Record<RestoreUnit, string>> {
  const chat = snapshot.chat;
  const values: Record<RestoreUnit, unknown | null> = {
    chat: Object.values(chat).every((rows) => rows.length === 0) ? null : Object.fromEntries(CHAT_STORES.map((name) => [name, chat[name] ?? []]).map(([name, rows]) => [name, byId(name === "assets" ? (rows as unknown[]).map(picture) : (rows as unknown[]))])),
    appearanceAssets: snapshot.appearanceAssets.length ? byId(snapshot.appearanceAssets.map(picture)) : null,
    apiConfigs: snapshot.apiConfigs.length ? byId(snapshot.apiConfigs).map((row) => { const { apiKey: _key, ...rest } = row as { apiKey?: unknown }; void _key; return rest; }) : null,
    appearance: snapshot.documents.appearance ?? null, bindings: snapshot.documents.bindings ?? null,
    presets: snapshot.documents.presets ?? null, regex: snapshot.documents.regex ?? null,
    worldbooks: snapshot.documents.worldbooks ?? null, contacts: snapshot.documents.contacts ?? null,
    presence: snapshot.documents.presence ?? null, foundation: snapshot.documents.foundation ?? null,
  };
  const out = {} as Record<RestoreUnit, string>;
  for (const unit of RESTORE_UNITS) out[unit] = values[unit] === null ? EMPTY : await sha256(JSON.stringify(values[unit]));
  return out;
}

/** The rows a clean device would hold after the backup is restored. */
export function snapshotFromBackup(validated: ValidatedBackup, files: ReadonlyMap<string, Uint8Array>): StaticBackupSnapshot {
  const bytes = (path: string) => files.get(path) ?? new Uint8Array();
  const assets = (domain: "appearance" | "chat") => validated.manifest.assets.filter((asset) => asset.domain === domain);
  const { sessions, messages, chatSettings, worldBookStates } = validated.data.chat;
  const documents: StaticBackupSnapshot["documents"] = {};
  for (const domain of ["foundation", "appearance", "bindings", "presets", "regex", "worldbooks", "contacts", "presence"] as BackupDomain[])
    documents[domain] = validated.data[domain];
  return {
    documents,
    chat: { sessions, messages, chatSettings, worldBookStates,
      assets: assets("chat").map((a) => ({ id: a.id, blob: new Blob([bytes(a.path)] as BlobPart[], { type: a.mime }), createdAt: a.createdAt })) },
    appearanceAssets: assets("appearance").map((a) => ({ id: a.id, blob: new Blob([bytes(a.path)] as BlobPart[], { type: a.mime }), type: a.mime, createdAt: a.createdAt })),
    apiConfigs: validated.data.apiConfigs,
  };
}

export type RestoreOptions = BackupLockOptions & {
  now?: () => number;
  /** A preview shown to the user; the restore compares it with a fresh one and refuses if the device changed. */
  confirmed?: RestorePreview;
  writers?: UnitWriters;
  safety?: SafetyCopyStore;
  newId?: () => string;
};

type Run = { device: RestoreDevice; writers: UnitWriters; safety: SafetyCopyStore };

const blankSnapshot = (): StaticBackupSnapshot => ({ documents: {}, appearanceAssets: [], apiConfigs: [],
  chat: { sessions: [], messages: [], chatSettings: [], assets: [], worldBookStates: [] } });
const before = (journal: RestoreJournal, unit: RestoreUnit) => journal.kind === "replace" ? journal.previous[unit] : EMPTY;

function readJournal(device: RestoreDevice): RestoreJournal | null {
  let text: string | null;
  try { text = device.localStorage.getItem(RESTORE_JOURNAL_KEY); } catch { throw new RestoreError("journal-invalid", "unknown"); }
  if (text === null) return null;
  try {
    const value = parseBackupJson(text) as Partial<RestoreJournal> | null;
    const expected = value?.expected as Record<string, unknown> | undefined;
    if (!value || value.version !== 1 || (value.kind !== "empty-restore" && value.kind !== "replace") || typeof value.restoreId !== "string"
      || (value.kind === "replace" && !value.previous) || typeof value.backupId !== "string" || typeof value.startedAt !== "number" || !expected
      || RESTORE_UNITS.some((unit) => typeof expected[unit] !== "string"
        || (value.kind === "replace" && typeof (value.previous as Record<string, unknown>)[unit] !== "string"))) throw new Error("shape");
    return value as RestoreJournal;
  } catch { throw new RestoreError("journal-invalid", "kept"); }
}

/** The state the device must return to on rollback: empty, or the safety copy taken before a replace. */
async function rollbackTarget(run: Run, journal: RestoreJournal): Promise<StaticBackupSnapshot> {
  if (journal.kind !== "replace") return blankSnapshot();
  let copy: StaticBackupSnapshot | null;
  try { copy = await run.safety.load(journal.restoreId); } catch { throw new RestoreError("safety-copy-failed", "kept"); }
  if (!copy) throw new RestoreError("safety-copy-missing", "kept");
  const digests = await digestUnits(copy);
  if (RESTORE_UNITS.some((unit) => digests[unit] !== journal.previous[unit])) throw new RestoreError("safety-copy-missing", "kept");
  return copy;
}

/**
 * Puts every unit back to its pre-restore state. A unit that holds neither that state nor what this restore wrote
 * stops the rollback (`target-changed`): it is never overwritten.
 */
async function rollback(run: Run, journal: RestoreJournal): Promise<void> {
  const target = await rollbackTarget(run, journal);
  const state = await digestUnits(await readStaticBackupSource(run.device));
  for (const unit of [...RESTORE_UNITS].reverse())
    if (state[unit] !== before(journal, unit) && state[unit] !== journal.expected[unit]) throw new RestoreError("target-changed", "kept", unit);
  for (const unit of [...RESTORE_UNITS].reverse()) if (state[unit] !== before(journal, unit))
    await (journal.kind === "replace" ? run.writers[unit].write(target) : run.writers[unit].clear());
  const after = await digestUnits(await readStaticBackupSource(run.device));
  const left = RESTORE_UNITS.find((unit) => after[unit] !== before(journal, unit));
  if (left) throw new RestoreError("rollback-failed", "kept", left);
  await finish(run, journal);
}

function clearJournal(device: RestoreDevice): void {
  try { device.localStorage.removeItem(RESTORE_JOURNAL_KEY); if (device.localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) throw new Error("kept"); }
  catch { throw new RestoreError("journal-clear-failed", "kept"); }
}

/** The journal goes first; a leftover safety copy is only wasted space and is removed best-effort. */
async function finish(run: Run, journal: RestoreJournal): Promise<void> {
  clearJournal(run.device);
  if (journal.kind === "replace") { try { await run.safety.remove(journal.restoreId); } catch { /* orphan copy: harmless */ } }
}

/** Writes units still in their old state, skips units already equal to the backup, refuses anything else; then verifies. */
async function applyUnits(run: Run, journal: RestoreJournal, snapshot: StaticBackupSnapshot): Promise<{ failedUnit?: RestoreUnit; verified: boolean }> {
  for (const unit of RESTORE_UNITS) {
    const state = (await digestUnits(await readStaticBackupSource(run.device)))[unit];
    if (state === journal.expected[unit]) continue;
    if (state !== before(journal, unit)) throw new RestoreError("target-changed", "kept", unit);
    try { await run.writers[unit].write(snapshot); } catch { return { failedUnit: unit, verified: false }; }
  }
  const after = await digestUnits(await readStaticBackupSource(run.device));
  return { verified: RESTORE_UNITS.every((unit) => after[unit] === journal.expected[unit]) };
}

async function runRestore(kind: RestoreJournal["kind"], manifestJson: string, files: ReadonlyMap<string, Uint8Array>,
  device: RestoreDevice, locks: BackupLockManager | undefined, options: RestoreOptions): Promise<{ restoreId: string; backupId: string }> {
  const { now = Date.now, confirmed, writers = createUnitWriters(device), newId = () => globalThis.crypto.randomUUID(),
    safety = createSafetyCopyStore(device.indexedDB), ...lockOptions } = options;
  if (kind === "replace" && !confirmed) throw new RestoreError("replace-not-confirmed", "none");
  const validated = await validateBackupPackage(manifestJson, files);
  return new BackupCoordinator(locks).withSnapshot(async () => {
    if (readJournal(device)) throw new RestoreError("restore-in-progress", "kept");
    const blank: RestorePreview = { capturedAt: now(), backupId: validated.manifest.backupId, mode: "blocked", target: "unknown",
      targetDigest: null, domains: {}, assets: null, warnings: validated.warnings, blockers: [] };
    const fresh = await previewValidatedBackup(blank, validated, device, locks!);
    if (fresh.mode !== (kind === "replace" ? "replace-required" : "empty-restore")) throw new RestoreError("not-empty-restore", "none", undefined, fresh);
    if (confirmed && restorePreviewChanged(confirmed, fresh)) throw new RestoreError("preview-changed", "none", undefined, fresh);
    const snapshot = snapshotFromBackup(validated, files);
    const current = kind === "replace" ? await readStaticBackupSource(device) : blankSnapshot();
    const restoreId = newId();
    if (kind === "replace") {
      // The copy must exist before the journal that depends on it, and before the first overwrite.
      try { await safety.save(restoreId, current, now()); } catch { throw new RestoreError("safety-copy-failed", "none"); }
    }
    const journal: RestoreJournal = { version: 1, kind, restoreId, backupId: validated.manifest.backupId, startedAt: now(),
      expected: await digestUnits(snapshot), previous: await digestUnits(current) };
    const run: Run = { device, writers, safety };
    try { device.localStorage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify(journal)); }
    catch {
      if (kind === "replace") { try { await safety.remove(restoreId); } catch { /* orphan copy: harmless */ } }
      throw new RestoreError("journal-write-failed", "unknown");
    }
    let result: Awaited<ReturnType<typeof applyUnits>>;
    try { result = await applyUnits(run, journal, snapshot); }
    catch (error) { throw error instanceof RestoreError ? error : new RestoreError("resume-failed", "kept"); }
    if (result.failedUnit || !result.verified) {
      await rollback(run, journal);
      throw new RestoreError(result.failedUnit ? "restore-failed-rolled-back" : "verify-failed-rolled-back", "none", result.failedUnit);
    }
    await finish(run, journal);
    return { restoreId, backupId: journal.backupId };
  }, lockOptions);
}

/**
 * Restore into a verified-empty device. Everything runs under the exclusive snapshot lock. The journal is written
 * first; a failed or unverifiable restore is rolled back. If rollback cannot finish, the journal stays so that
 * `recoverRestore` can finish or undo it. Nothing is merged: any non-empty target is refused.
 */
export function restoreIntoEmpty(manifestJson: string, files: ReadonlyMap<string, Uint8Array>, device: RestoreDevice,
  locks: BackupLockManager | undefined, options: RestoreOptions = {}) {
  return runRestore("empty-restore", manifestJson, files, device, locks, options);
}

/**
 * Explicitly replace everything on a device that holds data with the backup. `options.confirmed` (the preview the
 * user saw) is required and re-checked against the device. A full copy of the current data is saved first; any
 * failure puts the device back from it. Not a merge: every unit is replaced as a whole.
 */
export function replaceWithBackup(manifestJson: string, files: ReadonlyMap<string, Uint8Array>, device: RestoreDevice,
  locks: BackupLockManager | undefined, options: RestoreOptions & { confirmed: RestorePreview }) {
  return runRestore("replace", manifestJson, files, device, locks, options);
}

/**
 * Finish or undo an interrupted restore or replace. `resume` needs the same package again (checked against the
 * journal); `rollback` needs no package (a replace uses its safety copy). Either refuses if a unit holds anything
 * other than its old or its new state.
 */
export async function recoverRestore(action: "resume" | "rollback", device: RestoreDevice, locks: BackupLockManager | undefined,
  pack: { manifestJson: string; files: ReadonlyMap<string, Uint8Array> } | null, options: RestoreOptions = {}): Promise<void> {
  const { writers = createUnitWriters(device), safety = createSafetyCopyStore(device.indexedDB), ...lockOptions } = options;
  return new BackupCoordinator(locks).withSnapshot(async () => {
    const journal = readJournal(device);
    if (!journal) throw new RestoreError("no-journal", "none");
    const run: Run = { device, writers, safety };
    if (action === "rollback") { await rollback(run, journal); return; }
    if (!pack) throw new RestoreError("package-mismatch", "kept");
    const validated = await validateBackupPackage(pack.manifestJson, pack.files);
    const snapshot = snapshotFromBackup(validated, pack.files);
    if (validated.manifest.backupId !== journal.backupId
      || JSON.stringify(await digestUnits(snapshot)) !== JSON.stringify(journal.expected)) throw new RestoreError("package-mismatch", "kept");
    const result = await applyUnits(run, journal, snapshot);
    if (result.failedUnit || !result.verified) throw new RestoreError("resume-failed", "kept", result.failedUnit);
    await finish(run, journal);
  }, lockOptions);
}
