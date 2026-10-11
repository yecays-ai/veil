import { BackupCoordinator, type BackupLockManager, type BackupLockOptions } from "./coordination";

export type PersistenceWriteGate = Pick<BackupCoordinator, "withWrite">;

/** Preserve ordinary storage on unsupported browsers; this does not enable backup there. */
export function createPersistenceWriteGate(getLocks: () => BackupLockManager | undefined): PersistenceWriteGate {
  return {
    withWrite<T>(operation: () => Promise<T>, options: BackupLockOptions = {}): Promise<T> {
      const locks = getLocks();
      return locks ? new BackupCoordinator(locks).withWrite(operation, options) : operation();
    },
  };
}

// Resolve at call time: no navigator/window access during imports or server rendering.
export const browserPersistenceWriteGate = createPersistenceWriteGate(() =>
  typeof window === "undefined" ? undefined : window.navigator?.locks);
