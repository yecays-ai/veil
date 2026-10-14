/** Release authorization AND per-device consent are required. Neither is included in backups. */
export const MAINTENANCE_CONSENT_KEY = "veil.memory-maintenance.consent.v1";
export const MAINTENANCE_CONFIG_EVENT = "veil-memory-maintenance-config";
/** Each build-time release condition, so Settings can name the one that is missing. All must hold. */
export function maintenanceReleaseChecks() {
  return { productionBuild: process.env.NODE_ENV === "production",
    approvalFlag: process.env.NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED === "true",
    vercelProduction: process.env.NEXT_PUBLIC_VERCEL_ENV === "production", notCi: !process.env.CI };
}
export function maintenanceReleaseApproved(): boolean {
  const checks = maintenanceReleaseChecks();
  return checks.productionBuild && checks.approvalFlag && checks.vercelProduction && checks.notCi;
}
/** This device's stored consent only; it never authorizes anything without the release approval. */
export function maintenanceConsentStored(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(MAINTENANCE_CONSENT_KEY) === "enabled"; } catch { return false; }
}
export function maintenanceEnabled(): boolean {
  return maintenanceReleaseApproved() && maintenanceConsentStored();
}
/** Device switch for Settings → Memory Maintenance. Refused unless this build's release is approved. */
export function setMaintenanceConsent(enabled: boolean): void {
  if (!maintenanceReleaseApproved()) throw new Error("Memory maintenance release has not been approved.");
  if (enabled) window.localStorage.setItem(MAINTENANCE_CONSENT_KEY, "enabled");
  else window.localStorage.removeItem(MAINTENANCE_CONSENT_KEY);
  window.dispatchEvent(new Event(MAINTENANCE_CONFIG_EVENT));
}
