"use client";

import Link from "next/link";
import { APP_REGISTRY, type AppId } from "../lib/app-registry";
import { useTheme } from "./theme-provider";

function AppIcon({ id }: { id: AppId }) {
  const { document } = useTheme();
  const app = APP_REGISTRY.find((app) => app.id === id)!;
  const source = document.current.profile.icons[id];
  return (
    <Link className="home-app" href={app.href}>
      <span className="home-icon">
        <span aria-hidden="true">{app.glyph}</span>
        {/* User-provided URLs and inline uploads do not require Next image hosting configuration. */}
        {source && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt=""
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
            onLoad={(event) => {
              event.currentTarget.style.visibility = "visible";
            }}
          />
        )}
      </span>
      <span>{app.label}</span>
    </Link>
  );
}

export function HomeScreen() {
  const { document } = useTheme();
  const { profile, iconLayout, dockLayout } = document.current;
  const wallpaper = profile.wallpaper;
  return (
    <div className="home-screen">
      {wallpaper.source && (
        <div
          className="home-wallpaper"
          data-testid="home-wallpaper"
          style={{
            backgroundImage: `url(${JSON.stringify(wallpaper.source)})`,
            backgroundSize: wallpaper.fit,
            backgroundPosition: `${wallpaper.x}% ${wallpaper.y}%`,
            opacity: wallpaper.opacity,
            filter: `blur(${wallpaper.blur}px)`,
            transform: `scale(${wallpaper.scale / 100})`,
          }}
        />
      )}
      <div className="home-foreground">
        <h1>Companion Phone</h1>
        <nav className="home-apps" aria-label="Apps">
          {iconLayout.map((id) => (
            <AppIcon key={id} id={id} />
          ))}
        </nav>
        <nav
          className="home-dock"
          aria-label="Dock"
          style={{
            borderRadius: profile.dock.radius,
            backgroundImage: profile.dock.image
              ? `url(${JSON.stringify(profile.dock.image)})`
              : undefined,
          }}
        >
          {dockLayout.length ? (
            dockLayout.map((id) => <AppIcon key={id} id={id} />)
          ) : (
            <span>Dock</span>
          )}
        </nav>
      </div>
    </div>
  );
}
