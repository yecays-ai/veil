export type StorageHealth = {
  supported: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
};

type StorageManagerLike = {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
};

export async function readStorageHealth(
  manager: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<StorageHealth> {
  if (!manager)
    return { supported: false, persisted: null, usage: null, quota: null };
  const [estimate, persisted] = await Promise.all([
    manager.estimate?.().catch(() => undefined),
    manager.persisted?.().catch(() => undefined),
  ]);
  return {
    supported: true,
    persisted: typeof persisted === "boolean" ? persisted : null,
    usage: finiteBytes(estimate?.usage),
    quota: finiteBytes(estimate?.quota),
  };
}

export async function requestPersistentStorage(
  manager: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<StorageHealth> {
  if (!manager?.persist)
    return readStorageHealth(manager);
  await manager.persist().catch(() => false);
  return readStorageHealth(manager);
}

function finiteBytes(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function storageUsageRatio(health: StorageHealth): number | null {
  if (health.usage === null || health.quota === null || health.quota <= 0)
    return null;
  return Math.min(1, health.usage / health.quota);
}

export function formatStorageBytes(value: number | null): string {
  if (value === null) return "Unknown";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  return `${amount < 10 ? amount.toFixed(1) : Math.round(amount)} ${units[unit]}`;
}
