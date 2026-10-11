import type { FoundationDocument } from "../foundation-types";
import type { ThemeDocument } from "../theme-types";
import type { BindingDocument } from "../bindings";
import type { PresetDocument } from "../preset";
import type { RegexDocument } from "../regex";
import type { WorldBookDocument } from "../worldbook";
import type { ContactDocument } from "../contact-storage";
import type { PresenceDocument } from "../presence/storage";
import type { NamedApiConfig } from "../api-config";
import type { ChatSession, ChatMessage, ChatBackgroundSettings, GlobalProfileSettings } from "../chat/types";
import type { WorldBookActivationState } from "../worldbook-activation";

export const BACKUP_SCHEMA = "veil.full-backup";
export const BACKUP_VERSION = 1;
/** Backup-domain versions describe this format, not IndexedDB versions or name suffixes. */
export const BACKUP_DOMAIN_VERSIONS = {
  foundation: 1, appearance: 1, bindings: 1, presets: 3, regex: 1,
  worldbooks: 1, contacts: 1, presence: 1, chat: 1, apiConfigs: 1,
} as const;
export type BackupDomain = keyof typeof BACKUP_DOMAIN_VERSIONS;
export type BackupAssetDomain = "appearance" | "chat";
export type BackupFile = { path: string; bytes: number; sha256: string };
export type BackupSection = BackupFile & { domain: BackupDomain; version: number; records: number };
export type BackupAsset = BackupFile & {
  domain: BackupAssetDomain; id: string; mime: string; createdAt: number;
};
export type BackupManifest = {
  schema: typeof BACKUP_SCHEMA; version: typeof BACKUP_VERSION;
  backupId: string; createdAt: number; sourceCommit: string;
  credentials: "excluded"; domains: BackupSection[]; assets: BackupAsset[];
};
/** Key absence is represented by null, not synthesized defaults. */
export type BackupData = {
  foundation: FoundationDocument | null;
  appearance: ThemeDocument | null;
  bindings: BindingDocument | null;
  presets: PresetDocument | null;
  regex: RegexDocument | null;
  worldbooks: WorldBookDocument | null;
  contacts: ContactDocument | null;
  presence: PresenceDocument | null;
  chat: {
    sessions: ChatSession[]; messages: ChatMessage[];
    chatSettings: (ChatBackgroundSettings | GlobalProfileSettings)[];
    worldBookStates: { id: string; state: WorldBookActivationState }[];
  };
  apiConfigs: Omit<NamedApiConfig, "apiKey">[];
};
export type BackupWarning = { code: "credentials-required" | "external-image" | "missing-quote"; path: string };
export type ValidatedBackup = { manifest: BackupManifest; data: BackupData; warnings: BackupWarning[] };
export class BackupValidationError extends Error {
  constructor(readonly code: string, readonly path: string) {
    // Never include user text, provider URLs, keys, or native parser errors.
    super(`Backup validation failed (${code}) at ${path}.`);
    this.name = "BackupValidationError";
  }
}
