import type { Memory, MemorySource, Suppression } from "./types";

/** Pure, bounded by this Character's rows. Corrupt affected components are quarantined, never guessed back alive. */
export function cleanMemoryLineage(input: readonly Memory[], suppressions: readonly Suppression[],
  hit: (source: MemorySource) => boolean, now: number, isolated: readonly string[] = []): { rows: Memory[]; deleted: string[]; isolated: string[]; incomplete: boolean } {
  const originals = new Map(input.map((row) => [row.id, row]));
  const rows = new Map(input.map((row) => [row.id, structuredClone(row)]));
  const touched = new Set([...input.filter((row) => row.sources.some(hit)).map((row) => row.id), ...isolated]);
  const adjacency = new Map(input.map((row) => [row.id, new Set<string>()])), broken = new Set<string>();
  const link = (from: string, to: string) => {
    if (!rows.has(to) || from === to) { broken.add(from); return; }
    adjacency.get(from)!.add(to); adjacency.get(to)!.add(from);
  };
  for (const row of input) {
    if (row.lineage.supersededBy) link(row.id, row.lineage.supersededBy);
    for (const id of row.lineage.mergedFrom ?? []) {
      link(row.id, id);
      if (rows.get(id)?.lineage.supersededBy !== row.id) broken.add(row.id);
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { for (const member of visiting) broken.add(member); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const next = rows.get(id)?.lineage.supersededBy;
    if (next && rows.has(next)) visit(next);
    visiting.delete(id); visited.add(id);
  };
  for (const id of rows.keys()) visit(id);
  const quarantined = new Set<string>(), seen = new Set<string>();
  for (const id of rows.keys()) {
    if (seen.has(id)) continue;
    const component = new Set<string>(), queue = [id];
    while (queue.length) {
      const current = queue.pop()!;
      if (component.has(current)) continue;
      component.add(current); seen.add(current);
      queue.push(...adjacency.get(current)!);
    }
    if ([...component].some((key) => rows.get(key)?.origin === "auto")
      && [...component].some((key) => touched.has(key)) && [...component].some((key) => broken.has(key)))
      for (const key of component) quarantined.add(key);
  }
  for (const row of rows.values()) {
    if (touched.has(row.id)) { row.sources = row.sources.filter((source) => !hit(source)); row.updatedAt = Math.max(now, row.updatedAt + 1); }
    if (quarantined.has(row.id) && row.origin === "auto") { row.status = "flagged"; row.updatedAt = Math.max(now, row.updatedAt + 1); }
  }
  const deleted = new Set<string>();
  for (const row of rows.values()) if (touched.has(row.id) && row.origin === "auto" && !row.sources.length && !quarantined.has(row.id)) deleted.add(row.id);
  // Unwind all layers of affected auto merges; manual edits are authoritative even with historical lineage.
  let changed = true;
  const affected = new Set(touched);
  while (changed) {
    changed = false;
    for (const row of rows.values()) if (row.origin === "auto" && row.lineage.mergedFrom?.length && !quarantined.has(row.id)
      && (affected.has(row.id) || row.lineage.mergedFrom.some((id) => affected.has(id)))) {
      if (!deleted.has(row.id)) { deleted.add(row.id); changed = true; }
      if (!affected.has(row.id)) { affected.add(row.id); changed = true; }
    }
  }
  const suppressed = new Set(suppressions.filter((row) => !row.sources.length || row.sources.some((source) => !hit(source))).map((row) => row.fingerprint));
  // Resolve successors first. Nested chains retain a live terminal update rather than resurrecting every ancestor.
  const terminalAlive = (id: string): boolean => {
    const row = rows.get(id);
    if (!row || quarantined.has(id)) return false;
    const next = row.lineage.supersededBy;
    if (next && terminalAlive(next)) return true;
    return !deleted.has(id);
  };
  for (const row of rows.values()) {
    if (deleted.has(row.id) || quarantined.has(row.id) || row.origin === "manual") continue;
    const successor = row.lineage.supersededBy;
    if (!successor || !deleted.has(successor)) continue;
    let surviving = rows.get(successor);
    while (surviving && deleted.has(surviving.id) && surviving.lineage.supersededBy) surviving = rows.get(surviving.lineage.supersededBy);
    if (surviving && !deleted.has(surviving.id)) {
      row.lineage.supersededBy = surviving.id;
      row.updatedAt = Math.max(now, row.updatedAt + 1);
      continue;
    }
    const { supersededBy: _next, previousStatus, ...lineage } = row.lineage;
    void _next;
    row.lineage = lineage;
    const manual = input.some((other) => other.origin === "manual" && other.fingerprint === row.fingerprint);
    const covered = [...rows.values()].some((other) => other.id !== row.id && !deleted.has(other.id)
      && ["active", "flagged"].includes(other.status) && other.fingerprint === row.fingerprint);
    if (!suppressed.has(row.fingerprint) && !manual && !covered && !terminalAlive(successor)) row.status = previousStatus ?? "active";
    row.updatedAt = Math.max(now, row.updatedAt + 1);
  }
  // Only changed rows need writes. Untouched Characters and user-authored text are outside this function.
  return { rows: [...rows.values()].filter((row) => !deleted.has(row.id) && JSON.stringify(row) !== JSON.stringify(originals.get(row.id))),
    deleted: [...deleted], isolated: [...quarantined].sort(), incomplete: quarantined.size > 0 };
}
