"use client";

import { useState, type FormEvent } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import {
  avatarSource,
  type CharacterInput,
  type UserProfile,
} from "../lib/foundation-types";
import { readImage } from "../lib/theme-storage";

type Input = UserProfile | CharacterInput;
export function ProfileForm({
  initial,
  kind,
  saveLabel = C.common.save,
  onSave,
  onCancel,
}: {
  initial: Input;
  kind: "user" | "character";
  saveLabel?: string;
  onSave: (profile: Input) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Input>(initial);
  const [location, setLocation] = useState(initial.location?.label ?? "");
  const [avatar, setAvatar] = useState(initial.avatar ?? "");
  const [age, setAge] = useState(
    initial.age === null ? "" : String(initial.age),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  function text(key: keyof Input, value: string) {
    setDraft((d) => ({ ...d, [key]: value || null }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const source = avatar.trim() ? avatarSource(avatar.trim()) : null;
      if (avatar.trim() && !source) throw new Error(C.profile.avatarError);
      await onSave({
        ...draft,
        avatar: source,
        age: age.trim() ? Number(age) : null,
        location: location.trim()
          ? {
              label: location.trim(),
              coordinates:
                location.trim() === initial.location?.label
                  ? initial.location.coordinates
                  : null,
            }
          : null,
      });
      setNotice(C.common.saved);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : C.profile.saveError);
    } finally {
      setBusy(false);
    }
  }
  const areas =
    kind === "user"
      ? (["appearance", "aboutMe"] as const)
      : (["appearance", "backstory", "personality", "speakingStyle"] as const);
  return (
    <form className="foundation-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        {avatarSource(avatar) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="profile-avatar"
            src={avatar}
            alt={C.common.avatarAlt}
          />
        )}
        <label>
          {C.fields.avatar}
          <input
            type="text"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            maxLength={600000}
          />
        </label>
        <label>
          {C.common.uploadAvatar}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setNotice("");
              try {
                setAvatar(await readImage(file));
              } catch (error) {
                setNotice(
                  error instanceof Error
                    ? error.message
                    : C.profile.avatarError,
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <p className="form-help">{C.profile.avatarHelp}</p>
        {avatar && (
          <button type="button" onClick={() => setAvatar("")}>
            {C.common.clearAvatar}
          </button>
        )}
        <label>
          {C.fields.name}
          <input
            required
            value={draft.name}
            maxLength={100}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label>
          {C.fields.gender}
          <input
            value={draft.gender ?? ""}
            maxLength={100}
            onChange={(e) => text("gender", e.target.value)}
          />
        </label>
        <label>
          {C.fields.birthday}
          <input
            type="date"
            value={draft.birthday ?? ""}
            onChange={(e) => text("birthday", e.target.value)}
          />
        </label>
        <label>
          {C.fields.age}
          <input
            type="number"
            min="0"
            step="1"
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </label>
        <p className="form-help">{C.profile.birthdayHelp}</p>
        <label>
          {C.fields.occupation}
          <input
            value={draft.occupation ?? ""}
            maxLength={200}
            onChange={(e) => text("occupation", e.target.value)}
          />
        </label>
        <label>
          {C.fields.location}
          <input
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label>
          {C.fields.timezone}
          <input
            value={draft.timezone ?? ""}
            maxLength={100}
            onChange={(e) => text("timezone", e.target.value)}
            placeholder="UTC"
          />
        </label>
        <p className="form-help">{C.profile.timezoneHelp}</p>
        {areas.map((key) => (
          <section key={key}>
            <label htmlFor={`profile-${key}`}>{C.fields[key]}</label>
            <textarea
              id={`profile-${key}`}
              rows={4}
              maxLength={12000}
              value={
                (draft as unknown as Record<string, string | null>)[key] ?? ""
              }
              onChange={(e) =>
                setDraft((d) => ({ ...d, [key]: e.target.value || null }))
              }
            />
            {key === "appearance" && (
              <p className="form-help">{C.profile.appearanceHelp}</p>
            )}
            {key === "aboutMe" && (
              <p className="form-help">{C.profile.aboutHelp}</p>
            )}
          </section>
        ))}
        <div className="foundation-actions">
          <button type="submit">{saveLabel}</button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              {C.common.cancel}
            </button>
          )}
        </div>
      </fieldset>
      <p role="status" aria-live="polite">
        {notice}
      </p>
    </form>
  );
}
