import { generationLockName } from "../chat/generation-lock";
import { BackupCoordinator, type BackupLockManager, type BackupLockOptions } from "./coordination";
import { BackupValidationError } from "./format";
import { exportStaticBackup, type StaticBackupMetadata, type StaticBackupPackage } from "./static-export";
import type { StaticBackupSnapshot, StaticBackupSource } from "./static-source";

/**
 * True while a reply holds the session's generation lock. Probe, never wait: a granted lock is released at
 * once. A `generation` marker without the lock is a stale leftover (the tab died), not a live reply.
 */
export async function generationHeld(sessionId: string, locks: BackupLockManager): Promise<boolean> {
  try {
    return !await locks.request(generationLockName(sessionId), { mode: "exclusive", ifAvailable: true }, async (lock) => !!lock);
  } catch { throw new BackupValidationError("coordination-unavailable", "chat"); }
}

/**
 * Only a live reply is refused here. A stale marker is not called live, and the unchanged v1 validation
 * rejects it as invalid-data until the chat store recovers it (which opening the conversation does).
 */
async function refuseLiveGeneration(snapshot: StaticBackupSnapshot, locks: BackupLockManager): Promise<void> {
  for (const row of snapshot.chat.sessions) {
    const session = row as { id?: unknown; generation?: unknown };
    if (!session.generation || typeof session.id !== "string") continue;
    if (await generationHeld(session.id, locks)) throw new BackupValidationError("generation-active", "chat");
  }
}

/**
 * Consistent static export: capture runs under the exclusive snapshot lock, so no logical write is half
 * done, and is refused (no package produced) while a reply is generating. Internal only: not wired to the app.
 */
export function exportStaticBackupSnapshot(source: StaticBackupSource, metadata: StaticBackupMetadata,
  locks: BackupLockManager | undefined, options: BackupLockOptions = {}): Promise<StaticBackupPackage> {
  return new BackupCoordinator(locks).withSnapshot(
    () => exportStaticBackup(source, metadata, { inspect: (snapshot) => refuseLiveGeneration(snapshot, locks!) }), options);
}
