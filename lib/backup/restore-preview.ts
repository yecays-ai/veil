import { BackupCoordinator, type BackupLockManager, type BackupLockOptions } from "./coordination";
import { BackupValidationError, BACKUP_DOMAIN_VERSIONS, type BackupDomain, type BackupWarning } from "./format";
import { parseBackupJson } from "./json";
import { generationHeld } from "./snapshot-export";
import { recordCount } from "./static-export";
import { readStaticBackupSource, type StaticBackupSnapshot, type StaticBackupSource } from "./static-source";
import { parseBackupManifest, validateBackupPackage } from "./validation";
import type { ValidatedBackup } from "./format";

export type RestoreBlocker =
  /** The package failed v1 validation (checksum, version, structure). `error` is the validation code. */
  | { code: "backup-invalid"; error: string; path: string }
  /** The package itself carries an in-progress `generation` marker: a damaged or hand-edited file. */
  | { code: "backup-generation-marker"; path: string }
  /** The local device could not be read; its state is unknown, not assumed empty. */
  | { code: "target-unreadable"; error: string; path: string }
  /** A reply is generating on this device right now (its generation lock is held). */
  | { code: "local-generation-active"; path: string }
  /** A local session carries a `generation` marker but no live reply holds it: a crash leftover. */
  | { code: "local-generation-stale"; path: string };

export type RestoreCount = { backup: number; current: number };
/**
 * A point-in-time snapshot of one backup package against this device. It authorizes nothing: a restore
 * must run previewRestore again and compare with `restorePreviewChanged` before it writes anything.
 */
export type RestorePreview = {
  capturedAt: number;
  backupId: string | null;
  mode: "empty-restore" | "replace-required" | "blocked";
  target: "empty" | "has-data" | "unknown";
  /** Digest of the device state that was read; null when the device was not read. */
  targetDigest: string | null;
  domains: Partial<Record<BackupDomain, RestoreCount>>;
  assets: { appearance: RestoreCount; chat: RestoreCount } | null;
  warnings: BackupWarning[];
  blockers: RestoreBlocker[];
};

const DOMAINS = Object.keys(BACKUP_DOMAIN_VERSIONS) as BackupDomain[];

