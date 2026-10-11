import { PageShell } from "../../components/page-shell";
import { CardGrid } from "../../components/settings/ui/card-grid";
import { RuntimeSettings } from "../../components/settings/runtime-settings";
import { Archive, BookOpen, GitBranch, Regex, SlidersHorizontal } from "lucide-react";
export default function Page() {
  return (
    <PageShell
      className="settings-app"
      title="Settings"
      backHref="/"
      backLabel="Back to Home"
    >
      <RuntimeSettings />
      <CardGrid
        label="API configuration"
        items={[
          {
            id: "text-api",
            label: "Text API",
            description: "Providers and models for your conversations",
            href: "/settings/text-api",
            icon: "Aa",
          },
        ]}
      />
      <CardGrid
        label="Data & Rules"
        items={[
          {
            id: "presets",
            label: "Presets",
            description: "Prompt pipelines and reply settings",
            href: "/settings/presets",
            icon: <SlidersHorizontal size={20} />,
          },
          {
            id: "bindings",
            label: "Bindings",
            description: "Defaults and Character choices",
            href: "/settings/bindings",
            icon: <GitBranch size={20} />,
          },
          {
            id: "worldbooks",
            label: "WorldBooks",
            description: "Conversation lore and keyword activation",
            href: "/settings/worldbooks",
            icon: <BookOpen size={20} />,
          },
          {
            id: "regex",
            label: "Regex",
            description: "Chat formatting & custom rules",
            href: "/settings/regex",
            icon: <Regex size={20} />,
          },
        ]}
      />
      <CardGrid
        label="Data"
        items={[
          {
            id: "backup-and-restore",
            label: "Backup & Restore",
            description: "Export or import a local backup",
            href: "/settings/backup",
            icon: <Archive size={20} />,
          },
        ]}
      />
    </PageShell>
  );
}

