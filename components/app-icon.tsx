"use client";

import Link from "next/link";
import { APP_REGISTRY, type AppId } from "../lib/app-registry";
import { useTheme } from "./theme-provider";

export function AppIcon({
  id,
  editing = false,
  selected = false,
  onSelect,
}: {
  id: AppId;
  editing?: boolean;
  selected?: boolean;
  onSelect?: () => void;
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
      aria-label={`Move ${app.label}`}
      aria-pressed={selected}
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
