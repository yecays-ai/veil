"use client";
import { MEMORY_KIND_LABEL, MEMORY_ORIGIN_LABEL, MEMORY_STATUS_LABEL } from "../lib/memory/bank";
import type { Memory } from "../lib/memory/types";

/**
 * History tab: everything that is no longer an Active memory (replaced, archived or flagged) and what it was replaced by.
 * Read-only: nothing here is injected into replies, and it adds no storage of its own.
 */
export function MemoryHistory({ rows, all }: { rows: readonly Memory[]; all: readonly Memory[] }) {
  const byId = new Map(all.map((row) => [row.id, row]));
  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  if (!sorted.length) return <p className="empty-copy subtle">Nothing has been replaced or archived yet.</p>;
  return <ul className="memory-bank-list" aria-label="History">
    {sorted.map((row) => {
      const successor = row.lineage.supersededBy ? byId.get(row.lineage.supersededBy) : undefined;
      return <li key={row.id} className="profile-card">
        <p className="memory-bank-text">{row.text}</p>
        <small className="subtle">
          {[MEMORY_KIND_LABEL[row.kind] ?? row.kind, MEMORY_ORIGIN_LABEL[row.origin], MEMORY_STATUS_LABEL[row.status],
            new Date(row.updatedAt).toLocaleString()].filter(Boolean).join(" · ")}
        </small>
        {row.lineage.supersededBy && <small className="subtle memory-bank-source">
          {successor ? `Replaced by: ${successor.text}` : "Replaced by a memory that is no longer there"}
        </small>}
      </li>;
    })}
  </ul>;
}
