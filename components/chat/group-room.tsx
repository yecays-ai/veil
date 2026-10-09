"use client";
import { useEffect, useState } from "react";
import { PageShell } from "../page-shell";
import { useFoundation } from "../foundation-provider";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { ChatAvatar } from "./avatar";

export function GroupRoom({ sessionId }: { sessionId: string }) {
  const { document } = useFoundation();
  const [session, setSession] = useState<ChatSession>(), [error, setError] = useState(""), [notGroup, setNotGroup] = useState(false);
  useEffect(() => { let active = true; void chatStorage.readSession(sessionId).then((value) => {
    if (!active) return;
    if (value.session.type === "group") setSession(value.session); else setNotGroup(true);
  }).catch(() => { if (active) setError("Group conversation could not be loaded."); });
    return () => { active = false; };
  }, [sessionId]);
  const members = (session?.participantIds ?? []).flatMap((id) => {
    const character = document.characters.find((item) => item.characterId === id); return character ? [character] : [];
  });
  return <PageShell title={session?.title ?? "Group"} backHref="/messages" backLabel="Back to Chats" bodyClassName="foundation-page group-room">
    {error ? <p role="alert">{error}</p> : !session ? <p>{notGroup ? "This conversation is not a group." : "Loading group…"}</p> : <>
      <p className="subtle">Group messaging will be connected in a later update.</p>
      <section className="profile-card"><h2>Members</h2><div className="social-list">{members.map((character) =>
        <div className="social-row" key={character.characterId}><ChatAvatar profile={character} /><span><strong>{character.name}</strong></span></div>)}</div></section>
    </>}
  </PageShell>;
}
