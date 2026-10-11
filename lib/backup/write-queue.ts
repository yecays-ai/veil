import { browserPersistenceWriteGate, withPersistenceWriteScope, type PersistenceWriteGate, type PersistenceWriteScope } from "./persistence-write-gate";

/**
 * Serializes a Provider's writes with the lock order backup lease → Provider queue → storage.
 * A caller that already owns a lease passes its scope and joins the queue directly. An unscoped caller
 * takes its own shared lease first and only then enters the queue. Entering the queue first would let an
 * exclusive snapshot, queued behind a scoped writer that is itself waiting in this queue, block the
 * unscoped write's lease request: a cycle. Queue entry follows lease grant order, which is request order.
 */
export function runQueuedWrite<T>(
  queue: { current: Promise<unknown> },
  job: (scope: PersistenceWriteScope) => Promise<T>,
  scope?: PersistenceWriteScope,
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate,
): Promise<T> {
  const enqueue = (owned: PersistenceWriteScope) => {
    const operation = queue.current.then(() => job(owned));
    queue.current = operation.then(() => {}, () => {});
    return operation;
  };
  return scope ? enqueue(scope) : withPersistenceWriteScope(writeGate, enqueue);
}
