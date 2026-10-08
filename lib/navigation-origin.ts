// The in-app source of the most recent forward navigation. Back follows real history when the
// page was reached from inside the app; a direct entry or reload has no record and uses its
// parent fallback. Lives only in this tab's JS memory, so it never persists or crosses tabs.
type Origin = { from: string; to: string; state?: unknown };
let origin: Origin | null = null;
let returnState: { from: string; state: unknown } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function rememberNavigationOrigin(from: string, to: string, state?: unknown) {
  origin = { from, to };
  returnState = state === undefined ? null : { from, state };
  notify();
}

/** True when `path` was reached by an in-app forward navigation, so history Back is safe. */
export function arrivedFromApp(path: string): boolean {
  return origin?.to === path;
}

export function peekReturnState<T>(from: string): T | undefined {
  return returnState?.from === from ? returnState.state as T : undefined;
}

export function clearReturnState(from: string) {
  if (returnState?.from === from) returnState = null;
}

export function subscribeNavigationOrigin(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetNavigationOriginForTests() { origin = null; returnState = null; listeners.clear(); }
