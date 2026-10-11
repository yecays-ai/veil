"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { livePresence } from "../lib/presence/live";
import { advanceLastSeen, browserPresenceStorage, presenceRecord } from "../lib/presence/storage";
import { presenceText, presenceView } from "../lib/presence/view";
import type { Presence } from "../lib/foundation-types";

const LAST_SEEN_REFRESH_MS = 60_000;
export type CharacterPresence = { ready: boolean; status: Presence; text: string };

/**
 * The shared Presence reading for one Character. Until the stored data has loaded it reports `ready: false` with
 * empty text, so server and first client render agree and no surface shows a guessed status. It refreshes once at
 * the next status change, and at most once a minute when the caller shows Last Seen; the timer is owned by the
 * caller's mount. With `lastSeen` it also persists a later derived online time (never while online, never lower).
 */
export function useCharacterPresence(character: { characterId: string; timezone: string | null } | undefined,
  options: { lastSeen?: boolean } = {}): CharacterPresence {
  const snapshot = useSyncExternalStore(livePresence.subscribe, livePresence.getSnapshot, livePresence.getServerSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const characterId = character?.characterId, timezone = character?.timezone ?? null, lastSeen = !!options.lastSeen;
  const record = characterId ? presenceRecord(snapshot.document, characterId) : undefined;
  const view = useMemo(() => characterId ? presenceView({ characterId, timezone }, record, now) : null,
    [characterId, timezone, record, now]);
  const nextChangeAt = view?.nextChangeAt ?? null;
  useEffect(() => {
    if (!snapshot.ready || !characterId) return;
    // Wake at the next status change, and for Last Seen text once a minute.
    const current = Date.now();
    const untilChange = nextChangeAt === null ? Infinity : Math.max(1_000, nextChangeAt - current);
    const delay = Math.min(untilChange, lastSeen ? LAST_SEEN_REFRESH_MS : Infinity, 2 ** 31 - 1);
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [snapshot.ready, characterId, nextChangeAt, lastSeen, now]);
  const derivedOnlineAt = view?.status === "online" ? null : view?.derivedOnlineAt ?? null;
  const storedOnlineAt = record?.lastOnlineAt ?? null;
  useEffect(() => {
    if (!lastSeen || !snapshot.ready || !characterId || derivedOnlineAt === null) return;
    if (storedOnlineAt !== null && derivedOnlineAt <= storedOnlineAt) return;
    void browserPresenceStorage.transact((document) => advanceLastSeen(document, characterId, { lastOnlineAt: derivedOnlineAt }, Date.now()))
      .catch(() => { /* Last Seen is derived again on the next view; a failed write loses nothing. */ });
  }, [lastSeen, snapshot.ready, characterId, derivedOnlineAt, storedOnlineAt]);
  if (!view || !snapshot.ready) return { ready: false, status: "offline", text: "" };
  return { ready: true, status: view.status, text: presenceText(view, now) };
}
