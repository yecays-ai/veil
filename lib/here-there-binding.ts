import type { FoundationDocument } from "./foundation-types";
import type { ThemeDocument } from "./theme-types";
import type { WidgetConfig } from "./widget-types";

export function resolveHereThereCharacter(config: WidgetConfig, foundation: FoundationDocument) {
  return foundation.characters.find((character) => character.characterId === config.characterId);
}

export function bindHereThereCharacter(theme: ThemeDocument, widgetId: string, characterId: string): ThemeDocument {
  return { ...theme, current: { ...theme.current, widgets: theme.current.widgets.map((widget) =>
    widget.id === widgetId && widget.type === "here-there"
      ? { ...widget, config: { ...widget.config, characterId,
        comment: widget.config.characterId === characterId ? widget.config.comment : undefined } } : widget) } };
}
