import type { BackupLockManager } from "../backup/coordination";
import { MAINTENANCE_MAX_SAFE_CLAIMS } from "./maintenance-capacity";
import { validMemoryProgress } from "./progress-types";
import { request, type MemoryStorage } from "./storage";
import type { MemoryCursor } from "./types";

/**
 * User action: a failed range that already used its automatic requests gets exactly one more. Only `attempts` changes (to one below the
 * cap); range, sources and candidates stay, and the normal trigger and one-retry-per-run rule decide when it is sent.
 * Returns how many ranges were released, or undefined when maintenance for the Character is running elsewhere.
 */
export async function allowFailedRetry(memory: MemoryStorage, locks: BackupLockManager, characterId: string): Promise<number | undefined> {
  const limit = MAINTENANCE_MAX_SAFE_CLAIMS - 1;
  return locks.request(`veil-memory:${characterId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return undefined;
    return memory.withExclusive(async (scope) => {
      let released = 0;
      for (const row of await memory.listCursors(characterId, scope)) {
        const exhausted = (cursor: MemoryCursor | undefined) => cursor?.extraction && cursor.clearRequestedAt === undefined && validMemoryProgress(cursor.extraction)
          ? cursor.extraction.batches.filter((b) => b.state === "failed" && b.attempts > limit) : [];
        if (!exhausted(row).length) continue;
        released += await memory.transaction("readwrite", async (tx) => {
          const current = await request<MemoryCursor | undefined>(tx.store("cursors").get(row.id)), batches = exhausted(current);
          if (!current || !batches.length) return 0;
          for (const batch of batches) batch.attempts = limit;
          await request(tx.store("cursors").put({ ...current, updatedAt: memory.now() }));
          return batches.length;
        }, scope);
      }
      return released;
    });
  });
}
