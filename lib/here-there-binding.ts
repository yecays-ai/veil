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

const bound = (config: WidgetConfig) => [config.characterId, config.comment?.characterId]
  .filter((id): id is string => typeof id === "string");
type Widgets = ThemeDocument["current"]["widgets"];
function unbindWidgets(widgets: Widgets, shouldUnbind: (characterId: string) => boolean): Widgets {
  let changed = false;
  const next = widgets.map((widget) => {
    if (widget.type !== "here-there" || !bound(widget.config).some(shouldUnbind)) return widget;
    changed = true;
    const config = { ...widget.config };
    delete config.characterId; delete config.comment; // the widget stays; its link and generated remark go
    return { ...widget, config };
  });
  return changed ? next : widgets;
}

/**
 * Clears the Character link and the generated comment of every Here & There widget whose Character the
 * predicate selects, in the current layout and in every saved decoration preset. Widgets are kept.
 * Returns the same document when nothing referenced such a Character.
 */
export function unbindHereThereCharacters(theme: ThemeDocument, shouldUnbind: (characterId: string) => boolean): ThemeDocument {
  const widgets = unbindWidgets(theme.current.widgets, shouldUnbind);
  let changed = widgets !== theme.current.widgets;
  const presets = theme.presets.map((preset) => {
    const presetWidgets = unbindWidgets(preset.snapshot.widgets, shouldUnbind);
    if (presetWidgets === preset.snapshot.widgets) return preset;
    changed = true;
    return { ...preset, snapshot: { ...preset.snapshot, widgets: presetWidgets } };
  });
  return changed ? { ...theme, current: { ...theme.current, widgets }, presets } : theme;
}

export function countHereThereReferences(theme: ThemeDocument, characterId: string): { layout: number; presets: number } {
  const count = (widgets: Widgets) => widgets.filter((widget) =>
    widget.type === "here-there" && bound(widget.config).includes(characterId)).length;
  return { layout: count(theme.current.widgets),
    presets: theme.presets.reduce((total, preset) => total + count(preset.snapshot.widgets), 0) };
}
