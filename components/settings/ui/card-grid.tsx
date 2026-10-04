import Link from "next/link";
import type { ReactNode } from "react";
import { Chevron } from "../../page-shell";

// The reference CardGrid's label/body/icon/chevron structure, using VEIL routes.
export function CardGrid({
  label,
  items,
}: {
  label: string;
  items: {
    id: string;
    label: string;
    description: string;
    href: string;
    icon: ReactNode;
  }[];
}) {
  return (
    <section>
      <h2 className="settings-section-label">{label}</h2>
      <nav className="settings-card-grid" aria-label={label}>
        {items.map((item) => (
          <Link className="settings-card" key={item.id} href={item.href}>
            <span className="settings-card-copy">
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </span>
            <span className="settings-card-icon" aria-hidden="true">
              {item.icon}
            </span>
            <Chevron forward />
          </Link>
        ))}
      </nav>
    </section>
  );
}
