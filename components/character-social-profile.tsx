"use client";

import { useFoundation } from "./foundation-provider";
import { PageShell } from "./page-shell";
import { Avatar } from "./profile-view";
import { CharacterPresenceLine } from "./presence";
import { CharacterStatePanel } from "./character-state-panel";

export function CharacterSocialProfile({ characterId }: { characterId: string }) {
  const { document, ready } = useFoundation();
  const character = document.characters.find((item) => item.characterId === characterId);
  return <PageShell title="Profile" backHref={`/contacts/${encodeURIComponent(characterId)}`} backLabel="Back to Contact Info"
    bodyClassName="foundation-page">
    {!ready ? <p>Loading profile…</p> : !character ? <p>Profile not found.</p> : <div className="profile-hero">
      <Avatar avatar={character.avatar} name={character.name} large />
      <h1>{character.name}</h1>
      <CharacterPresenceLine character={character} />
      {character.statusMessage && <p>{character.statusMessage}</p>}
      <CharacterStatePanel character={character} />
    </div>}
  </PageShell>;
}
