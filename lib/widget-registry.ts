import {
  normalizeWidgetPlace,
  type WidgetConfig,
  type WidgetSize,
  type WidgetType,
} from "./widget-types";

export type WidgetDefinition = {
  label: string;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  normalizeConfig: (value: unknown) => WidgetConfig;
};

function timeConfig(value: unknown): WidgetConfig {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return { hour12: raw.hour12 === true, showSeconds: raw.showSeconds === true };
}

// Here & There keeps its own per-side place. Older configs only knew the time
// flags: unset places stay omitted so legacy layouts are never rewritten, and
// the view falls back to the saved profiles.
function hereThereConfig(value: unknown): WidgetConfig {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const config = timeConfig(value);
  const here = normalizeWidgetPlace(raw.here);
  const there = normalizeWidgetPlace(raw.there);
  if (here) config.here = here;
  if (there) config.there = there;
  return config;
}

// Register metadata/config here and a view in WidgetRenderer when adding a type.
export const WIDGET_REGISTRY: Record<WidgetType, WidgetDefinition> = {
  clock: {
    label: "Clock",
    sizes: ["2x2", "4x2"],
    defaultSize: "2x2",
    normalizeConfig: timeConfig,
  },
  "here-there": {
    label: "Here & There",
    sizes: ["2x2", "4x2"],
    defaultSize: "4x2",
    normalizeConfig: hereThereConfig,
  },
};

export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && Object.hasOwn(WIDGET_REGISTRY, value);
}
