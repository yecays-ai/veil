import type { WidgetConfig, WidgetSize, WidgetType } from "./widget-types";

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

function hereThereConfig(value: unknown): WidgetConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const characterId = typeof raw.characterId === "string" ? raw.characterId.trim() : "";
  return { ...timeConfig(value), ...(characterId.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(characterId)
    && !["__proto__", "constructor", "prototype"].includes(characterId) ? { characterId } : {}) };
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
