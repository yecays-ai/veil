import type { FoundationDocument } from "./foundation-types";
import type { ThemeDocument } from "./theme-types";
import type { WidgetConfig } from "./widget-types";

export function resolveHereThereCharacter(config: WidgetConfig, foundation: FoundationDocument) {
  const characterId = config.characterId ?? foundation.selectedCharacterId;
  return foundation.characters.find((character) => character.characterId === characterId);
}

export function bindHereThereCharacter(theme: ThemeDocument, widgetId: string, characterId: string,
  onlyIfMissing = false): ThemeDocument {
  return { ...theme, current: { ...theme.current, widgets: theme.current.widgets.map((widget) =>
    widget.id === widgetId && widget.type === "here-there" && (!onlyIfMissing || !widget.config.characterId)
      ? { ...widget, config: { ...widget.config, characterId } } : widget) } };
}
