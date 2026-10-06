import { PageShell } from "./page-shell";

export function RouteLoading({ title, backHref, backLabel }: { title: string; backHref: string; backLabel: string }) {
  return <PageShell title={title} backHref={backHref} backLabel={backLabel} bodyClassName="route-loading">
    <p role="status">Loading…</p>
  </PageShell>;
}
