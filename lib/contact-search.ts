export function contactMatches(name: string, nickname: string | undefined, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [name, nickname ?? ""].some((value) => value.toLocaleLowerCase().includes(needle));
}
