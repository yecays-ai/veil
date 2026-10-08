/** Longest an auxiliary request (weather, place lookup) may keep a caller waiting. */
export const AUX_REQUEST_TIMEOUT_MS = 12_000;

/**
 * Runs one request with a deadline. On timeout the request's signal is aborted and the returned promise
 * rejects, even if the request ignores its signal and never settles; whatever it does later is dropped.
 */
export function withRequestTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("The request timed out.")); // reject first: aborting makes the request fail too
      controller.abort();
    }, ms);
  });
  const request = run(controller.signal);
  request.catch(() => {}); // an abandoned request's late failure is not an unhandled rejection
  return Promise.race([request, timedOut]).finally(() => clearTimeout(timer));
}
