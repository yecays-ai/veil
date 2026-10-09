"use client";
import { useEffect, useState } from "react";
import { PageShell } from "../page-shell";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { ChatAvatar } from "./avatar";

// The read result is tagged with the session it belongs to, so a changed sessionId never shows the previous target's state.
type Outcome = { id: string } & ({ kind: "group"; session: ChatSession } | { kind: "notGroup" } | { kind: "error" });
export function GroupRoom({ sessionId }: { sessionId: string }) {
  const { document } = useFoundation();
  const [outcome, setOutcome] = useState<Outcome>();
  useEffect(() => { let active = true; void chatStorage.readSession(sessionId).then((value) => {
    if (active) setOutcome(value.session.type === "group"
      ? { id: sessionId, kind: "group", session: value.session } : { id: sessionId, kind: "notGroup" });
  }).catch(() => { if (active) setOutcome({ id: sessionId, kind: "error" }); });
    return () => { active = false; };
  }, [sessionId]);
  const current = outcome?.id === sessionId ? outcome : undefined;
  const session = current?.kind === "group" ? current.session : undefined;
  const members = (session?.participantIds ?? []).flatMap((id) => {
    const character = document.characters.find((item) => item.characterId === id); return character ? [character] : [];
  });
  return <PageShell title={session?.title ?? "Group"} backHref="/messages" backLabel="Back to Chats" bodyClassName="foundation-page group-room">
    {current?.kind === "error" ? <p role="alert">Group conversation could not be loaded.</p> : !session ? <p>{current?.kind === "notGroup" ? "This conversation is not a group." : "Loading group…"}</p> : <>
      <p className="subtle">Group messaging will be connected in a later update.</p>
      <section className="profile-card"><h2>Members</h2><div className="social-list">{members.map((character) =>
        <div className="social-row" key={character.characterId}><ChatAvatar profile={character} /><span><strong>{character.name}</strong></span></div>)}</div></section>
    </>}
  </PageShell>;
}
