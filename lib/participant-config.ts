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

export function resolveTimezone(configured: string | null): {
  timezone: string;
  state: "configured" | "device" | "invalid";
} {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!configured) return { timezone: device, state: "device" };
  try {
    new Intl.DateTimeFormat("en", { timeZone: configured }).format();
    return { timezone: configured, state: "configured" };
  } catch {
    return { timezone: device, state: "invalid" };
  }
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
