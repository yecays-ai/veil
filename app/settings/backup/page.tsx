import { PageShell } from "../../../components/page-shell";
import { BackupRestoreSettings } from "../../../components/settings/backup-restore";

export default function Page() {
  return (
    <PageShell
      className="settings-app"
      title="Backup & Restore"
      backHref="/settings"
      backLabel="Back to Settings"
    >
      <BackupRestoreSettings />
    </PageShell>
  );
}

