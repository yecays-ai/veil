"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { UI_COPY as U } from "../lib/ui-copy";
import {
  createCharacter,
  deleteCharacter,
  saveUser,
  selectCharacter,
  updateCharacter,
} from "../lib/foundation";
import {
  normalizeCharacterInput,
  type CharacterInput,
  type UserProfile,
} from "../lib/foundation-types";
import { useFoundation } from "./foundation-provider";
import { ProfileForm } from "./profile-form";
import { Avatar, ProfileView } from "./profile-view";
import { PageShell } from "./page-shell";

export function UserProfilePage() {
  const { document, ready, commit } = useFoundation();
  const [editing, setEditing] = useState(false);
  return (
    <PageShell
      title={C.profile.title}
      backHref="/"
      backLabel="Back to Home"
      bodyClassName="foundation-page"
    >
      {!ready ? (
        <p>{C.common.loading}</p>
      ) : editing ? (
        <>
          <h1>{U.editProfile}</h1>
          <ProfileForm
            initial={document.user}
            kind="user"
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              await commit((d) => saveUser(d, input as UserProfile));
              setEditing(false);
            }}
          />
        </>
      ) : (
        <ProfileView profile={document.user} kind="user">
          <button onClick={() => setEditing(true)}>{C.common.edit}</button>
        </ProfileView>
      )}
    </PageShell>
  );
}
export function CharactersPage() {
  const { document, ready } = useFoundation();
  return (
    <PageShell
      title={C.characters.title}
      backHref="/"
      backLabel="Back to Home"
      bodyClassName="foundation-page"
      rightAction={<Link href="/characters/new">{C.characters.new}</Link>}
    >
      <nav>
        <Link href="/universe">{C.characters.universe}</Link>
      </nav>
      {!ready ? (
        <p>{C.common.loading}</p>
      ) : !document.characters.length ? (
        <p className="empty-copy subtle">{C.characters.empty}</p>
      ) : (
        <ul className="character-list">
          {document.characters.map((c) => (
            <li key={c.characterId}>
              <Link
                className="character-link"
                href={`/characters/${c.characterId}`}
              >
                <Avatar avatar={c.avatar} name={c.name} />
                <span className="contact-details">
                  <strong>{c.name}</strong>
                  {(c.occupation || c.location?.label) && (
                    <small className="subtle">
                      {c.occupation || c.location?.label}
                    </small>
                  )}
                </span>
                {document.selectedCharacterId === c.characterId && (
                  <span className="active-badge">{C.characters.current}</span>
                )}
                <span className="subtle" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
export function CharacterPage({ characterId }: { characterId?: string }) {
  const { document, ready, commit } = useFoundation();
  const router = useRouter();
  const [editing, setEditing] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const character = document.characters.find(
    (c) => c.characterId === characterId,
  );
  if (!ready)
    return (
      <PageShell
        title={C.characters.title}
        backHref="/characters"
        backLabel="Back to Characters"
        bodyClassName="foundation-page"
      >
        {C.common.loading}
      </PageShell>
    );
  if (characterId && !character)
    return (
      <PageShell
        title={C.characters.title}
        backHref="/characters"
        backLabel="Back to Characters"
        bodyClassName="foundation-page"
      >
        <p>{C.characters.notFound}</p>
      </PageShell>
    );
  const isNew = !characterId,
    active = document.selectedCharacterId === characterId;
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : C.profile.saveError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageShell
      title={
        isNew
          ? C.characters.create
          : editing
            ? C.characters.edit
            : character!.name
      }
      backHref="/characters"
      backLabel="Back to Characters"
      bodyClassName="foundation-page"
    >
      {isNew || editing ? (
        <>
          <h1>{isNew ? C.characters.create : C.characters.edit}</h1>
          <ProfileForm
            key={characterId ?? "new"}
            kind="character"
            initial={
              character ?? { ...normalizeCharacterInput(null), name: "" }
            }
            saveLabel={isNew ? C.characters.create : C.common.save}
            onCancel={() =>
              isNew ? router.push("/characters") : setEditing(false)
            }
            onSave={async (input) => {
              const next = await commit((d) =>
                characterId
                  ? updateCharacter(d, characterId, input as CharacterInput)
                  : createCharacter(d, input as CharacterInput),
              );
              setEditing(false);
              router.push(
                `/characters/${characterId ?? next.characters.at(-1)!.characterId}`,
              );
            }}
          />
        </>
      ) : (
        <>
          <ProfileView profile={character!} kind="character">
            <button onClick={() => setEditing(true)}>{C.common.edit}</button>
            {active ? (
              <span className="active-badge">{C.characters.current}</span>
            ) : (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    commit((d) => selectCharacter(d, characterId!)),
                  )
                }
              >
                {C.characters.select}
              </button>
            )}
          </ProfileView>
          <footer className="danger-area">
            {confirmDelete ? (
              <>
                <p>{C.characters.deleteQuestion}</p>
                <div className="foundation-actions">
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await commit((d) => deleteCharacter(d, characterId!));
                        router.push("/characters");
                      })
                    }
                  >
                    {C.characters.confirmDelete}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>
                    {C.common.cancel}
                  </button>
                </div>
              </>
            ) : (
              <button
                className="text-button danger-button"
                onClick={() => setConfirmDelete(true)}
              >
                {U.deleteCharacter}
              </button>
            )}
          </footer>
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </PageShell>
  );
}
