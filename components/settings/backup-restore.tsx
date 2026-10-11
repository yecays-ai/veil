export function BackupRestoreSettings() {
  return (
    <section>
      <h2 className="settings-section-label">Backup &amp; Restore</h2>
      <div className="settings-backup-grid">
        {[
          { id: "export-backup", label: "Export Backup" },
          { id: "import-backup", label: "Import Backup" },
        ].map((action) => (
          <button
            className="settings-card settings-backup-action"
            disabled
            key={action.id}
            type="button"
          >
            <span className="settings-card-copy">
              <strong>{action.label}</strong>
              <span>Not available yet.</span>
            </span>
            <span className="settings-backup-status">Coming Soon</span>
          </button>
        ))}
      </div>
    </section>
  );
}

