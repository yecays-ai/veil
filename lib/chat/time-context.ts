import { validTimezone } from "../foundation-types";
import { getDeviceTimezone } from "../participant-config";

function localDateTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return { date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`, weekday: value("weekday"), timezone };
}

export function buildTimeContext(
  now: Date,
  userTimezone?: string | null,
  characterTimezone?: string | null,
  deviceTimezone: string | null = getDeviceTimezone(),
  weather?: RuntimeWeatherContext,
) {
  const userZone = validTimezone(userTimezone) ?? validTimezone(deviceTimezone) ?? "UTC";
  const characterZone = validTimezone(characterTimezone) ?? userZone;
  const user = localDateTime(now, userZone);
  const character = localDateTime(now, characterZone);
  const differentDate = user.date !== character.date;
  const differentLocalTime = differentDate || user.time !== character.time;
  const content = [
    "Current time context:",
    `Current instant (UTC): ${now.toISOString()}`,
    "", "User local time:", `${user.date} ${user.time}, ${user.weekday}`,
    `Timezone: ${user.timezone}`,
    "", "Character local time:", `${character.date} ${character.time}, ${character.weekday}`,
    `Timezone: ${character.timezone}`,
    "", `Local dates differ: ${differentDate ? "yes" : "no"}. Local times differ: ${differentLocalTime ? "yes" : "no"}.`,
    "Use each person's own local time when interpreting greetings, sleep/wake state, day/night, work hours, dates, and relative time.",
    "", "Recent History timestamp boundary:",
    "The bracketed timestamp lines [YYYY-MM-DD HH:mm Timezone] attached to Recent History are VEIL runtime metadata, not message content or Character speech.",
    "Use them only to understand when messages occurred.",
    "Never reproduce, quote, imitate, paraphrase, or include these timestamp lines in your reply.",
    "Your reply must contain only the Character's actual message text.",
    ...weatherLines(weather),
  ].join("\n");
  return { user, character, differentDate, differentLocalTime, content };
}

export type RuntimeWeatherFact = {
  location: string;
  temperatureC: number;
  summary: string;
};

export type RuntimeWeatherContext = {
  user?: RuntimeWeatherFact;
  character?: RuntimeWeatherFact;
};

function weatherLines(weather?: RuntimeWeatherContext): string[] {
  if (!weather?.user && !weather?.character) return [];
  return [
    "",
    "Current weather facts (use only when relevant; do not proactively report them):",
    ...(weather.user ? [
      "User current weather:",
      `Location: ${weather.user.location}`,
      `Temperature: ${weather.user.temperatureC}°C`,
      `Conditions: ${weather.user.summary}`,
    ] : []),
    ...(weather.character ? [
      "Character current weather:",
      `Location: ${weather.character.location}`,
      `Temperature: ${weather.character.temperatureC}°C`,
      `Conditions: ${weather.character.summary}`,
    ] : []),
  ];
}

export function historyTimestamp(createdAt: number, userTimezone: string) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return "";
  const local = localDateTime(date, userTimezone);
  return `[${local.date} ${local.time} ${local.timezone}]`;
}
