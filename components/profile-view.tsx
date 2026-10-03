"use client";
/* eslint-disable @next/next/no-img-element -- Local avatars can be embedded data URLs. */
import { useEffect } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { UI_COPY as U } from "../lib/ui-copy";
import type {
  ProfileBasics,
  UserProfile,
  CharacterInput,
} from "../lib/foundation-types";
export function Avatar({
  avatar,
  name,
  large = false,
}: {
  avatar: string | null;
  name: string;
  large?: boolean;
}) {
  return avatar ? (
    <img
      className={`person-avatar ${large ? "large" : ""}`}
      src={avatar}
      alt={C.common.avatarAlt}
      draggable={false}
    />
  ) : (
    <span
      className={`person-avatar avatar-fallback ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export function ProfileView({
  profile,
  kind,
  children,
}: {
  profile: UserProfile | CharacterInput;
  kind: "user" | "character";
  children: React.ReactNode;
}) {
  useEffect(() => {
    // A saved profile opens at its header instead of the former form's scroll position.
    document.querySelector(".phone-content")?.scrollTo({ top: 0 });
  }, []);
  const keys = [
    "gender",
    "birthday",
    "age",
    "occupation",
    "location",
    "timezone",
  ] as const;
  const value = (key: keyof ProfileBasics) =>
    key === "location" ? profile.location?.label : profile[key];
  const populated = keys.filter(
    (key) =>
      value(key) !== null && value(key) !== undefined && value(key) !== "",
  );
  const sections =
    kind === "user"
      ? (["appearance", "aboutMe"] as const)
      : (["appearance", "backstory", "personality", "speakingStyle"] as const);
  return (
    <>
      <header className="profile-hero">
        <Avatar avatar={profile.avatar} name={profile.name} large />
        <h1>{profile.name}</h1>
        {profile.occupation && <p className="subtle">{profile.occupation}</p>}
        <div className="foundation-actions">{children}</div>
      </header>
      <section className="profile-card">
        <h2>{U.basic}</h2>
        {populated.length ? (
          <dl className="profile-details">
            {populated.map((key) => (
              <div key={key}>
                <dt>{C.fields[key]}</dt>
                <dd>{String(value(key))}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="subtle empty-copy">{C.common.empty}</p>
        )}
      </section>
      {sections
        .filter((key) =>
          Boolean((profile as unknown as Record<string, unknown>)[key]),
        )
        .map((key) => (
          <section className="profile-card profile-body" key={key}>
            <h2>{C.fields[key]}</h2>
            <p>
              {String((profile as unknown as Record<string, unknown>)[key])}
            </p>
          </section>
        ))}
    </>
  );
}
