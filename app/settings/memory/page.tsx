import { PageShell } from "../../../components/page-shell";
import { MemoryMaintenanceSettings } from "../../../components/settings/memory-maintenance-settings";

export default function Page() {
  return (
    <PageShell
      className="settings-app"
      title="Memory Maintenance"
      backHref="/settings"
      backLabel="Back to Settings"
    >
      <MemoryMaintenanceSettings />
    </PageShell>
  );
}
