"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, MessageCircle, Phone, Video, UserRound, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFoundation } from "./foundation-provider";
import { useContacts } from "./use-contacts";
import { Avatar } from "./profile-view";
import { PresenceBadge, presenceLabel } from "./presence";
import { ImageCropDialog } from "./image-crop-dialog";
import { readImage } from "../lib/theme-storage";
import { chatStorage } from "../lib/chat/storage";
import { contactDisplayName, removeContact, updateContact } from "../lib/contact-storage";
import "../app/contacts/contact-info.css";

export function ContactInfo({ characterId }: { characterId: string }) {
  const { document, ready } = useFoundation();
  const contacts = useContacts();
  const router = useRouter();
  const character = document.characters.find((item) => item.characterId === characterId);
  const contact = contacts.document.contacts.find((item) => item.characterId === characterId);
  const [draft, setDraft] = useState<{ remark: string; heroBackground: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [imageReading, setImageReading] = useState(false);
  const imageRequest = useRef(0);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useEffect(() => () => { imageRequest.current++; }, []);

  function cancelEdit() {
    imageRequest.current++; setImageReading(false); setCropSource(null); setDraft(null); setError("");
  }
  async function chooseBackground(file: File) {
    const request = ++imageRequest.current;
    setImageReading(true); setError("");
    try {
      const source = await readImage(file);
      if (request === imageRequest.current) setCropSource(source);
    } catch (reason) {
      if (request === imageRequest.current) setError(reason instanceof Error ? reason.message : "Image could not be opened.");
    } finally { if (request === imageRequest.current) setImageReading(false); }
  }
  async function save() {
    if (!draft || busy || imageReading) return;
    setBusy(true); setError("");
    try {
      await contacts.commit((current) => updateContact(current, characterId, draft));
      setDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Contact could not be saved."); }
    finally { setBusy(false); }
  }
  async function message() {
    if (!character || busy) return;
    setBusy(true); setError("");
    try {
      await chatStorage.openSession(character.characterId);
      router.push(`/messages/${encodeURIComponent(character.characterId)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Conversation could not be opened."); setBusy(false); }
  }
  async function deleteContact() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await contacts.commit((current) => removeContact(current, characterId));
      router.push("/contacts");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Contact could not be deleted."); setBusy(false); }
  }

  if (!ready || !contacts.ready || !character || !contact || contacts.error) return <div className="contact-info contact-info-unavailable">
    <Link href="/contacts" aria-label="Back to Contacts"><ChevronLeft /> Back</Link>
    <p role={contacts.error ? "alert" : undefined}>{!ready || !contacts.ready ? "Loading contact…" : contacts.error || "Contact not found."}</p>
  </div>;
  const heroBackground = draft ? draft.heroBackground : contact.heroBackground;
  const name = contactDisplayName(draft ? { remark: draft.remark } : contact, character.name);
  const since = contact.createdAt > 0 && contact.createdAt <= 8.64e15 ? new Date(contact.createdAt) : null;
  return <div className="contact-info">
    <header className={`contact-info-hero${heroBackground ? " has-background" : ""}`}
      style={heroBackground ? { backgroundImage: `url(${JSON.stringify(heroBackground)})` } : undefined}>
      {draft && <>
        <button type="button" className="contact-hero-background-trigger" aria-label="Change Hero Background"
          onClick={() => backgroundInput.current?.click()} />
        <input ref={backgroundInput} className="contact-hero-background-input" type="file" accept="image/*"
          disabled={busy || imageReading}
          aria-label="Choose Hero Background image" onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (file) void chooseBackground(file);
          }} />
      </>}
      <nav className="contact-hero-nav" aria-label="Contact Info">
        <Link className="contact-back" href="/contacts" aria-label="Back to Contacts"><ChevronLeft /></Link>
        {draft ? <div className="contact-edit-actions">
          <button type="button" disabled={busy} onClick={cancelEdit}>Cancel</button>
          <button type="button" disabled={busy || imageReading || !!cropSource} onClick={() => void save()}>Save</button>
        </div> : <button type="button" className="contact-edit" onClick={() => {
          setDraft({ remark: contact.remark ?? "", heroBackground: contact.heroBackground }); setError("");
        }}>Edit</button>}
      </nav>
      <div className="contact-hero-identity">
        <Avatar avatar={character.avatar} name={character.name} large />
        {draft ? <input className="contact-hero-name-input" aria-label="Contact name" value={draft.remark}
          maxLength={100} disabled={busy} placeholder={character.name}
          onChange={(event) => setDraft({ ...draft, remark: event.currentTarget.value })} /> : <h1>{name}</h1>}
        <span className="contact-presence"><PresenceBadge presence={character.presence} />{presenceLabel(character.presence)}</span>
        {character.statusMessage && <p className="contact-status">{character.statusMessage}</p>}
      </div>
      {draft?.heroBackground && <button type="button" className="contact-background-remove" disabled={busy}
        onClick={() => setDraft({ ...draft, heroBackground: null })}>Remove Background</button>}
      {imageReading && <span className="contact-background-reading" role="status">Opening image…</span>}
    </header>
    <div className="contact-info-body">
      <nav className="contact-quick-actions" aria-label="Quick Actions">
        <button type="button" disabled={busy || !!draft} onClick={() => void message()}><MessageCircle /><span>Message</span></button>
        <button type="button" disabled title="Call unavailable"><Phone /><span>Call</span></button>
        <button type="button" disabled title="Video unavailable"><Video /><span>Video</span></button>
        <Link href={`/social/${encodeURIComponent(character.characterId)}`}><UserRound /><span>Profile</span></Link>
      </nav>
      {error && !deleteOpen && <p className="contact-error" role="alert">{error}</p>}
      <section className="contact-info-section" aria-labelledby="shared-media-title">
        <h2 id="shared-media-title">Shared Media</h2>
        <div className="contact-media-placeholders" aria-label="Shared Media unavailable">
          {[0, 1, 2, 3].map((slot) => <div className="contact-media-slot" key={slot} aria-hidden="true">{slot === 0 && <Plus />}</div>)}
        </div>
      </section>
      <section className="contact-info-section" aria-labelledby="relationship-title">
        <h2 id="relationship-title">Relationship</h2>
        <div className="contact-since"><span>Contact since</span>{since ? <time dateTime={since.toISOString()}>
          {since.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</time> : <span>Unavailable</span>}</div>
      </section>
      <div className="contact-danger-area">
        <button type="button" disabled>Block Contact</button>
        <button type="button" className="contact-delete" disabled={busy || !!draft} onClick={() => { setError(""); setDeleteOpen(true); }}>Delete Contact</button>
      </div>
    </div>
    {cropSource && <ImageCropDialog source={cropSource} shape="wide" title="Adjust Hero Background"
      onSave={(value) => { setDraft((current) => current ? { ...current, heroBackground: value } : null); setCropSource(null); }}
      onCancel={() => setCropSource(null)} />}
    {deleteOpen && <DeleteContactDialog busy={busy} error={error} onCancel={() => { if (!busy) setDeleteOpen(false); }} onConfirm={() => void deleteContact()} />}
  </div>;
}

function DeleteContactDialog({ busy, error, onCancel, onConfirm }: {
  busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="contact-delete-dialog" aria-labelledby="delete-contact-title"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="delete-contact-title">Delete Contact?</h2>
    <p>This removes the Contact relationship. The Character, conversation and chat history will remain.</p>
    {error && <p role="alert">{error}</p>}
    <div><button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="contact-delete" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete Contact"}</button></div>
  </dialog>;
}
