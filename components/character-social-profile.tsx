"use client";

import { useFoundation } from "./foundation-provider";
import { PageShell } from "./page-shell";
import { Avatar } from "./profile-view";
import { PresenceBadge, presenceLabel } from "./presence";

export function CharacterSocialProfile({ characterId }: { characterId: string }) {
  const { document, ready } = useFoundation();
  const character = document.characters.find((item) => item.characterId === characterId);
  return <PageShell title="Profile" backHref={`/contacts/${encodeURIComponent(characterId)}`} backLabel="Back to Contact Info"
    bodyClassName="foundation-page">
    {!ready ? <p>Loading profile…</p> : !character ? <p>Profile not found.</p> : <div className="profile-hero">
      <Avatar avatar={character.avatar} name={character.name} large />
      <h1>{character.name}</h1>
      <span className="contact-presence"><PresenceBadge presence={character.presence} />{presenceLabel(character.presence)}</span>
      {character.statusMessage && <p>{character.statusMessage}</p>}
    </div>}
  </PageShell>;
}
