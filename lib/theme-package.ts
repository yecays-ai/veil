import { normalizeSnapshot, record, type ThemeSnapshot } from "./theme-types";

const SCHEMA = "companion-phone.theme";
export function exportTheme(snapshot: ThemeSnapshot): string {
  // Only whitelisted decoration fields; uploads are embedded as data URLs.
  return JSON.stringify(
    { schema: SCHEMA, version: 1, snapshot: normalizeSnapshot(snapshot) },
    null,
    2,
  );
}

export function importTheme(json: string): ThemeSnapshot {
  if (json.length > 3_000_000)
    throw new Error("Theme package is too large (maximum 3 MB).");
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(json));
  } catch {
    throw new Error("Invalid theme JSON.");
  }
  if (
    raw.schema !== SCHEMA ||
    raw.version !== 1 ||
    record(record(raw.snapshot).profile).version !== 1
  ) {
    throw new Error("This is not a supported Companion Phone theme package.");
  }
  return normalizeSnapshot(raw.snapshot);
}
