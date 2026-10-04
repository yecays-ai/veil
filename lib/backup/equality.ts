import type { BackupChat } from "./types";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

export function sameBackupChat(a: BackupChat, b: BackupChat): boolean {
  const sorted = (chat: BackupChat) => ({
    version: 1,
    sessions: [...chat.sessions].sort((x, y) => x.id.localeCompare(y.id)),
    messages: [...chat.messages].sort(
      (x, y) =>
        x.sessionId.localeCompare(y.sessionId) ||
        x.order - y.order ||
        x.id.localeCompare(y.id),
    ),
  });
  return stableJson(sorted(a)) === stableJson(sorted(b));
}
