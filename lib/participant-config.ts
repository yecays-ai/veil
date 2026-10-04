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
export type WeatherState =
  | { status: "not-configured" }
  | { status: "loading" }
  | {
      status: "ready";
      temperatureC: number;
      summary: string;
      updatedAt: string;
    }
  | { status: "error"; message: string };
export type WeatherRequest = { coordinates: Coordinates; timezone: string };
// Future adapter: manually selected city → coordinates → weather provider.
export interface WeatherProvider {
  getWeather(request: WeatherRequest): Promise<WeatherState>;
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
