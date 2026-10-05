"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFoundation } from "./foundation-provider";
import { Avatar } from "./profile-view";
import { PresenceBadge } from "./presence";
import { PageShell } from "./page-shell";
import { chatStorage } from "../lib/chat/storage";
import { contactMatches } from "../lib/contact-search";
import { RootAppHeader } from "./root-app-header";

export function ContactsHome() {
  const { document, ready } = useFoundation();
  const [query, setQuery] = useState("");
  const contacts = document.characters.filter((character) => contactMatches(character.name, undefined, query));
  return <div className="social-root">
    <RootAppHeader title="Contacts" />
    <input className="social-search" type="search" aria-label="Search contacts"
      placeholder="Search contacts..." value={query} onChange={(event) => setQuery(event.target.value)} />
    {!ready ? <p>Loading contacts…</p> : document.characters.length === 0 ? <p>No contacts yet.</p>
      : contacts.length === 0 ? <p>No matching contacts.</p> : <div className="social-list">
        {contacts.map((character) => <Link className="social-row" key={character.characterId}
          href={`/contacts/${encodeURIComponent(character.characterId)}`}>
          <span className="social-avatar"><Avatar avatar={character.avatar} name={character.name} />
            <PresenceBadge presence={character.presence} /></span>
          <span><strong>{character.name}</strong>
            {character.statusMessage && <small>{character.statusMessage}</small>}</span>
        </Link>)}
      </div>}
  </div>;
}

export function ContactProfile({ characterId }: { characterId: string }) {
  const { document, ready } = useFoundation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const character = document.characters.find((item) => item.characterId === characterId);
  async function message() {
    if (!character || busy) return;
    setBusy(true); setError("");
    try {
      const session = await chatStorage.openSession(character.characterId);
      router.push(`/messages/conversation/${encodeURIComponent(session.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Conversation could not be opened.");
      setBusy(false);
    }
  }
  return <PageShell title={character?.name ?? "Contact"} backHref="/contacts" backLabel="Back to Contacts"
    bodyClassName="foundation-page contact-profile">
    {!ready ? <p>Loading contact…</p> : !character ? <p>Contact not found.</p> : <>
      <div className="profile-hero"><span className="social-avatar social-avatar-large">
        <Avatar avatar={character.avatar} name={character.name} large />
        <PresenceBadge presence={character.presence} /></span>
        <h1>{character.name}</h1>
        {character.statusMessage && <p>{character.statusMessage}</p>}
        <button type="button" className="primary-button" disabled={busy} onClick={() => void message()}>Message</button>
      </div>
      {character.occupation && <section className="profile-card"><h2>Occupation</h2><p>{character.occupation}</p></section>}
      {character.location?.label && <section className="profile-card"><h2>Location</h2><p>{character.location.label}</p></section>}
      {error && <p role="alert">{error}</p>}
    </>}
  </PageShell>;
}
