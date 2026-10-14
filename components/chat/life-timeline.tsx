"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type Ref } from "react";
import type { Character } from "../../lib/foundation-types";
import { lifeActivityStatus, lifeTimeline, type LifeActivity } from "../../lib/life/activity";
import { reconcileProjectedLife } from "../../lib/life/plan";
import { livePresence } from "../../lib/presence/live";
import { browserPresenceStorage, presenceRecord, setLifeState } from "../../lib/presence/storage";

function formatTime(value: number, timezone: string | null) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone: timezone ?? undefined, hour: "numeric", minute: "2-digit" }).format(value); }
  catch { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value); }
}

function TimelineItem({ item, now, timezone }: { item: LifeActivity; now: number; timezone: string | null }) {
  const status = lifeActivityStatus(item, now);
  return <article className={`life-timeline-item life-timeline-${status}`}>
    <span className="life-timeline-dot" aria-hidden="true" />
    <div className="life-timeline-content">
      <time dateTime={new Date(item.startsAt).toISOString()}>{formatTime(item.startsAt, timezone)}–{formatTime(item.endsAt, timezone)}</time>
      <h2>{item.title}</h2>
      {item.moment && <p>{item.moment}</p>}
    </div>
  </article>;
}

export function LifeTimelineScreen({ screenRef, character, onBack }: {
  screenRef: Ref<HTMLElement>; character: Pick<Character, "characterId" | "name" | "timezone">; onBack: () => void;
}) {
  const snapshot = useSyncExternalStore(livePresence.subscribe, livePresence.getSnapshot, livePresence.getServerSnapshot);
  const [now, setNow] = useState(() => Date.now()), [writeError, setWriteError] = useState("");
  const record = presenceRecord(snapshot.document, character.characterId);
  const timeline = useMemo(() => lifeTimeline(record?.life, now), [record?.life, now]);
  const items = [...timeline.completed].reverse().concat(timeline.current ? [timeline.current] : [], timeline.upcoming);

  useEffect(() => {
    if (!snapshot.ready) return;
    const at = Date.now();
    void browserPresenceStorage.transact((document) => {
      const latest = presenceRecord(document, character.characterId);
      if (!latest?.routine && !latest?.situations.length && !latest?.life) return document;
      const life = reconcileProjectedLife(latest?.life, { characterId: character.characterId, timezone: character.timezone,
        routine: latest?.routine?.routine ?? null, situations: latest?.situations ?? [] }, at);
      return setLifeState(document, character.characterId, life);
    }).catch(() => setWriteError("Life could not be refreshed. Existing activity is still shown."));
  }, [snapshot.ready, character.characterId, character.timezone]);

  useEffect(() => {
    const edge = items.flatMap((item) => [item.startsAt, item.endsAt]).filter((value) => value > now).sort((a, b) => a - b)[0];
    if (!edge) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.max(1_000, edge - Date.now()), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [items, now]);

  return <section ref={screenRef} className="chat-info-screen" role="dialog" aria-modal="true" aria-label={`${character.name}'s Life`}>
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to Chat Info" onClick={onBack}><ChevronLeft aria-hidden="true" /></button>
      <h1>Life</h1><span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body life-timeline-body">
      <p className="life-timeline-intro">A simple glimpse of what {character.name} has been doing.</p>
      {(snapshot.error || writeError) && <p className="chat-notice chat-setting-error" role="alert">{snapshot.error || writeError}</p>}
      {!snapshot.ready ? <p className="chat-info-search-unavailable" role="status">Loading Life…</p> : items.length ?
        <div className="life-timeline" aria-label={`${character.name}'s activity timeline`}>
          {items.map((item) => <TimelineItem key={item.id} item={item} now={now} timezone={character.timezone} />)}
        </div> : <div className="life-timeline-empty"><strong>No activity yet.</strong><span>Life will appear after a routine or situation is available.</span></div>}
    </div>
  </section>;
}
