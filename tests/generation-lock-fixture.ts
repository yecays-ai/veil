// Distinct clients share origin state; each callback holds its lock until its
// returned promise settles. Storage itself remains real fake IndexedDB.
export function lockOrigin() {
  const held = new Map<string, symbol>();
  const readers = new Map<string, Set<symbol>>();
  type Waiting = { mode: LockMode; grant: () => void; signal?: AbortSignal; abort: () => void };
  const queues = new Map<string, Waiting[]>();
  const available = (name: string, mode: LockMode) => !held.has(name) && (mode === "shared" || !readers.get(name)?.size);
  function drain(name: string) {
    const queue = queues.get(name);
    while (queue?.length && available(name, queue[0].mode)) {
      const entry = queue.shift()!; entry.signal?.removeEventListener("abort", entry.abort); entry.grant();
    }
    if (!queue?.length) queues.delete(name);
  }
  const client = () => ({ request: async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    const mode = options.mode ?? "exclusive";
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (options.ifAvailable && (queues.get(name)?.length || !available(name, mode))) return callback(null);
    return new Promise((resolve, reject) => {
      const entry: Waiting = { mode, signal: options.signal,
        abort() {
          const queue = queues.get(name), index = queue?.indexOf(entry) ?? -1;
          if (index >= 0) queue!.splice(index, 1);
          reject(new DOMException("Cancelled", "AbortError")); drain(name);
        },
        grant() {
          const token = Symbol();
          if (mode === "exclusive") held.set(name, token);
          else { const active = readers.get(name) ?? new Set<symbol>(); active.add(token); readers.set(name, active); }
          Promise.resolve().then(() => callback({ name, mode } as Lock)).then(resolve, reject).finally(() => {
            if (mode === "exclusive") { if (held.get(name) === token) held.delete(name); }
            else { readers.get(name)?.delete(token); if (!readers.get(name)?.size) readers.delete(name); }
            drain(name);
          });
        } };
      options.signal?.addEventListener("abort", entry.abort, { once: true });
      const queue = queues.get(name) ?? []; queue.push(entry); queues.set(name, queue); drain(name);
    });
  } }) as unknown as LockManager;
  return { client, crash: () => { held.clear(); readers.clear(); for (const name of queues.keys()) drain(name); }, held };
}
