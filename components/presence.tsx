import type { Presence } from "../lib/foundation-types";

export function PresenceBadge({ presence }: { presence: Presence }) {
  return <span className={`presence-badge presence-${presence}`} aria-label={presence} title={presence} />;
}
