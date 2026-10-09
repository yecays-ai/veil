export function createRegexReadGuard() {
  let revision = 0;
  return {
    next() {
      return ++revision;
    },
    isCurrent(requestRevision: number) {
      return requestRevision === revision;
    },
    invalidate() {
      revision++;
    },
  };
}
