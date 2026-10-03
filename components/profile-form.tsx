"use client";

import { useState, type FormEvent } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import {
  avatarSource,
  type CharacterInput,
  type UserProfile,
} from "../lib/foundation-types";
import { AvatarEditor } from "./avatar-editor";
import { UI_COPY as U } from "../lib/ui-copy";

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
    <form autoComplete="off" className="foundation-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <AvatarEditor
          value={avatar || null}
          name={draft.name}
          onChange={(value) => setAvatar(value ?? "")}
        />
        <label>
          {C.fields.name}
          <input
            autoComplete="off"
            required
            value={draft.name}
            maxLength={100}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label>
          {C.fields.gender}
          <input
            autoComplete="off"
            list="gender-options"
            value={draft.gender ?? ""}
            maxLength={100}
            onChange={(e) => text("gender", e.target.value)}
          />
        </label>
        <label>
          {C.fields.birthday}
          <input
            autoComplete="off"
            type="date"
            value={draft.birthday ?? ""}
            onChange={(e) => text("birthday", e.target.value)}
          />
        </label>
        <label>
          {C.fields.age}
          <input
            autoComplete="off"
            type="number"
            min="0"
            step="1"
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </label>

        <label>
          {C.fields.occupation}
          <input
            autoComplete="off"
            value={draft.occupation ?? ""}
            maxLength={200}
            onChange={(e) => text("occupation", e.target.value)}
          />
        </label>
        <label>
          {C.fields.location}
          <input
            autoComplete="off"
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label>
          {C.fields.timezone}
          <input
            autoComplete="off"
            value={draft.timezone ?? ""}
            maxLength={100}
            onChange={(e) => text("timezone", e.target.value)}
            placeholder={U.deviceTimezone}
            list="timezone-options"
          />
        </label>

        <datalist id="timezone-options">
          {[
            "UTC",
            "America/New_York",
            "America/Los_Angeles",
            "Europe/London",
            "Europe/Paris",
            "Asia/Tokyo",
            "Asia/Shanghai",
            "Australia/Sydney",
          ].map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <datalist id="gender-options">
          {U.genderSuggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        {areas.map((key) => (
          <section key={key}>
            <label htmlFor={`profile-${key}`}>{C.fields[key]}</label>
            <textarea
              autoComplete="off"
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
