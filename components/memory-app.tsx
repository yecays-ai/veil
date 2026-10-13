"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { countActiveMemories } from "../lib/memory/bank";
import { browserMemoryStorage } from "../lib/memory/browser";
import type { MemoryStorage } from "../lib/memory/storage";
import { useFoundation } from "./foundation-provider";
import { MemoryBankPage } from "./memory-bank";
import { PageShell } from "./page-shell";
import { Avatar } from "./profile-view";

const href = (characterId: string) => `/memory/${encodeURIComponent(characterId)}`;

/** Memory App home: every Character with its Active count. One Character goes straight to its page. */
export function MemoryAppPage({ storage = browserMemoryStorage }: { storage?: MemoryStorage }) {
  const { document, ready } = useFoundation();
  const router = useRouter();
  const characters = document.characters;
  // undefined = not read yet, null = the read failed (never shown as 0).
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const single = ready && characters.length === 1 ? characters[0].characterId : null;
  useEffect(() => { if (single) router.replace(href(single)); }, [single, router]);
  const ids = characters.map((c) => c.characterId).join("\n");
  useEffect(() => {
    if (!ready || single) return;
    let active = true;
    const read = () => {
      for (const characterId of ids.split("\n").filter(Boolean))
        storage.listMemories(characterId).then((rows) => countActiveMemories(rows), () => null)
          .then((count) => { if (active) setCounts((prev) => ({ ...prev, [characterId]: count })); });
    };
    read();
    const visible = () => { if (window.document.visibilityState === "visible") read(); };
    window.document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.document.removeEventListener("visibilitychange", visible); };
  }, [ready, single, ids, storage]);
  return (
    <PageShell title="Memory" backHref="/" backLabel="Back to Home" bodyClassName="foundation-page">
      {!ready || single ? <p>{C.common.loading}</p>
        : !characters.length ? <p className="empty-copy subtle">{C.characters.empty}</p>
        : <ul className="character-list">
          {characters.map((c) => {
            const count = counts[c.characterId];
            return <li key={c.characterId}>
              <Link className="character-link" href={href(c.characterId)}>
                <Avatar avatar={c.avatar} name={c.name} />
                <span className="contact-details">
                  <strong>{c.name}</strong>
                  <small className="subtle">{count === undefined ? "Loading…" : count === null ? "Unavailable" : `${count} ${count === 1 ? "memory" : "memories"}`}</small>
                </span>
                <span className="subtle" aria-hidden="true">›</span>
              </Link>
            </li>;
          })}
        </ul>}
    </PageShell>
  );
}

/** One Character's memory page. Back returns to the list, or Home when there is only one Character. */
export function MemoryCharacterPage({ characterId, storage = browserMemoryStorage }: { characterId: string; storage?: MemoryStorage }) {
  const { document } = useFoundation();
  const single = document.characters.length === 1;
  return <MemoryBankPage characterId={characterId} storage={storage}
    backHref={single ? "/" : "/memory"} backLabel={single ? "Back to Home" : "Back to Memory"} />;
}
