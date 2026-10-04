import { PageShell } from "../../components/page-shell";
import { CardGrid } from "../../components/settings/ui/card-grid";
export default function Page() {
  return (
    <PageShell
      className="settings-app"
      title="Settings"
      backHref="/"
      backLabel="Back to Home"
    >
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
    </PageShell>
  );
}
