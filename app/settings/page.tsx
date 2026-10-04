import { PageShell } from "../../components/settings/ui/page-shell";
import { CardGrid } from "../../components/settings/ui/card-grid";
export default function Page() {
  return (
    <PageShell title="Settings" backHref="/" backLabel="Back to Home">
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
