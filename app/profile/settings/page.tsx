import "../../settings/settings.css";
import { PageShell } from "../../../components/page-shell";
import { GlobalProfileSettings } from "../../../components/settings/global-profile-settings";

export default function Page() {
  return (
    <PageShell
      className="settings-app profile-chat-settings"
      title="Settings"
      backHref="/profile"
      backLabel="Back to Profile"
    >
      <GlobalProfileSettings />
    </PageShell>
  );
}
