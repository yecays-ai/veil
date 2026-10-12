import { BackupCoordinator, type BackupLockManager, type BackupLockOptions } from "./coordination";
import { BackupValidationError } from "./format";
import { RESTORE_JOURNAL_KEY } from "./restore-journal";

export type PersistenceWriteGate = Pick<BackupCoordinator, "withWrite">;

declare const scopeBrand: unique symbol;
export type PersistenceWriteScope = { readonly [scopeBrand]: true };
const scopes = new WeakMap<PersistenceWriteScope, {
  gate: PersistenceWriteGate; active: boolean; pending: Set<Promise<unknown>>;
}>();

/** One logical mutation owns the shared lease; explicitly passed scopes avoid nested requests. */
export function withPersistenceWriteScope<T>(gate: PersistenceWriteGate,
  operation: (scope: PersistenceWriteScope) => Promise<T>, options: BackupLockOptions = {}): Promise<T> {
  return gate.withWrite(async () => {
    const scope = Object.freeze({}) as PersistenceWriteScope;
    const state = { gate, active: true, pending: new Set<Promise<unknown>>() };
    scopes.set(scope, state);
    let result!: T, failure: unknown, failed = false;
    try { result = await operation(scope); }
    catch (error) { failed = true; failure = error; }
    state.active = false;
    // A child accidentally left unawaited still cannot outlive this shared lease.
    const children = await Promise.allSettled(state.pending);
    state.pending.clear();
    if (failed) throw failure;
    const rejected = children.find((child) => child.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    return result;
  }, options);
}

/** Reject forged, expired or foreign-owner scopes rather than bypassing the gate. */
export function runPersistenceWrite<T>(gate: PersistenceWriteGate, operation: () => Promise<T>,
  scope?: PersistenceWriteScope): Promise<T> {
  if (!scope) return gate.withWrite(operation);
  const state = scopes.get(scope);
  if (!state?.active || state.gate !== gate)
    return Promise.reject(new BackupValidationError("invalid-write-scope", "coordination"));
  const pending = Promise.resolve().then(operation);
  state.pending.add(pending);
  // Observe rejection immediately, but retain its outcome until the owner collects every child.
  void pending.then(() => undefined, () => undefined);
  return pending;
}

/** Preserve ordinary storage on unsupported browsers; this does not enable backup there. */
export function createPersistenceWriteGate(getLocks: () => BackupLockManager | undefined,
  getStorage: () => Pick<Storage, "getItem"> | undefined = () => typeof window === "undefined" ? undefined : window.localStorage): PersistenceWriteGate {
  return {
    withWrite<T>(operation: () => Promise<T>, options: BackupLockOptions = {}): Promise<T> {
      const locks = getLocks();
      const admitted = async () => {
        let journal: string | null;
        try { journal = getStorage()?.getItem(RESTORE_JOURNAL_KEY) ?? null; }
        catch { throw new BackupValidationError("restore-state-unavailable", "coordination"); }
        // Check after acquiring the shared lease, not before queueing: an exclusive restore may have run first.
        // Mere presence (even malformed) blocks writes; only the exclusive recovery executor may clear it.
        if (journal !== null) throw new BackupValidationError("restore-in-progress", "coordination");
        return operation();
      };
      return locks ? new BackupCoordinator(locks).withWrite(admitted, options) : admitted();
    },
  };
}

// Resolve at call time: no navigator/window access during imports or server rendering.
export const browserPersistenceWriteGate = createPersistenceWriteGate(() =>
  typeof window === "undefined" ? undefined : window.navigator?.locks);
