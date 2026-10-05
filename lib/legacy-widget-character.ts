import { normalizeFoundation, record } from "./foundation-types";
import type { ThemeDocument } from "./theme-types";

export function migrateLegacyWidgetCharacters(theme: ThemeDocument, rawFoundation: unknown): ThemeDocument {
  const foundation = normalizeFoundation(rawFoundation);
  const legacyId = record(rawFoundation).selectedCharacterId;
  const character = foundation.characters.find((item) => item.characterId === legacyId)
    ?? (foundation.characters.length === 1 ? foundation.characters[0] : undefined);
  if (!character) return theme;
  let changed = false;
  const widgets = theme.current.widgets.map((widget) => {
    if (widget.type !== "here-there" || widget.config.characterId) return widget;
    changed = true;
    return { ...widget, config: { ...widget.config, characterId: character.characterId } };
  });
  return changed ? { ...theme, current: { ...theme.current, widgets } } : theme;
}
