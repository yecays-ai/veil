// Presentation only: never normalize or replace the stored timezone ID.
// Whole-hour Etc/GMT IDs have reversed signs. Fractional choices use zones
// with the corresponding year-round offset, not a location lookup.
export const TIMEZONE_OFFSET_OPTIONS = [
  ...Array.from({ length: 27 }, (_, index) => {
    const hours = index - 12;
    return {
      minutes: hours * 60,
      timezone: hours === 0 ? "UTC" : `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`,
    };
  }),
  { minutes: -570, timezone: "Pacific/Marquesas" },
  { minutes: 210, timezone: "Asia/Tehran" },
  { minutes: 270, timezone: "Asia/Kabul" },
  { minutes: 330, timezone: "Asia/Kolkata" },
  { minutes: 345, timezone: "Asia/Kathmandu" },
  { minutes: 390, timezone: "Asia/Yangon" },
  { minutes: 525, timezone: "Australia/Eucla" },
  { minutes: 570, timezone: "Australia/Darwin" },
].sort((a, b) => a.minutes - b.minutes).map(({ minutes, timezone }) => {
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return {
    timezone,
    label: minutes === 0 ? "UTC" :
      `UTC${minutes < 0 ? "−" : "+"}${hours}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`,
  };
});

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
