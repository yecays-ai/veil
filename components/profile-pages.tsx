"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
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

export function UserProfilePage() {
  const { document, ready, commit } = useFoundation();
  return (
    <div className="theme-page foundation-page">
      <Link className="back-link" href="/">
        {C.common.home}
      </Link>
      <h1>{C.profile.title}</h1>
      <p>{C.profile.description}</p>
      {ready ? (
        <ProfileForm
          initial={document.user}
          kind="user"
          onSave={async (input) => {
            await commit((d) => saveUser(d, input as UserProfile));
          }}
        />
      ) : (
        <p>{C.common.loading}</p>
      )}
    </div>
  );
}

export function CharactersPage() {
  const { document, ready, commit } = useFoundation();
  const [notice, setNotice] = useState("");
  return (
    <div className="theme-page foundation-page">
      <Link className="back-link" href="/">
        {C.common.home}
      </Link>
      <h1>{C.characters.title}</h1>
      <div className="foundation-actions">
        <Link href="/characters/new">{C.characters.new}</Link>
        <Link href="/universe">{C.characters.universe}</Link>
      </div>
      {!ready ? (
        <p>{C.common.loading}</p>
      ) : document.characters.length === 0 ? (
        <p>{C.characters.empty}</p>
      ) : (
        <ul className="character-list">
          {document.characters.map((c) => (
            <li key={c.characterId}>
              <Link
                className="character-link"
                href={`/characters/${c.characterId}`}
              >
                {c.avatar && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatar} alt="" />
                )}
                <span>{c.name}</span>
              </Link>
              {document.selectedCharacterId === c.characterId ? (
                <span className="form-help">{C.characters.current}</span>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await commit((d) => selectCharacter(d, c.characterId));
                      setNotice(C.common.selected);
                    } catch (e) {
                      setNotice(
                        e instanceof Error ? e.message : C.profile.saveError,
                      );
                    }
                  }}
                >
                  {C.characters.select}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status">{notice}</p>
    </div>
  );
}

export function CharacterPage({ characterId }: { characterId?: string }) {
  const { document, ready, commit } = useFoundation();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const character = characterId
    ? document.characters.find((c) => c.characterId === characterId)
    : null;
  if (!ready)
    return <div className="theme-page foundation-page">{C.common.loading}</div>;
  if (characterId && !character)
    return (
      <div className="theme-page foundation-page">
        <Link href="/characters">{C.common.back}</Link>
        <p>{C.characters.notFound}</p>
      </div>
    );
  const isNew = !characterId;
  const input = character ?? { ...normalizeCharacterInput(null), name: "" };
  return (
    <div className="theme-page foundation-page">
      <Link className="back-link" href="/characters">
        {C.common.back}
      </Link>
      <h1>
        {isNew
          ? C.characters.create
          : editing
            ? C.characters.edit
            : character!.name}
      </h1>
      {isNew || editing ? (
        <ProfileForm
          key={characterId ?? "new"}
          kind="character"
          initial={input}
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
      ) : (
        <>
          {character!.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="profile-avatar"
              src={character!.avatar}
              alt={C.common.avatarAlt}
            />
          )}
          <div className="foundation-actions">
            <button onClick={() => setEditing(true)}>{C.common.edit}</button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await commit((d) => selectCharacter(d, characterId!));
                  setNotice(C.common.selected);
                } catch (e) {
                  setNotice(
                    e instanceof Error ? e.message : C.profile.saveError,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {C.characters.select}
            </button>
            <button onClick={() => setConfirmDelete(true)}>
              {C.common.delete}
            </button>
          </div>
          <dl className="profile-details">
            {(
              [
                "gender",
                "birthday",
                "age",
                "occupation",
                "location",
                "timezone",
              ] as const
            ).map((key) => (
              <div key={key}>
                <dt>{C.fields[key]}</dt>
                <dd>
                  {key === "location"
                    ? character!.location?.label || C.common.empty
                    : String(character![key] ?? C.common.empty)}
                </dd>
              </div>
            ))}
          </dl>
          {(
            ["appearance", "backstory", "personality", "speakingStyle"] as const
          ).map((key) => (
            <section className="profile-body" key={key}>
              <h2>{C.fields[key]}</h2>
              <p>{character![key] || C.common.empty}</p>
            </section>
          ))}
          {confirmDelete && (
            <div className="foundation-confirm">
              <p>{C.characters.deleteQuestion}</p>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await commit((d) => deleteCharacter(d, characterId!));
                    router.push("/characters");
                  } catch (e) {
                    setNotice(
                      e instanceof Error ? e.message : C.profile.saveError,
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {C.characters.confirmDelete}
              </button>
              <button onClick={() => setConfirmDelete(false)}>
                {C.common.cancel}
              </button>
            </div>
          )}
        </>
      )}
      <p role="status">{notice}</p>
    </div>
  );
}
