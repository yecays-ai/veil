/** Release authorization AND per-device consent are required. Neither is included in backups. */
export const MAINTENANCE_CONSENT_KEY = "veil.memory-maintenance.consent.v1";
export const MAINTENANCE_CONFIG_EVENT = "veil-memory-maintenance-config";
export function maintenanceReleaseApproved(): boolean {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED === "true"
    && process.env.NEXT_PUBLIC_VERCEL_ENV === "production" && !process.env.CI;
}
export function maintenanceEnabled(): boolean {
  if (!maintenanceReleaseApproved() || typeof window === "undefined") return false;
  try { return window.localStorage.getItem(MAINTENANCE_CONSENT_KEY) === "enabled"; } catch { return false; }
}
/** Configuration entry for later authorized activation; unavailable in today's default builds. */
export function setMaintenanceConsent(enabled: boolean): void {
  if (!maintenanceReleaseApproved()) throw new Error("Memory maintenance release has not been approved.");
  if (enabled) window.localStorage.setItem(MAINTENANCE_CONSENT_KEY, "enabled");
  else window.localStorage.removeItem(MAINTENANCE_CONSENT_KEY);
  window.dispatchEvent(new Event(MAINTENANCE_CONFIG_EVENT));
}
