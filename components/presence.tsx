import type { Presence } from "../lib/foundation-types";

const PRESENCE_LABELS: Record<Presence, string> = { online: "Online", away: "Away", busy: "Busy", dnd: "Do Not Disturb", offline: "Offline" };
export function presenceLabel(presence: Presence): string { return PRESENCE_LABELS[presence]; }

export function PresenceBadge({ presence }: { presence: Presence }) {
  return <span className={`presence-badge presence-${presence}`} aria-label={presence} title={presence} />;
}
