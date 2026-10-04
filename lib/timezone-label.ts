// Presentation only: never normalize or replace the stored timezone ID.
export function timezoneLabel(timezone: string, now = new Date()): string {
  try {
    const offset = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value;
    return offset?.replace(/^GMT(?:\+0)?$/, "UTC")
      .replace(/^GMT/, "UTC").replace("-", "−") ?? "Timezone unavailable";
  } catch {
    return "Timezone unavailable";
  }
}
