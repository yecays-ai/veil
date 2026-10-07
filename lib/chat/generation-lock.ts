// Web Locks survive navigation in another tab and are released by the browser
// when their owning document dies. A persisted flag alone cannot prove liveness.
const testLocks = new WeakMap<IDBFactory, Set<string>>();
export async function acquireGenerationLock(factory: IDBFactory, sessionId: string,
  manager: LockManager | undefined): Promise<(() => Promise<void>) | null> {
  if (!manager) {
    // Only the Node/fake-IndexedDB test runtime uses an in-process lock bank.
    // Unsupported browsers fail closed rather than claiming cross-tab safety.
    if (typeof window !== "undefined" || typeof process === "undefined" || !process.versions?.node)
      throw new Error("Safe chat generation requires a browser with Web Locks support.");
    const bank = testLocks.get(factory) ?? new Set<string>();
    testLocks.set(factory, bank);
    if (bank.has(sessionId)) return null;
    bank.add(sessionId);
    return async () => { bank.delete(sessionId); };
  }
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let ready!: (value: boolean) => void;
  let failed!: (error: unknown) => void;
  const acquired = new Promise<boolean>((resolve, reject) => { ready = resolve; failed = reject; });
  const lifetime = manager.request(`veil-chat-v2:generation:${sessionId}`,
    { mode: "exclusive", ifAvailable: true }, async (lock) => {
      ready(!!lock);
      if (lock) await held;
    });
  void lifetime.catch(failed);
  if (!await acquired) { await lifetime; return null; }
  return async () => { release(); await lifetime; };
}
