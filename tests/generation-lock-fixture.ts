import assert from "node:assert/strict";

// Distinct clients share origin state; each callback holds its lock until its
// returned promise settles. Storage itself remains real fake IndexedDB.
export function lockOrigin() {
  const held = new Map<string, symbol>();
  const client = () => ({ request: async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    assert.equal(options.ifAvailable, true);
    const existing = held.get(name);
    if (existing) return callback(null);
    const token = Symbol(); held.set(name, token);
    try { return await callback({ name, mode: "exclusive" } as Lock); }
    finally { if (held.get(name) === token) held.delete(name); }
  } }) as unknown as LockManager;
  return { client, crash: () => held.clear(), held };
}
