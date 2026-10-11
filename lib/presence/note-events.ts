/** The grey chat line for a change to either note. `note` is the new text, null when it was removed. */
export const userNoteEventText = (characterName: string, note: string | null) =>
  note ? `You changed ${characterName}'s nickname to “${note}”` : `You removed ${characterName}'s nickname`;
export const characterNoteEventText = (characterName: string, note: string | null) =>
  note ? `${characterName} has changed your nickname to “${note}”` : `${characterName} has removed your nickname`;
