import type { ChatMessage } from "../chat/types";

/** Content/identity digest only; order and annotations can change without replacing the evidence. */
export async function memorySourceHash(message: ChatMessage): Promise<string> {
  const value = { id: message.id, sessionId: message.sessionId, role: message.role, content: message.content,
    status: message.status, attemptId: message.attemptId,
    attemptFor: message.attemptFor, turnId: message.turnId, memorySequence: message.memorySequence };
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SourceInvalidation = { messages: { messageId: string; hash: string }[] };
/** Hashes identify the old evidence without storing a second copy of its text. */
export function sourceInvalidationValid(value: unknown, ids: readonly string[]): value is SourceInvalidation {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !("messages" in value)
    || !Array.isArray(value.messages) || value.messages.length !== ids.length || ids.length < 1 || ids.length > 1_000) return false;
  return value.messages.every((row) => row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).length === 2
    && typeof row.messageId === "string" && ids.includes(row.messageId) && typeof row.hash === "string" && /^[a-f0-9]{64}$/.test(row.hash))
    && new Set(value.messages.map((row) => row.messageId)).size === ids.length;
}
