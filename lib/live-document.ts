export type LiveDocumentSnapshot<T> = { document: T; ready: boolean; error: string };

/** One lazy app-session read owner; durable writes remain owned by storage. */
export function createLiveDocument<T>(options: {
  initial: T; load: () => Promise<T>; key: string; event: string; error: string;
  readyOnError?: boolean; getWindow?: () => Window;
}) {
  const initial: LiveDocumentSnapshot<T> = { document: options.initial, ready: false, error: "" };
  let snapshot = initial;
  let hydrated = false;
  let revision = 0;
  let pending: Promise<void> | undefined;
  let completedRevision = -1;
  let owner: Window | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: LiveDocumentSnapshot<T>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const load = (): Promise<void> => {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      let observed: number;
      do {
        observed = revision;
        try {
          const document = await options.load();
          if (observed !== revision) continue;
          hydrated = true;
          publish({ document, ready: true, error: "" });
        } catch {
          if (observed !== revision) continue;
          publish({ ...snapshot, ready: snapshot.ready || !!options.readyOnError, error: options.error });
        }
      } while (observed !== revision);
      completedRevision = observed;
    }).finally(() => {
      pending = undefined;
      if (completedRevision !== revision) return load();
    });
    return pending;
  };
  const refresh = () => { revision++; return load(); };
  const storageChanged = (event: StorageEvent) => {
    if ((event.key === options.key || event.key === null) &&
      (event.storageArea === null || event.storageArea === owner?.localStorage)) void refresh();
  };
  const changed = () => { void refresh(); };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!owner) {
      owner = options.getWindow ? options.getWindow() : window;
      owner.addEventListener(options.event, changed);
      owner.addEventListener("storage", storageChanged);
    }
    if (!hydrated || snapshot.error) void load();
    // Retain scoped listeners for the app session, including gaps between routes.
    return () => { listeners.delete(listener); };
  };
  return { subscribe, getSnapshot: () => snapshot, getServerSnapshot: () => initial, retry: load };
}
