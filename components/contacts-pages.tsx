"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useFoundation } from "./foundation-provider";
import { Avatar } from "./profile-view";
import { PresenceBadge } from "./presence";
import { PageShell } from "./page-shell";
import { chatStorage } from "../lib/chat/storage";
import { contactMatches } from "../lib/contact-search";
import { RootAppHeader } from "./root-app-header";
import { useContacts } from "./use-contacts";
import { addContact } from "../lib/contact-storage";

export function ContactsHome() {
  const { document, ready } = useFoundation();
  const contactState = useContacts(document.characters.map((item) => item.characterId));
  const [query, setQuery] = useState("");
  const ids = new Set(contactState.document.contacts.map((item) => item.characterId));
  const contacts = document.characters.filter((character) => ids.has(character.characterId) && contactMatches(character.name, undefined, query));
  return <div className="social-root">
    <RootAppHeader title="Contacts" rightAction={<Link className="social-add" href="/contacts/add" aria-label="Add Friend"><Plus /></Link>} />
    <input className="social-search" type="search" aria-label="Search contacts"
      placeholder="Search contacts..." value={query} onChange={(event) => setQuery(event.target.value)} />
    {!ready || !contactState.ready ? <p>Loading contacts…</p> : contactState.document.contacts.length === 0 ? <p>No contacts yet.</p>
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

export function AddFriendPage() {
  const { document, ready } = useFoundation();
  const contactState = useContacts(document.characters.map((item) => item.characterId));
  const [query, setQuery] = useState(""), [notice, setNotice] = useState("");
  const ids = new Set(contactState.document.contacts.map((item) => item.characterId));
  const rows = document.characters.filter((character) => contactMatches(character.name, undefined, query));
  return <PageShell title="Add Friend" backHref="/contacts" backLabel="Back to Contacts" bodyClassName="foundation-page add-friend-page">
    <input className="social-search" type="search" aria-label="Search Characters" placeholder="Search Characters..." value={query} onChange={(event) => setQuery(event.target.value)} />
    {notice && <p role="status">{notice}</p>}
    {!ready || !contactState.ready ? <p>Loading Characters…</p> : rows.length === 0 ? <p>No Characters available.</p> : <div className="social-list">
      {rows.map((character) => { const added = ids.has(character.characterId); return <div className="social-row" key={character.characterId}>
        <span className="social-avatar"><Avatar avatar={character.avatar} name={character.name} /></span>
        <span><strong>{character.name}</strong></span>
        <button type="button" disabled={added} onClick={() => void contactState.commit((current) => addContact(current, character.characterId)).then(() => setNotice(`${character.name} added.`))}>{added ? "Added" : "+ Add"}</button>
      </div>; })}
    </div>}
  </PageShell>;
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
      await chatStorage.openSession(character.characterId);
      router.push(`/messages/${encodeURIComponent(character.characterId)}`);
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