async function sha256(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Counts per domain with the same rule as the export; credentials are never part of the digest. */
function currentDomainCounts(snapshot: StaticBackupSnapshot): Record<BackupDomain, number> {
  const { assets: _assets, ...chat } = snapshot.chat;
  void _assets;
  const value: Record<BackupDomain, unknown> = { ...snapshot.documents as Record<BackupDomain, unknown>,
    foundation: snapshot.documents.foundation ?? null, chat, apiConfigs: snapshot.apiConfigs };
  return Object.fromEntries(DOMAINS.map((domain) => [domain,
    domain === "chat" ? Object.values(chat).reduce((n, rows) => n + rows.length, 0)
      : recordCount(domain, value[domain] ?? null)])) as Record<BackupDomain, number>;
}

/** Everything but secrets and image bytes: pictures contribute id, age, size and type only. */
async function digestTarget(snapshot: StaticBackupSnapshot): Promise<string> {
  const picture = (row: unknown) => {
    const { blob, ...rest } = row as { blob?: unknown };
    return { ...rest, blob: blob instanceof Blob ? { size: blob.size, type: blob.type } : null };
  };
  const withoutKeys = snapshot.apiConfigs.map((row) => {
    const { apiKey: _key, ...rest } = row as { apiKey?: unknown };
    void _key;
    return rest;
  });
  return sha256(JSON.stringify({ documents: snapshot.documents,
    chat: { ...snapshot.chat, assets: snapshot.chat.assets.map(picture) },
    appearanceAssets: snapshot.appearanceAssets.map(picture), apiConfigs: withoutKeys }));
}

/** Tells a package-level generation marker from other validation failures, without trusting the package. */
function packageHasGenerationMarker(manifestJson: string, files: ReadonlyMap<string, Uint8Array>): boolean {
  try {
    const entry = parseBackupManifest(manifestJson).domains.find((section) => section.domain === "chat");
    const bytes = entry && files.get(entry.path);
    if (!bytes) return false;
    const chat = parseBackupJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { sessions?: unknown } | null;
    return Array.isArray(chat?.sessions) && chat!.sessions.some((row) => !!row && typeof row === "object" && "generation" in row);
  } catch { return false; }
}

async function classifyTarget(snapshot: StaticBackupSnapshot, locks: BackupLockManager): Promise<RestoreBlocker[]> {
  const blockers: RestoreBlocker[] = [];
  for (const [index, row] of snapshot.chat.sessions.entries()) {
    const session = row as { id?: unknown; generation?: unknown };
    if (!session.generation) continue;
    const path = `chat.sessions[${index}]`;
    const live = typeof session.id === "string" && await generationHeld(session.id, locks);
    blockers.push({ code: live ? "local-generation-active" : "local-generation-stale", path });
  }
  return blockers;
}

/**
 * Read-only restore precheck. Validates the package, then reads this device inside the exclusive snapshot
 * lock and compares. It writes nothing, creates no database and returns blockers rather than guessing.
 * Coordination failures (timeout, unavailable, cancelled) are thrown with their existing codes.
 */
export async function previewRestore(manifestJson: string, files: ReadonlyMap<string, Uint8Array>,
  source: StaticBackupSource, locks: BackupLockManager | undefined,
  options: BackupLockOptions & { now?: () => number } = {}): Promise<RestorePreview> {
  const { now = Date.now, ...lockOptions } = options;
  const preview: RestorePreview = { capturedAt: now(), backupId: null, mode: "blocked", target: "unknown", targetDigest: null,
    domains: {}, assets: null, warnings: [], blockers: [] };
  let validated: Awaited<ReturnType<typeof validateBackupPackage>>;
  try { validated = await validateBackupPackage(manifestJson, files); }
  catch (error) {
    if (!(error instanceof BackupValidationError)) throw error;
    preview.blockers.push(error.code === "invalid-data" && error.path.startsWith("chat") && packageHasGenerationMarker(manifestJson, files)
      ? { code: "backup-generation-marker", path: error.path }
      : { code: "backup-invalid", error: error.code, path: error.path });
    return preview;
  }
  preview.backupId = validated.manifest.backupId;
  preview.warnings = validated.warnings;
  return new BackupCoordinator(locks).withSnapshot(() => previewValidatedBackup(preview, validated, source, locks!), lockOptions);
}

/** Compares an already validated package with this device. The caller must hold the exclusive snapshot lock. */
export async function previewValidatedBackup(preview: RestorePreview, validated: ValidatedBackup,
  source: StaticBackupSource, locks: BackupLockManager): Promise<RestorePreview> {
  let snapshot: StaticBackupSnapshot;
  try { snapshot = await readStaticBackupSource(source); }
  catch (error) {
    if (!(error instanceof BackupValidationError)) throw error;
    preview.blockers.push({ code: "target-unreadable", error: error.code, path: error.path });
    preview.mode = "blocked";
    return preview;
  }
  try {
    const current = currentDomainCounts(snapshot);
    for (const section of validated.manifest.domains) preview.domains[section.domain] = { backup: section.records, current: current[section.domain] };
    const backupAssets = (domain: "appearance" | "chat") => validated.manifest.assets.filter((asset) => asset.domain === domain).length;
    preview.assets = { appearance: { backup: backupAssets("appearance"), current: snapshot.appearanceAssets.length },
      chat: { backup: backupAssets("chat"), current: snapshot.chat.assets.length } };
    preview.targetDigest = await digestTarget(snapshot);
    const empty = Object.values(current).every((count) => count === 0)
      && preview.assets.appearance.current === 0 && preview.assets.chat.current === 0;
    preview.target = empty ? "empty" : "has-data";
  } catch (error) {
    // A malformed local document cannot be counted: report it, never assume the device is empty.
    if (!(error instanceof BackupValidationError)) throw error;
    preview.blockers.push({ code: "target-unreadable", error: error.code, path: error.path });
    preview.domains = {}; preview.assets = null; preview.targetDigest = null; preview.target = "unknown";
    preview.mode = "blocked";
    return preview;
  }
  preview.blockers.push(...await classifyTarget(snapshot, locks));
  preview.mode = preview.blockers.length ? "blocked" : preview.target === "empty" ? "empty-restore" : "replace-required";
  return preview;
}

/** A report from before a restore is stale as soon as the device changed; the restore must preview again. */
export function restorePreviewChanged(previous: RestorePreview, fresh: RestorePreview): boolean {
  return previous.mode !== fresh.mode || previous.targetDigest !== fresh.targetDigest
    || JSON.stringify(previous.blockers) !== JSON.stringify(fresh.blockers) || previous.backupId !== fresh.backupId
    || JSON.stringify(previous.domains) !== JSON.stringify(fresh.domains)
    || JSON.stringify(previous.assets) !== JSON.stringify(fresh.assets);
}
