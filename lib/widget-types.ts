export const WIDGET_SIZES = {
  "2x2": { cols: 2, rows: 2 },
  "4x2": { cols: 4, rows: 2 },
} as const;

export type WidgetSize = keyof typeof WIDGET_SIZES;
export type WidgetType = "clock" | "here-there";

// A manually chosen place: never device geolocation. Coordinates may stay null
// while a label/timezone is known, so time and weather resolve independently.
export type WidgetPlace = {
  label: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};
export type WidgetConfig = {
  hour12: boolean;
  showSeconds: boolean;
  here?: WidgetPlace | null;
  there?: WidgetPlace | null;
};
export type WidgetInstance = {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  page: number;
  row: number;
  col: number;
  config: WidgetConfig;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function coordinate(value: unknown, limit: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= limit
    ? value
    : null;
}
function timezoneId(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

// Storage boundary for one side's place. Latitude and longitude are kept or
// dropped together, and a completely empty place collapses back to null.
export function normalizeWidgetPlace(value: unknown): WidgetPlace | null {
  const raw = record(value);
  const label =
    typeof raw.label === "string" ? raw.label.trim().slice(0, 120) : "";
  const latitude = coordinate(raw.latitude, 90);
  const longitude = coordinate(raw.longitude, 180);
  const paired = latitude !== null && longitude !== null;
  const timezone = timezoneId(raw.timezone);
  if (!label && !paired && !timezone) return null;
  return {
    label,
    latitude: paired ? latitude : null,
    longitude: paired ? longitude : null,
    timezone,
  };
}
