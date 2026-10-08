import type { TestContext } from "node:test";

/** Observe cancellation separately from callbacks that merely ignore stale work.
 * Install after enabling node:test's mock timers so tick() still drives the clock.
 */
export function observeTimeouts(context: TestContext) {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const timers: { handle: ReturnType<typeof setTimeout>; cancelled: boolean; fired: boolean }[] = [];
  context.mock.method(globalThis, "setTimeout", (callback: (...args: unknown[]) => void,
    delay?: number, ...args: unknown[]) => {
    const entry = { handle: undefined as unknown as ReturnType<typeof setTimeout>, cancelled: false, fired: false };
    entry.handle = originalSet(() => { entry.fired = true; callback(...args); }, delay);
    timers.push(entry);
    return entry.handle;
  });
  context.mock.method(globalThis, "clearTimeout", (handle: Parameters<typeof clearTimeout>[0]) => {
    originalClear(handle);
    const entry = timers.find((timer) => timer.handle === handle);
    if (entry) entry.cancelled = true;
  });
  return timers;
}

/** A read settling is not its consumer's continuation completing. Yield a task
 * after settlement while spies/DOM owners are still installed. Bound failures.
 */
export async function drainContinuation(pending: Promise<unknown>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pending.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0))),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within 2s`)), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
