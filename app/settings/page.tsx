import { PageShell } from "../../components/page-shell";
import { CardGrid } from "../../components/settings/ui/card-grid";
import { RuntimeSettings } from "../../components/settings/runtime-settings";
import { BookOpen, SlidersHorizontal } from "lucide-react";
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
            id: "worldbooks",
            label: "WorldBooks",
            description: "Conversation lore and keyword activation",
            href: "/settings/worldbooks",
            icon: <BookOpen size={20} />,
          },
        ]}
      />
      <CardGrid
        label="Data"
        items={[
          {
            id: "backup",
            label: "Data & Backup",
            description: "Download a private copy of your data",
            href: "/settings/data",
            icon: "⇩",
          },
        ]}
      />
    </PageShell>
  );
}
