import type { WidgetPlace } from "./widget-types";

export type Coordinates = { latitude: number; longitude: number };
export type ManualLocation = {
  label: string;
  // Future city selection/geocoding writes coordinates here, never IP location.
  coordinates: Coordinates | null;
};
export type ParticipantConfig = {
  name: string;
  location: ManualLocation | null;
  timezone: string | null;
};
// Display state for one Here & There side: label and timezone drive local time,
// coordinates drive weather. They are resolved independently on purpose.
export type ResolvedPlace = {
  label: string | null;
  timezone: string | null;
  coordinates: Coordinates | null;
};
export type WeatherState =
  | { status: "not-configured" }
  | { status: "loading" }
  | {
      status: "ready";
      temperatureC: number;
      summary: string;
      icon: string;
      updatedAt: string;
    }
  | { status: "error"; message: string };
export type WeatherRequest = { coordinates: Coordinates; timezone: string };
// Future adapter: manually selected city → coordinates → weather provider.
export interface WeatherProvider {
  getWeather(request: WeatherRequest): Promise<WeatherState>;
}

function validCoordinates(value: unknown): Coordinates | null {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return typeof raw.latitude === "number" &&
    Number.isFinite(raw.latitude) &&
    Math.abs(raw.latitude) <= 90 &&
    typeof raw.longitude === "number" &&
    Number.isFinite(raw.longitude) &&
    Math.abs(raw.longitude) <= 180
    ? { latitude: raw.latitude, longitude: raw.longitude }
    : null;
}

// The widget's own place wins per field; the profile remains the fallback so
// existing Here & There widgets keep working without any new configuration.
export function resolveParticipantPlace(
  configured: WidgetPlace | null | undefined,
  profile: ParticipantConfig,
): ResolvedPlace {
  const widgetCoordinates = configured
    ? validCoordinates({
        latitude: configured.latitude,
        longitude: configured.longitude,
      })
    : null;
  return {
    label: configured?.label?.trim() || profile.location?.label || null,
    timezone: configured?.timezone || profile.timezone || null,
    coordinates:
      widgetCoordinates ?? validCoordinates(profile.location?.coordinates) ?? null,
  };
}

type IntlWithTimezoneValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

let cachedTimezoneValues: string[] | null = null;

export function getSupportedTimezones(): string[] {
  if (cachedTimezoneValues !== null) return cachedTimezoneValues;
  const intl = Intl as IntlWithTimezoneValues;
  try {
    cachedTimezoneValues =
      typeof intl.supportedValuesOf === "function"
        ? intl.supportedValuesOf.call(Intl, "timeZone")
        : [];
  } catch {
    cachedTimezoneValues = [];
  }
  return cachedTimezoneValues;
}

function validTimezone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function getDeviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}

export function getTimezoneOptions(
  savedTimezone: string | null,
  deviceTimezone: string | null,
  supported: readonly string[] = getSupportedTimezones(),
): string[] {
  return [...new Set([
    ...supported,
    ...(savedTimezone ? [savedTimezone] : []),
    ...(deviceTimezone ? [deviceTimezone] : []),
    "UTC",
  ])].sort((a, b) => a.localeCompare(b));
}

export function resolveTimezone(
  configured: string | null,
  detectedDeviceTimezone: string | null = getDeviceTimezone(),
): {
  timezone: string;
  state: "configured" | "device" | "fallback" | "invalid";
} {
  const device = validTimezone(detectedDeviceTimezone)
    ? detectedDeviceTimezone
    : null;
  if (!configured) {
    return device
      ? { timezone: device, state: "device" }
      : { timezone: "UTC", state: "fallback" };
  }
  if (validTimezone(configured))
    return { timezone: configured, state: "configured" };
  return { timezone: device ?? "UTC", state: "invalid" };
}

export function localTime(
  date: Date,
  timezone: string,
  hour12 = false,
  showSeconds = false,
): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
    hour12,
  }).format(date);
}
