import { BackupValidationError } from "./format";

// Explicitly authorized disposable development database. Never match a prefix or open its contents.
export const LEGACY_CHAT_DATABASE_NAME = "veil-chat-v1";
const DELETE_TIMEOUT_MS = 5000;

export function deleteLegacyChatDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (success) resolve();
      else reject(new BackupValidationError("legacy-cleanup-failed", "databases"));
    };
    const timer = setTimeout(() => finish(false), DELETE_TIMEOUT_MS);
    try {
      const request = factory.deleteDatabase(LEGACY_CHAT_DATABASE_NAME);
      request.onsuccess = () => finish(true);
      request.onerror = request.onblocked = () => finish(false);
      // Native deletion cannot be cancelled. A blocked request may finish later; this attempt still fails.
    } catch { finish(false); }
  });
}
