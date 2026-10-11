import { generationLockName } from "../chat/generation-lock";
import { BackupCoordinator, type BackupLockManager, type BackupLockOptions } from "./coordination";
import { BackupValidationError } from "./format";
import { exportStaticBackup, type StaticBackupMetadata, type StaticBackupPackage } from "./static-export";
import type { StaticBackupSnapshot, StaticBackupSource } from "./static-source";

/**
 * A reply is live only while its session's generation lock is held. A `generation` marker without the lock
 * is a stale leftover (the tab died): it is not refused here, and the unchanged v1 validation rejects the
 * marker as invalid-data until the chat store recovers it (which opening the conversation does).
 */
async function refuseLiveGeneration(snapshot: StaticBackupSnapshot, locks: BackupLockManager): Promise<void> {
  for (const row of snapshot.chat.sessions) {
    const session = row as { id?: unknown; generation?: unknown };
    if (!session.generation || typeof session.id !== "string") continue;
    let free: boolean;
    try {
      // Probe, never wait: a held lock means a live reply; a granted one is released at once.
      free = await locks.request(generationLockName(session.id), { mode: "exclusive", ifAvailable: true }, async (lock) => !!lock);
    } catch { throw new BackupValidationError("coordination-unavailable", "chat"); }
    if (!free) throw new BackupValidationError("generation-active", "chat");
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
