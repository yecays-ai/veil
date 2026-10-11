import { BackupValidationError } from "./format";

// All cooperating tabs and all domains must use this same origin-scoped name.
export const BACKUP_LOCK_NAME = "veil.persistence.snapshot.v1";
export type BackupLockManager = Pick<LockManager, "request">;
export type BackupLockOptions = { signal?: AbortSignal; waitMs?: number };

/** Internal protocol only: existing app writers are not yet connected to this gate. */
export class BackupCoordinator {
  constructor(private readonly locks: BackupLockManager | undefined) {}

  /** Wrap the entire logical write, including every domain commit and rollback. */
  withWrite<T>(operation: () => Promise<T>, options: BackupLockOptions = {}): Promise<T> {
    return this.run("shared", operation, options);
  }

  /** Capture only after all cooperating logical writes finish; block new ones until completion. */
  withSnapshot<T>(operation: () => Promise<T>, options: BackupLockOptions = {}): Promise<T> {
    return this.run("exclusive", operation, options);
  }

  private async run<T>(mode: LockMode, operation: () => Promise<T>, options: BackupLockOptions): Promise<T> {
    const fail = (code: string): never => { throw new BackupValidationError(code, "coordination"); };
    const waitMs = options.waitMs ?? 30_000;
    if (!Number.isSafeInteger(waitMs) || waitMs <= 0 || waitMs > 300_000) return fail("invalid-lock-options");
    if (!this.locks) return fail("coordination-unavailable");
    if (options.signal?.aborted) return fail("coordination-cancelled");
    const controller = new AbortController();
    let started = false, timedOut = false;
    const cancel = () => controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, waitMs);
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await this.locks.request(BACKUP_LOCK_NAME, { mode, signal: controller.signal }, async (lock) => {
        if (controller.signal.aborted) return fail(timedOut ? "coordination-timeout" : "coordination-cancelled");
        if (!lock) return fail("coordination-unavailable");
        started = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
        // No Promise.race: a running operation must settle before the browser releases its lock.
        return await operation();
      });
    } catch (error) {
      if (started || error instanceof BackupValidationError) throw error;
      return fail(timedOut ? "coordination-timeout" : controller.signal.aborted ? "coordination-cancelled" : "coordination-unavailable");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
}
