"use client";

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import {
  avatarSource,
  type CharacterInput,
  type UserProfile,
} from "../lib/foundation-types";
import { AvatarEditor } from "./avatar-editor";
import { UI_COPY as U } from "../lib/ui-copy";
import {
  getDeviceTimezone,
  getTimezoneOptions,
} from "../lib/participant-config";

type Input = UserProfile | CharacterInput;

function TimezoneField({
  value,
  savedTimezone,
  onChange,
}: {
  value: string;
  savedTimezone: string | null;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const listId = `${id}-options`;
  const [query, setQuery] = useState(value);
  const [deviceTimezone, setDeviceTimezone] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const device = getDeviceTimezone();
    setDeviceTimezone(device);
    setOptions(getTimezoneOptions(savedTimezone, device));
  }, [savedTimezone]);
  useEffect(() => setQuery(value), [value]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = options
    .filter((zone) => zone.toLocaleLowerCase().includes(normalizedQuery));

  function selectTimezone(zone: string) {
    setQuery(zone);
    onChange(zone);
    setOpen(false);
    setActiveIndex(-1);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && filteredOptions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        index < 0 ? 0 : Math.min(index + 1, filteredOptions.length - 1),
      );
    } else if (event.key === "ArrowUp" && filteredOptions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        index < 0 ? 0 : Math.max(index - 1, 0),
      );
    } else if (
      event.key === "Enter" &&
      open &&
      activeIndex >= 0 &&
      filteredOptions[activeIndex]
    ) {
      event.preventDefault();
      selectTimezone(filteredOptions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="timezone-picker">
      <label htmlFor={id}>{C.fields.timezone}</label>
      <div className="timezone-combobox">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open && filteredOptions.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            open && activeIndex >= 0
              ? `${listId}-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          maxLength={100}
          value={query}
          placeholder={U.deviceTimezone}
          onFocus={() => setOpen(true)}
          onBlur={() =>
            window.setTimeout(() => {
              setOpen(false);
              setActiveIndex(-1);
            }, 120)
          }
          onKeyDown={keyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
        />
        <ul
          className="timezone-options"
          id={listId}
          role="listbox"
          aria-label={C.fields.timezone}
          hidden={!open || filteredOptions.length === 0}
        >
          {filteredOptions.map((zone, index) => (
            <li
              className="timezone-option"
              id={`${listId}-${index}`}
              key={zone}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectTimezone(zone)}
            >
              {zone}
            </li>
          ))}
        </ul>
      </div>
      <small>
        {deviceTimezone
          ? U.deviceTimezoneValue(deviceTimezone)
          : U.deviceTimezoneUnavailable}
      </small>
      <button
        className="text-button timezone-use-device"
        type="button"
        disabled={!value && !query}
        onClick={() => selectTimezone("")}
      >
        {U.useDeviceTimezone}
      </button>
    </div>
  );
}

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
        <TimezoneField
          value={draft.timezone ?? ""}
          savedTimezone={initial.timezone}
          onChange={(value) => text("timezone", value)}
        />
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
