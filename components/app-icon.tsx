"use client";

import Link from "next/link";
import { APP_REGISTRY, type AppId } from "../lib/app-registry";
import { useTheme } from "./theme-provider";

export function AppIcon({
  id,
  editing = false,
  selected = false,
  onSelect,
  actionLabel,
  disabled = false,
}: {
  id: AppId;
  editing?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  actionLabel?: string;
  disabled?: boolean;
}) {
  const { document } = useTheme();
  const app = APP_REGISTRY.find((app) => app.id === id);
  if (!app) return null;
  const source = document.current.profile.icons[id];
  const content = (
    <>
      <span className="home-icon">
        <span aria-hidden="true">{app.glyph}</span>
        {source && (
          // User uploads and external URLs use the browser image loader.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt=""
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
            onLoad={(e) => {
              e.currentTarget.style.visibility = "visible";
            }}
          />
        )}
      </span>
      <span className="home-app-label">{app.label}</span>
    </>
  );
  return editing ? (
    <button
      className={`home-app${selected ? " is-selected" : ""}`}
      aria-label={actionLabel ?? `Move ${app.label}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      {content}
    </button>
  ) : (
    <Link className="home-app" href={app.href}>
      {content}
    </Link>
  );
}
