"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Circle, CircleCheck, Plus } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useFoundation } from "./foundation-provider";
import { Avatar } from "./profile-view";
import { PresenceBadge } from "./presence";
import { PageShell } from "./page-shell";
import { chatStorage } from "../lib/chat/storage";
import { contactMatches } from "../lib/contact-search";
import { RootAppHeader } from "./root-app-header";
import { useContacts } from "./use-contacts";
import { addContact, contactDisplayName } from "../lib/contact-storage";
import { ContactInfo } from "./contact-info";
import { contactReturnSourceFromQuery } from "../lib/contact-navigation";
import { contactIdsFromQuery, contactSelectionState, type ContactSelectionMode } from "../lib/contact-route-state";
import { recordChatDiagnostic } from "../lib/diagnostics/chat-first-paint";

export function ContactsRoute() {
  const { mode, initialSelection } = contactSelectionState(useSearchParams());
  return <ContactsHome mode={mode} initialSelection={initialSelection} />;
}

export function CreateGroupRoute() {
  const characterIds = contactIdsFromQuery(useSearchParams());
  return <CreateGroupPage characterIds={characterIds} />;
}

function contactsSelectionHref(mode: ContactSelectionMode, characterIds: readonly string[] = []) {
  const params = new URLSearchParams({ mode });
  characterIds.forEach((id) => params.append("contact", id));
  return `/contacts?${params.toString()}`;
}

function createGroupHref(characterIds: readonly string[]) {
  const params = new URLSearchParams();
  characterIds.forEach((id) => params.append("contact", id));
  return `/contacts/create-group?${params.toString()}`;
}

function ContactLoadError({ error, retry }: { error: string; retry: () => Promise<void> }) {
  return <>
    <p role="alert">{error}</p>
    <button type="button" className="settings-button" onClick={() => void retry()}>Retry</button>
  </>;
}

export function ContactsHome({ mode, initialSelection = [] }: {
  mode?: ContactSelectionMode;
  initialSelection?: string[];
}) {
  const { document, ready } = useFoundation();
  const router = useRouter();
  const contactState = useContacts();
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(initialSelection);
  const [openingId, setOpeningId] = useState(""), [error, setError] = useState("");
  const ids = new Set(contactState.document.contacts.map((item) => item.characterId));
  const contactByCharacter = new Map(contactState.document.contacts.map((item) => [item.characterId, item]));
  const contacts = document.characters.filter((character) => ids.has(character.characterId)
    && contactMatches(character.name, contactByCharacter.get(character.characterId)?.remark ?? undefined, query));
  const selectedContacts = [...new Set(selected.filter((id) => ids.has(id)))];
  function openDirect(characterId: string) {
    if (openingId) return;
    setOpeningId(characterId); setError("");
    const target = `/messages/${encodeURIComponent(characterId)}`;
    recordChatDiagnostic("navigation-call", { target, characterId });
    router.push(target);
  }
  function toggleSelected(characterId: string) {
    setSelected((current) => current.includes(characterId)
      ? current.filter((id) => id !== characterId) : [...current, characterId]);
  }
  const title = mode === "single" ? "New Message" : mode === "multi" ? "New Group" : "Contacts";
  return <div className="social-root">
    <RootAppHeader title={title} backHref={mode ? "/messages" : "/"}
      backLabel={mode ? "Back to Messages" : "Back to Home"}
      rightAction={!mode && <Link className="social-add" href="/contacts/add" aria-label="Add Contact" title="Add Contact"><Plus /></Link>} />
    <input className="social-search" type="search" aria-label="Search contacts"
      placeholder="Search contacts..." value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert">{error}</p>}
    {!ready || !contactState.ready ? <p>Loading contacts…</p> : contactState.error
      ? <ContactLoadError error={contactState.error} retry={contactState.retry} />
      : contactState.document.contacts.length === 0 ? <p>No contacts yet.</p>
      : contacts.length === 0 ? <p>No matching contacts.</p> : <div className="social-list">
        {contacts.map((character) => {
          const content = <><span className="social-avatar"><Avatar avatar={character.avatar} name={character.name} />
            <PresenceBadge presence={character.presence} /></span>
            <span><strong>{contactDisplayName(contactByCharacter.get(character.characterId), character.name)}</strong>
              {character.statusMessage && <small>{character.statusMessage}</small>}</span>
            {mode === "multi" && <span className="contact-selection-mark" aria-hidden="true">
              {selectedContacts.includes(character.characterId) ? <CircleCheck /> : <Circle />}
            </span>}
          </>;
          if (mode === "single") return <button className="social-row contact-select-row" type="button" key={character.characterId}
            data-chat-navigation={`/messages/${encodeURIComponent(character.characterId)}`}
            disabled={!!openingId} onClick={() => openDirect(character.characterId)}>{content}</button>;
          if (mode === "multi") return <button className="social-row contact-select-row" type="button" key={character.characterId}
            aria-pressed={selectedContacts.includes(character.characterId)} onClick={() => toggleSelected(character.characterId)}>{content}</button>;
          return <Link className="social-row" key={character.characterId}
            href={`/contacts/${encodeURIComponent(character.characterId)}`}>{content}</Link>;
        })}
      </div>}
    {mode === "multi" && <div className="contact-selection-footer">
      <span>{selectedContacts.length} selected</span>
      <button type="button" disabled={selectedContacts.length < 2}
        onClick={() => router.push(createGroupHref(selectedContacts))}>Next</button>
    </div>}
  </div>;
}

