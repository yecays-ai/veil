export const MEMORY_DATABASE_NAME = "veil-memory-v1";
export const MEMORY_DATABASE_VERSION = 1;
export const MEMORY_OPERATION_LIMIT = 5;

export type MemoryStatus = "active" | "superseded" | "archived" | "flagged";
export type MemoryOrigin = "manual" | "auto";

/** A pointer to a persisted chat message. Chat text is never copied into Memory. */
export type MemorySource = { sessionId: string; messageId: string };

export type MemoryLineage = {
  /** Set on a merged memory: the originals it replaced. */
  mergedFrom?: string[];
  /** Set on a superseded original: the memory that replaced it. */
  supersededBy?: string;
};

export type Memory = {
  id: string;
  characterId: string;
  kind: string;
  text: string;
  subject: string;
  status: MemoryStatus;
  origin: MemoryOrigin;
  sources: MemorySource[];
  lineage: MemoryLineage;
  /** Normalized-text fingerprint; always derived by the store, never trusted from callers. */
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
};

/** What callers provide; the store derives fingerprint and timestamps. */
export type MemoryDraft = Omit<Memory, "fingerprint" | "createdAt" | "updatedAt">;

export type Suppression = {
  id: string;
  characterId: string;
  fingerprint: string;
  reason: "corrected" | "deleted";
  sources: MemorySource[];
  createdAt: number;
};

export type MemoryChange = { before: Memory | null; after: Memory | null };

/** Undo record: the last MEMORY_OPERATION_LIMIT per Character are kept. */
export type MemoryOperation = {
  id: string;
  characterId: string;
  seq: number;
  label: string;
  createdAt: number;
  changes: MemoryChange[];
  /** Suppression rows written by this operation, so undo can reverse them. */
  suppressionChanges?: { before: Suppression | null; after: Suppression }[];
};

/** One row per Character+session: extraction progress, failure state, and a pending clear intent. */
export type MemoryCursor = {
  id: string;
  characterId: string;
  sessionId: string;
  processedMessageId?: string;
  failureCount: number;
  failureReason?: string;
  clearRequestedAt?: number;
  updatedAt: number;
};
