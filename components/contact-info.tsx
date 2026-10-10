"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, MessageCircle, Phone, Video, UserRound, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useFoundation } from "./foundation-provider";
import { useContacts } from "./use-contacts";
import { Avatar } from "./profile-view";
import { PresenceBadge, presenceLabel } from "./presence";
import { ImageCropDialog } from "./image-crop-dialog";
import { readImage } from "../lib/theme-storage";
import { chatStorage } from "../lib/chat/storage";
import { prefetchChatSession } from "../lib/chat/session-prefetch";
import { measureChatDiagnostic, recordChatDiagnostic } from "../lib/diagnostics/chat-first-paint";
import { contactDisplayName, removeContact, updateContact } from "../lib/contact-storage";
import { contactReturnTarget, type ContactReturnSource } from "../lib/contact-navigation";
import { confirmDiscard, guardLinkClicks } from "./leave-guard";
import "../app/contacts/contact-info.css";

// While `pending`, the route query is still resolving and this instance is about to be replaced by
// the resolved one. Contact Info stays visible but inert (Back, Edit, Delete), so
// nothing navigates to a wrong destination or is typed into a draft that would be discarded.
export function ContactInfo({ characterId, returnSource, pending = false }: {
  characterId: string; returnSource?: ContactReturnSource; pending?: boolean;
}) {
  const { document, ready } = useFoundation();
  const contacts = useContacts();
  const router = useRouter();
  const character = document.characters.find((item) => item.characterId === characterId);
  const contact = contacts.document.contacts.find((item) => item.characterId === characterId);
  useLayoutEffect(() => {
    recordChatDiagnostic("ContactInfo-commit-mount", { characterId, pending });
    return () => recordChatDiagnostic("ContactInfo-commit-unmount", { characterId, pending });
  }, [characterId, pending]);
  const [draft, setDraft] = useState<{ remark: string; heroBackground: string | null;
    base: { remark: string | null; heroBackground: string | null } } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [imageReading, setImageReading] = useState(false);
  const imageRequest = useRef(0);
  const lifetime = useRef(0);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [stateCharacterId, setStateCharacterId] = useState(characterId);
  const backHref = contactReturnTarget(characterId, returnSource);
  if (stateCharacterId !== characterId) {
    setStateCharacterId(characterId);
    setDraft(null); setBusy(false); setError(""); setCropSource(null);
    setImageReading(false); setDeleteOpen(false);
  }
  useLayoutEffect(() => {
    imageRequest.current++;
    const owner = lifetime;
    const request = imageRequest;
    return () => { owner.current++; request.current++; };
  }, [characterId]);

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
    const owner = lifetime.current;
    setBusy(true); setError("");
    try {
      await contacts.commit((current) => updateContact(current, characterId, draft, undefined, draft.base));
      if (owner === lifetime.current) setDraft(null);
    } catch (reason) {
      if (owner === lifetime.current) setError(reason instanceof Error ? reason.message : "Contact could not be saved.");
    } finally { if (owner === lifetime.current) setBusy(false); }
  }
  async function message() {
    if (!character || busy) return;
    const owner = lifetime.current;
    setBusy(true); setError("");
    try {
      await measureChatDiagnostic("contact-info-open-session", { characterId: character.characterId },
        () => chatStorage.openSession(character.characterId), () => ({ hasSession: true }));
      // Seed the room's first frame with the session that was just opened; a failed read only means no seed.
      await prefetchChatSession(character.characterId, chatStorage);
      if (owner === lifetime.current) {
        const target = `/messages/${encodeURIComponent(character.characterId)}`;
        recordChatDiagnostic("navigation-call", { target, characterId: character.characterId });
        router.push(target);
      }
    } catch (reason) {
      if (owner === lifetime.current) {
        setError(reason instanceof Error ? reason.message : "Conversation could not be opened."); setBusy(false);
      }
    }
  }
  async function deleteContact() {
    if (busy || pending) return;
    const owner = lifetime.current;
    setBusy(true); setError("");
    try {
      await contacts.commit((current) => removeContact(current, characterId));
      if (owner === lifetime.current) router.push(backHref);
    } catch (reason) {
      if (owner === lifetime.current) {
        setError(reason instanceof Error ? reason.message : "Contact could not be deleted."); setBusy(false);
      }
    }
  }

  if (!ready || !contacts.ready || !character || !contact || contacts.error) return <div className="contact-info contact-info-unavailable">
    {pending ? <span aria-label="Back to Contacts" aria-disabled="true"><ChevronLeft /> Back</span>
      : <Link href={backHref} aria-label="Back to Contacts"><ChevronLeft /> Back</Link>}
    <p role={contacts.error ? "alert" : undefined}>{!ready || !contacts.ready ? "Loading contact…" : contacts.error || "Contact not found."}</p>
    {contacts.error && <button type="button" className="settings-button" onClick={() => void contacts.retry()}>Retry</button>}
  </div>;
  const dirty = !!draft && (draft.remark !== (draft.base.remark ?? "") || draft.heroBackground !== draft.base.heroBackground);
  const heroBackground = draft ? draft.heroBackground : contact.heroBackground;
  const name = contactDisplayName(draft ? { remark: draft.remark } : contact, character.name);
  const since = contact.createdAt > 0 && contact.createdAt <= 8.64e15 ? new Date(contact.createdAt) : null;
  return <div className="contact-info" onClickCapture={guardLinkClicks(dirty)}>
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
        {pending ? <span className="contact-back" aria-label="Back to Contacts" aria-disabled="true"><ChevronLeft /></span>
          : <Link className="contact-back" href={backHref} aria-label="Back to Contacts"><ChevronLeft /></Link>}
        {draft ? <div className="contact-edit-actions">
          <button type="button" disabled={busy} onClick={() => { if (confirmDiscard(dirty)) cancelEdit(); }}>Cancel</button>
          <button type="button" disabled={busy || imageReading || !!cropSource} onClick={() => void save()}>Save</button>
        </div> : <button type="button" className="contact-edit" disabled={pending} onClick={() => {
          setDraft({ remark: contact.remark ?? "", heroBackground: contact.heroBackground,
            base: { remark: contact.remark, heroBackground: contact.heroBackground } }); setError("");
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
        <button type="button" data-chat-navigation="contact-info-message" disabled={busy || !!draft} onClick={() => void message()}><MessageCircle /><span>Message</span></button>
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
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.focus({ preventScroll: true });
  }, []);
  return <dialog ref={ref} tabIndex={-1} className="contact-delete-dialog" aria-labelledby="delete-contact-title"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="delete-contact-title">Delete Contact?</h2>
    <p>This removes the Contact relationship. The Character, conversation and chat history will remain.</p>
    {error && <p role="alert">{error}</p>}
    <div><button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="contact-delete" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete Contact"}</button></div>
  </dialog>;
}
