export type ProductBootstrapStatus = "initializing" | "ready" | "error";

export function createProductBootstrapController(
  bootstrap: () => Promise<void>,
  update: (status: ProductBootstrapStatus) => void,
) {
  let status: ProductBootstrapStatus = "initializing";
  let mounted = false;
  let running: Promise<void> | null = null;
  const publish = (next: ProductBootstrapStatus) => {
    status = next;
    if (mounted) update(next);
  };
  const run = (): Promise<void> => {
    if (running) return running;
    publish("initializing");
    const operation = Promise.resolve().then(bootstrap).then(
      () => publish("ready"),
      () => publish("error"),
    ).finally(() => { if (running === operation) running = null; });
    running = operation;
    return operation;
  };
  return {
    mount() {
      mounted = true;
      if (status === "initializing" && !running) void run();
      else update(status);
    },
    unmount() { mounted = false; },
    retry() {
      return status === "error" ? run() : running ?? Promise.resolve();
    },
  };
}