export function AddContactPage() {
  const { document, ready } = useFoundation();
  const contactState = useContacts();
  const [query, setQuery] = useState(""), [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null), [error, setError] = useState("");
  const submitting = useRef(false), lifetime = useRef(0);
  useEffect(() => {
    const owner = lifetime;
    return () => { owner.current++; };
  }, []);
  async function add(characterId: string, name: string) {
    if (submitting.current) return;
    submitting.current = true;
    const owner = lifetime.current;
    setPendingId(characterId); setNotice(""); setError("");
    try {
      await contactState.commit((current) => addContact(current, characterId));
      if (owner === lifetime.current) setNotice(`${name} added to Contacts.`);
    } catch (reason) {
      if (owner === lifetime.current) setError(reason instanceof Error ? reason.message : "Contact could not be added.");
    } finally {
      submitting.current = false;
      if (owner === lifetime.current) setPendingId(null);
    }
  }
  const ids = new Set(contactState.document.contacts.map((item) => item.characterId));
  const rows = document.characters.filter((character) => contactMatches(character.name, undefined, query));
  return <PageShell title="Add Contact" backHref="/contacts" backLabel="Back to Contacts" bodyClassName="foundation-page add-contact-page">
    <input className="social-search" type="search" aria-label="Search Characters" placeholder="Search Characters..." value={query} onChange={(event) => setQuery(event.target.value)} />
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!ready || !contactState.ready ? <p>Loading Characters…</p> : contactState.error
      ? <ContactLoadError error={contactState.error} retry={contactState.retry} />
      : rows.length === 0 ? <p>No Characters available.</p> : <div className="social-list">
      {rows.map((character) => { const added = ids.has(character.characterId); return <div className="social-row" key={character.characterId}>
        <span className="social-avatar"><Avatar avatar={character.avatar} name={character.name} /></span>
        <span><strong>{character.name}</strong></span>
        <button type="button" disabled={added || pendingId !== null} onClick={() => void add(character.characterId, character.name)}>{added ? "Added" : pendingId === character.characterId ? "Adding…" : "Add Contact"}</button>
      </div>; })}
    </div>}
  </PageShell>;
}

export function CreateGroupPage({ characterIds }: { characterIds: string[] }) {
  const { document, ready } = useFoundation();
  const router = useRouter();
  const contactState = useContacts();
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lifetime = useRef(0);
  useEffect(() => {
    const owner = lifetime;
    return () => { owner.current++; };
  }, []);
  const contacts = new Set(characterIds);
  const memberContactIds = new Set(contactState.document.contacts.map((contact) => contact.characterId));
  const members = document.characters.filter((character) =>
    contacts.has(character.characterId) && memberContactIds.has(character.characterId));
  const backHref = contactsSelectionHref("multi", members.map((character) => character.characterId));
  async function create() {
    if (busy || members.length < 2 || !name.trim()) return;
    const owner = lifetime.current;
    setBusy(true); setError("");
    try {
      const session = await chatStorage.createGroupSession(members.map((character) => character.characterId), name);
      if (owner === lifetime.current) router.push(`/messages/group/${encodeURIComponent(session.id)}`);
    } catch (reason) {
      if (owner === lifetime.current) {
        setError(reason instanceof Error ? reason.message : "Group could not be created.");
        setBusy(false);
      }
    }
  }
  return <PageShell title="Create Group" backHref={backHref} backLabel="Back to Contacts"
    bodyClassName="foundation-page create-group-page">
    {!ready || !contactState.ready ? <p>Loading contacts…</p> : contactState.error
      ? <ContactLoadError error={contactState.error} retry={contactState.retry} /> : <>
      <p>{members.length} contacts selected</p>
      <div className="social-list">{members.map((character) => <div className="social-row" key={character.characterId}>
        <span className="social-avatar"><Avatar avatar={character.avatar} name={character.name} /></span>
        <span><strong>{character.name}</strong></span>
      </div>)}</div>
      <label className="group-name-field"><span>Group name</span>
        <input value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={100} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" type="button" disabled={busy || members.length < 2 || !name.trim()} onClick={() => void create()}>
        {busy ? "Creating…" : "Create Group"}
      </button>
    </>}
  </PageShell>;
}

function ContactProfileFromQuery({ characterId }: { characterId: string }) {
  const returnSource = contactReturnSourceFromQuery(useSearchParams().get("from"));
  return <ContactInfo characterId={characterId} returnSource={returnSource} />;
}

export function ContactProfile({ characterId }: { characterId: string }) {
  // The fallback is the real page (inert until the query decides where Back goes), so
  // resolving the query never blanks or reloads the first frame.
  return <Suspense fallback={<ContactInfo characterId={characterId} pending />}>
    <ContactProfileFromQuery characterId={characterId} />
  </Suspense>;
}
